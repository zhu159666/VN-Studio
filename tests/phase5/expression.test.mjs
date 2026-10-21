// 阶段五：表达式白名单求值测试。
// 覆盖 schema/FIELDS.md 第 8 节：字面量 / 优先级 / 比较 / 逻辑短路 / 字符串拼接 /
// 深相等 / in 三种语义 / 成员与下标 / 白名单函数 / 各种错误 / 原型链键拒绝 / 复杂组合。
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateExpression, ExpressionError } from '../../runtime/expression.js';

/** 断言求值成功并返回指定值。 */
function expectValue(expression, variables, expected) {
  const result = evaluateExpression(expression, variables);
  assert.equal(result.ok, true, `期望 ${expression} 求值成功，实际错误：${result.error}`);
  assert.deepEqual(result.value, expected, `表达式 ${expression} 的求值结果不符`);
  return result.value;
}

/** 断言求值失败，且错误信息匹配给定模式。 */
function expectError(expression, variables, pattern) {
  const result = evaluateExpression(expression, variables);
  assert.equal(result.ok, false, `期望 ${expression} 求值失败，实际得到 ${JSON.stringify(result.value)}`);
  assert.equal(typeof result.error, 'string');
  if (pattern) assert.match(result.error, pattern);
  return result.error;
}

const VARS = {
  money: 120,
  cost: 30,
  ratio: 0.5,
  name: '林',
  empty: '',
  has_umbrella: true,
  flag: false,
  nothing: null,
  inventory: ['umbrella', 'ticket'],
  run_stats: { loop: 2, route: 'rain', nested: { deep: [1, 2] } },
  last_choice: 'buy',
  weather: 'rainy night',
  last_minigame_result: 'win',
};

/* ------------------------------------------------------------------ */
/* 1. 字面量与基本运算                                                 */
/* ------------------------------------------------------------------ */

test('字面量：数字 / 字符串（单双引号）/ 布尔 / null', () => {
  expectValue('42', {}, 42);
  expectValue('3.14', {}, 3.14);
  expectValue('0', {}, 0);
  expectValue('"win"', {}, 'win');
  expectValue("'雨夜'", {}, '雨夜');
  expectValue('true', {}, true);
  expectValue('false', {}, false);
  expectValue('null', {}, null);
});

test('字符串转义：\\\\ \\" \\\' \\n \\t \\r \\uXXXX', () => {
  expectValue('"a\\nb"', {}, 'a\nb');
  expectValue('"a\\tb"', {}, 'a\tb');
  expectValue('"a\\rb"', {}, 'a\rb');
  expectValue('"\\u96e8"', {}, '雨');
  expectValue('"say \\"hi\\""', {}, 'say "hi"');
  expectValue("'it\\'s'", {}, "it's");
  expectValue('"back\\\\slash"', {}, 'back\\slash');
});

test('算术运算与优先级（* / % 高于 + -）', () => {
  expectValue('1 + 2 * 3', {}, 7);
  expectValue('(1 + 2) * 3', {}, 9);
  expectValue('10 % 3', {}, 1);
  expectValue('7 / 2', {}, 3.5);
  expectValue('2 - 5', {}, -3);
  expectValue('1 - 2 - 3', {}, -4, '减法左结合');
});

test('一元运算：! 与 -，且一元减绑定强于乘除', () => {
  expectValue('!true', {}, false);
  expectValue('!!0', {}, false);
  expectValue('-5 + 2', {}, -3);
  expectValue('-money + 20', VARS, -100);
  expectValue('-2 * 3', {}, -6);
});

/* ------------------------------------------------------------------ */
/* 2. 比较与相等                                                       */
/* ------------------------------------------------------------------ */

test('数值比较：== != < <= > >=', () => {
  expectValue('money >= 100', VARS, true);
  expectValue('money < 100', VARS, false);
  expectValue('1 <= 1', {}, true);
  expectValue('2 > 1', {}, true);
  expectValue('2 == 2.0', {}, true);
  expectValue('2 != 3', {}, true);
});

