// 阶段五：视觉小说运行时引擎核心（纯 ESM，无 DOM / window / document / IndexedDB）。
// 只负责蓝图推进、变量、条件、场景舞台时间轴时间、存档序列化；渲染与交互在 runtime.js。
// API 与语义严格按 runtime/CONTRACT-PHASE5.md；错误只写入 engine.status / engine.error，
// 不向调用方抛未捕获异常（公共方法内部兜底 try/catch），warning 收集到 engine.warnings 并 console.warn。

import { evaluateExpression } from './expression.js';
import { DEFAULT_TEXTBOX, getTimeline, resolveSceneValues } from './timeline.js';

/** 引擎状态。 */
export const ENGINE_STATUS = Object.freeze({
  RUNNING: 'running',
  ENDED: 'ended',
  ERROR: 'error',
});

const SAVE_VERSION = 1;
const SAVE_SCHEMA_VERSION = 1;
/** 自动节点（jump / condition / variable）单次推进的最大步数，防御纯逻辑死循环。 */
const MAX_AUTO_STEPS = 1000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TYPED_TYPES = new Set(['number', 'string', 'boolean', 'array', 'object', 'null']);
const DEFAULT_AUDIO_STATE = Object.freeze({
  bgmAssetId: null,
  volume: 0.8,
  loop: false,
  sfx: [],
});

/* ------------------------------------------------------------------ */
/* 通用小工具（不依赖宿主）                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

/** 深拷贝 JSON 兼容值（变量值 / 存档快照），只处理普通 JSON 结构。 */
function cloneJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* 含不可克隆值时退化到 JSON */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** 判断是否合法 typedValue（六种标签 + 对应 JSON 类型）。 */
function isTypedValue(value) {
  if (!isPlainObject(value)) return false;
  if (!TYPED_TYPES.has(value.type)) return false;
  switch (value.type) {
    case 'number':
      return typeof value.value === 'number' && Number.isFinite(value.value);
    case 'string':
      return typeof value.value === 'string';
    case 'boolean':
      return typeof value.value === 'boolean';
    case 'array':
      return Array.isArray(value.value);
    case 'object':
      return isPlainObject(value.value);
    case 'null':
      return value.value === null;
    default:
      return false;
  }
}

/** 深拷贝 typedValue，并剔除多余字段。 */
function cloneTypedValue(typedValue) {
  return { type: typedValue.type, value: cloneJson(typedValue.value) };
}

/** 深拷贝变量表；非法条目与原型链键静默跳过。 */
function cloneTypedValueMap(map) {
  const result = {};
  if (!isPlainObject(map)) return result;
  for (const key of Object.keys(map)) {
    if (!isSafeKey(key)) continue;
    const typedValue = map[key];
    if (!isTypedValue(typedValue)) continue;
    result[key] = cloneTypedValue(typedValue);
  }
  return result;
}

/** FIELDS 8.7 真值表（condition 求值结果非 boolean 时使用）。 */
function isTruthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '';
  return true;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/* ------------------------------------------------------------------ */
/* 引擎                                                               */
/* ------------------------------------------------------------------ */

/**
 * 创建运行时引擎。
 * @param {{project:object, startNodeId?:string|null, autoStart?:boolean, save?:object|null}} options
 */
