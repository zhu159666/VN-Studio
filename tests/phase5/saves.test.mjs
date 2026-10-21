// 阶段五：Electron 存档文件读写（saves/slot_N.json / auto.json / quick.json）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectStore = require('../../editor/electron/lib/project.cjs');
const schema = require('../../editor/electron/lib/schema.cjs');
const saves = require('../../editor/electron/lib/saves.cjs');

const TMP = path.join(process.cwd(), 'editor', '.tmp-phase5-saves');

function saveState(project, overrides = {}) {
  return {
    version: 1,
    kind: 'manual',
    slot: 1,
    savedAt: new Date().toISOString(),
    projectId: project.meta.id,
    projectTitle: project.meta.title,
    schemaVersion: 1,
    nodeId: 'n_opening',
    variables: { flag: { type: 'boolean', value: true } },
    timeline: null,
    thumbnailDataUrl: null,
    playtimeMs: 1200,
    ...overrides,
  };
}

test('Electron 存档读写：slot_N / auto / quick 文件、列表、删除、schema 校验', async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  try {
    const created = await projectStore.createProjectInDir(path.join(TMP, 'project'), {
      title: '存档测试',
    });
    const project = created.project;
    const projectDir = created.projectDir;

    const manual = saveState(project);
    const auto = saveState(project, {
      kind: 'auto',
      slot: 0,
      variables: { last_minigame_result: { type: 'string', value: 'win' } },
      timeline: { nodeId: 'n_opening', timeMs: 800 },
    });
    const quick = saveState(project, { kind: 'quick', slot: 0 });
    assert.equal(schema.validateSaveState(manual).ok, true);
    assert.equal(schema.validateSaveState(auto).ok, true);

    await saves.writeSave(projectDir, manual);
    await saves.writeSave(projectDir, auto);
    await saves.writeSave(projectDir, quick);

    const saveDir = path.join(projectDir, 'saves');
    assert.ok(fs.existsSync(path.join(saveDir, 'slot_1.json')));
    assert.ok(fs.existsSync(path.join(saveDir, 'auto.json')));
    assert.ok(fs.existsSync(path.join(saveDir, 'quick.json')));

    const listed = await saves.listSaves(projectDir);
    assert.equal(listed.length, 3);
    assert.deepEqual(listed.map((item) => item.kind).sort(), ['auto', 'manual', 'quick']);

    const loaded = await saves.readSave(projectDir, 'auto', 0);
    assert.equal(loaded.variables.last_minigame_result.value, 'win');
    assert.equal(loaded.timeline.timeMs, 800);

    await saves.deleteSave(projectDir, 'quick', 0);
    assert.equal(fs.existsSync(path.join(saveDir, 'quick.json')), false);
    assert.equal(await saves.readSave(projectDir, 'quick', 0), null);

    // 非法存档被拒绝，不落盘
    await assert.rejects(
      () => saves.writeSave(projectDir, saveState(project, { kind: 'manual', slot: 0 })),
      /不符合 schema/,
    );
    // manual 槽位号保证 1–999
    const manualTwo = saveState(project, { kind: 'manual', slot: 2 });
    await saves.writeSave(projectDir, manualTwo);
    assert.ok(fs.existsSync(path.join(saveDir, 'slot_2.json')));
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});