test('字符串比较按 Unicode 码点字典序；混合类型返回 false 不报错', () => {
  expectValue('"a" < "b"', {}, true);
  expectValue('"雨" < "雨夜"', {}, true);
  expectValue('"b" >= "a"', {}, true);
  expectValue('"a" < 1', {}, false);
  expectValue('1 < "a"', {}, false);
  expectValue('true < false', {}, false);
});

test('== / != 深度相等：数组与对象（键顺序无关），不同类型直接 false/true', () => {
  expectValue('[1, 2] == [1, 2]', {}, true);
  expectValue('[1, [2, 3]] == [1, [2, 3]]', {}, true);
  expectError('run_stats == {"a": 1}', VARS, /语法错误/, '对象字面量不在白名单内');
  expectValue('"2" == 2', {}, false);
  expectValue('"2" != 2', {}, true);
  expectValue('null == null', {}, true);
  expectValue('null != 0', {}, true);
  expectValue('true == 1', {}, false);
  expectValue('inventory == ["umbrella", "ticket"]', VARS, true);
  expectValue('inventory == ["ticket", "umbrella"]', VARS, false);
});

test('对象深相等忽略键顺序（通过变量构造）', () => {
  const variables = {
    a: { x: 1, y: [1, 2] },
    b: { y: [1, 2], x: 1 },
    c: { x: 1, y: [2, 1] },
  };
  expectValue('a == b', variables, true);
  expectValue('a == c', variables, false);
});

/* ------------------------------------------------------------------ */
/* 3. 逻辑与真值                                                       */
/* ------------------------------------------------------------------ */

test('&& 与 || 返回 boolean（不是操作数本身）', () => {
  expectValue('1 && 2', {}, true);
  expectValue('0 && 1', {}, false);
  expectValue('"" || 0', {}, false);
  expectValue('"x" || 0', {}, true);
  expectValue('[] || false', {}, true, '空数组为真');
  expectValue('run_stats && true', VARS, true);
});

test('&& / || 短路求值（右侧不会求值）', () => {
  expectValue('false && unknown_identifier', {}, false);
  expectValue('true || unknown_identifier', {}, true);
  // 不短路时会因除零报错，短路时正常返回。
  expectValue('false && (1 / 0)', {}, false);
  expectValue('true || (1 / 0)', {}, true);
});

test('真值表：false / 0 / -0 / "" / null 为假，其余为真', () => {
  const variables = { zero: 0, negativeZero: -0, empty: '', arr: [], obj: {}, n: null };
  expectValue('!zero', variables, true);
  expectValue('!negativeZero', variables, true);
  expectValue('!empty', variables, true);
  expectValue('!n', variables, true);
  expectValue('!arr', variables, false);
  expectValue('!obj', variables, false);
  expectValue('!0.0', {}, true);
});

/* ------------------------------------------------------------------ */
/* 4. 字符串拼接                                                       */
/* ------------------------------------------------------------------ */

test('+ 的字符串拼接：string 与 number / boolean / null 的 display 转换', () => {
  expectValue('"money=" + 120', {}, 'money=120');
  expectValue('120 + " 元"', {}, '120 元');
  expectValue('"flag=" + true', {}, 'flag=true');
  expectValue('null + "!"', {}, 'null!');
  expectValue('"a" + 1 + 2', {}, 'a12', '左结合：先拼成字符串');
  expectValue('name + ":" + ratio', VARS, '林:0.5');
});

test('+ 对 array / object 拼接报类型错误；非字符串非数字组合报错', () => {
  expectError('"x" + [1]', {}, /类型错误/);
  expectError('run_stats + "x"', VARS, /类型错误/);
  expectError('true + false', {}, /类型错误/);
  expectError('null + 1', {}, /类型错误/);
});

/* ------------------------------------------------------------------ */
/* 5. in 的三种语义                                                    */
/* ------------------------------------------------------------------ */

test('in：数组包含用深度相等', () => {
  expectValue('last_choice in ["buy", "wait"]', VARS, true);
  expectValue('"vip" in ["buy", "wait"]', VARS, false);
  expectValue('"umbrella" in inventory', VARS, true);
  expectValue('[1, 2] in [[1, 2], [3]]', {}, true);
  expectValue('run_stats.route in ["rain", "snow"]', VARS, true);
});