export function createEngine(options = {}) {
  const rawProject = options?.project;
  const projectIsValid = isPlainObject(rawProject);
  // 无效项目时用空项目占位，保证引擎字段/方法仍可安全访问（不向 UI 抛异常）。
  const project = projectIsValid
    ? rawProject
    : {
        meta: {},
        settings: {},
        assets: { images: [], audio: [], videos: [], minigames: [] },
        variables: {},
        nodes: [],
        edges: [],
        timelines: {},
      };
  const explicitStartNodeId = typeof options?.startNodeId === 'string' && options.startNodeId ? options.startNodeId : null;
  const autoStart = options?.autoStart === true;
  const initialSave = isPlainObject(options?.save) ? options.save : null;

  const engine = {
    project,
    status: ENGINE_STATUS.RUNNING,
    error: null,
    warnings: [],
    nodeId: null,
    variables: {},
    playtimeMs: 0,
    stage: null,
    pending: null,
    normal: null,

    start,
    advance,
    choose,
    submitMinigameResult,
    timeoutMinigame,
    completeVideo,
    tick,
    getRenderState,
    serialize,
    loadSave,
    getCurrentNode,
    getNodeById,
  };

  engine.variables = cloneTypedValueMap(project.variables);

  if (!projectIsValid) {
    fail('项目数据无效：缺少 project 对象');
    return engine;
  }

  /* ---------------- 内部工具 ---------------- */

  function warn(message) {
    engine.warnings.push(message);
    try {
      console.warn(message);
    } catch {
      /* 无 console 环境忽略 */
    }
  }

  function fail(message) {
    engine.status = ENGINE_STATUS.ERROR;
    engine.error = message;
    engine.pending = null;
    try {
      console.warn(message);
    } catch {
      /* 无 console 环境忽略 */
    }
    return { ok: false, error: message };
  }

  /** 公共方法兜底：任何内部异常都转成 error 状态，不抛给 UI。 */
  function safeCall(handler, onError) {
    try {
      return handler();
    } catch (error) {
      const message = `运行时错误：${error?.message ?? String(error)}`;
      engine.status = ENGINE_STATUS.ERROR;
      engine.error = message;
      engine.pending = null;
      try {
        console.warn(message);
      } catch {
        /* ignore */
      }
      return typeof onError === 'function' ? onError(message) : { ok: false, error: message };
    }
  }

  function getNodes() {
    return Array.isArray(project.nodes) ? project.nodes : [];
  }

  function getEdges() {
    return Array.isArray(project.edges) ? project.edges : [];
  }

  function getStartNodeId() {
    if (explicitStartNodeId) return explicitStartNodeId;
    const fromSettings = project.settings?.startNodeId;
    return typeof fromSettings === 'string' && fromSettings ? fromSettings : null;
  }

  function plainVariables() {
    const result = {};
    for (const key of Object.keys(engine.variables)) {
      if (!isSafeKey(key)) continue;
      const typedValue = engine.variables[key];
      result[key] = isTypedValue(typedValue) ? typedValue.value : typedValue;
    }
    return result;
  }

  /**
   * 出口 → 边：只能沿 sequence / conditional 推进，data 忽略。
   * 找不到返回 { missing:true }（由调用方决定是「正常结束」还是错误）；
   * 多条出线返回 { error }（FIELDS 12.2 E11，永远按错误处理）。
   */
  function findEdge(fromNodeId, port) {
    const matches = getEdges().filter(
      (edge) =>
        edge &&
        edge.from === fromNodeId &&
        edge.port === port &&
        (edge.kind === 'sequence' || edge.kind === 'conditional'),
    );
    if (matches.length === 0) {
      return { missing: true, message: `节点 ${fromNodeId} 的出口 "${port}" 没有连线` };
    }
    if (matches.length > 1) {
      return { error: `节点 ${fromNodeId} 的出口 "${port}" 存在多条连线（不唯一）` };
    }
    return { to: matches[0].to };
  }

  /** 把 findEdge 的失败结果转成 error 状态（missing 也视为错误，用于自动节点/分支出口）。 */
  function failForEdge(edge) {
    return fail(edge.error ?? edge.message ?? '出口连线无效');
  }

  /* ---------------- 变量操作 ---------------- */

  function applyAssignments(node) {
    const assignments = Array.isArray(node.assignments) ? node.assignments : [];
    for (const assignment of assignments) {
      const key = assignment?.key;
      const op = assignment?.op;
      if (!isSafeKey(key)) {
        warn(`变量节点 ${node.id} 存在无效的变量名，已跳过`);
        continue;
      }
      if (op === 'set') {
        if (!isTypedValue(assignment.value)) {
          warn(`变量操作已跳过（set）：${key} 的目标值不是合法 typedValue`);
          continue;
        }
        if (key === 'last_minigame_result' && assignment.value.type !== 'string') {
          warn(`变量操作已跳过（set）：last_minigame_result 只允许 string 类型的值`);
          continue;
        }
        engine.variables[key] = cloneTypedValue(assignment.value);
        continue;
      }
      if (op === 'add' || op === 'subtract') {
        const target = engine.variables[key];
        if (!isTypedValue(target) || target.type !== 'number') {
          warn(`变量操作已跳过（${op}）：${key} 不存在或不是 number`);
          continue;
        }
        const delta = assignment.value;
        if (!isTypedValue(delta) || delta.type !== 'number') {
          warn(`变量操作已跳过（${op}）：${key} 的赋值不是 number`);
          continue;
        }
        const next = op === 'add' ? target.value + delta.value : target.value - delta.value;
        engine.variables[key] = { type: 'number', value: next };
        continue;
      }
      if (op === 'toggle') {
        const target = engine.variables[key];
        if (!isTypedValue(target) || target.type !== 'boolean') {
          warn(`变量操作已跳过（toggle）：${key} 不存在或不是 boolean`);
          continue;
        }
        engine.variables[key] = { type: 'boolean', value: !target.value };
        continue;
      }
      if (op === 'push') {
        const target = engine.variables[key];
        if (!isTypedValue(target) || target.type !== 'array') {
          warn(`变量操作已跳过（push）：${key} 不存在或不是 array`);
          continue;
        }
        if (!isTypedValue(assignment.value)) {
          warn(`变量操作已跳过（push）：${key} 的追加值不是合法 typedValue`);
          continue;
        }
        target.value.push(cloneJson(assignment.value.value));
        continue;
      }
      warn(`变量节点 ${node.id} 存在未知操作：${op}`);
    }
  }

  /** 场景 variables 是声明：仅当全局变量表没有该 key 时按声明初始化。 */
  function applySceneVariables(node) {
    const declarations = Array.isArray(node.variables) ? node.variables : [];
    for (const declaration of declarations) {
      const key = declaration?.key;
      if (!isSafeKey(key)) {
        warn(`场景 ${node.id} 存在无效的变量声明，已跳过`);
        continue;
      }
      if (hasOwn(engine.variables, key)) continue;
      if (!isTypedValue(declaration.value)) {
        warn(`场景 ${node.id} 的变量声明 ${key} 不是合法 typedValue，已跳过`);
        continue;
      }
      if (key === 'last_minigame_result' && declaration.value.type !== 'string') {
        warn(`场景 ${node.id} 的变量声明 last_minigame_result 不是 string，已跳过`);
        continue;
      }
      engine.variables[key] = cloneTypedValue(declaration.value);
    }
  }

  /* ---------------- 节点推进 ---------------- */

  /** 沿出口前进：查唯一边 → 进入目标节点（无出边视为蓝图错误）。 */
  function gotoEdge(fromNodeId, port) {
    const edge = findEdge(fromNodeId, port);
    if (edge.missing || edge.error) return failForEdge(edge);
    return enterNode(edge.to);
  }

  /** 正常结束：没有可交互节点 / 剧情走到尽头（UI 显示结束界面）。 */
  function endGame() {
    engine.status = ENGINE_STATUS.ENDED;
    engine.error = null;
    engine.pending = null;
    return { ok: true, ended: true };
  }

  /** 进入节点并连续执行自动节点（jump / condition / variable），直到可交互节点或错误。 */
  function enterNode(initialNodeId) {
    let nodeId = initialNodeId;
    for (let step = 0; step < MAX_AUTO_STEPS; step += 1) {
      const node = getNodeById(nodeId);
      if (!node) return fail(`节点不存在：${nodeId}`);
      engine.nodeId = node.id;
      if (node.type !== 'scene') engine.normal = null;
      switch (node.type) {
        case 'jump': {
          const target = node.targetNodeId;
          if (typeof target !== 'string' || !target) {
            return fail(`跳转节点 ${node.id} 缺少目标节点`);
          }
          if (!getNodeById(target)) {
            return fail(`跳转节点 ${node.id} 的目标节点不存在：${target}`);
          }
          nodeId = target;
          break;
        }
        case 'condition': {
          let branch = false;
          const expression = typeof node.expression === 'string' ? node.expression : '';
          const result = evaluateExpression(expression, plainVariables());
          if (result.ok) {
            branch = isTruthy(result.value);
          } else {
            warn(`条件表达式求值失败（按 false 分支继续）：${result.error}｜表达式：${expression}`);
          }
          const port = branch ? 'true' : 'false';
          const edge = findEdge(node.id, port);
          if (edge.missing || edge.error) return failForEdge(edge);
          nodeId = edge.to;
          break;
        }
        case 'variable': {
          applyAssignments(node);
          const edge = findEdge(node.id, 'next');
          if (edge.missing || edge.error) return failForEdge(edge);
          nodeId = edge.to;
          break;
        }
        case 'scene': {
          applySceneVariables(node);
          engine.stage = { sceneNodeId: node.id, timeMs: 0 };
          const entries = Array.isArray(node.dialogues) ? node.dialogues : [];
          if (entries.length > 0) {
            engine.normal = { index: 0 };
            engine.pending = { type: entries[0]?.type === 'branch' ? 'normal-choice' : 'normal' };
          } else {
            engine.normal = null;
            engine.pending = { type: 'scene' };
          }
          engine.status = ENGINE_STATUS.RUNNING;
          engine.error = null;
          return { ok: true };
        }
        case 'dialogue':
          engine.pending = { type: 'dialogue' };
          return { ok: true };
        case 'choice':
          engine.pending = { type: 'choice' };
          return { ok: true };
        case 'minigame':
          engine.pending = { type: 'minigame' };
          return { ok: true };
        case 'video':
          engine.pending = { type: 'video' };
          return { ok: true };
        default:
          return fail(`未知节点类型：${String(node.type)}（节点 ${node.id}）`);
      }
    }
    return fail('自动节点链路过长（疑似存在纯逻辑死循环）');
  }

  /* ---------------- 公共方法 ---------------- */

  /**
   * 开始游戏：重置变量与进度，从 startNodeId（参数 > createEngine 参数 > settings.startNodeId）开始。
   */
  function start(nodeId) {
    return safeCall(() => {
      const target = typeof nodeId === 'string' && nodeId ? nodeId : getStartNodeId();
      engine.status = ENGINE_STATUS.RUNNING;
      engine.error = null;
      engine.warnings = [];
      engine.nodeId = null;
      engine.pending = null;
      engine.stage = null;
      engine.playtimeMs = 0;
      engine.variables = cloneTypedValueMap(project.variables);
      if (!target) return fail('没有可用的起始节点：请检查 settings.startNodeId');
      if (!getNodeById(target)) return fail(`起始节点不存在：${target}`);
      return enterNode(target);
    });
  }

  /**
   * dialogue / scene：沿 next 出口推进。
   * 没有 next 出边 = 剧情正常结束（status='ended'）；同一出口多条边仍按蓝图错误处理。
   */
  function advance() {
    return safeCall(() => {
      if (engine.status !== ENGINE_STATUS.RUNNING) {
        return { ok: false, error: engine.error ?? '当前状态不可推进' };
      }
      const type = engine.pending?.type;
      if (type === 'normal') {
        const node = getCurrentNode();
        const entries = Array.isArray(node?.dialogues) ? node.dialogues : [];
        const nextIndex = (engine.normal?.index ?? 0) + 1;
        if (nextIndex >= entries.length) {
          const edge = findEdge(engine.nodeId, 'next');
          if (edge.missing) return endGame();
          if (edge.error) return fail(edge.error);
          return enterNode(edge.to);
        }
        engine.normal = { index: nextIndex };
        engine.pending = { type: entries[nextIndex]?.type === 'branch' ? 'normal-choice' : 'normal' };
        return { ok: true };
      }
      if (type !== 'dialogue' && type !== 'scene') {
        return { ok: false, error: `当前节点（${type ?? '无'}）不能通过 advance 推进` };
      }
      const edge = findEdge(engine.nodeId, 'next');
      if (edge.missing) return endGame();
      if (edge.error) return fail(edge.error);
      return enterNode(edge.to);
    });
  }

  /** choice：按出口 id 推进；出口不存在或没有出边 → error。 */
  function choose(exitId) {
    return safeCall(() => {
      if (engine.status !== ENGINE_STATUS.RUNNING) {
        return { ok: false, error: engine.error ?? '当前状态不可推进' };
      }
      if (engine.pending?.type === 'normal-choice') {
        const node = getCurrentNode();
        const entries = Array.isArray(node?.dialogues) ? node.dialogues : [];
        const entry = entries[engine.normal?.index ?? 0];
        const options = Array.isArray(entry?.options) ? entry.options : [];
        const option = options.find((item) => item && item.id === exitId);
        if (!option) return fail(`分支对话 ${node?.id ?? ''} 不存在选项：${exitId}`);
        if (option.setVariables && typeof option.setVariables === 'object') {
          for (const [key, value] of Object.entries(option.setVariables)) {
            const type = Array.isArray(value)
              ? 'array'
              : value === null
                ? 'null'
                : typeof value === 'boolean'
                  ? 'boolean'
                  : typeof value === 'number'
                    ? 'number'
                    : 'string';
            engine.variables[key] = { type, value: cloneJson(value) };
          }
        }
        if (typeof option.targetNodeId !== 'string' || !option.targetNodeId) {
          return fail(`分支选项 ${option.id} 缺少 targetNodeId`);
        }
        return enterNode(option.targetNodeId);
      }
      if (engine.pending?.type !== 'choice') {
        return { ok: false, error: '当前不是选项节点' };
      }
      const node = getCurrentNode();
      if (!node) return fail(`当前节点不存在：${engine.nodeId}`);
      const exits = Array.isArray(node.exits) ? node.exits : [];
      const exit = exits.find((item) => item && item.id === exitId);
      if (!exit) return fail(`选项节点 ${node.id} 不存在出口：${exitId}`);
      return gotoEdge(node.id, exit.id);
    });
  }

  /**
   * minigame：写 last_minigame_result（typed string）后按 exit.name 精确匹配。
   * 无匹配走 defaultExitId；再没有则 error。result 非 string 直接拒绝（不改变量、不推进）。
   */
  function submitMinigameResult(result) {
    return safeCall(() => {
      if (engine.status !== ENGINE_STATUS.RUNNING) {
        return { ok: false, error: engine.error ?? '当前状态不可推进' };
      }
      if (engine.pending?.type !== 'minigame') {
        return { ok: false, error: '当前不是小游戏节点' };
      }
      if (typeof result !== 'string') {
        return { ok: false, matched: false, error: '小游戏结果必须是字符串' };
      }
      const node = getCurrentNode();
      if (!node) return fail(`当前节点不存在：${engine.nodeId}`);
      const exits = Array.isArray(node.exits) ? node.exits : [];
      // 合法结果先写入保留变量（即使后续没有匹配出口也不回滚）。
      engine.variables.last_minigame_result = { type: 'string', value: result };
      const matchedExit = exits.find((exit) => exit && exit.name === result);
      let exitId;
      if (matchedExit) {
        exitId = matchedExit.id;
      } else if (typeof node.defaultExitId === 'string' && node.defaultExitId) {
        exitId = node.defaultExitId;
        if (!exits.some((exit) => exit && exit.id === exitId)) {
          return fail(`小游戏节点 ${node.id} 的默认出口不存在：${exitId}`);
        }
      } else {
        return fail(`小游戏结果 "${result}" 未匹配任何出口，且节点没有默认出口`);
      }
      const advanced = gotoEdge(node.id, exitId);
      if (!advanced.ok) {
        return { ok: false, matched: !!matchedExit, exitId, error: advanced.error };
      }
      return { ok: true, matched: !!matchedExit, exitId };
    });
  }

  /** minigame 超时：不写 last_minigame_result，按无匹配走 defaultExitId / error。 */
  function timeoutMinigame() {
    return safeCall(() => {
      if (engine.status !== ENGINE_STATUS.RUNNING) {
        return { ok: false, error: engine.error ?? '当前状态不可推进' };
      }
      if (engine.pending?.type !== 'minigame') {
        return { ok: false, error: '当前不是小游戏节点' };
      }
      const node = getCurrentNode();
      if (!node) return fail(`当前节点不存在：${engine.nodeId}`);
      const exits = Array.isArray(node.exits) ? node.exits : [];
      const defaultExitId = typeof node.defaultExitId === 'string' && node.defaultExitId ? node.defaultExitId : null;
      if (!defaultExitId) {
        return fail(`小游戏节点 ${node.id} 超时，且没有默认出口`);
      }
      if (!exits.some((exit) => exit && exit.id === defaultExitId)) {
        return fail(`小游戏节点 ${node.id} 的默认出口不存在：${defaultExitId}`);
      }
      const advanced = gotoEdge(node.id, defaultExitId);
      if (!advanced.ok) {
        return { ok: false, matched: false, exitId: defaultExitId, error: advanced.error };
      }
      return { ok: true, matched: false, exitId: defaultExitId };
    });
  }

  /** video：按 'completed' / 'skipped' 出口推进。 */
  function completeVideo(outcome) {
    return safeCall(() => {
      if (engine.status !== ENGINE_STATUS.RUNNING) {
        return { ok: false, error: engine.error ?? '当前状态不可推进' };
      }
      if (engine.pending?.type !== 'video') {
        return { ok: false, error: '当前不是视频节点' };
      }
      if (outcome !== 'completed' && outcome !== 'skipped') {
        return { ok: false, error: '视频结局必须是 completed 或 skipped' };
      }
      return gotoEdge(engine.nodeId, outcome);
    });
  }

  /**
   * 推进时钟：playtimeMs 累加；当前停在 scene 时推进舞台时间。
   * 该场景有时间轴：loop=true 取模，否则 clamp 到 durationMs。离开 scene 后舞台冻结。
   */
  function tick(deltaMs) {
    return safeCall(() => {
      const delta = Number(deltaMs);
      if (!Number.isFinite(delta) || delta <= 0) return { ok: true };
      engine.playtimeMs += delta;
      if (engine.pending?.type !== 'scene' || !engine.stage) return { ok: true };
      engine.stage.timeMs += delta;
      const timeline = getTimeline(project, engine.stage.sceneNodeId);
      if (!timeline) return { ok: true };
      const duration = toFiniteNumber(timeline.durationMs, 0);
      if (!(duration > 0)) {
        engine.stage.timeMs = Math.max(0, engine.stage.timeMs);
        return { ok: true };
      }
      if (timeline.loop === true) {
        engine.stage.timeMs = engine.stage.timeMs % duration;
      } else {
        engine.stage.timeMs = Math.min(engine.stage.timeMs, duration);
      }
      return { ok: true };
    });
  }

  function getCurrentNode() {
    if (typeof engine.nodeId !== 'string' || !engine.nodeId) return null;
    return getNodeById(engine.nodeId);
  }

  function getNodeById(nodeId) {
    if (typeof nodeId !== 'string' || !nodeId) return null;
    return getNodes().find((node) => node && node.id === nodeId) ?? null;
  }

  function findAsset(kind, assetId) {
    if (typeof assetId !== 'string' || !assetId) return null;
    const list = project.assets?.[kind];
    if (!Array.isArray(list)) return null;
    return list.find((asset) => asset && asset.id === assetId) ?? null;
  }

  function defaultStageState() {
    return {
      sceneNodeId: null,
      timeMs: 0,
      background: null,
      sprites: [],
      uiImages: [],
      textbox: { ...DEFAULT_TEXTBOX },
      audio: { ...DEFAULT_AUDIO_STATE, sfx: [] },
      camera: { x: 0, y: 0, zoom: 1, rotation: 0, shake: 0 },
      foreground: null,
      particles: null,
    };
  }

  function computeStageState() {
    const stage = engine.stage;
    if (!stage || typeof stage.sceneNodeId !== 'string') return defaultStageState();
    const sceneNode = getNodeById(stage.sceneNodeId);
    const timeMs = Math.max(0, toFiniteNumber(stage.timeMs, 0));
    if (!sceneNode || sceneNode.type !== 'scene') {
      return { ...defaultStageState(), sceneNodeId: stage.sceneNodeId, timeMs: Math.round(timeMs) };
    }
    const values = resolveSceneValues(project, sceneNode, timeMs);
    return {
      sceneNodeId: stage.sceneNodeId,
      timeMs: Math.round(timeMs),
      background: values.background
        ? {
            assetId: values.background.assetId ?? null,
            fit: values.background.fit ?? 'cover',
            x: toFiniteNumber(values.background.x, 0.5),
            y: toFiniteNumber(values.background.y, 0.5),
            scale: toFiniteNumber(values.background.scale, 1),
            opacity: toFiniteNumber(values.background.opacity, 1),
            enabled: values.background.enabled !== false,
            startMs: values.background.startMs ?? null,
            endMs: values.background.endMs ?? null,
          }
        : null,
      sprites: (values.sprites ?? []).map((sprite) => ({
        id: sprite.id,
        assetId: sprite.assetId ?? null,
        x: toFiniteNumber(sprite.x, 0.5),
        y: toFiniteNumber(sprite.y, 0.5),
        scale: toFiniteNumber(sprite.scale, 1),
        zIndex: Math.round(toFiniteNumber(sprite.zIndex, 0)),
        opacity: toFiniteNumber(sprite.opacity, 1),
        enabled: sprite.enabled !== false,
        startMs: sprite.startMs ?? null,
        endMs: sprite.endMs ?? null,
      })),
      uiImages: (values.uiImages ?? []).map((image) => ({
        id: image.id,
        assetId: image.assetId ?? null,
        x: toFiniteNumber(image.x, 0.5),
        y: toFiniteNumber(image.y, 0.5),
        scale: toFiniteNumber(image.scale, 1),
        zIndex: Math.round(toFiniteNumber(image.zIndex, 0)),
        opacity: toFiniteNumber(image.opacity, 1),
        enabled: image.enabled !== false,
        startMs: image.startMs ?? null,
        endMs: image.endMs ?? null,
      })),
      textbox: { ...values.textbox },
      audio: {
        bgmAssetId: values.audio?.bgmAssetId ?? null,
        volume: toFiniteNumber(values.audio?.volume, DEFAULT_AUDIO_STATE.volume),
        loop: values.audio?.loop === true,
        sfx: Array.isArray(values.audio?.sfx) ? values.audio.sfx : [],
      },
      camera: {
        x: toFiniteNumber(values.camera?.x, 0),
        y: toFiniteNumber(values.camera?.y, 0),
        zoom: Math.max(0.1, toFiniteNumber(values.camera?.zoom, 1)),
        rotation: toFiniteNumber(values.camera?.rotation, 0),
        shake: Math.max(0, toFiniteNumber(values.camera?.shake, 0)),
      },
      foreground: sceneNode.foreground
        ? {
            assetId: sceneNode.foreground.assetId ?? null,
            opacity: toFiniteNumber(sceneNode.foreground.opacity, 1),
            fit: sceneNode.foreground.fit ?? 'cover',
            scale: toFiniteNumber(sceneNode.foreground.scale, 1),
            scrollX: toFiniteNumber(sceneNode.foreground.scrollX, 0),
            scrollY: toFiniteNumber(sceneNode.foreground.scrollY, 0),
            enabled: sceneNode.foreground.enabled !== false,
            startMs: sceneNode.foreground.startMs ?? null,
            endMs: sceneNode.foreground.endMs ?? null,
          }
        : null,
      particles: sceneNode.particles
        ? {
            preset: sceneNode.particles.preset ?? 'none',
            density: toFiniteNumber(sceneNode.particles.density, 1),
            speed: toFiniteNumber(sceneNode.particles.speed, 1),
            wind: toFiniteNumber(sceneNode.particles.wind, 0),
            opacity: toFiniteNumber(sceneNode.particles.opacity, 0.7),
            color: sceneNode.particles.color ?? null,
            enabled: sceneNode.particles.enabled !== false,
            startMs: sceneNode.particles.startMs ?? null,
            endMs: sceneNode.particles.endMs ?? null,
          }
        : null,
    };
  }

  /** 供 UI 渲染的只读快照。 */
  function getRenderState() {
    return safeCall(
      () => {
        const node = getCurrentNode();
        const state = {
          status: engine.status,
          error: engine.error,
          nodeId: engine.nodeId,
          nodeType: node?.type ?? null,
          playtimeMs: Math.round(toFiniteNumber(engine.playtimeMs, 0)),
          autoSave: node?.autoSave === true,
          stage: computeStageState(),
          dialogue: null,
          choice: null,
          minigame: null,
          video: null,
          ended: engine.status === ENGINE_STATUS.ENDED,
        };
        const pendingType = engine.pending?.type;
        if (!node) return state;
        const normalEntries = Array.isArray(node.dialogues) ? node.dialogues : [];
        const normalEntry = normalEntries[engine.normal?.index ?? 0] || null;
        if (pendingType === 'normal' && normalEntry) {
          const speedCps = typeof normalEntry.speedCps === 'number'
            ? normalEntry.speedCps
            : toFiniteNumber(project.settings?.textSpeedCps, 0);
          state.dialogue = {
            speaker: normalEntry.speaker ?? null,
            text: typeof normalEntry.text === 'string' ? normalEntry.text : '',
            portrait: normalEntry.portrait ?? null,
            voice: null,
            speedCps,
            autoAdvanceMs: normalEntry.autoAdvanceMs ?? null,
            animation: normalEntry.animation ?? 'none',
            sfx: Array.isArray(normalEntry.sfx) ? normalEntry.sfx : [],
          };
        } else if (pendingType === 'normal-choice' && normalEntry) {
          state.choice = {
            prompt: typeof normalEntry.prompt === 'string' ? normalEntry.prompt : '',
            options: (Array.isArray(normalEntry.options) ? normalEntry.options : []).map((option) => ({
              id: option?.id ?? '',
              name: option?.label ?? '',
              label: option?.label ?? null,
            })),
          };
        } else if (pendingType === 'dialogue') {
          const speedCps = typeof node.speedCps === 'number'
            ? node.speedCps
            : toFiniteNumber(project.settings?.textSpeedCps, 0);
          state.dialogue = {
            speaker: node.speaker ?? null,
            text: typeof node.text === 'string' ? node.text : '',
            portrait: node.portrait ?? null,
            voice: node.voice ?? null,
            speedCps,
            autoAdvanceMs: node.autoAdvanceMs ?? null,
          };
        } else if (pendingType === 'choice') {
          const exits = Array.isArray(node.exits) ? node.exits : [];
          state.choice = {
            prompt: typeof node.prompt === 'string' ? node.prompt : '',
            options: exits.map((exit) => ({
              id: exit?.id ?? '',
              name: exit?.name ?? '',
              label: exit?.label ?? null,
            })),
          };
        } else if (pendingType === 'minigame') {
          const asset = findAsset('minigames', node.minigameAssetId);
          const exits = Array.isArray(node.exits) ? node.exits : [];
          const timeoutMs = typeof node.timeoutMs === 'number' && Number.isFinite(node.timeoutMs)
            ? node.timeoutMs
            : project.settings?.runtime?.defaultMinigameTimeoutMs ?? null;
          state.minigame = {
            nodeId: node.id,
            minigameAssetId: node.minigameAssetId ?? null,
            path: asset?.path ?? null,
            exits: exits.map((exit) => ({ id: exit?.id ?? '', name: exit?.name ?? '' })),
            defaultExitId: node.defaultExitId ?? null,
            timeoutMs,
            instructions: typeof node.instructions === 'string' ? node.instructions : '',
            mode: asset?.mode ?? 'blocking',
          };
        } else if (pendingType === 'video') {
          const asset = findAsset('videos', node.videoAssetId);
          state.video = {
            nodeId: node.id,
            videoAssetId: node.videoAssetId ?? null,
            path: asset?.path ?? null,
            volume: toFiniteNumber(node.volume, 1),
            loop: node.loop === true,
            showSkipButton: node.showSkipButton !== false,
            skipAfterMs: node.skipAfterMs ?? null,
          };
        }
        return state;
      },
      (message) => ({
        status: ENGINE_STATUS.ERROR,
        error: message,
        nodeId: engine.nodeId,
        nodeType: null,
        playtimeMs: Math.round(toFiniteNumber(engine.playtimeMs, 0)),
        stage: defaultStageState(),
        dialogue: null,
        choice: null,
        minigame: null,
        video: null,
        ended: false,
      }),
    );
  }

  /**
   * 生成 schema $defs.saveState 形状的存档对象。
   * kind='manual' 时 slot 取 1–999；auto / quick 槽位固定为 0（schema allOf 约束）。
   */
  function serialize(serializeOptions = {}) {
    return safeCall(() => {
      const source = isPlainObject(serializeOptions) ? serializeOptions : {};
      const kind = ['manual', 'auto', 'quick'].includes(source.kind) ? source.kind : 'manual';
      const rawSlot = Math.round(toFiniteNumber(source.slot, 1));
      const slot = kind === 'manual' ? Math.min(999, Math.max(1, rawSlot || 1)) : 0;
      const projectTitle = typeof source.projectTitle === 'string' && source.projectTitle
        ? source.projectTitle
        : typeof project.meta?.title === 'string'
          ? project.meta.title
          : undefined;
      const thumbnailDataUrl = typeof source.thumbnailDataUrl === 'string' ? source.thumbnailDataUrl : null;
      const saveState = {
        version: SAVE_VERSION,
        kind,
        slot,
        savedAt: new Date().toISOString(),
        projectId: typeof project.meta?.id === 'string' ? project.meta.id : '',
        schemaVersion: SAVE_SCHEMA_VERSION,
        nodeId: engine.nodeId ?? getStartNodeId() ?? '',
        variables: cloneTypedValueMap(engine.variables),
        timeline: engine.stage && typeof engine.stage.sceneNodeId === 'string'
          ? {
              nodeId: engine.stage.sceneNodeId,
              timeMs: Math.max(0, Math.round(toFiniteNumber(engine.stage.timeMs, 0))),
            }
          : null,
        thumbnailDataUrl,
        playtimeMs: Math.max(0, Math.round(toFiniteNumber(engine.playtimeMs, 0))),
      };
      if (projectTitle !== undefined) saveState.projectTitle = projectTitle;
      if (typeof source.label === 'string' && source.label) saveState.label = source.label;
      if (engine.normal && Number.isInteger(engine.normal.index)) saveState.normalIndex = engine.normal.index;
      return saveState;
    });
  }

  /**
   * 读档：校验 projectId / schemaVersion / nodeId → 恢复变量、节点、舞台时间。
   * 自动节点会基于恢复后的变量重新推进，但不会重置已有变量。
   */
  function loadSave(saveState) {
    return safeCall(() => {
      if (!isPlainObject(saveState)) return { ok: false, error: '存档数据无效' };
      const projectId = typeof project.meta?.id === 'string' ? project.meta.id : '';
      if (saveState.projectId !== projectId) {
        return { ok: false, error: '存档属于其他项目，已拒绝加载' };
      }
      if (saveState.schemaVersion !== SAVE_SCHEMA_VERSION) {
        return { ok: false, error: `存档结构版本不兼容：${String(saveState.schemaVersion)}` };
      }
      if (typeof saveState.nodeId !== 'string' || !getNodeById(saveState.nodeId)) {
        return { ok: false, error: `存档节点不存在：${String(saveState.nodeId)}` };
      }
      engine.status = ENGINE_STATUS.RUNNING;
      engine.error = null;
      engine.warnings = [];
      engine.nodeId = null;
      engine.pending = null;
      engine.stage = null;
      // 恢复变量（deep clone）；非法条目跳过并警告，不覆盖已有值以外的任何状态。
      engine.variables = {};
      if (isPlainObject(saveState.variables)) {
        for (const key of Object.keys(saveState.variables)) {
          if (!isSafeKey(key)) {
            warn(`存档变量名非法，已忽略：${key}`);
            continue;
          }
          const typedValue = saveState.variables[key];
          if (!isTypedValue(typedValue)) {
            warn(`存档变量 ${key} 不是合法 typedValue，已忽略`);
            continue;
          }
          engine.variables[key] = cloneTypedValue(typedValue);
        }
      }
      engine.playtimeMs = Math.max(0, Math.round(toFiniteNumber(saveState.playtimeMs, 0)));
      const entered = enterNode(saveState.nodeId);
      if (!entered.ok) return entered;
      if (engine.normal && Number.isInteger(saveState.normalIndex)) {
        const normalNode = getCurrentNode();
        const entries = Array.isArray(normalNode?.dialogues) ? normalNode.dialogues : [];
        if (entries.length > 0) {
          const index = Math.min(Math.max(0, saveState.normalIndex), entries.length - 1);
          engine.normal = { index };
          engine.pending = { type: entries[index]?.type === 'branch' ? 'normal-choice' : 'normal' };
        }
      }

      const savedTimeline = isPlainObject(saveState.timeline) ? saveState.timeline : null;
      const savedTimeMs = savedTimeline ? Math.max(0, Math.round(toFiniteNumber(savedTimeline.timeMs, 0))) : 0;
      const savedSceneId = savedTimeline && typeof savedTimeline.nodeId === 'string' ? savedTimeline.nodeId : null;
      if ((engine.pending?.type === 'scene' || engine.pending?.type === 'normal' || engine.pending?.type === 'normal-choice') && engine.stage) {
        // 当前就停在该场景：沿用该场景，时间取存档里同一场景的播放头。
        engine.stage = {
          sceneNodeId: engine.nodeId,
          timeMs: savedSceneId === engine.nodeId ? savedTimeMs : 0,
        };
      } else if (savedSceneId) {
        const savedSceneNode = getNodeById(savedSceneId);
        if (savedSceneNode && savedSceneNode.type === 'scene') {
          engine.stage = { sceneNodeId: savedSceneId, timeMs: savedTimeMs };
        } else {
          warn(`存档中的场景节点不存在，舞台时间轴进度未恢复：${savedSceneId}`);
        }
      }
      return { ok: true };
    });
  }

  /* ---------------- 构造阶段自动启动 ---------------- */

  if (initialSave) {
    engine.loadSave(initialSave);
  } else if (autoStart) {
    engine.start();
  }

  return engine;
}
