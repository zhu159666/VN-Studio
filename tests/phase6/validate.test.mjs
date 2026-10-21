// 阶段六：导出前项目校验器测试。
// 覆盖 CONTRACT-PHASE6 的 validateProjectForExport API、FIELDS §12 的 E03–E30 / W01–W10，
// 以及 checkFiles=true 的文件存在性 / 小游戏 HTML 重解析 / 视频编码矩阵。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { validateProjectForExport } = require('../../editor/electron/lib/validate-project.cjs');

const DEMO = JSON.parse(
  await fs.readFile(new URL('../../examples/demo-project.json', import.meta.url), 'utf8'),
);

const LINEAR = { type: 'bezier', p1: [0, 0], p2: [1, 1] };

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function clone(value) {
  return structuredClone(value);
}

function nodeOf(project, id) {
  const found = project.nodes.find((node) => node.id === id);
  assert.ok(found, `fixture 中不存在节点 ${id}`);
  return found;
}

function edgeOf(project, id) {
  const found = project.edges.find((edge) => edge.id === id);
  assert.ok(found, `fixture 中不存在连线 ${id}`);
  return found;
}

function trackOf(project, sceneId, trackId) {
  const timeline = project.timelines[sceneId];
  assert.ok(timeline, `fixture 中不存在时间轴 ${sceneId}`);
  const found = timeline.tracks.find((track) => track.id === trackId);
  assert.ok(found, `fixture 中不存在轨道 ${trackId}`);
  return found;
}

/** 用 demo 的深拷贝 + 变异跑一次校验（默认 checkFiles=false，不做文件 IO）。 */
async function validateDemo(mutator, options = { checkFiles: false }) {
  const project = clone(DEMO);
  if (mutator) mutator(project);
  return validateProjectForExport(project, options);
}

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

function warningCodes(result) {
  return result.warnings.map((warning) => warning.code);
}

function expectError(result, code) {
  assert.ok(
    result.errors.some((error) => error.code === code),
    `期望出现 ${code}，实际错误：${JSON.stringify(result.errors, null, 2)}`,
  );
}

function expectWarning(result, code) {
  assert.ok(
    result.warnings.some((warning) => warning.code === code),
    `期望出现 ${code}，实际警告：${JSON.stringify(result.warnings, null, 2)}`,
  );
}

function assertNoErrors(result) {
  assert.deepEqual(result.errors, [], `不应有错误，实际：${JSON.stringify(result.errors, null, 2)}`);
  assert.equal(result.ok, true);
}

/* ------------------------------------------------------------------ */
/* 最小合法项目（checkFiles 用）+ 临时目录                             */
/* ------------------------------------------------------------------ */

