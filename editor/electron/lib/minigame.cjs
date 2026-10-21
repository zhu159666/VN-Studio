'use strict';

// 小游戏（自包含 HTML5）静态校验：解析 window.MINIGAME_EXITS、检测远程资源。
// 纯文本解析，不使用 eval / vm；不依赖 electron。

const EXITS_ASSIGN_RE = /(?:window\s*\.\s*)?MINIGAME_EXITS\s*=/g;
const EXITS_WINDOW_INDEX_RE = /window\s*\[\s*(['"])MINIGAME_EXITS\1\s*\]\s*=/;

/** 跳过空白与 //、/* *\/ 注释。 */
function skipSpaceAndComments(text, start) {
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i + 2);
      i = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

/** 从 start（引号位置）读取一个 JS 字符串字面量。 */
function readStringLiteral(text, start) {
  const quote = text[start];
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) return { ok: false, error: 'MINIGAME_EXITS 中存在未闭合的字符串' };
      if (next === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      if (next === 'x') {
        const hex = text.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          continue;
        }
      }
      const escapes = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        v: '\v',
        0: '\0',
        '\\': '\\',
        "'": "'",
        '"': '"',
        '`': '`',
      };
      out += Object.prototype.hasOwnProperty.call(escapes, next) ? escapes[next] : next;
      i += 2;
      continue;
    }
    if (ch === quote) return { ok: true, value: out, end: i + 1 };
    if (quote === '`' && ch === '$' && text[i + 1] === '{') {
      return { ok: false, error: 'MINIGAME_EXITS 不支持模板字符串插值，请使用普通字符串数组' };
    }
    out += ch;
    i += 1;
  }
  return { ok: false, error: 'MINIGAME_EXITS 中存在未闭合的字符串' };
}

/** 解析数组内容（不含外层中括号）：只允许字符串字面量与逗号/空白/注释。 */
function parseStringArrayLiteral(content) {
  const items = [];
  let i = 0;
  let expectValue = true;
  while (true) {
    i = skipSpaceAndComments(content, i);
    if (i >= content.length) {
      // 尾逗号（`["a",]`）允许；空数组也允许（由上层判空）
      return { ok: true, items };
    }
    const ch = content[i];
    if (ch === ',') {
      if (expectValue && items.length > 0) {
        return { ok: false, error: 'MINIGAME_EXITS 中存在空元素（多余的逗号）' };
      }
      if (expectValue && items.length === 0) {
        return { ok: false, error: 'MINIGAME_EXITS 中存在空元素（多余的逗号）' };
      }
      expectValue = true;
      i += 1;
      continue;
    }
    if (!expectValue) {
      return { ok: false, error: 'MINIGAME_EXITS 元素之间缺少逗号' };
    }
    if (ch !== '"' && ch !== "'" && ch !== '`') {
      return { ok: false, error: 'MINIGAME_EXITS 只允许字符串数组，存在非字符串元素' };
    }
    const parsed = readStringLiteral(content, i);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
    i = parsed.end;
    expectValue = false;
  }
}

/** 找到 MINIGAME_EXITS 赋值语句，返回数组字面量内容与结束位置。 */
function findExitsArrayLiteral(html) {
  let assignIndex = -1;
  let assignLength = 0;
  EXITS_ASSIGN_RE.lastIndex = 0;
  const match = EXITS_ASSIGN_RE.exec(html);
  if (match) {
    assignIndex = match.index;
    assignLength = match[0].length;
  } else {
    const indexed = EXITS_WINDOW_INDEX_RE.exec(html);
    if (indexed) {
      assignIndex = indexed.index;
      assignLength = indexed[0].length;
    }
  }
  if (assignIndex < 0) {
    return { ok: false, error: '未找到 window.MINIGAME_EXITS 声明（应为字符串数组）' };
  }

  let i = assignIndex + assignLength;
  i = skipSpaceAndComments(html, i);
  if (html[i] !== '[') {
    return { ok: false, error: 'window.MINIGAME_EXITS 必须直接赋值为字符串数组（缺少 [）' };
  }

  const start = i;
  let depth = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const parsed = readStringLiteral(html, i);
      if (!parsed.ok) return parsed;
      i = parsed.end;
      continue;
    }
    if (ch === '/' && html[i + 1] === '/') {
      const newline = html.indexOf('\n', i + 2);
      i = newline === -1 ? html.length : newline + 1;
      continue;
    }
    if (ch === '/' && html[i + 1] === '*') {
      const end = html.indexOf('*/', i + 2);
      i = end === -1 ? html.length : end + 2;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return { ok: true, content: html.slice(start + 1, i) };
      }
    }
    i += 1;
  }
  return { ok: false, error: 'window.MINIGAME_EXITS 的数组未闭合' };
}

/**
 * 解析小游戏 HTML 中的 `window.MINIGAME_EXITS = [...]`。
 * 支持单/双引号、跨行、尾逗号、可选分号；只解析字符串数组。
 * @param {string} html
 * @returns {{ok:true,exits:string[]}|{ok:false,error:string}}
 */
