// 阶段二主进程集成测试：用假的 electron 模块跑通 IPC → project/schema/assets 全链路。
// 覆盖：创建项目、保存、导入图片/音频/小游戏、读取素材、导出图片、删除素材、最近项目。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const TMP_ROOT = path.join(ROOT, 'editor', '.tmp-phase2-ipc');

function makeWavBuffer(seconds = 0.5, sampleRate = 22050) {
  const samples = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 6000), 44 + i * 2);
  }
  return data;
}

function setupFakeElectron() {
  const handlers = new Map();
  const fake = {
    ipcMain: {
      handle(channel, fn) {
        handlers.set(channel, fn);
      },
    },
    dialog: {
      nextOpen: { canceled: true, filePaths: [] },
      async showOpenDialog() {
        return fake.dialog.nextOpen;
      },
    },
    app: {
      getPath(name) {
        return path.join(TMP_ROOT, 'userData', name);
      },
      getVersion() {
        return '0.2.0-test';
      },
    },
    BrowserWindow: {
      getAllWindows: () => [],
      fromWebContents: () => null,
    },
    shell: {},
  };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return fake;
    return originalLoad.call(this, request, parent, isMain);
  };
  return { fake, handlers, restore: () => { Module._load = originalLoad; } };
}

test('IPC 全链路：创建 → 保存 → 导入素材 → 读取 → 导出 → 删除', async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const { fake, handlers, restore } = setupFakeElectron();
  const ipc = require('../../editor/electron/lib/ipc.cjs');
  ipc.registerIpc({ getWindow: () => null });

  const invoke = async (channel, payload) => {
    const handler = handlers.get(channel);
    assert.ok(handler, `IPC 通道未注册：${channel}`);
    return handler({ sender: null }, payload);
  };

  try {
    // 1. 创建项目（dialog 选父目录）
    const parentDir = path.join(TMP_ROOT, 'projects');
    fs.mkdirSync(parentDir, { recursive: true });
    fake.dialog.nextOpen = { canceled: false, filePaths: [parentDir] };
    const created = await invoke('project:create', {
      title: 'IPC 集成项目',
      resolution: { width: 1280, height: 720 },
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.ok(fs.existsSync(path.join(created.projectDir, 'project.json')));
    assert.ok(fs.existsSync(path.join(created.projectDir, 'assets', '.source', 'images')));
    const project = created.project;
    const projectDir = created.projectDir;
    const projectPath = created.projectPath;

    // 2. 保存（修改标题 + 变量）
    project.meta.title = 'IPC 集成项目（改）';
    project.variables.flag = { type: 'boolean', value: true };
    const saved = await invoke('project:save', { project, projectPath });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.project.meta.title, 'IPC 集成项目（改）');

    // 3. 导入图片（dialog 选文件）
    const pngPath = path.join(TMP_ROOT, 'tiny.png');
    fs.writeFileSync(
      pngPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      ),
    );
    fake.dialog.nextOpen = { canceled: false, filePaths: [pngPath] };
    const imported = await invoke('asset:import-images', { projectDir, role: 'background' });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.equal(imported.assets.length, 1);
    const image = imported.assets[0];
    assert.equal(image.kind, 'image');
    assert.ok(image.source?.path.startsWith('assets/.source/images/'));
    assert.ok(fs.existsSync(path.join(projectDir, image.path.replaceAll('/', path.sep))));

    // 4. 读取 dataUrl / assetUrl
    const dataResult = await invoke('asset:read-data-url', {
      projectDir,
      relativePath: image.path,
    });
    assert.equal(dataResult.ok, true);
    assert.ok(dataResult.dataUrl.startsWith('data:image/'));
    const urlResult = await invoke('asset:url', { projectDir, relativePath: image.path });
    assert.equal(urlResult.ok, true);
    assert.ok(urlResult.url.startsWith('vnasset://asset/'));

    // 5. 导出图片（渲染层给 base64）
    const pngBase64 = fs.readFileSync(pngPath).toString('base64');
    const exported = await invoke('asset:export-image', {
      projectDir,
      asset: image,
      edit: { crop: null, removeBackground: null, adjustments: { brightness: 10, contrast: 5 } },
      format: 'png',
      width: 1,
      height: 1,
      dataBase64: pngBase64,
    });
    assert.equal(exported.ok, true, JSON.stringify(exported));
    assert.equal(exported.asset.format, 'png');
    assert.equal(exported.asset.width, 1);
    assert.ok(fs.existsSync(path.join(projectDir, exported.asset.path.replaceAll('/', path.sep))));

    // 6. 导入音频（wav → ogg）
    const wavPath = path.join(TMP_ROOT, 'tone.wav');
    fs.writeFileSync(wavPath, makeWavBuffer());
    fake.dialog.nextOpen = { canceled: false, filePaths: [wavPath] };
    const importedAudio = await invoke('asset:import-audio', { projectDir, role: 'bgm' });
    assert.equal(importedAudio.ok, true, JSON.stringify(importedAudio));
    assert.equal(importedAudio.assets.length, 1);
    const audio = importedAudio.assets[0];
    assert.equal(audio.format, 'ogg');
    assert.ok(audio.durationMs > 0);
    assert.ok(fs.existsSync(path.join(projectDir, audio.path.replaceAll('/', path.sep))));

    // 7. 导入小游戏（合法 + 非法各一次）
    const goodHtml = path.join(TMP_ROOT, 'mini-good.html');
    fs.writeFileSync(
      goodHtml,
      '<!doctype html><script>window.MINIGAME_EXITS=["win","lose"];</script>',
      'utf8',
    );
    fake.dialog.nextOpen = { canceled: false, filePaths: [goodHtml] };
    const importedMini = await invoke('asset:import-minigames', { projectDir });
    assert.equal(importedMini.ok, true, JSON.stringify(importedMini));
    assert.deepEqual(importedMini.assets[0].declaredExits, ['win', 'lose']);

    const badHtml = path.join(TMP_ROOT, 'mini-bad.html');
    fs.writeFileSync(badHtml, '<!doctype html><script>window.X=1;</script>', 'utf8');
    fake.dialog.nextOpen = { canceled: false, filePaths: [badHtml] };
    const importedBad = await invoke('asset:import-minigames', { projectDir });
    assert.equal(importedBad.ok, true, JSON.stringify(importedBad));
    assert.equal(importedBad.assets.length, 0, '缺少 MINIGAME_EXITS 的小游戏必须被拒绝');
    assert.ok(importedBad.warnings.length > 0);

    // 8. 删除图片（最终文件 + source 文件都清理）
    const finalAbs = path.join(projectDir, image.path.replaceAll('/', path.sep));
    const sourceAbs = path.join(projectDir, image.source.path.replaceAll('/', path.sep));
    const removed = await invoke('asset:remove', { projectDir, asset: image });
    assert.equal(removed.ok, true);
    assert.equal(fs.existsSync(finalAbs), false, '最终图片文件应被删除');
    assert.equal(fs.existsSync(sourceAbs), false, '原始图片文件应被删除');

    // 9. 最近项目
    const recent = await invoke('project:recent');
    assert.equal(recent.ok, true);
    assert.ok(recent.items.some((item) => path.resolve(item.projectPath) === path.resolve(projectPath)));
  } finally {
    restore();
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});