function makeProject() {
  return {
    schemaVersion: 1,
    meta: {
      id: 'proj_phase6_validate',
      title: '导出校验最小项目',
      createdAt: '2026-10-21T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
    },
    settings: {
      startNodeId: 'n_scene',
      resolution: { width: 1280, height: 720 },
      backgroundColor: '#101418',
      textSpeedCps: 30,
    },
    assets: {
      images: [
        {
          id: 'img_bg',
          kind: 'image',
          name: '背景',
          role: 'background',
          path: 'assets/images/bg.png',
          width: 1280,
          height: 720,
          format: 'png',
        },
      ],
      audio: [
        {
          id: 'aud_bgm',
          kind: 'audio',
          name: 'BGM',
          role: 'bgm',
          path: 'assets/audio/bgm.ogg',
          format: 'ogg',
          durationMs: 1000,
        },
      ],
      videos: [
        {
          id: 'vid_cut',
          kind: 'video',
          name: '过场',
          path: 'assets/videos/cut.mp4',
          format: 'mp4',
          codec: 'h264',
          durationMs: 1000,
        },
      ],
      minigames: [
        {
          id: 'mg_test',
          kind: 'minigame',
          name: '小游戏',
          path: 'assets/minigames/game.html',
          declaredExits: ['win', 'lose', 'timeout'],
          mode: 'blocking',
        },
      ],
    },
    variables: {},
    nodes: [
      {
        id: 'n_scene',
        type: 'scene',
        name: '场景',
        position: { x: 0, y: 0 },
        exits: [{ id: 'next', name: 'next' }],
        background: { assetId: 'img_bg', fit: 'cover', x: 0.5, y: 0.5, scale: 1, opacity: 1 },
        sprites: [],
        textbox: {
          x: 0.5,
          y: 0.84,
          width: 0.9,
          height: 0.2,
          fontSizePx: 28,
          color: '#ffffff',
          background: '#000000',
          backgroundOpacity: 0.5,
          opacity: 1,
        },
        audio: { bgmAssetId: 'aud_bgm', volume: 0.6, loop: true },
        variables: [],
      },
      {
        id: 'n_video',
        type: 'video',
        name: '过场',
        position: { x: 300, y: 0 },
        exits: [
          { id: 'completed', name: 'completed' },
          { id: 'skipped', name: 'skipped' },
        ],
        videoAssetId: 'vid_cut',
      },
      {
        id: 'n_game',
        type: 'minigame',
        name: '小游戏',
        position: { x: 600, y: 0 },
        exits: [
          { id: 'win', name: 'win' },
          { id: 'lose', name: 'lose' },
          { id: 'timeout', name: 'timeout' },
        ],
        minigameAssetId: 'mg_test',
        defaultExitId: 'win',
      },
      {
        id: 'n_end',
        type: 'dialogue',
        name: '收尾',
        position: { x: 900, y: 0 },
        exits: [{ id: 'next', name: 'next' }],
        text: '测试结束。',
      },
    ],
    edges: [
      { id: 'e1', from: 'n_scene', port: 'next', to: 'n_video', kind: 'sequence' },
      { id: 'e2', from: 'n_video', port: 'completed', to: 'n_game', kind: 'sequence' },
      { id: 'e3', from: 'n_video', port: 'skipped', to: 'n_game', kind: 'sequence' },
      { id: 'e4', from: 'n_game', port: 'win', to: 'n_end', kind: 'sequence' },
      { id: 'e5', from: 'n_game', port: 'lose', to: 'n_end', kind: 'sequence' },
      { id: 'e6', from: 'n_game', port: 'timeout', to: 'n_end', kind: 'sequence' },
      { id: 'e7', from: 'n_end', port: 'next', to: 'n_scene', kind: 'sequence' },
    ],
    timelines: {
      n_scene: {
        durationMs: 1000,
        tracks: [
          {
            id: 'tr_bg_opacity',
            kind: 'background',
            property: 'opacity',
            keys: [{ time: 0, value: 1, easing: LINEAR }],
          },
        ],
      },
    },
  };
}

const VALID_MINIGAME_HTML = `<!doctype html>
<html>
  <body>
    <script>
      window.MINIGAME_EXITS = ["win", "lose", "timeout"];
      function report(result) {
        window.parent.postMessage({ type: "minigame-result", result }, "*");
      }
    </script>
  </body>
</html>
`;

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vn-phase6-validate-'));
const projectDir = path.join(tempRoot, 'project');

after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function resetProjectDir() {
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.mkdir(projectDir, { recursive: true });
}

/** 按项目里的素材 path 在临时目录里落文件；htmlOverrides 按相对路径覆盖小游戏内容。 */
async function writeProjectFiles(project, htmlOverrides = {}) {
  const tables = ['images', 'audio', 'videos', 'minigames'];
  for (const table of tables) {
    for (const asset of project.assets[table] ?? []) {
      const absolutePath = path.join(projectDir, asset.path);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      if (asset.kind === 'minigame') {
        await fs.writeFile(absolutePath, htmlOverrides[asset.path] ?? VALID_MINIGAME_HTML, 'utf8');
      } else {
        await fs.writeFile(absolutePath, Buffer.from('stub-asset-bytes'));
      }
    }
  }
}

async function prepareProject(mutator = null, htmlOverrides = {}) {
  await resetProjectDir();
  const project = makeProject();
  if (mutator) mutator(project);
  await writeProjectFiles(project, htmlOverrides);
  return project;
}

