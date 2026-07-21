#!/usr/bin/env node
/**
 * 구조 지도(`frontend/docs/structure.md`)의 기계 담당 절반.
 *
 * 왜 있나: 지도가 손 갱신이면 반드시 낡는다(2026-07-21 확인 — 12,746자 지도가
 * 이틀 만에 델타 메모로 퇴화). 기계가 만들 수 있는 것(파일 목록·export 심볼)은
 * 기계가 만들고, 사람/AI는 기계가 못 주는 것(용도 한 줄·스텁 여부·경고)만 쓴다.
 *
 * 사용 (cwd = frontend/):
 *   node .claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs
 *       → 현재 소스 인벤토리 출력 (문서에 옮겨 적을 재료)
 *   node .claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs --check
 *       → docs/structure.md ↔ 실제 파일 대조. 어긋나면 exit 1
 *
 * 대조가 잡는 것:
 *   - 파일은 있는데 문서에 행이 없다  → 새 파일 누락
 *   - 문서에 행은 있는데 파일이 없다  → 삭제·이동 미반영(스냅샷의 가장 흔한 실패)
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DOC = path.join(ROOT, 'docs', 'structure.md');
const SCAN_DIRS = ['src', '__mocks__'];

/** 문서에 행을 둘 대상인가 — 소스와 전역 가드는 싣고, 병렬 배치된 단위 테스트는 뺀다. */
function isDocumented(rel) {
  if (!/\.(ts|tsx)$/.test(rel)) return false;
  if (/\.d\.ts$/.test(rel)) return false;
  // 소스 옆에 붙는 *.test.ts(x)는 대상 소스 행이 이미 대표한다.
  // 단 src/__tests__/ 아래 전역 가드는 그 자체가 독립 산출물이라 싣는다.
  if (/\.test\.(ts|tsx)$/.test(rel) && !rel.startsWith('src/__tests__/')) return false;
  return true;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(ROOT, p));
  }
  return out;
}

function actualFiles() {
  return SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .filter(isDocumented)
    .sort();
}

/** `export const x` / `export function x` / `export type X` / `export { a, b }` 를 훑는다. */
function exportsOf(rel) {
  let src;
  try {
    src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return [];
  }
  const found = new Set();
  const named =
    /^export\s+(?:async\s+)?(?:const|let|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm;
  for (const m of src.matchAll(named)) found.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) found.add(name);
    }
  }
  return [...found];
}

/** 문서 본문의 백틱 안에서 리포 상대 경로만 뽑는다. */
function documentedPaths() {
  if (!fs.existsSync(DOC)) return null;
  const doc = fs.readFileSync(DOC, 'utf8');
  const set = new Set();
  for (const m of doc.matchAll(/`([^`\n]+)`/g)) {
    const v = m[1].trim();
    if (/^(src|__mocks__)\/[^\s]+\.(ts|tsx)$/.test(v)) set.add(v);
  }
  return set;
}

function printInventory() {
  const files = actualFiles();
  let dir = null;
  for (const f of files) {
    const d = path.dirname(f);
    if (d !== dir) {
      dir = d;
      console.log(`\n## ${d}/`);
    }
    const ex = exportsOf(f);
    console.log(`- \`${f}\`${ex.length ? `  →  ${ex.join(' · ')}` : '  →  (export 없음)'}`);
  }
  console.log(`\n합계 ${files.length}개 파일`);
}

function check() {
  const documented = documentedPaths();
  if (documented === null) {
    console.error(`FAIL: ${path.relative(ROOT, DOC)} 이(가) 없다.`);
    process.exit(1);
  }
  const actual = actualFiles();
  const missing = actual.filter((f) => !documented.has(f));
  const ghost = [...documented].filter((f) => !fs.existsSync(path.join(ROOT, f))).sort();

  if (missing.length) {
    console.log(`\n누락 — 파일은 있는데 문서에 행이 없다 (${missing.length}):`);
    for (const f of missing) console.log(`  + ${f}`);
  }
  if (ghost.length) {
    console.log(`\n유령 — 문서에 행은 있는데 파일이 없다 (${ghost.length}):`);
    for (const f of ghost) console.log(`  - ${f}`);
  }

  const total = missing.length + ghost.length;
  console.log(
    total === 0
      ? `\nOK — 문서 ${documented.size}행 ↔ 실제 ${actual.length}파일 일치`
      : `\nFAIL — 불일치 ${total}건 (누락 ${missing.length} · 유령 ${ghost.length})`
  );
  process.exit(total === 0 ? 0 : 1);
}

if (process.argv.includes('--check')) check();
else printInventory();