test('in：字符串子串（左侧必须是 string）', () => {
  expectValue('"rain" in weather', VARS, true);
  expectValue('"snow" in weather', VARS, false);
  expectValue('1 in weather', VARS, false);
});

test('in：对象自有键（不看原型链）', () => {
  expectValue('"loop" in run_stats', VARS, true);
  expectValue('"route" in run_stats', VARS, true);
  expectValue('"missing" in run_stats', VARS, false);
  expectValue('"constructor" in run_stats', VARS, false);
  expectValue('"toString" in run_stats', VARS, false);
});

test('in：其他组合返回 false（不报错）', () => {
  expectValue('1 in 2', {}, false);
  expectValue('"a" in 1', {}, false);
  expectValue('null in null', {}, false);
  expectValue('true in false', {}, false);
});

/* ------------------------------------------------------------------ */
/* 6. 成员访问与下标                                                   */
/* ------------------------------------------------------------------ */

test('成员访问与下标：对象属性 / 数组元素 / 字符串字符', () => {
  expectValue('run_stats.loop', VARS, 2);
  expectValue('run_stats.nested.deep[1]', VARS, 2);
  expectValue('inventory[0]', VARS, 'umbrella');
  expectValue('inventory[1].length', VARS, 6);
  expectValue('inventory.length', VARS, 2);
  expectValue('"abc"[0]', {}, 'a');
  expectValue('run_stats["route"]', VARS, 'rain');
});

test('成员 / 下标不存在返回 null（不报错），可配合 isNull', () => {
  expectValue('run_stats.missing', VARS, null);
  expectValue('inventory[9]', VARS, null);
  expectValue('inventory[-1]', VARS, null);
  expectValue('nothing.anything', VARS, null);
  expectValue('isNull(run_stats.missing)', VARS, true);
  expectValue('isNull(inventory[9])', VARS, true);
});

test('原型链键名一律拒绝：__proto__ / constructor / prototype', () => {
  expectError('run_stats.__proto__', VARS, /原型链/);
  expectError('run_stats.constructor', VARS, /原型链/);
  expectError('run_stats.prototype', VARS, /原型链/);
  expectError('run_stats["__proto__"]', VARS, /原型链/);
  expectError('inventory["constructor"]', VARS, /原型链/);
  expectError('run_stats["con" + "structor"]', VARS, /原型链/);
});

/* ------------------------------------------------------------------ */
/* 7. 白名单函数                                                       */
/* ------------------------------------------------------------------ */

test('函数 len / type', () => {
  expectValue('len("雨夜")', {}, 2, '字符串按 Unicode 码点计数');
  expectValue('len(inventory)', VARS, 2);
  expectValue('len(run_stats)', VARS, 3, '对象返回自有键数');
  expectValue('type(money)', VARS, 'number');
  expectValue('type(name)', VARS, 'string');
  expectValue('type(flag)', VARS, 'boolean');
  expectValue('type(inventory)', VARS, 'array');
  expectValue('type(run_stats)', VARS, 'object');
  expectValue('type(nothing)', VARS, 'null');
});

test('类型判断函数 isNumber / isString / isBoolean / isArray / isObject / isNull', () => {
  expectValue('isNumber(money) && isString(name) && isBoolean(flag)', VARS, true);
  expectValue('isArray(inventory) && isObject(run_stats) && isNull(nothing)', VARS, true);
  expectValue('isNumber("1")', {}, false);
  expectValue('isArray(run_stats)', VARS, false);
  expectValue('isNull(0)', {}, false);
  expectValue('isObject(inventory)', VARS, false);
});

test('数值函数 abs / floor / ceil / round / min / max', () => {
  expectValue('abs(-3.5)', {}, 3.5);
  expectValue('floor(2.9)', {}, 2);
  expectValue('ceil(2.1)', {}, 3);
  expectValue('round(2.5)', {}, 3);
  expectValue('round(-2.5)', {}, -2, '半数向 +∞ 取整');
  expectValue('min(money, cost, 50)', VARS, 30);
  expectValue('max(money, cost)', VARS, 120);
  expectValue('min(money, max(0, 100 - cost)) > 25', VARS, true);
  expectValue('max(1)', {}, 1);
});