/* ------------------------------------------------------------------ */
/* 基线                                                                */
/* ------------------------------------------------------------------ */

test('demo-project 在 checkFiles=false 下零错误、不修改项目对象、二次校验稳定', async () => {
  const project = clone(DEMO);
  const before = JSON.stringify(project);
  const first = await validateProjectForExport(project, { checkFiles: false });
  const second = await validateProjectForExport(project, { checkFiles: false });

  assertNoErrors(first);
  assert.equal(JSON.stringify(project), before, '校验器不应修改项目对象');
  assert.deepEqual(second, first, '同一项目二次校验结果应稳定');
  assert.ok(Array.isArray(first.warnings));
});

test('demo-project 在 checkFiles=true 但没有 projectDir 时跳过文件存在性检查', async () => {
  const result = await validateProjectForExport(clone(DEMO), { checkFiles: true, projectDir: null });
  assertNoErrors(result);
});

test('错误按 path 稳定排序，warnings 去重', async () => {
  const result = await validateDemo((project) => {
    // 两个未接线出口（choice 选项 / video completed）→ 两条 E12，path 应递增
    project.edges = project.edges.filter((edge) => edge.id !== 'e04_choice_buy' && edge.id !== 'e10_video_completed');
  });
  const errorPaths = result.errors.filter((error) => error.code === 'E12').map((error) => error.path);
  assert.equal(errorPaths.length, 2);
  const sorted = [...errorPaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(errorPaths, sorted);
  for (let index = 1; index < result.errors.length; index += 1) {
    const previous = result.errors[index - 1];
    const current = result.errors[index];
    assert.ok(
      previous.path < current.path || (previous.path === current.path && previous.code <= current.code),
      `错误排序不稳定：${previous.path} / ${current.path}`,
    );
  }
  const warningKeys = result.warnings.map((warning) => `${warning.code}|${warning.path}|${warning.message}`);
  assert.equal(new Set(warningKeys).size, warningKeys.length, 'warnings 应去重');
});

/* ------------------------------------------------------------------ */
/* E03–E18 结构与连线                                                  */
/* ------------------------------------------------------------------ */

test('E03 节点 id 重复', async () => {
  const result = await validateDemo((project) => {
    project.nodes.push({ ...clone(project.nodes[0]), name: '重复 id 的节点' });
  });
  expectError(result, 'E03');
});

test('E04 连线 id 重复', async () => {
  const result = await validateDemo((project) => {
    project.edges.push(clone(project.edges[0]));
  });
  expectError(result, 'E04');
});

test('E05 素材 id 跨四表重复', async () => {
  const result = await validateDemo((project) => {
    project.assets.audio.push({
      ...clone(project.assets.images[0]),
      kind: 'audio',
      role: 'bgm',
      path: 'assets/audio/dup.ogg',
      format: 'ogg',
      durationMs: 1000,
      width: undefined,
      height: undefined,
    });
  });
  expectError(result, 'E05');
});

test('E06 同一节点内出口 id 重复', async () => {
  const result = await validateDemo((project) => {
    const choice = nodeOf(project, 'n_choice_umbrella');
    choice.exits[1].id = choice.exits[0].id;
  });
  expectError(result, 'E06');
});

test('E07 同一节点内出口 name 重复', async () => {
  const result = await validateDemo((project) => {
    const choice = nodeOf(project, 'n_choice_umbrella');
    choice.exits[1].name = choice.exits[0].name;
  });
  expectError(result, 'E07');
});

test('E08 startNodeId 为 null', async () => {
  const result = await validateDemo((project) => {
    project.settings.startNodeId = null;
  });
  expectError(result, 'E08');
});

test('E08 startNodeId 指向不存在的节点', async () => {
  const result = await validateDemo((project) => {
    project.settings.startNodeId = 'n_missing';
  });
  expectError(result, 'E08');
});

test('E09 连线 from 指向不存在的节点', async () => {
  const result = await validateDemo((project) => {
    edgeOf(project, 'e01_scene_open').from = 'n_ghost';
  });
  expectError(result, 'E09');
});

test('E09 连线 to 指向不存在的节点', async () => {
  const result = await validateDemo((project) => {
    edgeOf(project, 'e01_scene_open').to = 'n_ghost';
  });
  expectError(result, 'E09');
});

test('E10 edge.port 不是源节点真实出口', async () => {
  const result = await validateDemo((project) => {
    edgeOf(project, 'e01_scene_open').port = 'nonexistent-port';
  });
  expectError(result, 'E10');
});

test('E11 同一出口存在多条 sequence 出边', async () => {
  const result = await validateDemo((project) => {
    project.edges.push({ ...clone(project.edges[0]), id: 'e01_duplicate' });
  });
  expectError(result, 'E11');
});

test('E12 普通节点出口没有出边（choice）', async () => {
  const result = await validateDemo((project) => {
    project.edges = project.edges.filter((edge) => edge.id !== 'e04_choice_buy');
  });
  expectError(result, 'E12');
});

test('E12 dialogue / scene 无出边表示正常结束，不报错', async () => {
  const result = await validateDemo((project) => {
    project.edges = project.edges.filter(
      (edge) => edge.id !== 'e06_wait_buy' && edge.id !== 'e20_success_loop',
    );
  });
  assert.equal(
    result.errors.filter((error) => error.code === 'E12').length,
    0,
    'dialogue/scene 的 next 留空应视为结束',
  );
});

test('E12 jump 节点不应有出边', async () => {
  const result = await validateDemo((project) => {
    project.edges.push({
      id: 'e_jump_out',
      from: 'n_jump_loop',
      port: 'out',
      to: 'n_scene_rain',
      kind: 'sequence',
    });
  });
  expectError(result, 'E12');
  assert.ok(
    result.errors.some((error) => error.code === 'E12' && /jump/.test(error.message)),
    '应有一条针对 jump 出边的 E12',
  );
});

test('E13 condition 的出边 kind 不是 conditional', async () => {
  const result = await validateDemo((project) => {
    edgeOf(project, 'e18_condition_success').kind = 'sequence';
  });
  expectError(result, 'E13');
});

test('E14 普通节点的出边 kind 不是 sequence', async () => {
  const result = await validateDemo((project) => {
    edgeOf(project, 'e01_scene_open').kind = 'conditional';
  });
  expectError(result, 'E14');
});

test('E15 video 的 completed 出口未接线', async () => {
  const result = await validateDemo((project) => {
    project.edges = project.edges.filter((edge) => edge.id !== 'e10_video_completed');
  });
  expectError(result, 'E15');
});

test('E15 video 的 skipped 出口未接线', async () => {
  const result = await validateDemo((project) => {
    project.edges = project.edges.filter((edge) => edge.id !== 'e11_video_skipped');
  });
  expectError(result, 'E15');
});

test('E16 minigame 有出口未接线', async () => {
  const result = await validateDemo((project) => {
    project.edges = project.edges.filter((edge) => edge.id !== 'e12_minigame_win');
  });
  expectError(result, 'E16');
});

test('E17 minigame.defaultExitId 不是本节点出口', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_minigame_umbrella').defaultExitId = 'not-an-exit';
  });
  expectError(result, 'E17');
});

