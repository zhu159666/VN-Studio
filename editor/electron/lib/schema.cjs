'use strict';

// 项目文件 / 存档的 JSON Schema 校验（draft 2020-12，ajv）。
// 纯 Node 模块：不依赖 electron，测试可直接复用。

const fs = require('node:fs');
const paths = require('./paths.cjs');

const SCHEMA_VERSION = 1;

let cached = null;

function loadSchema() {
  const text = fs.readFileSync(paths.schemaPath(), 'utf8');
  return JSON.parse(text);
}

function getCompiled() {
  if (cached) return cached;
  // 延迟 require，ajv 只在需要校验时加载。
  const Ajv2020 = require('ajv/dist/2020');
  const schema = loadSchema();
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const validateProjectFn = ajv.compile(schema);
  const validateSaveFn = ajv.compile({ $ref: `${schema.$id}#/$defs/saveState` });
  cached = { schema, ajv, validateProjectFn, validateSaveFn };
  return cached;
}

function formatErrors(errors) {
  return (errors || []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message || '校验失败',
    params: e.params || null,
  }));
}

function validateProject(project) {
  const { validateProjectFn } = getCompiled();
  const valid = validateProjectFn(project);
  return { ok: Boolean(valid), errors: valid ? [] : formatErrors(validateProjectFn.errors) };
}

function validateSaveState(save) {
  const { validateSaveFn } = getCompiled();
  const valid = validateSaveFn(save);
  return { ok: Boolean(valid), errors: valid ? [] : formatErrors(validateSaveFn.errors) };
}

function assertValidProject(project) {
  const result = validateProject(project);
  if (!result.ok) {
    const preview = result.errors
      .slice(0, 5)
      .map((e) => `${e.path} ${e.message}`)
      .join('；');
    const err = new Error(`项目文件不符合 schema：${preview}`);
    err.code = 'SCHEMA_INVALID';
    err.errors = result.errors;
    throw err;
  }
  return project;
}

module.exports = {
  SCHEMA_VERSION,
  loadSchema,
  validateProject,
  validateSaveState,
  assertValidProject,
};
