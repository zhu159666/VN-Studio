'use strict';

// 导出前项目校验（阶段六）。
//
// 契约见 editor/CONTRACT-PHASE6.md：validateProjectForExport(project, options)
// 返回 { ok, errors, warnings }。结构规则按 schema/FIELDS.md §12 的 E03–E30 / W01–W10
// 实现；E01/E02/E29 由 schema 与存档模块另行处理。
//
// checkFiles=true 且提供 projectDir 时额外做文件检查：
//   - 素材文件存在；
//   - 小游戏 HTML 用 ./minigame.cjs 的 validateMinigameHtml 重新解析
//     （MINIGAME_EXITS 与 declaredExits 一致、无远程资源、含 postMessage）；
//   - 视频编码矩阵（metadata 层始终检查，见 E28）。
//
// 纯 Node 模块：不 require electron，不修改项目对象，不向调用方抛异常。

const fsp = require('node:fs/promises');
const path = require('node:path');

const { validateMinigameHtml } = require('./minigame.cjs');

const FLOW_KINDS = new Set(['sequence', 'conditional']);
const INTERACTIVE_NODE_TYPES = new Set(['scene', 'dialogue', 'choice', 'minigame', 'video']);
const LOGIC_NODE_TYPES = new Set(['condition', 'variable', 'jump']);

const ASSET_TABLES = [
  { key: 'images', kind: 'image' },
  { key: 'audio', kind: 'audio' },
  { key: 'videos', kind: 'video' },
  { key: 'minigames', kind: 'minigame' },
];

const EXTENSION_BY_FORMAT = {
  png: '.png',
  webp: '.webp',
  jpg: '.jpg',
  ogg: '.ogg',
  mp3: '.mp3',
  mp4: '.mp4',
  webm: '.webm',
};

const VIDEO_CODECS_BY_FORMAT = {
  mp4: ['h264'],
  webm: ['vp8', 'vp9'],
};

// 关键帧属性合法域（FIELDS §12 E25）。
const KEYFRAME_DOMAINS = {
  opacity: { min: 0, max: 1, label: '0–1' },
  backgroundOpacity: { min: 0, max: 1, label: '0–1' },
  volume: { min: 0, max: 1, label: '0–1' },
  scale: { min: 0.05, max: 10, label: '0.05–10' },
  width: { min: 0.05, max: 1, label: '0.05–1' },
  height: { min: 0.05, max: 1, label: '0.05–1' },
  fontSizePx: { min: 8, max: 200, label: '8–200' },
  x: { min: -1, max: 2, label: '-1–2' },
  y: { min: -1, max: 2, label: '-1–2' },
};

