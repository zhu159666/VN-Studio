#!/usr/bin/env node
// 生成“完整环境”Windows 安装包：先打 dir 包（内置 ffmpeg），再用 NSIS 直接编译 Setup.exe。
//
// 用法：
//   node scripts/build-installer.mjs                 全量：vite build + electron-builder --dir + NSIS
//   node scripts/build-installer.mjs --skip-prepare  复用已有 release/win-unpacked，只重新编译 NSIS
//   node scripts/build-installer.mjs --keep-stage    保留 .installer-stage，便于排错
//
// 产物：
//   editor/release/VN-Studio-Setup-<version>-x64.exe
//   editor/release/INSTALLER-INFO.json（大小 / SHA-256 / 内置 ffmpeg 大小 / 文件数量）
//
// 说明：NSIS 安装器本身不需要“桌面会话”，`/S /D=<目录>` 可静默安装；安装器带卸载程序、
// 开始菜单与桌面快捷方式、HKCU 卸载登记项，默认按当前用户安装到 %LOCALAPPDATA%\Programs。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = path.join(ROOT, 'editor');
const RELEASE = path.join(EDITOR, 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');
const STAGE_DIR = path.join(EDITOR, '.installer-stage');

const argv = process.argv.slice(2);
const skipPrepare = argv.includes('--skip-prepare');
const keepStage = argv.includes('--keep-stage');

const editorPkg = JSON.parse(fs.readFileSync(path.join(EDITOR, 'package.json'), 'utf8'));
const VERSION = editorPkg.version;
const PRODUCT_NAME = editorPkg.build?.productName ?? 'VN Studio';
const APP_EXE = `${PRODUCT_NAME}.exe`;
const APP_ID = editorPkg.build?.appId ?? 'com.vnstudio.desktop';
const PUBLISHER = editorPkg.author ?? 'VN Studio Team';
const OUT_FILE = path.join(RELEASE, `VN-Studio-Setup-${VERSION}-x64.exe`);
const MIN_INSTALLER_BYTES = 40 * 1024 * 1024;
const NSIS_TIMEOUT_MS = 30 * 60 * 1000;

function log(message) {
  console.log(`[installer] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`);
  return execFileSync(command, args, { cwd: EDITOR, stdio: 'inherit', timeout: 900000, ...options });
}

function findMakensis() {
  const candidates = [];
  if (process.env.MAKENSIS) candidates.push(process.env.MAKENSIS);
  const caches = [
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
    path.join(process.env.APPDATA || '', 'electron-builder', 'Cache'),
  ];
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue;
    for (const name of fs.readdirSync(cache)) {
      if (!name.startsWith('nsis')) continue;
      const root = path.join(cache, name);
      const direct = path.join(root, 'makensis.exe');
      const bin = path.join(root, 'Bin', 'makensis.exe');
      if (fs.existsSync(direct)) candidates.push(direct);
      if (fs.existsSync(bin)) candidates.push(bin);
      for (const child of fs.readdirSync(root, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const nested = path.join(root, child.name, 'makensis.exe');
        const nestedBin = path.join(root, child.name, 'Bin', 'makensis.exe');
        if (fs.existsSync(nested)) candidates.push(nested);
        if (fs.existsSync(nestedBin)) candidates.push(nestedBin);
      }
    }
  }
  for (const installed of [
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'NSIS', 'makensis.exe'),
  ]) {
    if (fs.existsSync(installed)) candidates.push(installed);
  }
  try {
    const where = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['makensis'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of where.split(/\r?\n/)) if (line.trim()) candidates.push(line.trim());
  } catch {
    /* ignore */
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** 统计目录内文件数量/总字节/最大文件，用来确认 stage 与 win-unpacked 完整。 */
function treeStats(dir) {
  let files = 0;
  let bytes = 0;
  let largest = { file: '', size: 0 };
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const size = fs.statSync(full).size;
        files += 1;
        bytes += size;
        if (size > largest.size) largest = { file: path.relative(dir, full), size };
      }
    }
  };
  walk(dir);
  return { files, bytes, largest };
}

function assertUnpacked() {
  if (!fs.existsSync(UNPACKED)) fail(`未找到 ${UNPACKED}，请先运行一次完整构建（去掉 --skip-prepare）`);
  if (!fs.existsSync(path.join(UNPACKED, APP_EXE))) fail(`win-unpacked 缺少 ${APP_EXE}`);
  if (!fs.existsSync(path.join(UNPACKED, 'resources', 'bin', 'ffmpeg.exe'))) {
    fail('win-unpacked 未包含 resources/bin/ffmpeg.exe');
  }
  if (!fs.existsSync(path.join(UNPACKED, 'resources', 'app.asar'))) fail('win-unpacked 未包含 resources/app.asar');
}

