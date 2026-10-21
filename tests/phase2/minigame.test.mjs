// phase2 小游戏静态校验单测：MINIGAME_EXITS 解析 + 远程资源检测。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const minigame = require('../../editor/electron/lib/minigame.cjs');

const VALID_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { background: url(assets/bg.png) no-repeat; }
    </style>
    <script src="assets/game.js"></script>
    <script>
      window.MINIGAME_EXITS = ["win", "lose"];
      function done(result) {
        window.parent.postMessage({ type: "minigame-result", result: result }, "*");
      }
    </script>
  </head>
  <body>
    <img src="data:image/png;base64,iVBORw0KGgo=" alt="" />
  </body>
</html>`;

test('parseMinigameExits 解析双引号数组', () => {
  const result = minigame.parseMinigameExits('window.MINIGAME_EXITS = ["win", "lose"];');
  assert.deepEqual(result, { ok: true, exits: ['win', 'lose'] });
});

test('parseMinigameExits 解析单引号数组', () => {
  const result = minigame.parseMinigameExits(`window.MINIGAME_EXITS = ['start', 'good_end'];`);
  assert.deepEqual(result, { ok: true, exits: ['start', 'good_end'] });
});

test('parseMinigameExits 支持跨行、尾逗号、可选分号、无 window 前缀', () => {
  const html = `
    <script>
      MINIGAME_EXITS = [
        "win",
        'lose',
        "draw",
      ];
    </script>`;
  const result = minigame.parseMinigameExits(html);
  assert.deepEqual(result, { ok: true, exits: ['win', 'lose', 'draw'] });
});

test('parseMinigameExits 支持字符串转义', () => {
  const result = minigame.parseMinigameExits(`window.MINIGAME_EXITS = ["a\\"b", 'c\\'d', "e\\\\f"];`);
  assert.deepEqual(result, { ok: true, exits: ['a"b', "c'd", 'e\\f'] });
});

test('parseMinigameExits 支持 window["MINIGAME_EXITS"] 写法', () => {
  const result = minigame.parseMinigameExits(`window["MINIGAME_EXITS"] = ["win"];`);
  assert.deepEqual(result, { ok: true, exits: ['win'] });
});

test('parseMinigameExits 缺失声明 / 非数组 → 失败', () => {
  const missing = minigame.parseMinigameExits('<html><body>无声明</body></html>');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /未找到 window\.MINIGAME_EXITS/);

  const notArray = minigame.parseMinigameExits('window.MINIGAME_EXITS = "win";');
  assert.equal(notArray.ok, false);
  assert.match(notArray.error, /字符串数组/);

  const empty = minigame.parseMinigameExits('window.MINIGAME_EXITS = [];');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /不能为空数组/);

  const unclosed = minigame.parseMinigameExits('window.MINIGAME_EXITS = ["win",');
  assert.equal(unclosed.ok, false);
  assert.match(unclosed.error, /未闭合/);
});

test('parseMinigameExits 拒绝重复、空字符串、非字符串项', () => {
  const duplicated = minigame.parseMinigameExits('window.MINIGAME_EXITS = ["win", "win"];');
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.error, /重复出口/);

  const emptyItem = minigame.parseMinigameExits('window.MINIGAME_EXITS = ["win", ""];');
  assert.equal(emptyItem.ok, false);
  assert.match(emptyItem.error, /空字符串/);

  const nonString = minigame.parseMinigameExits('window.MINIGAME_EXITS = ["win", 3];');
  assert.equal(nonString.ok, false);
  assert.match(nonString.error, /只允许字符串数组/);

  const hole = minigame.parseMinigameExits('window.MINIGAME_EXITS = ["win", , "lose"];');
  assert.equal(hole.ok, false);
  assert.match(hole.error, /空元素/);
});

