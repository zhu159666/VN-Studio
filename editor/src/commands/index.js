// Command bus：统一注册、JSON Schema 参数校验、结构化结果与 MCP 工具描述。
//
// 设计目标（为未来 MCP 暴露做准备）：
// - 每个 command 对应一个可能被 AI 调用的操作；
// - 参数只接受 JSON 可序列化类型，并由 inputSchema 校验；
// - 返回统一结构：{ ok, command, affectedNodeIds, affectedTrackIds, warnings, data?, project?, error? }；
// - listCommands() / commandsToMcpTools() 可直接转成 MCP tool 定义（name + description + inputSchema）。
import AjvModule from 'ajv';

import { BLUEPRINT_COMMANDS } from './blueprintCommands.js';
import { TIMELINE_COMMANDS } from './timelineCommands.js';
import { fail, success, toMcpToolName } from './helpers.js';

const Ajv = AjvModule?.default ?? AjvModule;
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

const COMMANDS = [...BLUEPRINT_COMMANDS, ...TIMELINE_COMMANDS];
const BY_NAME = new Map();
for (const command of COMMANDS) {
  if (BY_NAME.has(command.name)) throw new Error(`重复的 command：${command.name}`);
  BY_NAME.set(command.name, command);
  BY_NAME.set(toMcpToolName(command.name), command);
}

const VALIDATORS = new Map();

function validatorFor(command) {
  if (!VALIDATORS.has(command.name)) {
    VALIDATORS.set(command.name, ajv.compile(command.inputSchema));
  }
  return VALIDATORS.get(command.name);
}

function formatAjvErrors(errors) {
  return (errors ?? [])
    .map((error) => {
      const path = error.instancePath || '/';
      return `${path} ${error.message ?? '参数不合法'}`.trim();
    })
    .join('; ');
}

function failure(commandName, code, message, details = null) {
  const result = fail(code, message, details);
  return {
    ok: false,
    command: commandName,
    affectedNodeIds: [],
    affectedTrackIds: [],
    warnings: [],
    error: result.error,
  };
}

/** 返回全部 command 的元数据（含 MCP 可用的 tool name / inputSchema）。 */
export function listCommands() {
  return COMMANDS.map((command) => ({
    name: command.name,
    mcpName: toMcpToolName(command.name),
    category: command.category,
    title: command.title,
    description: command.description,
    inputSchema: command.inputSchema,
  }));
}

/** 直接生成 MCP tools/list 需要的结构（不含项目状态）。 */
export function commandsToMcpTools() {
  return listCommands().map((command) => ({
    name: command.mcpName,
    description: `${command.title}：${command.description}`,
    inputSchema: command.inputSchema,
  }));
}

export function getCommand(name) {
  return BY_NAME.get(name) ?? null;
}

export const COMMAND_NAMES = COMMANDS.map((command) => command.name);

/**
 * 执行一个 command。
 *
 * @param {object} project 当前项目（不会被原地修改）
 * @param {string} name command 点号名或 MCP 下划线名
 * @param {object} params 纯 JSON 参数
 * @returns {{
 *   ok: boolean,
 *   command: string,
 *   affectedNodeIds: string[],
 *   affectedTrackIds: string[],
 *   warnings: string[],
 *   data?: object|null,
 *   project?: object,
 *   error?: {code: string, message: string, details?: object}
 * }}
 */
export function executeCommand(project, name, params = {}) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    return failure(String(name ?? ''), 'E_INVALID_PROJECT', '项目结构无效：需要包含 nodes / edges 数组');
  }
  const command = BY_NAME.get(name);
  if (!command) {
    return failure(String(name ?? ''), 'E_UNKNOWN_COMMAND', `未知 command：${name}`);
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return failure(command.name, 'E_INVALID_PARAMS', 'params 必须是 JSON 对象');
  }

  const validate = validatorFor(command);
  if (!validate(params)) {
    return failure(
      command.name,
      'E_INVALID_PARAMS',
      `参数校验失败：${formatAjvErrors(validate.errors)}`,
      { errors: validate.errors ?? [] },
    );
  }

  try {
    const result = command.run({ project, command }, params);
    if (!result?.ok) {
      return failure(command.name, result?.error?.code ?? 'E_COMMAND_FAILED', result?.error?.message ?? '命令执行失败', result?.error?.details ?? null);
    }
    const normalized = success({
      project: result.project,
      affectedNodeIds: result.affectedNodeIds ?? [],
      affectedTrackIds: result.affectedTrackIds ?? [],
      data: result.data ?? null,
      warnings: result.warnings ?? [],
    });
    return {
      ok: true,
      command: command.name,
      affectedNodeIds: normalized.affectedNodeIds,
      affectedTrackIds: normalized.affectedTrackIds,
      warnings: normalized.warnings,
      data: normalized.data,
      project: normalized.project,
    };
  } catch (error) {
    return failure(command.name, 'E_COMMAND_FAILED', error?.message ?? '命令执行异常');
  }
}

/** 只校验参数不执行（预览 / MCP 请求预检）。 */
export function validateCommandParams(name, params = {}) {
  const command = BY_NAME.get(name);
  if (!command) return { ok: false, code: 'E_UNKNOWN_COMMAND', message: `未知 command：${name}` };
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, code: 'E_INVALID_PARAMS', message: 'params 必须是 JSON 对象' };
  }
  const validate = validatorFor(command);
  if (!validate(params)) {
    return { ok: false, code: 'E_INVALID_PARAMS', message: formatAjvErrors(validate.errors), errors: validate.errors ?? [] };
  }
  return { ok: true };
}
