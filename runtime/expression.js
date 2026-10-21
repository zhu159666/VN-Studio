// 阶段五：条件表达式白名单求值器（纯 ESM，无 DOM / 无 eval / 无 new Function）。
// 语法与语义严格按 schema/FIELDS.md 第 8 节：
//   - 手写词法分析 + 递归下降解析，只读变量表，没有任何副作用；
//   - `.` / `[]` 只读自有属性，`__proto__` / `constructor` / `prototype` 键一律求值错误；
//   - 未知标识符 / 语法错误 / 类型错误 / 除零 / 参数个数错误 → { ok:false, error }；
//   - 成员或下标不存在 → null（不算错误，方便 isNull 判断）。
//
// 对外只暴露 evaluateExpression（以及可选的 ExpressionError）。本模块不打印日志：
// 警告由调用方（engine.js 的 condition 节点处理）统一收集到 engine.warnings 并 console.warn，
// 这样一次求值最多产生一条带表达式文本的警告（FIELDS 8.10）。

/** 表达式求值错误（语法 / 类型 / 白名单限制等）。 */
export class ExpressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/** 禁止通过 `.` / `[]` 读取的原型链键名。 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** 表达式最大嵌套深度（防止恶意/误输入的超深表达式打爆调用栈）。 */
const MAX_DEPTH = 200;

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

/* ------------------------------------------------------------------ */
/* 词法分析                                                            */
/* ------------------------------------------------------------------ */