test('findRemoteResources 检测 http / https / 协议相对地址', () => {
  const html = `
    <script src="https://cdn.example.com/game.js"></script>
    <link rel="stylesheet" href="http://cdn.example.com/a.css" />
    <img src="//cdn.example.com/bg.png" />
    <style>
      body { background-image: url("https://cdn.example.com/bg.jpg"); }
      @import url('//cdn.example.com/theme.css');
    </style>`;
  const found = minigame.findRemoteResources(html);
  assert.equal(found.length, 5, `实际检测：${JSON.stringify(found)}`);
  assert.ok(found.some((url) => url.includes('https://cdn.example.com/game.js')));
  assert.ok(found.some((url) => url.includes('http://cdn.example.com/a.css')));
  assert.ok(found.some((url) => url.includes('//cdn.example.com/bg.png')));
  assert.ok(found.some((url) => url.includes('https://cdn.example.com/bg.jpg')));
  assert.ok(found.some((url) => url.includes('//cdn.example.com/theme.css')));
});

test('findRemoteResources 不误报 data: 与 assets 相对路径', () => {
  const html = `
    <img src="data:image/png;base64,AAAA" />
    <script src="assets/game.js"></script>
    <link rel="stylesheet" href="./style.css" />
    <style>
      body { background: url('assets/bg.png'); }
      .x { background: url(./icons/a.svg); }
    </style>
    <script>
      const local = "../shared/util.js";
    </script>`;
  assert.deepEqual(minigame.findRemoteResources(html), []);
});

test('findRemoteResources 结果去重', () => {
  const html = `
    <img src="https://cdn.example.com/a.png" />
    <img src="https://cdn.example.com/a.png" />
    <script src="https://cdn.example.com/a.png"></script>`;
  assert.deepEqual(minigame.findRemoteResources(html), ['https://cdn.example.com/a.png']);
});

test('validateMinigameHtml 合法小游戏通过且无 warning', () => {
  const result = minigame.validateMinigameHtml(VALID_HTML);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.exits, ['win', 'lose']);
});

test('validateMinigameHtml 远程资源 / 缺失出口 → 失败并列出原因', () => {
  const remote = minigame.validateMinigameHtml(
    '<html><script src="https://cdn.example.com/game.js"></script></html>',
  );
  assert.equal(remote.ok, false);
  assert.ok(remote.errors.some((error) => error.includes('远程资源引用')));
  assert.ok(remote.errors.some((error) => error.includes('未找到 window.MINIGAME_EXITS')));

  const protocolRelative = minigame.validateMinigameHtml(
    '<html><link href="//cdn.example.com/a.css" rel="stylesheet" /></html>',
  );
  assert.equal(protocolRelative.ok, false);
  assert.ok(protocolRelative.errors.some((error) => error.includes('远程资源引用')));
});

test('validateMinigameHtml 找不到 minigame-result 时给 warning 但仍通过', () => {
  const html = '<html><script>window.MINIGAME_EXITS = ["win"];</script></html>';
  const result = minigame.validateMinigameHtml(html);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /minigame-result/);
});

test('validateMinigameHtml 空内容 / 非字符串直接失败', () => {
  assert.equal(minigame.validateMinigameHtml('').ok, false);
  assert.equal(minigame.validateMinigameHtml('   ').ok, false);
  assert.equal(minigame.validateMinigameHtml(null).ok, false);
});

test('validateMinigameHtml 出口数量与长度受 schema 约束', () => {
  const many = JSON.stringify(Array.from({ length: 33 }, (_, i) => `exit-${i}`));
  const result = minigame.validateMinigameHtml(
    `<script>window.MINIGAME_EXITS = ${many}; postMessage({type:"minigame-result"})</script>`,
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('最多 32 项')));

  const longName = 'x'.repeat(65);
  const longResult = minigame.validateMinigameHtml(
    `<script>window.MINIGAME_EXITS = ["${longName}"]; postMessage({type:"minigame-result"})</script>`,
  );
  assert.equal(longResult.ok, false);
  assert.ok(longResult.errors.some((error) => error.includes('64 字符')));
});
