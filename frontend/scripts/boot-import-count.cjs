#!/usr/bin/env node
/**
 * 부팅 경로 정적 import 계수(TRIP-1716) — `node scripts/boot-import-count.cjs [--list] [--why <파일>]`.
 *
 * 무엇을 세나: 앱이 첫 화면(홈)을 그리기 전에 평가하는 프로젝트 모듈(src·app 안 파일) 수.
 *   진입점 = index.ts + app/ 의 모든 _layout(운영 expo-router 는 라우트 트리를 만들 때 레이아웃을 전부 즉시
 *   평가한다 — getRoutesCore 가 unstable_settings 를 읽으려고 loadRoute()) + 첫 화면 app/(tabs)/index.tsx.
 *   화면 파일은 그릴 때 평가되므로(getComponent) 첫 화면 말고는 넣지 않는다.
 * 런타임 import 만 센다: 각 파일을 TypeScript 로 트랜스파일해 타입으로만 쓰인 import 가 지워진 결과에서
 *   import·export-from·최상위 require 를 따라간다. 함수 안 require·동적 import() 는 지연이라 제외,
 *   `__DEV__ ? require(..)` 는 운영에서 접히므로 제외(`if (__DEV__ && …)`·괄호식도 같다). 패키지(node_modules)는 따라가지 않고 이름만 센다.
 * 한계: 정적 그래프다 — 실제 평가 순서·시간(ms)이 아니다. 실기 모듈 수는 Release 번들에서만 의미가 있다.
 *   위치 자동화 플래그 OFF 빌드 기준이다 — index.ts 가 바로 부르는 registerBackgroundTasks() 의 함수 안 require 는
 *   세지 않으므로, 플래그 ON 빌드(production-automation)는 실제로 더 많이 읽는다(TRIP-1716 실측 +15).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const FIRST_SCREEN = 'app/(tabs)/index.tsx';
// iOS 운영 번들의 해석 순서(metro platform → native → 기본).
const EXTS = [
  '.ios.tsx',
  '.ios.ts',
  '.native.tsx',
  '.native.ts',
  '.tsx',
  '.ts',
  '.js',
  '.cjs',
  '.jsx',
];
const ALIASES = [
  ['@/', 'src/'],
  ['@routes/', 'app/'],
];

function listLayouts(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '_dev') continue; // 운영 blockList(metro.config.js)가 막는 개발 전용 라우트
      out.push(...listLayouts(rel));
    } else if (/^_layout\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

function tryFile(abs) {
  for (const ext of EXTS) if (fs.existsSync(abs + ext)) return abs + ext;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  for (const ext of EXTS) {
    const idx = path.join(abs, 'index' + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

// 프로젝트 파일이면 절대 경로, 패키지면 { pkg }, 코드가 아니면(css·이미지) null.
function resolve(spec, fromFile) {
  let base = null;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  for (const [a, to] of ALIASES)
    if (spec.startsWith(a)) base = path.join(ROOT, to, spec.slice(a.length));
  if (base === null) {
    const parts = spec.split('/');
    return {
      pkg: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0],
    };
  }
  if (/\.(css|png|jpe?g|webp|gif|svg|json|ttf|otf)$/.test(base)) return null;
  const hit = tryFile(base);
  if (!hit)
    throw new Error(`해석 실패: '${spec}' (${path.relative(ROOT, fromFile)})`);
  return hit;
}

// 운영에서 거짓으로 접히는 조건: `__DEV__` 자신, 괄호식, 어느 한쪽이 그런 `&&`(`||`·`!` 은 운영에서도 참일 수 있다).
function isDevGuard(node) {
  if (ts.isParenthesizedExpression(node)) return isDevGuard(node.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return isDevGuard(node.left) || isDevGuard(node.right);
  return ts.isIdentifier(node) && node.text === '__DEV__';
}

// 트랜스파일 결과(타입 전용 import 제거됨)에서 런타임 의존 지정자를 뽑는다. src 를 주면 파일을 읽지 않는다(테스트용).
// dev 가 참이면 `__DEV__` 분기를 접지 않는다 — 개발 빌드·프리뷰·jest(`__DEV__ = true`)가 실제로 평가하는 그래프(TRIP-1770 index.view 가드).
function runtimeSpecifiers(
  file,
  src = fs.readFileSync(file, 'utf8'),
  dev = false
) {
  const out = ts.transpileModule(src, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  }).outputText;
  const sf = ts.createSourceFile(
    file + '.out.jsx',
    out,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JSX
  );
  const specs = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      specs.push(node.moduleSpecifier.text);
      return;
    }
    if (ts.isFunctionLike(node)) return; // 함수 안 require 는 지연 로드
    if (!dev && ts.isConditionalExpression(node) && isDevGuard(node.condition))
      return visit(node.whenFalse);
    if (!dev && ts.isIfStatement(node) && isDevGuard(node.expression))
      return node.elseStatement && visit(node.elseStatement);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

function walk(entries, { dev = false } = {}) {
  const seen = new Map(); // 파일 → 처음 끌어온 파일
  const pkgs = new Set();
  const queue = entries.map((e) => [path.join(ROOT, e), null]);
  while (queue.length) {
    const [file, from] = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, from);
    for (const spec of runtimeSpecifiers(file, undefined, dev)) {
      const r = resolve(spec, file);
      if (r === null) continue;
      if (typeof r === 'object') pkgs.add(r.pkg);
      else if (!seen.has(r)) queue.push([r, file]);
    }
  }
  return { seen, pkgs };
}

function main() {
  const args = process.argv.slice(2);
  const entries = ['index.ts', ...listLayouts('app'), FIRST_SCREEN];
  const { seen, pkgs } = walk(entries);
  const rel = (f) => path.relative(ROOT, f);
  console.log(
    `부팅 경로 프로젝트 모듈 ${seen.size}개 · 패키지 ${pkgs.size}종 (진입점 ${entries.length}: index.ts + _layout ${entries.length - 2} + ${FIRST_SCREEN})`
  );
  if (args.includes('--list'))
    for (const f of [...seen.keys()].map(rel).sort()) console.log(f);
  const why = args[args.indexOf('--why') + 1];
  if (args.includes('--why') && why) {
    let cur = path.join(ROOT, why);
    if (!seen.has(cur)) return console.log(`${why}: 부팅 경로에 없다`);
    const chain = [];
    while (cur) {
      chain.push(rel(cur));
      cur = seen.get(cur);
    }
    console.log(chain.reverse().join('\n  → '));
  }
}

if (require.main === module) main();
module.exports = { walk, runtimeSpecifiers };