test('函数参数个数 / 类型错误 → ok:false', () => {
  expectError('len()', {}, /参数个数/);
  expectError('len("a", "b")', {}, /参数个数/);
  expectError('abs("x")', {}, /number/);
  expectError('floor(null)', {}, /number/);
  expectError('min()', {}, /参数个数/);
  expectError('max(1, "2")', {}, /number/);
  expectError('len(1)', {}, /string \/ array \/ object/);
});

test('未知函数 → 求值错误（不是任意函数调用）', () => {
  expectError('foo(1)', {}, /未知函数/);
  expectError('unknownFn()', {}, /未知函数/);
});

/* ------------------------------------------------------------------ */
/* 8. 错误处理                                                         */
/* ------------------------------------------------------------------ */

test('未知标识符 → 求值错误', () => {
  expectError('missing_variable', {}, /未知标识符/);
  expectError('missing_variable > 1', {}, /未知标识符/);
  expectError('money > missing_variable', VARS, /未知标识符/);
});

test('语法错误：空表达式 / 多余记号 / 未闭合 / 非法字符 / 不支持注释', () => {
  expectError('', {}, /语法错误|表达式/);
  expectError('   ', {}, /语法错误|表达式/);
  expectError('1 +', {}, /语法错误/);
  expectError('(1 + 2', {}, /语法错误/);
  expectError('"abc', {}, /语法错误/);
  expectError('1 2', {}, /多余的记号/);
  expectError('a = 1', VARS, /语法错误/);
  expectError('a += 1', VARS, /语法错误/);
  expectError('a++', VARS, /语法错误/);
  expectError('1 // 2', {}, /语法错误/);
  expectError('1 /* 2 */', {}, /语法错误/);
  expectError('"a" * ', {}, /语法错误/);
  expectError('`template`', {}, /语法错误/);
  expectError('() => 1', {}, /语法错误/);
});

test('类型错误与除零：算术、取负、除零', () => {
  expectError('"a" - 1', {}, /类型错误/);
  expectError('null * 2', {}, /类型错误/);
  expectError('-"a"', {}, /类型错误/);
  expectError('1 / 0', {}, /除零/);
  expectError('1 % 0', {}, /除零/);
  expectError('money / 0', VARS, /除零/);
});

test('表达式参数本身非法（非字符串 / 变量表非法）', () => {
  assert.deepEqual(evaluateExpression(42, {}), { ok: false, error: '表达式必须是字符串' });
  assert.deepEqual(evaluateExpression(null, {}), { ok: false, error: '表达式必须是字符串' });
  const result = evaluateExpression('1', []);
  assert.equal(result.ok, false);
});

test('ExpressionError 是 Error 子类（供调用方类型判断）', () => {
  const error = new ExpressionError('测试');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ExpressionError');
});

/* ------------------------------------------------------------------ */
/* 9. 复杂组合（FIELDS 8.11 示例）                                     */
/* ------------------------------------------------------------------ */

test('复杂组合：run_stats.loop == 2 && inventory[0] == "umbrella"', () => {
  expectValue('run_stats.loop == 2 && inventory[0] == "umbrella"', VARS, true);
  expectValue('run_stats.loop == 1 && inventory[0] == "umbrella"', VARS, false);
});

test('复杂组合：嵌套函数 + 成员 + in + 逻辑', () => {
  const expression = 'money >= 100 && has_umbrella == true && last_minigame_result == "win"';
  expectValue(expression, VARS, true);
  expectValue('len(inventory) >= 2 && "umbrella" in inventory && type(run_stats.loop) == "number"', VARS, true);
  expectValue('!(isNull(nothing)) || (run_stats.nested.deep[0] == 1)', VARS, true);
  expectValue('isNull(nothing) && run_stats.nested.deep[0] == 2', VARS, false);
  expectValue('isNull(nothing) && run_stats.nested.deep[0] == 1', VARS, true);
});

test('求值器无副作用：不修改变量表对象', () => {
  const variables = { inventory: ['a'], run_stats: { loop: 1 } };
  const snapshot = JSON.parse(JSON.stringify(variables));
  evaluateExpression('inventory[0] + "_x"', variables);
  evaluateExpression('run_stats.loop >= 1', variables);
  assert.deepEqual(variables, snapshot);
});
