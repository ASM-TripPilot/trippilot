#!/usr/bin/env node
/**
 * 운영 iOS 번들 리포트(TRIP-1612) — `pnpm bundle:report`.
 *
 * 하는 일: `expo export`(NODE_ENV=production, --no-bytecode, 소스맵 포함)를 임시 폴더에 돌려
 * JS 바이트·에셋 바이트·상위 20 모듈을 `dist/bundle-report/{report.json,report.md,summary.txt}` 로 쓰고,
 * 원본 소스맵 `sources` 에 금지 경로(`app/_dev`·`src/mocks`·`src/test-support`·`__fixtures__`·`*.test.*`·assistant fake)가 있으면 실패한다.
 * 종료코드: 0 통과 · 1 금지 경로 검출 · 2 도구 오류(export 실패·맵 0/복수·빈 sources·에셋 0개·s-m-e 실패·예기치 못한 예외).
 *
 * 사용: `node scripts/bundle-report.cjs [--project <frontend 디렉토리>]`
 *   --project 로 옛 트리를 재면 expo·metro.config.js 는 그 트리 것을 쓰고, s-m-e 는 이 스크립트 쪽 것을 쓴다
 *   (옛 트리엔 s-m-e 가 없다). 산출물도 그 트리의 dist/ 에 써서 이쪽 결과를 덮지 않는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// 금지 경로 목록 — metro.config.js 운영 blockList 와 짝이다(막는 쪽 / 번들에 섞였는지 확인하는 쪽, TRIP-1616).
// 소스맵 sources 는 프로젝트 루트 기준 '/src/...' 꼴이라 루트 앵커 대신 `/src|app/` 로 시작을 박는다.
// 앵커가 없으면 node_modules 속 `__fixtures__`·`*.test.js` 를 오검출한다(실제 번들에 실리는 정상 파일).
const FORBIDDEN_PATTERNS = [
  /app[\\/]_dev[\\/]/,
  /^[\\/]src[\\/](mocks|test-support)[\\/]/,
  /^[\\/](src|app)[\\/](.*[\\/])?__fixtures__[\\/]/,
  /^[\\/](src|app)[\\/].*\.test\.[jt]sx?$/,
  /assistant-sheet[\\/]api[\\/](fakeAssistantAdapter|assistantSamples)\.ts$/,
];

// s-m-e 가 files 에 섞는 모듈 아닌 항목: [unmapped]·[no source]·[EOLs] … 대괄호로 "통째로" 감싼 키만.
// ([tripId] 가 든 실경로 `/app/trips/[tripId]/…` 는 앞뒤가 있어 걸리지 않는다.)
const FAKE_KEY = /^\[[^\]]+\]$/;

const TOP_N = 20;
const NO_BYTECODE_NOTE = '--no-bytecode 기준이라 출하 hbc 크기와 다름';

// 소스당 1번, 입력 순서 유지.
function findForbiddenSources(sources, patterns = FORBIDDEN_PATTERNS) {
  return sources.filter((s) => patterns.some((p) => p.test(s)));
}

// 빈 sources 를 "0건=통과"로 읽지 않으려고 findForbiddenSources 와 분리했다(INV-4).
function judgeSourceMap(sources, patterns) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return {
      forbiddenPaths: [],
      toolError: '소스맵 sources 가 비었거나 배열이 아니다',
    };
  }
  return {
    forbiddenPaths: findForbiddenSources(sources, patterns),
    toolError: null,
  };
}

// 금지 경로 검출(1)이 도구 오류(2)보다 우선 — 판정은 s-m-e 와 무관하게 끝났다.
function decideExitCode({ forbiddenPaths, toolError }) {
  if (forbiddenPaths.length > 0) return 1;
  return toolError ? 2 : 0;
}

function summarizeSme(sme) {
  const results = sme && sme.results;
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error('s-m-e 결과(results)가 정확히 1개가 아니다');
  }
  const { totalBytes, files } = results[0];
  const entries = Object.entries(files).map(([key, { size }]) => ({
    key,
    bytes: size,
  }));
  const topModules = entries
    .filter((e) => !FAKE_KEY.test(e.key))
    .map((e) => ({ path: e.key, bytes: e.bytes }))
    .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1))
    .slice(0, TOP_N);
  const excluded = entries
    .filter((e) => FAKE_KEY.test(e.key))
    .map((e) => ({ label: e.key, bytes: e.bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  return { totalJsBytes: totalBytes, topModules, excluded };
}

function sumAssetBytes(sizes) {
  return sizes.reduce((sum, n) => sum + n, 0);
}

// 7키 고정 — 커밋·시각·duration 을 넣지 않는다(INV-3, 결과 재현성).
function buildReport({ sme, sources, assetSizes }) {
  const { totalJsBytes, topModules, excluded } = summarizeSme(sme);
  return {
    platform: 'ios',
    bytecode: false,
    totalJsBytes,
    totalAssetBytes: sumAssetBytes(assetSizes),
    topModules,
    excluded,
    forbiddenPaths: findForbiddenSources(sources),
  };
}

// 1MB = 1,000,000B
function formatMB(bytes) {
  return (bytes / 1_000_000).toFixed(2);
}

function renderSummaryLine(report) {
  return `iOS JS ${formatMB(report.totalJsBytes)}MB · assets ${formatMB(report.totalAssetBytes)}MB · 금지 경로 ${report.forbiddenPaths.length}건 (--no-bytecode)`;
}

function renderMarkdown(report) {
  const lines = ['# 번들 리포트 (iOS 운영 export)', ''];
  if (!report.bytecode) lines.push(`> ${NO_BYTECODE_NOTE}`, '');
  lines.push(
    `- JS: ${formatMB(report.totalJsBytes)}MB`,
    `- 에셋: ${formatMB(report.totalAssetBytes)}MB`,
    `- 금지 경로 ${report.forbiddenPaths.length}건`
  );
  report.forbiddenPaths.forEach((p) => lines.push(`  - ${p}`));
  lines.push('', '## 상위 모듈', '', '| # | module | bytes |', '|---|---|---|');
  report.topModules.forEach((m, i) =>
    lines.push(`| ${i + 1} | ${m.path} | ${formatMB(m.bytes)}MB |`)
  );
  lines.push('', '## 모듈이 아닌 항목 (순위 제외)', '');
  report.excluded.forEach((f) =>
    lines.push(`- ${f.label}: ${formatMB(f.bytes)}MB`)
  );
  return `${lines.join('\n')}\n`;
}

// 값 없는 --project 가 조용히 HEAD 로 도는 것을 막으려고 모르는 인자·값 누락은 throw.
function parseArgs(argv) {
  let project = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--project') throw new Error(`모르는 인자: ${argv[i]}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new Error('--project 에 디렉토리 값이 필요하다');
    }
    project = value;
    i += 1;
  }
  return { project };
}

function run(command, args, options) {
  // spawnSync = 자식 프로세스를 띄우고 끝날 때까지 기다린 뒤 {status, error} 를 돌려준다.
  const result = spawnSync(command, args, options);
  if (result.error || result.status !== 0) {
    throw new Error(
      `${path.basename(args[0])} 실패 (exit ${result.status}${result.error ? `, ${result.error.message}` : ''})`
    );
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function main() {
  let projectDir;
  try {
    const { project } = parseArgs(process.argv.slice(2));
    projectDir = path.resolve(project ?? path.join(__dirname, '..'));
    // 없는 경로 밑에 dist 를 만들어 버리지 않게 먼저 거른다.
    if (!fs.existsSync(projectDir)) {
      throw new Error(`--project 디렉토리가 없다: ${projectDir}`);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }

  const outDir = path.join(projectDir, 'dist', 'bundle-report');
  fs.rmSync(outDir, { recursive: true, force: true }); // 실패한 실행이 옛 summary 를 남기지 않게
  fs.mkdirSync(outDir, { recursive: true });
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-export-'));

  let forbiddenPaths = [];
  let toolError = null;
  try {
    run(
      process.execPath,
      [
        path.join(projectDir, 'node_modules', 'expo', 'bin', 'cli'),
        'export',
        '--platform',
        'ios',
        '--no-bytecode',
        '--source-maps',
        '--output-dir',
        exportDir,
      ],
      {
        cwd: projectDir,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' },
      }
    );

    const jsDir = path.join(exportDir, '_expo', 'static', 'js', 'ios');
    const maps = fs.existsSync(jsDir)
      ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js.map'))
      : [];
    if (maps.length !== 1) {
      throw new Error(`소스맵이 정확히 1개여야 하는데 ${maps.length}개`);
    }
    const mapFile = path.join(jsDir, maps[0]);
    const jsFile = mapFile.slice(0, -'.map'.length);

    const sources = JSON.parse(fs.readFileSync(mapFile, 'utf8')).sources;
    const verdict = judgeSourceMap(sources);
    forbiddenPaths = verdict.forbiddenPaths;
    if (verdict.toolError) throw new Error(verdict.toolError);

    const smeJson = path.join(exportDir, 'sme.json');
    run(
      process.execPath,
      [
        require.resolve('source-map-explorer/bin/cli.js'),
        jsFile,
        mapFile,
        '--json',
        smeJson,
        '--no-border-checks', // Metro 맵의 특정 구간 때문에 없으면 exit 1
      ],
      { stdio: 'inherit' }
    );

    // 에셋 0개를 0MB 로 통과시키지 않는다(INV-4) — 이 앱은 폰트·이미지가 있다.
    const assetFiles = listFiles(path.join(exportDir, 'assets'));
    if (assetFiles.length === 0) {
      throw new Error('export 결과에 assets 파일이 하나도 없다');
    }

    const report = buildReport({
      sme: JSON.parse(fs.readFileSync(smeJson, 'utf8')),
      sources,
      assetSizes: assetFiles.map((f) => fs.statSync(f).size),
    });
    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`
    );
    fs.writeFileSync(path.join(outDir, 'report.md'), renderMarkdown(report));
    fs.writeFileSync(
      path.join(outDir, 'summary.txt'),
      `${renderSummaryLine(report)}\n`
    );
    process.stdout.write(`${renderSummaryLine(report)}\n`);
  } catch (e) {
    toolError = e.message;
  } finally {
    fs.rmSync(exportDir, { recursive: true, force: true });
  }

  forbiddenPaths.forEach((p) => process.stderr.write(`금지 경로 검출: ${p}\n`));
  if (toolError) process.stderr.write(`도구 오류: ${toolError}\n`);
  process.exit(decideExitCode({ forbiddenPaths, toolError }));
}

module.exports = {
  FORBIDDEN_PATTERNS,
  findForbiddenSources,
  judgeSourceMap,
  decideExitCode,
  summarizeSme,
  sumAssetBytes,
  buildReport,
  formatMB,
  renderSummaryLine,
  renderMarkdown,
  parseArgs,
  main,
};

// main 안에서 예기치 못하게 던진 예외(fs 쓰기 실패 등)가 node 기본 exit 1("금지 경로 검출")로 새지 않게 한다.
if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`도구 오류: ${e.message}\n`);
    process.exit(2);
  }
}