test('E17 minigame.defaultExitId 缺失（既不是出口也不是 null）', async () => {
  const result = await validateDemo((project) => {
    delete nodeOf(project, 'n_minigame_umbrella').defaultExitId;
  });
  expectError(result, 'E17');
});

test('E18 jump.targetNodeId 指向不存在的节点', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_jump_loop').targetNodeId = 'n_ghost';
  });
  expectError(result, 'E18');
});

/* ------------------------------------------------------------------ */
/* E19 素材引用                                                        */
/* ------------------------------------------------------------------ */

test('E19 素材引用不存在', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_scene_rain').background.assetId = 'missing_bg';
  });
  expectError(result, 'E19');
});

test('E19 素材引用 role 不匹配（背景位填了立绘）', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_scene_rain').background.assetId = 'sprite_me';
  });
  expectError(result, 'E19');
});

test('E19 素材引用类型不匹配（立绘位填了音频）', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_dialogue_clerk').portrait.assetId = 'a_bgm_rain';
  });
  expectError(result, 'E19');
});

test('E19 语音引用 role 不匹配', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_dialogue_clerk').voice.assetId = 'a_bgm_rain';
  });
  expectError(result, 'E19');
});

/* ------------------------------------------------------------------ */
/* E20 路径结构（checkFiles=false 也做）                               */
/* ------------------------------------------------------------------ */