function parseMinigameExits(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, error: '小游戏 HTML 内容为空' };
  }
  const literal = findExitsArrayLiteral(html);
  if (!literal.ok) return literal;
  const parsed = parseStringArrayLiteral(literal.content);
  if (!parsed.ok) return parsed;
  const exits = parsed.items;
  if (exits.length === 0) {
    return { ok: false, error: 'window.MINIGAME_EXITS 不能为空数组（至少声明 1 个出口）' };
  }
  const empty = exits.find((item) => !item.trim());
  if (empty !== undefined) {
    return { ok: false, error: 'window.MINIGAME_EXITS 中存在空字符串出口' };
  }
  const seen = new Set();
  const duplicated = new Set();
  for (const exit of exits) {
    if (seen.has(exit)) duplicated.add(exit);
    seen.add(exit);
  }
  if (duplicated.size > 0) {
    return { ok: false, error: `window.MINIGAME_EXITS 存在重复出口：${[...duplicated].join('、')}` };
  }
  return { ok: true, exits };
}

/** 从属性值/URL 值里提取远程 URL（要求位于值开头或空白/逗号/括号之后，避免把 assets//x 当成协议相对地址）。 */
function extractRemoteUrls(value) {
  const urls = [];
  const re = /(?:^|[\s,(])((?:https?:\/\/|\/\/)[^\s"'<>`),]+)/gi;
  let match;
  while ((match = re.exec(value)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * 扫描 HTML/CSS/JS 中的远程资源引用（http://、https://、// 协议相对地址）。
 * 关注 src/href/srcset/poster/action/data-src/data-href、CSS url()、@import、import 语句。
 * data: 与 assets/ 相对路径不会误报。
 * @param {string} html
 * @returns {string[]} 去重后的违规 URL 列表
 */
function findRemoteResources(html) {
  if (typeof html !== 'string' || !html) return [];
  const found = [];
  const seen = new Set();
  const addAll = (urls) => {
    for (const url of urls) {
      const clean = url.trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      found.push(clean);
    }
  };

  // 1) 标签属性：src / href / srcset / poster / action / data-src / data-href
  const attrRe =
    /(?:^|[\s])(?:src|href|srcset|poster|action|data-src|data-href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let attrMatch;
  while ((attrMatch = attrRe.exec(html)) !== null) {
    const value = attrMatch[1] ?? attrMatch[2] ?? attrMatch[3] ?? '';
    addAll(extractRemoteUrls(value));
  }

  // 2) CSS url(...)
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  let urlMatch;
  while ((urlMatch = urlRe.exec(html)) !== null) {
    const value = urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? '';
    addAll(extractRemoteUrls(value));
  }

  // 3) @import "..." / @import url(...)
  const importRe = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;
  let importMatch;
  while ((importMatch = importRe.exec(html)) !== null) {
    const value = importMatch[1] ?? importMatch[2] ?? importMatch[3] ?? '';
    addAll(extractRemoteUrls(value));
  }

  // 4) JS import "..." / import("...")
  const jsImportRe = /\bimport\s*(?:\(\s*)?(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  let jsMatch;
  while ((jsMatch = jsImportRe.exec(html)) !== null) {
    const value = jsMatch[1] ?? jsMatch[2] ?? jsMatch[3] ?? '';
    addAll(extractRemoteUrls(value));
  }

  return found;
}

/**
 * 综合校验小游戏 HTML。
 * @param {string} html
 * @returns {{ok:boolean,exits?:string[],errors:string[],warnings:string[]}}
 */
function validateMinigameHtml(html) {
  const errors = [];
  const warnings = [];
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, errors: ['小游戏 HTML 内容为空'], warnings };
  }

  const parsed = parseMinigameExits(html);
  let exits;
  if (!parsed.ok) {
    errors.push(parsed.error);
  } else {
    exits = parsed.exits;
    if (exits.length > 32) {
      errors.push(`window.MINIGAME_EXITS 最多 32 项（当前 ${exits.length} 项）`);
    }
    const tooLong = exits.find((item) => item.length > 64);
    if (tooLong !== undefined) {
      errors.push(`出口名超过 64 字符：${tooLong.slice(0, 64)}…`);
    }
  }

  const remote = findRemoteResources(html);
  if (remote.length > 0) {
    const preview = remote.slice(0, 5).join('、');
    errors.push(
      `检测到远程资源引用（小游戏必须自包含，只允许 assets/ 本地资源）：${preview}${remote.length > 5 ? ` 等 ${remote.length} 处` : ''}`,
    );
  }

  if (!/minigame-result/.test(html)) {
    warnings.push('未检测到 postMessage 结果上报（type: "minigame-result"），小游戏结果可能无法推进剧情');
  }

  const result = { ok: errors.length === 0, errors, warnings };
  if (exits) result.exits = exits;
  return result;
}

module.exports = {
  parseMinigameExits,
  findRemoteResources,
  validateMinigameHtml,
};