const TWO_CHAR_OPERATORS = new Set(['==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPERATORS = new Set(['!', '-', '+', '*', '/', '%', '<', '>']);
const PUNCTUATION = new Set(['(', ')', '[', ']', '.', ',']);

const ESCAPES = {
  '\\': '\\',
  '"': '"',
  "'": "'",
  n: '\n',
  t: '\t',
  r: '\r',
};

function describeToken(token) {
  if (!token || token.type === 'eof') return '表达式结尾';
  if (token.type === 'string') return `字符串 "${token.value}"`;
  return `"${token.raw ?? token.value}"`;
}

function readString(source, startIndex) {
  const quote = source[startIndex];
  let index = startIndex + 1;
  let value = '';
  while (index < source.length) {
    const char = source[index];
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    if (char === '\\') {
      const escaped = source[index + 1];
      if (escaped === undefined) throw new ExpressionError('语法错误：字符串未闭合');
      if (escaped === 'u') {
        const hex = source.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ExpressionError('语法错误：\\u 转义需要 4 位十六进制数');
        value += String.fromCharCode(parseInt(hex, 16));
        index += 6;
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(ESCAPES, escaped)) {
        throw new ExpressionError(`语法错误：不支持的转义字符 \\${escaped}`);
      }
      value += ESCAPES[escaped];
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }
  throw new ExpressionError('语法错误：字符串未闭合');
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1;
      continue;
    }
    if (DIGIT.test(char)) {
      const start = index;
      while (index < source.length && DIGIT.test(source[index])) index += 1;
      if (source[index] === '.' && DIGIT.test(source[index + 1] ?? '')) {
        index += 1;
        while (index < source.length && DIGIT.test(source[index])) index += 1;
      }
      const raw = source.slice(start, index);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExpressionError(`数字超出可表示范围：${raw}`);
      tokens.push({ type: 'number', value, raw });
      continue;
    }
    if (char === '"' || char === "'") {
      const result = readString(source, index);
      tokens.push({ type: 'string', value: result.value });
      index = result.nextIndex;
      continue;
    }
    if (IDENT_START.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && IDENT_PART.test(source[index])) index += 1;
      const name = source.slice(start, index);
      if (name === 'true') tokens.push({ type: 'literal', value: true });
      else if (name === 'false') tokens.push({ type: 'literal', value: false });
      else if (name === 'null') tokens.push({ type: 'literal', value: null });
      else if (name === 'in') tokens.push({ type: 'operator', value: 'in' });
      else tokens.push({ type: 'ident', value: name });
      continue;
    }
    const two = source.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      tokens.push({ type: 'operator', value: two });
      index += 2;
      continue;
    }
    if (ONE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ type: 'punct', value: char });
      index += 1;
      continue;
    }
    throw new ExpressionError(`语法错误：非法字符 "${char}"`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

/* ------------------------------------------------------------------ */
/* 语法分析（按照 FIELDS 8.2 的 EBNF 与 8.3 的优先级）                  */
/* ------------------------------------------------------------------ */

function parse(tokens) {
  let position = 0;

  const peek = () => tokens[position];
  const advance = () => tokens[position++];
  const isOperator = (value) => {
    const token = peek();
    return token.type === 'operator' && token.value === value;
  };
  const isPunct = (value) => {
    const token = peek();
    return token.type === 'punct' && token.value === value;
  };
  const expectPunct = (value, hint) => {
    const token = peek();
    if (token.type !== 'punct' || token.value !== value) {
      throw new ExpressionError(`语法错误：${hint ?? `期望 "${value}"`}，实际 ${describeToken(token)}`);
    }
    position += 1;
  };

  function parsePrimary() {
    const token = peek();
    if (token.type === 'number' || token.type === 'string' || token.type === 'literal') {
      advance();
      return { type: 'literal', value: token.value };
    }
    // 数组字面量：FIELDS 8.2 的 EBNF 未列出，但 8.11 的示例 `last_choice in ["buy", "wait"]`
    // 明确使用，因此按“安全超集”支持（只读字面量，无副作用风险）。
    if (isPunct('[')) {
      advance();
      const items = [];
      if (!isPunct(']')) {
        items.push(parseOr());
        while (isPunct(',')) {
          advance();
          items.push(parseOr());
        }
      }
      expectPunct(']', '数组字面量缺少 "]"');
      return { type: 'array', items };
    }
    if (token.type === 'ident') {
      advance();
      if (isPunct('(')) {
        advance();
        const args = [];
        if (!isPunct(')')) {
          args.push(parseOr());
          while (isPunct(',')) {
            advance();
            args.push(parseOr());
          }
        }
        expectPunct(')', '函数调用的参数列表缺少 ")"');
        return { type: 'call', name: token.value, args };
      }
      return { type: 'ident', name: token.value };
    }
    if (isPunct('(')) {
      advance();
      const expression = parseOr();
      expectPunct(')', '括号未闭合');
      return expression;
    }
    throw new ExpressionError(`语法错误：意外的记号 ${describeToken(token)}`);
  }

  function parsePostfix() {
    let node = parsePrimary();
    for (;;) {
      if (isPunct('.')) {
        advance();
        const token = peek();
        if (token.type !== 'ident') {
          throw new ExpressionError(`语法错误："." 后需要成员名，实际 ${describeToken(token)}`);
        }
        advance();
        node = { type: 'member', object: node, property: token.value };
        continue;
      }
      if (isPunct('[')) {
        advance();
        const index = parseOr();
        expectPunct(']', '下标缺少 "]"');
        node = { type: 'index', object: node, index };
        continue;
      }
      return node;
    }
  }

  function parseUnary() {
    if (isOperator('!') || isOperator('-')) {
      const operator = advance().value;
      return { type: 'unary', op: operator, argument: parseUnary() };
    }
    return parsePostfix();
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (isOperator('*') || isOperator('/') || isOperator('%')) {
      const op = advance().value;
      left = { type: 'binary', op, left, right: parseUnary() };
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (isOperator('+') || isOperator('-')) {
      const op = advance().value;
      left = { type: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseRelational() {
    let left = parseAdditive();
    while (isOperator('<') || isOperator('<=') || isOperator('>') || isOperator('>=') || isOperator('in')) {
      const op = advance().value;
      left = { type: 'binary', op, left, right: parseAdditive() };
    }
    return left;
  }

  function parseEquality() {
    let left = parseRelational();
    while (isOperator('==') || isOperator('!=')) {
      const op = advance().value;
      left = { type: 'binary', op, left, right: parseRelational() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseEquality();
    while (isOperator('&&')) {
      advance();
      left = { type: 'binary', op: '&&', left, right: parseEquality() };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (isOperator('||')) {
      advance();
      left = { type: 'binary', op: '||', left, right: parseAnd() };
    }
    return left;
  }

  const ast = parseOr();
  const trailing = peek();
  if (trailing.type !== 'eof') {
    throw new ExpressionError(`语法错误：多余的记号 ${describeToken(trailing)}`);
  }
  return ast;
}

/* ------------------------------------------------------------------ */
/* 类型 / 相等 / 真值 / 显示字符串                                      */
/* ------------------------------------------------------------------ */

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** FIELDS 8.7 的六种标签：number / string / boolean / array / object / null。 */
function typeLabel(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind === 'number' || kind === 'string' || kind === 'boolean') return kind;
  return 'object';
}

/** FIELDS 8.7 真值表：false / 0（含 -0）/ "" / null 为假，数组与对象恒为真。 */
function truthy(value) {
  if (value === null || value === undefined || value === false) return false;
  const kind = typeof value;
  if (kind === 'number') return value !== 0;
  if (kind === 'string') return value !== '';
  return true;
}

/** 深度相等（array / object 递归比较，对象键顺序无关；不同类型恒不相等）。 */
function deepEqual(left, right) {
  const leftType = typeLabel(left);
  if (leftType !== typeLabel(right)) return false;
  if (leftType === 'null') return true;
  if (leftType === 'array') {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (leftType === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!hasOwn(right, key)) return false;
      if (!deepEqual(left[key], right[key])) return false;
    }
    return true;
  }
  return left === right;
}

/** FIELDS 8.7 的 display 转换：number / boolean / null 可拼接到字符串，array / object 报类型错误。 */
function toDisplayString(value) {
  const kind = typeLabel(value);
  if (kind === 'string') return value;
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new ExpressionError('类型错误：数值超出可表示范围');
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toPrecision(12)));
  }
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'null') return 'null';
  throw new ExpressionError(`类型错误：${kind} 不能参与字符串拼接`);
}

/** 按 Unicode 码点字典序比较两个字符串。 */
function compareCodePoints(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

/* ------------------------------------------------------------------ */
/* 成员 / 下标（只读自有属性）                                          */
/* ------------------------------------------------------------------ */

function toArrayIndex(key) {
  if (typeof key === 'number') {
    if (!Number.isInteger(key) || key < 0) return null;
    return key;
  }
  if (typeof key === 'string' && ARRAY_INDEX.test(key)) return Number(key);
  return null;
}

function readMember(object, key) {
  if (object === null || object === undefined) return null;
  if (typeof object === 'string') {
    if (key === 'length') return Array.from(object).length;
    const index = toArrayIndex(key);
    if (index === null) return null;
    const points = Array.from(object);
    return index < points.length ? points[index] : null;
  }
  if (Array.isArray(object)) {
    if (key === 'length') return object.length;
    const index = toArrayIndex(key);
    if (index !== null) return index < object.length ? object[index] : null;
    if (typeof key === 'string' && hasOwn(object, key)) return object[key];
    return null;
  }
  if (typeof object === 'object') {
    const property = typeof key === 'string' ? key : typeof key === 'number' ? String(key) : null;
    if (property === null) return null;
    return hasOwn(object, property) ? object[property] : null;
  }
  // number / boolean 没有可读的自有属性。
  return null;
}

/** FIELDS 8.5：`in` 的三种语义，其他组合返回 false（不报错）。 */
function inOperator(left, right) {
  const rightType = typeLabel(right);
  if (rightType === 'array') return right.some((item) => deepEqual(left, item));
  if (rightType === 'string') return typeof left === 'string' && right.includes(left);
  if (rightType === 'object') return typeof left === 'string' && hasOwn(right, left);
  return false;
}

/* ------------------------------------------------------------------ */
/* 白名单函数                                                          */
/* ------------------------------------------------------------------ */

function assertArity(name, args, min, max) {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min} 个参数` : `${min}–${max === Infinity ? '任意' : max} 个参数`;
    throw new ExpressionError(`参数个数错误：${name} 需要 ${expected}，实际收到 ${args.length} 个`);
  }
}

function requireNumberArgument(name, value, position) {
  if (typeof value !== 'number') {
    throw new ExpressionError(`${name} 的参数 ${position} 必须是 number，实际是 ${typeLabel(value)}`);
  }
  return value;
}

function callFunction(name, args) {
  switch (name) {
    case 'len': {
      assertArity(name, args, 1, 1);
      const value = args[0];
      const kind = typeLabel(value);
      if (kind === 'string') return Array.from(value).length;
      if (kind === 'array') return value.length;
      if (kind === 'object') return Object.keys(value).length;
      throw new ExpressionError(`len 的参数必须是 string / array / object，实际是 ${kind}`);
    }
    case 'type': {
      assertArity(name, args, 1, 1);
      return typeLabel(args[0]);
    }
    case 'isNumber':
    case 'isString':
    case 'isBoolean':
    case 'isArray':
    case 'isObject':
    case 'isNull': {
      assertArity(name, args, 1, 1);
      const expected = name.slice(2).toLowerCase();
      return typeLabel(args[0]) === expected;
    }
    case 'abs': {
      assertArity(name, args, 1, 1);
      return Math.abs(requireNumberArgument(name, args[0], 1));
    }
    case 'floor': {
      assertArity(name, args, 1, 1);
      return Math.floor(requireNumberArgument(name, args[0], 1));
    }
    case 'ceil': {
      assertArity(name, args, 1, 1);
      return Math.ceil(requireNumberArgument(name, args[0], 1));
    }
    case 'round': {
      assertArity(name, args, 1, 1);
      // Math.round 的半数向 +∞ 取整，符合 FIELDS 8.8。
      return Math.round(requireNumberArgument(name, args[0], 1));
    }
    case 'min':
    case 'max': {
      assertArity(name, args, 1, Infinity);
      const numbers = args.map((value, index) => requireNumberArgument(name, value, index + 1));
      return name === 'min' ? Math.min(...numbers) : Math.max(...numbers);
    }
    default:
      throw new ExpressionError(`未知函数：${name}`);
  }
}

/* ------------------------------------------------------------------ */
/* 求值                                                               */
/* ------------------------------------------------------------------ */

function evaluateAst(node, variables, depth) {
  if (depth > MAX_DEPTH) throw new ExpressionError('语法错误：表达式嵌套过深');
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'array':
      return node.items.map((item) => evaluateAst(item, variables, depth + 1));
    case 'ident': {
      if (!hasOwn(variables, node.name)) throw new ExpressionError(`未知标识符：${node.name}`);
      return variables[node.name];
    }
    case 'unary': {
      const value = evaluateAst(node.argument, variables, depth + 1);
      if (node.op === '!') return !truthy(value);
      if (typeof value !== 'number') {
        throw new ExpressionError(`类型错误：一元 - 需要 number，实际是 ${typeLabel(value)}`);
      }
      return -value;
    }
    case 'member': {
      if (FORBIDDEN_KEYS.has(node.property)) {
        throw new ExpressionError(`禁止访问原型链属性：${node.property}`);
      }
      const object = evaluateAst(node.object, variables, depth + 1);
      return readMember(object, node.property);
    }
    case 'index': {
      const object = evaluateAst(node.object, variables, depth + 1);
      const key = evaluateAst(node.index, variables, depth + 1);
      if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) {
        throw new ExpressionError(`禁止访问原型链属性：${key}`);
      }
      return readMember(object, key);
    }
    case 'call': {
      const args = node.args.map((argument) => evaluateAst(argument, variables, depth + 1));
      return callFunction(node.name, args);
    }
    case 'binary': {
      const op = node.op;
      if (op === '&&') {
        const left = evaluateAst(node.left, variables, depth + 1);
        if (!truthy(left)) return false;
        return truthy(evaluateAst(node.right, variables, depth + 1));
      }
      if (op === '||') {
        const left = evaluateAst(node.left, variables, depth + 1);
        if (truthy(left)) return true;
        return truthy(evaluateAst(node.right, variables, depth + 1));
      }
      const left = evaluateAst(node.left, variables, depth + 1);
      const right = evaluateAst(node.right, variables, depth + 1);
      switch (op) {
        case '+': {
          if (typeof left === 'number' && typeof right === 'number') return left + right;
          if (typeof left === 'string' || typeof right === 'string') {
            return toDisplayString(left) + toDisplayString(right);
          }
          throw new ExpressionError(`类型错误：${typeLabel(left)} 与 ${typeLabel(right)} 不能使用 +`);
        }
        case '-':
        case '*':
        case '/':
        case '%': {
          if (typeof left !== 'number' || typeof right !== 'number') {
            throw new ExpressionError(`类型错误：${op} 需要两个 number，实际是 ${typeLabel(left)} 与 ${typeLabel(right)}`);
          }
          if ((op === '/' || op === '%') && right === 0) {
            throw new ExpressionError('除零错误：除数不能为 0');
          }
          if (op === '-') return left - right;
          if (op === '*') return left * right;
          if (op === '/') return left / right;
          return left % right;
        }
        case '==':
          return deepEqual(left, right);
        case '!=':
          return !deepEqual(left, right);
        case '<':
        case '<=':
        case '>':
        case '>=': {
          let comparison;
          if (typeof left === 'number' && typeof right === 'number') comparison = left - right;
          else if (typeof left === 'string' && typeof right === 'string') comparison = compareCodePoints(left, right);
          else return false; // FIELDS 8.6：其他组合返回 false（不报错）
          if (op === '<') return comparison < 0;
          if (op === '<=') return comparison <= 0;
          if (op === '>') return comparison > 0;
          return comparison >= 0;
        }
        case 'in':
          return inOperator(left, right);
        default:
          throw new ExpressionError(`语法错误：未知运算符 ${op}`);
      }
    }
    default:
      throw new ExpressionError(`语法错误：未知语法节点 ${node.type}`);
  }
}

/**
 * 按 FIELDS 第 8 节白名单求值一个条件表达式。
 * @param {string} expression 表达式文本
 * @param {object} [variables] 普通 JS 值变量表（不是 typedValue）
 * @returns {{ok:true, value:any} | {ok:false, error:string}}
 */
export function evaluateExpression(expression, variables) {
  if (typeof expression !== 'string') {
    return { ok: false, error: '表达式必须是字符串' };
  }
  const scope = variables === null || variables === undefined ? {} : variables;
  if (typeof scope !== 'object' || Array.isArray(scope)) {
    return { ok: false, error: '变量表必须是对象' };
  }
  try {
    const tokens = tokenize(expression);
    const ast = parse(tokens);
    return { ok: true, value: evaluateAst(ast, scope, 0) };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, error: error.message };
    return { ok: false, error: `表达式求值失败：${error?.message ?? String(error)}` };
  }
}