test('E20 素材扩展名与 format 不一致', async () => {
  const result = await validateDemo((project) => {
    project.assets.images[0].path = 'assets/images/bg.jpg';
  });
  expectError(result, 'E20');
});

test('E20 路径逃逸 / 不以 assets/ 开头 / 小游戏不是 .html', async () => {
  const result = await validateDemo((project) => {
    project.assets.images[0].path = '../escape.png';
    project.assets.images[1].path = 'images/no-prefix.webp';
    project.assets.minigames[0].path = 'assets/minigames/game.txt';
  });
  const e20 = result.errors.filter((error) => error.code === 'E20');
  assert.ok(e20.length >= 3, `期望至少 3 条 E20，实际 ${JSON.stringify(e20)}`);
});

/* ------------------------------------------------------------------ */
/* E21–E25 时间轴                                                      */
/* ------------------------------------------------------------------ */

test('E21 timelines 的键不是 scene 节点', async () => {
  const result = await validateDemo((project) => {
    project.timelines.n_dialogue_open = { durationMs: 1000, tracks: [] };
  });
  expectError(result, 'E21');
});

test('E22 sprite 轨道 target 不在场景 sprites[].id 中', async () => {
  const result = await validateDemo((project) => {
    trackOf(project, 'n_scene_rain', 'tl_rain_me_x').target = 'ghost_sprite';
  });
  expectError(result, 'E22');
});

test('E23 同一时间轴内轨道 id 重复', async () => {
  const result = await validateDemo((project) => {
    const tracks = project.timelines.n_scene_rain.tracks;
    tracks[1].id = tracks[0].id;
  });
  expectError(result, 'E23');
});

test('E23 同一 (target, property) 有多条轨道', async () => {
  const result = await validateDemo((project) => {
    const tracks = project.timelines.n_scene_rain.tracks;
    tracks[1].target = tracks[0].target;
    tracks[1].property = tracks[0].property;
  });
  expectError(result, 'E23');
});

test('E24 关键帧时间乱序', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_rain', 'tl_rain_me_x');
    track.keys[2].time = 100;
  });
  expectError(result, 'E24');
});

test('E24 关键帧时间重复', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_rain', 'tl_rain_me_x');
    track.keys[1].time = 0;
  });
  expectError(result, 'E24');
});

test('E24 关键帧时间超过 durationMs', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_rain', 'tl_rain_me_x');
    track.keys[2].time = 6000;
  });
  expectError(result, 'E24');
});

test('E25 关键帧 opacity 越界（>1）', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_rain', 'tl_rain_clerk_opacity');
    track.keys[1].value = 1.5;
  });
  expectError(result, 'E25');
});

test('E25 关键帧 scale 越界（<0.05）', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_rain', 'tl_rain_bg_scale');
    track.keys[0].value = 0.01;
  });
  expectError(result, 'E25');
});

test('E25 关键帧 fontSizePx 越界（>200）', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_counter', 'tl_counter_textbox_fontsize');
    track.keys[0].value = 300;
  });
  expectError(result, 'E25');
});

test('E25 关键帧位置 x 越界（<-1）', async () => {
  const result = await validateDemo((project) => {
    const track = trackOf(project, 'n_scene_rain', 'tl_rain_me_x');
    track.keys[0].value = -3;
  });
  expectError(result, 'E25');
});

/* ------------------------------------------------------------------ */
/* E26 / E28 / E30                                                     */
/* ------------------------------------------------------------------ */