function prepareAppDir() {
  if (skipPrepare) {
    log('跳过 prepare（--skip-prepare），直接复用 release/win-unpacked');
    assertUnpacked();
    return;
  }
  const viteCli = path.join(EDITOR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteCli)) fail('未安装 vite，请先 pnpm install');
  const commandBusConfig = path.join(EDITOR, 'vite.command-bus.config.mjs');
  const mcpStdioConfig = path.join(EDITOR, 'vite.mcp-stdio.config.mjs');
  run(process.execPath, [viteCli, 'build', '--config', commandBusConfig]);
  run(process.execPath, [viteCli, 'build', '--config', mcpStdioConfig]);
  run(process.execPath, [viteCli, 'build']);
  run(process.execPath, [path.join(ROOT, 'scripts', 'prepare-ffmpeg.mjs')]);
  const builderCli = path.join(EDITOR, 'node_modules', 'electron-builder', 'cli.js');
  if (!fs.existsSync(builderCli)) fail('未安装 electron-builder，请先 pnpm install');
  run(process.execPath, [builderCli, '--dir', '--win'], {
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
      ELECTRON_BUILDER_BINARIES_MIRROR:
        process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
        'https://npmmirror.com/mirrors/electron-builder-binaries/',
    },
  });
  assertUnpacked();
}

function stageApp() {
  log(`复制 ${UNPACKED} → ${STAGE_DIR}`);
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  // NSIS 的 File /r 用绝对路径；stage 同时作为安装包完整性的比对基准。
  fs.cpSync(UNPACKED, STAGE_DIR, { recursive: true });
  const stage = treeStats(STAGE_DIR);
  const source = treeStats(UNPACKED);
  if (stage.files !== source.files || stage.bytes !== source.bytes) {
    fail(`stage 复制不完整：${stage.files}/${stage.bytes} != ${source.files}/${source.bytes}`);
  }
  log(`stage 完整：${stage.files} 个文件，${(stage.bytes / 1024 / 1024).toFixed(1)} MB`);
  return stage;
}

