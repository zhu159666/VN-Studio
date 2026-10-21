#!/usr/bin/env node
// 开发辅助脚本：编译 schema，并对 examples/ 下的项目与存档做结构校验。
// 正式断言在 tests/schema.test.mjs；这里只做快速人工检查。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');

const root = process.cwd();
const schemaPath = path.join(root, 'schema/schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const validateProject = ajv.compile(schema);
const validateSave = ajv.compile({
  $ref: `${schema.$id}#/$defs/saveState`,
});

function showErrors(label, errors) {
  console.log(`[FAIL] ${label}`);
  for (const e of errors ?? []) {
    console.log(`  - ${e.instancePath || '/'} ${e.message} ${e.params ? JSON.stringify(e.params) : ''}`);
  }
}

let ok = true;

const demoPath = path.join(root, 'examples/demo-project.json');
if (fs.existsSync(demoPath)) {
  const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
  if (validateProject(demo)) {
    console.log('[OK] examples/demo-project.json 通过 schema 校验');
  } else {
    showErrors('examples/demo-project.json', validateProject.errors);
    ok = false;
  }
}

const savePath = path.join(root, 'examples/save-sample.json');
if (fs.existsSync(savePath)) {
  const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  if (validateSave(save)) {
    console.log('[OK] examples/save-sample.json 通过 saveState 校验');
  } else {
    showErrors('examples/save-sample.json', validateSave.errors);
    ok = false;
  }
}

console.log(`schema compiled OK (${Object.keys(schema.$defs).length} $defs)`);
process.exit(ok ? 0 : 1);