test('E26 minigame 节点出口未覆盖 declaredExits', async () => {
  const result = await validateDemo((project) => {
    const game = nodeOf(project, 'n_minigame_umbrella');
    const timeoutExit = game.exits.find((exit) => exit.id === 'timeout');
    timeoutExit.name = '超时';
  });
  expectError(result, 'E26');
});

test('E28 mp4 容器使用 vp9 编码不在支持矩阵内', async () => {
  const result = await validateDemo((project) => {
    project.assets.videos[0].codec = 'vp9';
  });
  expectError(result, 'E28');
});

test('E30 纯逻辑环（condition / variable 构成）', async () => {
  const result = await validateDemo((project) => {
    edgeOf(project, 'e18_condition_success').to = 'n_var_win';
    edgeOf(project, 'e19_condition_fail').to = 'n_var_lose';
  });
  expectError(result, 'E30');
});

test('E30 纯逻辑环（jump 自跳）', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_jump_loop').targetNodeId = 'n_jump_loop';
  });
  expectError(result, 'E30');
});

/* ------------------------------------------------------------------ */
/* W01–W10                                                             */
/* ------------------------------------------------------------------ */

test('W02 环中包含可交互节点', async () => {
  const result = await validateDemo();
  expectWarning(result, 'W02');
  assertNoErrors(result);
});

test('W01 有节点从 startNodeId 不可达', async () => {
  const result = await validateDemo((project) => {
    project.nodes.push({
      id: 'n_orphan',
      type: 'dialogue',
      name: '孤儿节点',
      position: { x: 0, y: 0 },
      exits: [{ id: 'next', name: 'next' }],
      text: '没有人能走到这里。',
    });
    project.edges.push({
      id: 'e_orphan',
      from: 'n_orphan',
      port: 'next',
      to: 'n_orphan',
      kind: 'sequence',
    });
  });
  expectWarning(result, 'W01');
});

test('W03 存在 kind=data 的连线', async () => {
  const result = await validateDemo((project) => {
    project.edges.push({
      id: 'e_data_probe',
      from: 'n_dialogue_open',
      port: 'next',
      to: 'n_scene_rain',
      kind: 'data',
    });
  });
  expectWarning(result, 'W03');
  assertNoErrors(result);
});

test('W05 素材未被任何节点或时间轴引用', async () => {
  const result = await validateDemo((project) => {
    project.assets.images.push({
      id: 'img_unused',
      kind: 'image',
      name: '未使用图片',
      role: 'other',
      path: 'assets/images/unused.png',
      width: 10,
      height: 10,
      format: 'png',
    });
  });
  expectWarning(result, 'W05');
  assert.ok(
    result.warnings.some((warning) => warning.code === 'W05' && /img_unused/.test(warning.message)),
    'W05 应指出 img_unused',
  );
});

test('W06 节点 name 重复', async () => {
  const result = await validateDemo((project) => {
    nodeOf(project, 'n_dialogue_fail').name = nodeOf(project, 'n_dialogue_success').name;
  });
  expectWarning(result, 'W06');
});

test('W07 choice 选项文案重复', async () => {
  const result = await validateDemo((project) => {
    const choice = nodeOf(project, 'n_choice_umbrella');
    choice.exits[1].name = choice.exits[0].name;
  });
  expectWarning(result, 'W07');
  expectError(result, 'E07');
});

test('W08 minigame 有 declaredExits 之外的出口', async () => {
  const result = await validateDemo((project) => {
    const game = nodeOf(project, 'n_minigame_umbrella');
    game.exits.push({ id: 'debug', name: 'debug' });
    project.edges.push({
      id: 'e_debug_exit',
      from: 'n_minigame_umbrella',
      port: 'debug',
      to: 'n_var_win',
      kind: 'sequence',
    });
  });
  expectWarning(result, 'W08');
  assertNoErrors(result);
});

test('W09 last_minigame_result 初值不是 string', async () => {
  const result = await validateDemo((project) => {
    project.variables.last_minigame_result = { type: 'number', value: 1 };
  });
  expectWarning(result, 'W09');
});

