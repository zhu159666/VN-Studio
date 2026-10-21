#!/usr/bin/env node
// 开发辅助脚本：检查 FIELDS.md 与 schema.json 的一致性。
// 1) 编译 schema；2) 解析文档里所有 ```json 代码块；3) 检查 schema 中出现的每个字段名都在文档里被提到。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');

const root = process.cwd();
const schemaText = fs.readFileSync(path.join(root, 'schema/schema.json'), 'utf8');
const schema = JSON.parse(schemaText);
const doc = fs.readFileSync(path.join(root, 'schema/FIELDS.md'), 'utf8');

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
ajv.compile(schema);
console.log(`[OK] schema 编译通过，$defs = ${Object.keys(schema.$defs).length}`);

const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
const validateRoot = ajv.compile(schema);
const validateNode = ajv.compile({ $ref: `${schema.$id}#/$defs/node` });
let blockFailures = 0;
let semanticFailures = 0;
for (const [index, block] of jsonBlocks.entries()) {
  let data;
  try {
    data = JSON.parse(block);
  } catch (error) {
    blockFailures += 1;
    const firstLine = block.split('\n')[0];
    console.log(`[FAIL] 第 ${index + 1} 个 json 代码块解析失败（${error.message}）：${firstLine}`);
    continue;
  }

  // 语义校验：根对象片段 / 节点片段。其余（素材、轨道、边、变量表）只做语法检查。
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (Object.hasOwn(data, 'schemaVersion') || Object.hasOwn(data, 'nodes')) {
      if (!validateRoot(data)) {
        semanticFailures += 1;
        console.log(`[FAIL] 第 ${index + 1} 个代码块不符合根 schema：${JSON.stringify(validateRoot.errors)}`);
      }
    } else if (typeof data.type === 'string' && Array.isArray(data.exits) && typeof data.id === 'string') {
      if (!validateNode(data)) {
        semanticFailures += 1;
        console.log(`[FAIL] 第 ${index + 1} 个代码块不符合 $defs.node：${JSON.stringify(validateNode.errors)}`);
      }
    }
  }
}
console.log(
  `[${blockFailures === 0 ? 'OK' : 'FAIL'}] 文档内 ${jsonBlocks.length} 个 json 代码块解析通过 ${jsonBlocks.length - blockFailures}/${jsonBlocks.length}`,
);
console.log(
  `[${semanticFailures === 0 ? 'OK' : 'FAIL'}] 根对象 / 节点代码块通过语义校验（失败 ${semanticFailures}）`,
);

const fieldNames = new Set();
function collectProperties(node, seen = new WeakSet()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (node.properties && typeof node.properties === 'object') {
    for (const key of Object.keys(node.properties)) fieldNames.add(key);
  }
  for (const value of Object.values(node)) collectProperties(value, seen);
}
collectProperties(schema);

const missing = [...fieldNames]
  .sort()
  .filter((name) => !doc.includes(name));
console.log(
  `[${missing.length === 0 ? 'OK' : 'WARN'}] 文档覆盖 schema 字段名 ${fieldNames.size - missing.length}/${fieldNames.size}`,
);
if (missing.length > 0) console.log(`  文档中未找到：${missing.join(', ')}`);

process.exit(blockFailures === 0 && semanticFailures === 0 ? 0 : 1);