function writeInstallerScript() {
  const source = STAGE_DIR.replace(/\//g, '\\');
  const outFile = OUT_FILE.replace(/\//g, '\\');
  const versionQuad = `${VERSION.replace(/[^0-9.].*$/, '')}.0`.split('.').slice(0, 4);
  while (versionQuad.length < 4) versionQuad.push('0');
  const script = `Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APP_NAME "${PRODUCT_NAME}"
!define APP_EXE "${APP_EXE}"
!define APP_VERSION "${VERSION}"
!define APP_PUBLISHER "${PUBLISHER}"
!define APP_ID "${APP_ID}"
!define UNINST_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VNStudio"
!define UNINST_SW "Software\\VN Studio"

Name "\${APP_NAME}"
OutFile "${outFile}"
InstallDir "$LOCALAPPDATA\\Programs\\VN Studio"
InstallDirRegKey HKCU "\${UNINST_SW}" "InstallDir"
RequestExecutionLevel user
CRCCheck on
; 不用 /SOLID：solid 安装器启动时要把整个数据块解压到临时文件，本包约 400 MB，
; 会额外占用磁盘/内存并拖慢首次安装；非 solid 产物只大 4%，安装更快更稳。
SetCompressor lzma
SetCompressorDictSize 64
VIProductVersion "${versionQuad.join('.')}"
VIAddVersionKey /LANG=2052 "ProductName" "\${APP_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "\${APP_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "\${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "\${APP_VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "\${APP_PUBLISHER}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (c) 2026 VN Studio"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 \${APP_NAME}"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "VN Studio (完整环境)" SEC_APP
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${source}\\*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"

  CreateShortcut "$DESKTOP\\VN Studio.lnk" "$INSTDIR\\\${APP_EXE}" "" "$INSTDIR\\\${APP_EXE}" 0
  CreateDirectory "$SMPROGRAMS\\VN Studio"
  CreateShortcut "$SMPROGRAMS\\VN Studio\\VN Studio.lnk" "$INSTDIR\\\${APP_EXE}" "" "$INSTDIR\\\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\\VN Studio\\卸载 VN Studio.lnk" "$INSTDIR\\Uninstall.exe"

  WriteRegStr HKCU "\${UNINST_SW}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayName" "\${APP_NAME}"
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayVersion" "\${APP_VERSION}"
  WriteRegStr HKCU "\${UNINST_KEY}" "Publisher" "\${APP_PUBLISHER}"
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayIcon" "$INSTDIR\\\${APP_EXE}"
  WriteRegStr HKCU "\${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "\${UNINST_KEY}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteRegStr HKCU "\${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\\Uninstall.exe" /S'
  WriteRegDWORD HKCU "\${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "\${UNINST_KEY}" "NoRepair" 1
  \${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "\${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\\VN Studio.lnk"
  RMDir /r "$SMPROGRAMS\\VN Studio"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "\${UNINST_KEY}"
  DeleteRegKey HKCU "\${UNINST_SW}"
SectionEnd
`;
  // 注意：脚本不能放在 editor/build/，否则 electron-builder 会把它当成自定义 NSIS 脚本
  // 通过 stdin 交给 makensis（BOM 会变成 “Invalid command: ?Unicode”），导致 dist:win 失败。
  const scriptDir = path.join(EDITOR, '.nsis');
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, 'installer.nsi');
  // NSIS 3 需要 UTF-8 BOM 才能识别中文脚本；Unicode true 决定生成 Unicode 安装器。
  fs.writeFileSync(scriptPath, `\uFEFF${script}`, 'utf8');
  return scriptPath;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function compileInstaller(makensis, scriptPath) {
  fs.mkdirSync(RELEASE, { recursive: true });
  fs.rmSync(OUT_FILE, { force: true });
  log(`编译 NSIS 脚本：${scriptPath}`);
  const result = spawnSync(makensis, ['/V3', scriptPath], {
    cwd: EDITOR,
    encoding: 'utf8',
    timeout: NSIS_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`makensis 执行失败：${result.error.message}`);
  if (result.status !== 0) fail(`makensis 退出码 ${result.status}`);
  if (!fs.existsSync(OUT_FILE)) fail('makensis 未生成安装包');

  const stat = fs.statSync(OUT_FILE);
  if (stat.size < MIN_INSTALLER_BYTES) {
    fail(`安装包过小：${stat.size} bytes（预期 >= ${MIN_INSTALLER_BYTES}），可能是编译被中断`);
  }
  const header = fs.readFileSync(OUT_FILE).subarray(0, 2).toString('latin1');
  if (header !== 'MZ') fail('安装包不是有效 PE 文件');
  // makensis 成功结束时会打印 "Total size: <实际字节> / <数据字节> bytes"；
  // 用它和磁盘上的真实大小比对，可发现被中断/截断的产物。
  const total = /Total size:\s+(\d+)\s+\//.exec(result.stdout || '');
  if (!total) fail('makensis 输出中缺少 Total size，无法确认安装包完整');
  if (Number(total[1]) !== stat.size) {
    fail(`安装包大小与 makensis 报告不一致：磁盘 ${stat.size} != 报告 ${total[1]}，产物可能被截断`);
  }
  return stat;
}

/**
 * 如果项目位于“低完整性级别”（Low IL）目录，makensis 写出的 setup.exe 会继承 Low，
 * 用户双击时 NSIS 进程也是 Low，无法写 %TEMP% / 安装目录，表现为
 * “NSIS Error: Error writing temporary file” 或静默失败。这里把产物显式提升为 Medium。
 */
function ensureRunnableIntegrity() {
  const isLow = (acl) => /Low Mandatory Level|低强制级别/i.test(acl);
  const readAcl = () => {
    try {
      return execFileSync('icacls', [OUT_FILE], { encoding: 'utf8', windowsHide: true });
    } catch {
      return '';
    }
  };
  if (!isLow(readAcl())) return;
  try {
    execFileSync('icacls', [OUT_FILE, '/setintegritylevel', 'Medium'], { stdio: 'ignore', windowsHide: true });
  } catch (error) {
    fail(`安装包继承了 Low 完整性级别，且无法提升为 Medium：${error.message}`);
  }
  if (isLow(readAcl())) {
    fail('安装包仍是 Low 完整性级别；请把项目移动到普通目录后再构建');
  }
  log('安装包完整性级别：Low → Medium（否则运行时会报“Error writing temporary file”）');
}

function main() {
  if (process.platform !== 'win32') fail('当前安装脚本仅支持 Windows');
  log(`版本 ${VERSION}，产品名 ${PRODUCT_NAME}`);
  prepareAppDir();
  const makensis = findMakensis();
  if (!makensis) fail('未找到 makensis；请先运行一次 electron-builder 下载 NSIS，或设置 MAKENSIS 环境变量');
  log(`makensis：${makensis}`);
  const stage = stageApp();
  const scriptPath = writeInstallerScript();
  let stat;
  try {
    stat = compileInstaller(makensis, scriptPath);
    ensureRunnableIntegrity();
  } finally {
    if (!keepStage) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  }
  const ffmpegSize = fs.statSync(path.join(UNPACKED, 'resources', 'bin', 'ffmpeg.exe')).size;
  const digest = sha256(OUT_FILE);
  fs.writeFileSync(
    path.join(RELEASE, 'INSTALLER-INFO.json'),
    `${JSON.stringify(
      {
        file: path.basename(OUT_FILE),
        version: VERSION,
        productName: PRODUCT_NAME,
        sizeBytes: stat.size,
        sha256: digest,
        payloadFiles: stage.files,
        payloadBytes: stage.bytes,
        bundledFfmpegBytes: ffmpegSize,
        makensis,
        builtAt: new Date().toISOString(),
        note: '安装器支持 /S 静默安装，可用 /D=<目录> 指定安装位置；需要 Windows 桌面会话才能显示界面。',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  log(`安装包完成：${OUT_FILE}`);
  log(
    `大小：${(stat.size / 1024 / 1024).toFixed(1)} MB（内置 ffmpeg ${(ffmpegSize / 1024 / 1024).toFixed(1)} MB，payload ${stage.files} 个文件）`,
  );
  log(`SHA-256：${digest}`);
}

try {
  main();
} catch (error) {
  if (!keepStage) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  console.error(`[installer] 失败：${error.stack || error.message}`);
  process.exit(1);
}