test('W10 场景声明变量与全局已有变量类型不一致', async () => {
  const result = await validateDemo((project) => {
    project.variables.receipt_count = { type: 'string', value: 'x' };
  });
  expectWarning(result, 'W10');
});

/* ------------------------------------------------------------------ */
/* checkFiles=true：文件存在性 / 小游戏 HTML / 视频编码                 */
/* ------------------------------------------------------------------ */

test('checkFiles=true：文件齐全的最小项目通过', async () => {
  const project = await prepareProject();
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  assertNoErrors(result);
  assert.ok(warningCodes(result).includes('W02'), '最小项目含可交互环，应有 W02');
});

test('checkFiles=true：素材文件缺失报 E20', async () => {
  const project = await prepareProject();
  await fs.rm(path.join(projectDir, 'assets/images/bg.png'));
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E20');
  assert.equal(result.ok, false);
});

test('checkFiles=true：扩展名与 format 不一致报 E20', async () => {
  const project = await prepareProject((p) => {
    p.assets.images[0].path = 'assets/images/bg.jpg';
  });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E20');
});

test('checkFiles=true：小游戏 HTML 缺 MINIGAME_EXITS 报 E27', async () => {
  const project = await prepareProject(null, {
    'assets/minigames/game.html': '<!doctype html><html><body>no exits</body></html>',
  });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E27');
});

test('checkFiles=true：小游戏 HTML 含远程资源报 E27', async () => {
  const html = `<!doctype html>
<html>
  <body>
    <script src="https://cdn.example.com/engine.js"></script>
    <script>
      window.MINIGAME_EXITS = ["win", "lose", "timeout"];
      window.parent.postMessage({ type: "minigame-result", result: "win" }, "*");
    </script>
  </body>
</html>
`;
  const project = await prepareProject(null, { 'assets/minigames/game.html': html });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E27');
});

test('checkFiles=true：小游戏 HTML 没有 postMessage 报 E27', async () => {
  const html = `<!doctype html>
<html>
  <body>
    <script>
      window.MINIGAME_EXITS = ["win", "lose", "timeout"];
      // 只声明出口，不上报结果
    </script>
  </body>
</html>
`;
  const project = await prepareProject(null, { 'assets/minigames/game.html': html });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E27');
});

test('checkFiles=true：MINIGAME_EXITS 与 declaredExits 不一致报 E27', async () => {
  const html = `<!doctype html>
<html>
  <body>
    <script>
      window.MINIGAME_EXITS = ["win", "lose"];
      window.parent.postMessage({ type: "minigame-result", result: "win" }, "*");
    </script>
  </body>
</html>
`;
  const project = await prepareProject(null, { 'assets/minigames/game.html': html });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E27');
  assert.ok(
    result.errors.some((error) => error.code === 'E27' && /declaredExits/.test(error.message)),
    'E27 应指出 MINIGAME_EXITS 与 declaredExits 不一致',
  );
});

test('checkFiles=true：小游戏 HTML 读取失败报 E27', async () => {
  const project = await prepareProject();
  const result = await validateProjectForExport(project, {
    projectDir,
    checkFiles: true,
    readFile: async () => {
      throw new Error('read boom');
    },
  });
  expectError(result, 'E27');
});

test('checkFiles=true：mp4 + h264 通过', async () => {
  const project = await prepareProject();
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  assertNoErrors(result);
});

test('checkFiles=true：mp4 + vp9 报 E28', async () => {
  const project = await prepareProject((p) => {
    p.assets.videos[0].codec = 'vp9';
  });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  expectError(result, 'E28');
});

test('checkFiles=true：webm + vp9 通过', async () => {
  const project = await prepareProject((p) => {
    p.assets.videos[0].path = 'assets/videos/cut.webm';
    p.assets.videos[0].format = 'webm';
    p.assets.videos[0].codec = 'vp9';
  });
  const result = await validateProjectForExport(project, { projectDir, checkFiles: true });
  assertNoErrors(result);
});