const INTERACTIVE_EXIT_REQUIRED_TYPES = new Set([
  'dialogue',
  'scene',
  'choice',
  'minigame',
  'video',
  'condition',
  'variable',
]);
const TERMINAL_ALLOWED_TYPES = new Set(['dialogue', 'scene']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function nodeLabel(node) {
  if (!isObject(node)) return '未命名节点';
  if (isNonEmptyString(node.name)) return node.name;
  if (isNonEmptyString(node.id)) return node.id;
  return '未命名节点';
}

function assetLabel(record) {
  if (!record) return '不存在';
  const role = isNonEmptyString(record.asset.role) ? record.asset.role : '无 role';
  return `${record.kind}/${role}`;
}

function pathCompare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 去重 + 按 path（再 code/message）稳定排序。 */
function finalizeList(list) {
  const seen = new Set();
  const deduped = [];
  for (const item of list) {
    const entry = {
      code: String(item.code),
      message: String(item.message),
      path: typeof item.path === 'string' ? item.path : '',
    };
    const key = `${entry.code}\u0000${entry.path}\u0000${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  deduped.sort((a, b) => {
    const byPath = pathCompare(a.path, b.path);
    if (byPath !== 0) return byPath;
    const byCode = pathCompare(a.code, b.code);
    if (byCode !== 0) return byCode;
    return pathCompare(a.message, b.message);
  });
  return deduped;
}

/** 迭代式 DFS 求强连通分量（Kosaraju），避免深链递归爆栈。 */
function stronglyConnectedComponents(vertices, adjacency) {
  const visited = new Set();
  const order = [];
  for (const start of vertices) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [[start, 0]];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const node = frame[0];
      const neighbors = adjacency.get(node) || [];
      const index = frame[1];
      if (index < neighbors.length) {
        frame[1] = index + 1;
        const next = neighbors[index];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push([next, 0]);
        }
        continue;
      }
      order.push(node);
      stack.pop();
    }
  }

  const reverse = new Map();
  for (const vertex of vertices) reverse.set(vertex, []);
  for (const [from, targets] of adjacency) {
    if (!reverse.has(from)) continue;
    for (const to of targets) {
      if (!reverse.has(to)) continue;
      reverse.get(to).push(from);
    }
  }

  const assigned = new Set();
  const components = [];
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const start = order[i];
    if (assigned.has(start)) continue;
    assigned.add(start);
    const component = [];
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop();
      component.push(node);
      for (const next of reverse.get(node) || []) {
        if (!assigned.has(next)) {
          assigned.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * 校验项目是否可以导出为 Web 包。
 * @param {object} project 项目对象（schemaVersion=1）
 * @param {{projectDir?:string|null, checkFiles?:boolean, readFile?:Function}} [options]
 * @returns {Promise<{ok:boolean, errors:Array<{code:string,message:string,path:string}>, warnings:Array<{code:string,message:string,path:string}>}>}
 */
async function validateProjectForExport(project, options = {}) {
  const errors = [];
  const warnings = [];
  const addError = (code, message, errorPath = '') => errors.push({ code, message, path: errorPath });
  const addWarning = (code, message, warningPath = '') => warnings.push({ code, message, path: warningPath });

  const opts = isObject(options) ? options : {};
  const projectDir =
    typeof opts.projectDir === 'string' && opts.projectDir.trim() !== ''
      ? path.resolve(opts.projectDir)
      : null;
  const checkFiles = opts.checkFiles === undefined ? Boolean(projectDir) : Boolean(opts.checkFiles);
  const customReadFile = typeof opts.readFile === 'function' ? opts.readFile : null;

  try {
    if (!isObject(project)) {
      addError('E01', '项目对象缺失或不是对象');
      return { ok: false, errors: finalizeList(errors), warnings: finalizeList(warnings) };
    }

    /* ---------------------------------------------------------------- */
    /* 收集节点 / 连线 / 素材（保留原始下标用于 path）                    */
    /* ---------------------------------------------------------------- */

    const nodeEntries = [];
    const nodeById = new Map();
    const rawNodes = Array.isArray(project.nodes) ? project.nodes : [];
    for (let index = 0; index < rawNodes.length; index += 1) {
      const node = rawNodes[index];
      if (!isObject(node)) continue;
      nodeEntries.push({ node, index });
      if (!isNonEmptyString(node.id)) continue;
      if (nodeById.has(node.id)) {
        addError('E03', `节点 id 重复：${node.id}`, `/nodes/${index}/id`);
      } else {
        nodeById.set(node.id, { node, index });
      }
    }

    const edgeEntries = [];
    const edgeById = new Map();
    const rawEdges = Array.isArray(project.edges) ? project.edges : [];
    for (let index = 0; index < rawEdges.length; index += 1) {
      const edge = rawEdges[index];
      if (!isObject(edge)) continue;
      edgeEntries.push({ edge, index });
      if (!isNonEmptyString(edge.id)) continue;
      if (edgeById.has(edge.id)) {
        addError('E04', `连线 id 重复：${edge.id}`, `/edges/${index}/id`);
      } else {
        edgeById.set(edge.id, { edge, index });
      }
    }

    const rawAssets = isObject(project.assets) ? project.assets : {};
    const assetEntries = [];
    const assetById = new Map();
    for (const table of ASSET_TABLES) {
      const list = asArray(rawAssets[table.key]);
      for (let index = 0; index < list.length; index += 1) {
        const asset = list[index];
        if (!isObject(asset)) continue;
        const entry = { table: table.key, kind: table.kind, asset, index };
        assetEntries.push(entry);
        if (!isNonEmptyString(asset.id)) continue;
        if (assetById.has(asset.id)) {
          const first = assetById.get(asset.id);
          addError(
            'E05',
            `素材 id 跨四表重复：${asset.id}（${first.table}[${first.index}] 与 ${table.key}[${index}]）`,
            `/assets/${table.key}/${index}/id`,
          );
        } else {
          assetById.set(asset.id, entry);
        }
      }
    }

    /* ---------------------------------------------------------------- */
    /* E08 起始节点                                                      */
    /* ---------------------------------------------------------------- */

    const settings = isObject(project.settings) ? project.settings : {};
    const startNodeId = settings.startNodeId;
    if (!isNonEmptyString(startNodeId)) {
      addError('E08', 'settings.startNodeId 为空（导出前必须指定入口节点）', '/settings/startNodeId');
    } else if (!nodeById.has(startNodeId)) {
      addError('E08', `settings.startNodeId 指向不存在的节点：${startNodeId}`, '/settings/startNodeId');
    }

    /* ---------------------------------------------------------------- */
    /* E06 / E07 节点出口 id / name 唯一                                  */
    /* ---------------------------------------------------------------- */

    for (const { node, index } of nodeEntries) {
      const exits = asArray(node.exits);
      const seenIds = new Set();
      const seenNames = new Set();
      for (let exitIndex = 0; exitIndex < exits.length; exitIndex += 1) {
        const exit = exits[exitIndex];
        if (!isObject(exit)) continue;
        const exitPath = `/nodes/${index}/exits/${exitIndex}`;
        if (isNonEmptyString(exit.id)) {
          if (seenIds.has(exit.id)) {
            addError('E06', `节点 ${nodeLabel(node)} 内出口 id 重复：${exit.id}`, `${exitPath}/id`);
          } else {
            seenIds.add(exit.id);
          }
        }
        if (isNonEmptyString(exit.name)) {
          if (seenNames.has(exit.name)) {
            addError('E07', `节点 ${nodeLabel(node)} 内出口 name 重复：${exit.name}`, `${exitPath}/name`);
          } else {
            seenNames.add(exit.name);
          }
        }
      }
    }

    /* ---------------------------------------------------------------- */
    /* 连线结构：E09 / E10 / E11 / E12 / E13 / E14 / E15 / E16 / E17 / E18 */
    /* ---------------------------------------------------------------- */

    const flowEdgeCountByPort = new Map(); // `${from}\u0000${port}` -> number
    const flowEdgeGroups = new Map(); // 同 key -> [{edge,index}]
    for (const { edge, index } of edgeEntries) {
      const edgePath = `/edges/${index}`;
      const fromExists = isNonEmptyString(edge.from) && nodeById.has(edge.from);
      const toExists = isNonEmptyString(edge.to) && nodeById.has(edge.to);
      if (!fromExists) {
        addError('E09', `连线的 from 指向不存在的节点：${String(edge.from)}`, `${edgePath}/from`);
      }
      if (!toExists) {
        addError('E09', `连线的 to 指向不存在的节点：${String(edge.to)}`, `${edgePath}/to`);
      }

      const fromRec = fromExists ? nodeById.get(edge.from) : null;
      let exitIndex = -1;
      if (fromRec) {
        const exits = asArray(fromRec.node.exits);
        exitIndex = exits.findIndex((exit) => isObject(exit) && exit.id === edge.port);
        if (exitIndex === -1) {
          addError(
            'E10',
            `连线 ${String(edge.id)} 的 port 不是节点 ${nodeLabel(fromRec.node)} 的真实出口：${String(edge.port)}`,
            `${edgePath}/port`,
          );
        }
      }

      if (!FLOW_KINDS.has(edge.kind)) continue;
      const groupKey = `${String(edge.from)}\u0000${String(edge.port)}`;
      flowEdgeCountByPort.set(groupKey, (flowEdgeCountByPort.get(groupKey) || 0) + 1);
      if (!flowEdgeGroups.has(groupKey)) flowEdgeGroups.set(groupKey, []);
      flowEdgeGroups.get(groupKey).push({ edge, index, fromRec, exitIndex });

      // E13 / E14：按源节点类型约束出边 kind（data 边不参与流程，豁免）。
      if (fromRec) {
        if (fromRec.node.type === 'condition') {
          if (edge.kind !== 'conditional') {
            addError('E13', `condition 节点 ${nodeLabel(fromRec.node)} 的出边 kind 必须是 conditional（实际 ${String(edge.kind)}）`, edgePath);
          }
        } else if (edge.kind !== 'sequence') {
          addError('E14', `非 condition 节点 ${nodeLabel(fromRec.node)} 的出边 kind 必须是 sequence（实际 ${String(edge.kind)}）`, edgePath);
        }
      }
    }

    // E11：同一出口多条 sequence / conditional 出边。
    for (const [groupKey, group] of flowEdgeGroups) {
      if (group.length < 2) continue;
      const [rawFrom, rawPort] = groupKey.split('\u0000');
      const first = group[0];
      const groupPath =
        first.fromRec && first.exitIndex >= 0
          ? `/nodes/${first.fromRec.index}/exits/${first.exitIndex}`
          : `/edges/${first.index}`;
      addError(
        'E11',
        `出口 ${rawFrom}.${rawPort} 存在 ${group.length} 条 sequence/conditional 出边（同一出口只允许一条）`,
        groupPath,
      );
    }

    // E12：非 jump 每个出口恰好一条出边；jump 无出口 / 无出边。
    for (const { node, index } of nodeEntries) {
      const exits = asArray(node.exits);
      if (node.type === 'jump') {
        const flowOut = edgeEntries.filter(
          ({ edge }) => edge.from === node.id && FLOW_KINDS.has(edge.kind),
        );
        if (flowOut.length > 0) {
          addError(
            'E12',
            `jump 节点 ${nodeLabel(node)} 不应有出边（应使用 targetNodeId 直接跳转）`,
            `/nodes/${index}/exits`,
          );
        }
        continue;
      }
      if (!INTERACTIVE_EXIT_REQUIRED_TYPES.has(node.type)) continue;
      for (let exitIndex = 0; exitIndex < exits.length; exitIndex += 1) {
        const exit = exits[exitIndex];
        if (!isObject(exit)) continue;
        const count = flowEdgeCountByPort.get(`${String(node.id)}\u0000${String(exit.id)}`) || 0;
        const exitPath = `/nodes/${index}/exits/${exitIndex}`;
        // dialogue / scene 的 next 允许不接线：表示剧情正常结束（见 FIELDS D31）。
        if (count === 0 && TERMINAL_ALLOWED_TYPES.has(node.type)) continue;
        if (count === 0) {
          addError(
            'E12',
            `节点 ${nodeLabel(node)} 的出口 ${isNonEmptyString(exit.name) ? exit.name : String(exit.id)} 没有出边（除 jump 外每个出口必须恰好一条；dialogue/scene 的 next 可留空表示结束）`,
            exitPath,
          );
        } else if (count > 1) {
          addError(
            'E12',
            `节点 ${nodeLabel(node)} 的出口 ${isNonEmptyString(exit.name) ? exit.name : String(exit.id)} 有 ${count} 条出边（必须恰好一条）`,
            exitPath,
          );
        }
      }
    }

    // E15 / E16：video 固定出口、minigame 每个出口都要接线。
    for (const { node, index } of nodeEntries) {
      if (node.type !== 'video') continue;
      const exits = asArray(node.exits);
      for (const requiredId of ['completed', 'skipped']) {
        const exitIndex = exits.findIndex((exit) => isObject(exit) && exit.id === requiredId);
        const count =
          flowEdgeCountByPort.get(`${String(node.id)}\u0000${requiredId}`) || 0;
        if (exitIndex === -1 || count === 0) {
          addError(
            'E15',
            `video 节点 ${nodeLabel(node)} 的出口 ${requiredId} 未接线`,
            exitIndex === -1 ? `/nodes/${index}/exits` : `/nodes/${index}/exits/${exitIndex}`,
          );
        }
      }
    }

    for (const { node, index } of nodeEntries) {
      if (node.type !== 'minigame') continue;
      const exits = asArray(node.exits);
      if (exits.length === 0) {
        addError('E16', `minigame 节点 ${nodeLabel(node)} 没有可接线的出口`, `/nodes/${index}/exits`);
        continue;
      }
      for (let exitIndex = 0; exitIndex < exits.length; exitIndex += 1) {
        const exit = exits[exitIndex];
        if (!isObject(exit)) continue;
        const count = flowEdgeCountByPort.get(`${String(node.id)}\u0000${String(exit.id)}`) || 0;
        if (count === 0) {
          addError(
            'E16',
            `minigame 节点 ${nodeLabel(node)} 的出口 ${isNonEmptyString(exit.name) ? exit.name : String(exit.id)} 未接线`,
            `/nodes/${index}/exits/${exitIndex}`,
          );
        }
      }
    }

    // E17：defaultExitId 属于本节点出口或 null。
    for (const { node, index } of nodeEntries) {
      if (node.type !== 'minigame') continue;
      const defaultExitId = node.defaultExitId;
      if (defaultExitId === null) continue;
      const exitIds = new Set(
        asArray(node.exits).filter(isObject).map((exit) => exit.id).filter(isNonEmptyString),
      );
      if (!exitIds.has(defaultExitId)) {
        addError(
          'E17',
          `minigame 节点 ${nodeLabel(node)} 的 defaultExitId 不是本节点出口：${String(defaultExitId)}`,
          `/nodes/${index}/defaultExitId`,
        );
      }
    }

    // E18：jump.targetNodeId 指向存在节点。
    for (const { node, index } of nodeEntries) {
      if (node.type !== 'jump') continue;
      if (!isNonEmptyString(node.targetNodeId) || !nodeById.has(node.targetNodeId)) {
        addError(
          'E18',
          `jump 节点 ${nodeLabel(node)} 的 targetNodeId 指向不存在的节点：${String(node.targetNodeId)}`,
          `/nodes/${index}/targetNodeId`,
        );
      }
    }

    /* ---------------------------------------------------------------- */
    /* E19 素材引用：存在性 + kind / role 匹配                           */
    /* ---------------------------------------------------------------- */

    function checkAssetReference(reference, tableKey, kind, role, referencePath, label) {
      if (reference === null || reference === undefined) return;
      if (!isNonEmptyString(reference)) {
        addError('E19', `${label}的素材引用为空`, referencePath);
        return;
      }
      const record = assetById.get(reference);
      if (!record) {
        addError('E19', `${label}引用的素材不存在：${reference}`, referencePath);
        return;
      }
      if (record.table !== tableKey || record.kind !== kind) {
        addError(
          'E19',
          `${label}引用的素材类型不匹配（需要 ${kind}，实际 ${assetLabel(record)}）：${reference}`,
          referencePath,
        );
        return;
      }
      if (isNonEmptyString(role) && record.asset.role !== role) {
        addError(
          'E19',
          `${label}引用的素材 role 不匹配（需要 ${kind}/${role}，实际 ${assetLabel(record)}）：${reference}`,
          referencePath,
        );
      }
    }

    for (const { node, index } of nodeEntries) {
      const basePath = `/nodes/${index}`;
      if (node.type === 'scene') {
        if (isObject(node.background)) {
          checkAssetReference(
            node.background.assetId,
            'images',
            'image',
            'background',
            `${basePath}/background/assetId`,
            `场景 ${nodeLabel(node)} 背景`,
          );
        }
        const sprites = asArray(node.sprites);
        for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex += 1) {
          const sprite = sprites[spriteIndex];
          if (!isObject(sprite)) continue;
          checkAssetReference(
            sprite.assetId,
            'images',
            'image',
            'sprite',
            `${basePath}/sprites/${spriteIndex}/assetId`,
            `场景 ${nodeLabel(node)} 立绘`,
          );
        }
        const uiImages = asArray(node.uiImages);
        for (let uiIndex = 0; uiIndex < uiImages.length; uiIndex += 1) {
          const uiImage = uiImages[uiIndex];
          if (!isObject(uiImage)) continue;
          checkAssetReference(
            uiImage.assetId,
            'images',
            'image',
            'ui',
            `${basePath}/uiImages/${uiIndex}/assetId`,
            `场景 ${nodeLabel(node)} UI 图片`,
          );
        }
        if (isObject(node.audio)) {
          checkAssetReference(
            node.audio.bgmAssetId,
            'audio',
            'audio',
            'bgm',
            `${basePath}/audio/bgmAssetId`,
            `场景 ${nodeLabel(node)} BGM`,
          );
          const sfxList = asArray(node.audio.sfx);
          for (let sfxIndex = 0; sfxIndex < sfxList.length; sfxIndex += 1) {
            const sfx = sfxList[sfxIndex];
            if (!isObject(sfx)) continue;
            checkAssetReference(
              sfx.assetId,
              'audio',
              'audio',
              'sfx',
              `${basePath}/audio/sfx/${sfxIndex}/assetId`,
              `场景 ${nodeLabel(node)} 音效`,
            );
          }
        }
      } else if (node.type === 'dialogue') {
        if (isObject(node.portrait)) {
          checkAssetReference(
            node.portrait.assetId,
            'images',
            'image',
            'sprite',
            `${basePath}/portrait/assetId`,
            `对话 ${nodeLabel(node)} 立绘`,
          );
        }
        if (isObject(node.voice)) {
          checkAssetReference(
            node.voice.assetId,
            'audio',
            'audio',
            'voice',
            `${basePath}/voice/assetId`,
            `对话 ${nodeLabel(node)} 语音`,
          );
        }
      } else if (node.type === 'video') {
        checkAssetReference(
          node.videoAssetId,
          'videos',
          'video',
          null,
          `${basePath}/videoAssetId`,
          `视频节点 ${nodeLabel(node)}`,
        );
      } else if (node.type === 'minigame') {
        checkAssetReference(
          node.minigameAssetId,
          'minigames',
          'minigame',
          null,
          `${basePath}/minigameAssetId`,
          `小游戏节点 ${nodeLabel(node)}`,
        );
      }
    }

    /* ---------------------------------------------------------------- */
    /* E20 路径 / 扩展名 / 小游戏后缀（结构性，不做文件 IO）             */
    /* ---------------------------------------------------------------- */

    const assetPathUsable = new Map(); // entry -> boolean
    for (const entry of assetEntries) {
      const { asset, table: tableKey, kind, index } = entry;
      const assetPath = asset.path;
      let usable = true;
      const report = (message) => {
        usable = false;
        addError('E20', `${message}（${String(assetPath)}）`, `/assets/${tableKey}/${index}/path`);
      };

      if (!isNonEmptyString(assetPath)) {
        addError('E20', '素材路径为空或不是字符串', `/assets/${tableKey}/${index}/path`);
        assetPathUsable.set(entry, false);
        continue;
      }
      if (assetPath.includes('\\')) report('素材路径必须使用 / 分隔');
      if (assetPath.startsWith('/') || /^[A-Za-z]:/.test(assetPath)) report('素材路径不允许绝对路径');
      if (assetPath.split('/').includes('..')) report('素材路径不允许 .. 逃逸');
      if (!assetPath.startsWith('assets/')) report('素材路径必须以 assets/ 开头');

      if (kind === 'minigame') {
        if (!/\.html$/i.test(assetPath)) report('小游戏入口必须是 assets/ 下的 .html 文件');
      } else {
        const dot = assetPath.lastIndexOf('.');
        const extension = dot === -1 ? '' : assetPath.slice(dot).toLowerCase();
        const format = isNonEmptyString(asset.format) ? asset.format.toLowerCase() : '';
        const expectedExtension = EXTENSION_BY_FORMAT[format];
        if (expectedExtension && extension !== expectedExtension) {
          report(`素材扩展名 ${extension || '(无)'} 与 format ${format} 不一致`);
        }
      }
      assetPathUsable.set(entry, usable);
    }

    /* ---------------------------------------------------------------- */
    /* E28 视频编码矩阵（metadata 层）                                    */
    /* ---------------------------------------------------------------- */

    for (const entry of assetEntries) {
      if (entry.kind !== 'video') continue;
      const { asset, index } = entry;
      const format = isNonEmptyString(asset.format) ? asset.format.toLowerCase() : '';
      const supported = VIDEO_CODECS_BY_FORMAT[format];
      if (!supported || !isNonEmptyString(asset.codec)) continue;
      if (!supported.includes(asset.codec)) {
        addError(
          'E28',
          `视频容器 ${format} 只支持编码 ${supported.join(' / ')}（实际 ${asset.codec}）`,
          `/assets/videos/${index}/codec`,
        );
      }
    }

    /* ---------------------------------------------------------------- */
    /* E26 / W08 minigame 出口与 declaredExits 的关系                    */
    /* ---------------------------------------------------------------- */

    for (const { node, index } of nodeEntries) {
      if (node.type !== 'minigame') continue;
      const record = assetById.get(node.minigameAssetId);
      if (!record || record.kind !== 'minigame') continue; // E19 已覆盖
      const declared = asArray(record.asset.declaredExits).filter(isNonEmptyString);
      const exits = asArray(node.exits).filter(isObject);
      const exitNames = new Set(exits.map((exit) => exit.name).filter(isNonEmptyString));

      for (const declaredExit of declared) {
        if (!exitNames.has(declaredExit)) {
          addError(
            'E26',
            `minigame 节点 ${nodeLabel(node)} 的出口名未覆盖素材声明的出口：${declaredExit}`,
            `/nodes/${index}/exits`,
          );
        }
      }
      if (declared.length > 0) {
        const declaredSet = new Set(declared);
        for (let exitIndex = 0; exitIndex < exits.length; exitIndex += 1) {
          const exit = exits[exitIndex];
          if (!isNonEmptyString(exit.name)) continue;
          if (!declaredSet.has(exit.name)) {
            addWarning(
              'W08',
              `minigame 节点 ${nodeLabel(node)} 存在 declaredExits 之外的出口 ${exit.name}（result 永远不会命中）`,
              `/nodes/${index}/exits/${exitIndex}/name`,
            );
          }
        }
      }
    }

    /* ---------------------------------------------------------------- */
    /* E21–E25 时间轴                                                    */
    /* ---------------------------------------------------------------- */

    const timelines = isObject(project.timelines) ? project.timelines : {};
    for (const [sceneId, timeline] of Object.entries(timelines)) {
      const sceneRecord = nodeById.get(sceneId);
      const timelinePath = `/timelines/${sceneId}`;
      if (!sceneRecord || sceneRecord.node.type !== 'scene') {
        addError('E21', `timelines 的键不是场景节点 id：${sceneId}`, timelinePath);
        continue;
      }
      if (!isObject(timeline)) continue;

      const spriteIds = new Set(
        asArray(sceneRecord.node.sprites)
          .filter(isObject)
          .map((sprite) => sprite.id)
          .filter(isNonEmptyString),
      );
      const durationMs = Number.isInteger(timeline.durationMs) ? timeline.durationMs : null;
      const tracks = asArray(timeline.tracks);
      const seenTrackIds = new Set();
      const seenTrackPairs = new Set();

      for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
        const track = tracks[trackIndex];
        if (!isObject(track)) continue;
        const trackPath = `${timelinePath}/tracks/${trackIndex}`;

        if (isNonEmptyString(track.id)) {
          if (seenTrackIds.has(track.id)) {
            addError('E23', `时间轴 ${sceneId} 内轨道 id 重复：${track.id}`, `${trackPath}/id`);
          } else {
            seenTrackIds.add(track.id);
          }
        }

        const pairKey = `${String(track.kind)}\u0000${isNonEmptyString(track.target) ? track.target : ''}\u0000${String(track.property)}`;
        if (seenTrackPairs.has(pairKey)) {
          addError(
            'E23',
            `时间轴 ${sceneId} 内同一 (target, property) 有多条轨道：${String(track.target || track.kind)}.${String(track.property)}`,
            trackPath,
          );
        } else {
          seenTrackPairs.add(pairKey);
        }

        if (track.kind === 'sprite') {
          if (!isNonEmptyString(track.target) || !spriteIds.has(track.target)) {
            addError(
              'E22',
              `sprite 轨道的 target 不在场景 ${sceneId} 的 sprites[].id 中：${String(track.target)}`,
              `${trackPath}/target`,
            );
          }
        }

        const keys = asArray(track.keys);
        let previousTime = null;
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          const key = keys[keyIndex];
          if (!isObject(key)) continue;
          const keyPath = `${trackPath}/keys/${keyIndex}`;
          const time = key.time;
          if (Number.isInteger(time)) {
            if (durationMs !== null && time > durationMs) {
              addError(
                'E24',
                `关键帧时间 ${time}ms 超过时间轴 durationMs ${durationMs}ms`,
                `${keyPath}/time`,
              );
            }
            if (previousTime !== null) {
              if (time === previousTime) {
                addError('E24', `关键帧时间重复：${time}ms`, `${keyPath}/time`);
              } else if (time < previousTime) {
                addError(
                  'E24',
                  `关键帧时间乱序：${time}ms 小于前一帧 ${previousTime}ms`,
                  `${keyPath}/time`,
                );
              }
            }
            previousTime = time;
          }

          const value = key.value;
          if (typeof value === 'number' && Number.isFinite(value)) {
            const domain = KEYFRAME_DOMAINS[track.property];
            if (domain && (value < domain.min || value > domain.max)) {
              addError(
                'E25',
                `关键帧数值 ${value} 超出属性 ${String(track.property)} 的合法域 ${domain.label}`,
                `${keyPath}/value`,
              );
            }
          }
        }
      }
    }

    /* ---------------------------------------------------------------- */
    /* W01 可达性 / W02 交互环 / E30 纯逻辑环                            */
    /* ---------------------------------------------------------------- */

    const nodeIds = [...nodeById.keys()];
    const flowAdjacency = new Map();
    for (const id of nodeIds) flowAdjacency.set(id, []);
    const addAdjacency = (from, to) => {
      if (!flowAdjacency.has(from) || !flowAdjacency.has(to)) return;
      const list = flowAdjacency.get(from);
      if (!list.includes(to)) list.push(to);
    };

    for (const { edge } of edgeEntries) {
      if (!FLOW_KINDS.has(edge.kind)) continue;
      if (!isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) continue;
      addAdjacency(edge.from, edge.to);
    }
    for (const { node } of nodeEntries) {
      if (node.type !== 'jump') continue;
      if (isNonEmptyString(node.targetNodeId)) addAdjacency(node.id, node.targetNodeId);
    }

    if (isNonEmptyString(startNodeId) && nodeById.has(startNodeId)) {
      const reachable = new Set([startNodeId]);
      const queue = [startNodeId];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const next of flowAdjacency.get(current) || []) {
          if (!reachable.has(next)) {
            reachable.add(next);
            queue.push(next);
          }
        }
      }
      for (const { node, index } of nodeEntries) {
        if (!isNonEmptyString(node.id) || !reachable.has(node.id)) {
          addWarning(
            'W01',
            `节点从 startNodeId 不可达：${nodeLabel(node)}`,
            `/nodes/${index}`,
          );
        }
      }
    }

    const fullComponents = stronglyConnectedComponents(nodeIds, flowAdjacency);
    for (const component of fullComponents) {
      const isCycle =
        component.length > 1 ||
        (component.length === 1 && (flowAdjacency.get(component[0]) || []).includes(component[0]));
      if (!isCycle) continue;
      const hasNonLogic = component.some((id) => {
        const record = nodeById.get(id);
        return !record || !LOGIC_NODE_TYPES.has(record.node.type);
      });
      if (!hasNonLogic) continue; // 纯逻辑环由下面的 E30 处理
      const labels = [...component].sort().map((id) => nodeLabel(nodeById.get(id)?.node));
      const firstRecord = nodeById.get([...component].sort()[0]);
      addWarning(
        'W02',
        `环中包含可交互节点（玩家可能绕圈）：${labels.join(' → ')}`,
        firstRecord ? `/nodes/${firstRecord.index}` : '',
      );
    }

    // 纯逻辑环：只在 condition / variable / jump 诱导的子图上找。
    const logicIds = nodeEntries
      .filter(({ node }) => LOGIC_NODE_TYPES.has(node.type) && isNonEmptyString(node.id))
      .map(({ node }) => node.id);
    const logicIdSet = new Set(logicIds);
    const logicAdjacency = new Map();
    for (const id of logicIds) logicAdjacency.set(id, []);
    for (const id of logicIds) {
      for (const next of flowAdjacency.get(id) || []) {
        if (logicIdSet.has(next)) logicAdjacency.get(id).push(next);
      }
    }
    const logicComponents = stronglyConnectedComponents(logicIds, logicAdjacency);
    for (const component of logicComponents) {
      const isCycle =
        component.length > 1 ||
        (component.length === 1 &&
          (logicAdjacency.get(component[0]) || []).includes(component[0]));
      if (!isCycle) continue;
      const sorted = [...component].sort();
      const labels = sorted.map((id) => nodeLabel(nodeById.get(id)?.node));
      const firstRecord = nodeById.get(sorted[0]);
      addError(
        'E30',
        `纯逻辑环（只有 condition / variable / jump）：${labels.join(' → ')}`,
        firstRecord ? `/nodes/${firstRecord.index}` : '',
      );
    }

    /* ---------------------------------------------------------------- */
    /* W03 data 边                                                       */
    /* ---------------------------------------------------------------- */

    for (const { edge, index } of edgeEntries) {
      if (edge.kind !== 'data') continue;
      addWarning(
        'W03',
        `存在 kind: "data" 的连线（第一版运行时不推进）：${String(edge.id)}`,
        `/edges/${index}`,
      );
    }

    /* ---------------------------------------------------------------- */
    /* W05 未使用素材                                                     */
    /* ---------------------------------------------------------------- */

    const usedAssetIds = new Set();
    for (const { node } of nodeEntries) {
      if (isObject(node.background) && isNonEmptyString(node.background.assetId)) {
        usedAssetIds.add(node.background.assetId);
      }
      for (const sprite of asArray(node.sprites)) {
        if (isObject(sprite) && isNonEmptyString(sprite.assetId)) usedAssetIds.add(sprite.assetId);
      }
      for (const uiImage of asArray(node.uiImages)) {
        if (isObject(uiImage) && isNonEmptyString(uiImage.assetId)) usedAssetIds.add(uiImage.assetId);
      }
      if (isObject(node.audio)) {
        if (isNonEmptyString(node.audio.bgmAssetId)) usedAssetIds.add(node.audio.bgmAssetId);
        for (const sfx of asArray(node.audio.sfx)) {
          if (isObject(sfx) && isNonEmptyString(sfx.assetId)) usedAssetIds.add(sfx.assetId);
        }
      }
      if (isObject(node.portrait) && isNonEmptyString(node.portrait.assetId)) {
        usedAssetIds.add(node.portrait.assetId);
      }
      if (isObject(node.voice) && isNonEmptyString(node.voice.assetId)) {
        usedAssetIds.add(node.voice.assetId);
      }
      if (isNonEmptyString(node.videoAssetId)) usedAssetIds.add(node.videoAssetId);
      if (isNonEmptyString(node.minigameAssetId)) usedAssetIds.add(node.minigameAssetId);
    }
    for (const { table: tableKey, asset, index } of assetEntries) {
      if (!isNonEmptyString(asset.id)) continue;
      if (!usedAssetIds.has(asset.id)) {
        addWarning(
          'W05',
          `素材未被任何节点或时间轴引用：${asset.id}`,
          `/assets/${tableKey}/${index}`,
        );
      }
    }

    /* ---------------------------------------------------------------- */
    /* W06 节点 name 重复                                                */
    /* ---------------------------------------------------------------- */

    const nodeNameGroups = new Map();
    for (const { node, index } of nodeEntries) {
      if (!isNonEmptyString(node.name)) continue;
      if (!nodeNameGroups.has(node.name)) nodeNameGroups.set(node.name, []);
      nodeNameGroups.get(node.name).push({ node, index });
    }
    for (const [name, group] of nodeNameGroups) {
      if (group.length < 2) continue;
      addWarning(
        'W06',
        `节点 name 重复：${name}（${group.map(({ node }) => String(node.id)).join('、')}）`,
        `/nodes/${group[0].index}/name`,
      );
    }

    /* ---------------------------------------------------------------- */
    /* W07 choice 选项文案重复                                           */
    /* ---------------------------------------------------------------- */

    for (const { node, index } of nodeEntries) {
      if (node.type !== 'choice') continue;
      const seen = new Set();
      const duplicated = new Set();
      for (const exit of asArray(node.exits)) {
        if (!isObject(exit) || !isNonEmptyString(exit.name)) continue;
        if (seen.has(exit.name)) duplicated.add(exit.name);
        else seen.add(exit.name);
      }
      for (const name of duplicated) {
        addWarning(
          'W07',
          `choice 节点 ${nodeLabel(node)} 的选项文案重复：${name}`,
          `/nodes/${index}/exits`,
        );
      }
    }

    /* ---------------------------------------------------------------- */
    /* W09 last_minigame_result 初值                                     */
    /* ---------------------------------------------------------------- */

    const globalVariables = isObject(project.variables) ? project.variables : {};
    if (Object.prototype.hasOwnProperty.call(globalVariables, 'last_minigame_result')) {
      const value = globalVariables.last_minigame_result;
      const isStringValue =
        isObject(value) && value.type === 'string' && typeof value.value === 'string';
      if (!isStringValue) {
        addWarning(
          'W09',
          '保留变量 last_minigame_result 的初值不是 string（运行时会被小游戏结果覆盖）',
          '/variables/last_minigame_result',
        );
      }
    }

    /* ---------------------------------------------------------------- */
    /* W10 场景变量与全局变量类型不一致                                  */
    /* ---------------------------------------------------------------- */

    for (const { node, index } of nodeEntries) {
      if (node.type !== 'scene') continue;
      const sceneVariables = asArray(node.variables);
      for (let variableIndex = 0; variableIndex < sceneVariables.length; variableIndex += 1) {
        const sceneVariable = sceneVariables[variableIndex];
        if (!isObject(sceneVariable) || !isNonEmptyString(sceneVariable.key)) continue;
        const globalValue = globalVariables[sceneVariable.key];
        if (!isObject(globalValue)) continue;
        if (!isObject(sceneVariable.value)) continue;
        if (typeof globalValue.type !== 'string' || typeof sceneVariable.value.type !== 'string') {
          continue;
        }
        if (globalValue.type !== sceneVariable.value.type) {
          addWarning(
            'W10',
            `场景 ${nodeLabel(node)} 声明的变量 ${sceneVariable.key} 类型 ${sceneVariable.value.type} 与全局已有类型 ${globalValue.type} 不一致（不会被覆盖）`,
            `/nodes/${index}/variables/${variableIndex}/value/type`,
          );
        }
      }
    }

    /* ---------------------------------------------------------------- */
    /* checkFiles：文件存在性 / 小游戏 HTML 重新解析                     */
    /* ---------------------------------------------------------------- */

    if (checkFiles && projectDir) {
      for (const entry of assetEntries) {
        if (assetPathUsable.get(entry) === false) continue;
        const { asset, table: tableKey, kind, index } = entry;
        if (!isNonEmptyString(asset.path)) continue;
        const absolutePath = path.resolve(projectDir, asset.path);
        const relativeFromDir = path.relative(projectDir, absolutePath);
        if (
          relativeFromDir === '' ||
          relativeFromDir.startsWith('..') ||
          path.isAbsolute(relativeFromDir)
        ) {
          continue; // 路径越界已在 E20 报过
        }

        let stat = null;
        try {
          stat = await fsp.stat(absolutePath);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            addError(
              'E20',
              `素材文件不存在：${asset.path}`,
              `/assets/${tableKey}/${index}/path`,
            );
          } else {
            addError(
              'E20',
              `无法访问素材文件：${asset.path}（${error && error.code ? error.code : '未知错误'}）`,
              `/assets/${tableKey}/${index}/path`,
            );
          }
          continue;
        }
        if (!stat.isFile()) {
          addError(
            'E20',
            `素材路径不是文件：${asset.path}`,
            `/assets/${tableKey}/${index}/path`,
          );
          continue;
        }

        if (kind !== 'minigame') continue;

        let html = null;
        try {
          html = customReadFile ? await customReadFile(absolutePath) : await fsp.readFile(absolutePath, 'utf8');
        } catch (error) {
          addError(
            'E27',
            `小游戏 HTML 读取失败：${asset.path}（${error && error.message ? error.message : '未知错误'}）`,
            `/assets/${tableKey}/${index}/path`,
          );
          continue;
        }
        if (Buffer.isBuffer(html)) html = html.toString('utf8');
        else if (typeof html !== 'string') html = String(html ?? '');

        const htmlResult = validateMinigameHtml(html);
        for (const message of asArray(htmlResult.errors)) {
          addError('E27', `小游戏接入不合规：${message}`, `/assets/${tableKey}/${index}/path`);
        }
        if (!/minigame-result/.test(html) || !/postMessage/.test(html)) {
          addError(
            'E27',
            '小游戏 HTML 未检测到 postMessage 结果上报（需要 window.parent.postMessage({ type: "minigame-result", ... })）',
            `/assets/${tableKey}/${index}/path`,
          );
        }

        const declared = asArray(asset.declaredExits).filter(isNonEmptyString);
        if (declared.length > 0 && Array.isArray(htmlResult.exits)) {
          const htmlExits = htmlResult.exits;
          const htmlSet = new Set(htmlExits);
          const declaredSet = new Set(declared);
          const missing = declared.filter((name) => !htmlSet.has(name));
          const extra = htmlExits.filter((name) => !declaredSet.has(name));
          if (missing.length > 0 || extra.length > 0) {
            const detail = [];
            if (missing.length > 0) detail.push(`缺少 ${missing.join('、')}`);
            if (extra.length > 0) detail.push(`多出 ${extra.join('、')}`);
            addError(
              'E27',
              `window.MINIGAME_EXITS 与 declaredExits 不一致（${detail.join('；')}）`,
              `/assets/${tableKey}/${index}/declaredExits`,
            );
          }
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors: finalizeList(errors),
      warnings: finalizeList(warnings),
    };
  } catch (error) {
    addError(
      'E_INTERNAL',
      `导出校验内部错误：${error && error.message ? error.message : String(error)}`,
    );
    return {
      ok: false,
      errors: finalizeList(errors),
      warnings: finalizeList(warnings),
    };
  }
}

module.exports = {
  validateProjectForExport,
};
