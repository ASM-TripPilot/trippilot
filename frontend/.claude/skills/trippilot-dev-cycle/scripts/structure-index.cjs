#!/usr/bin/env node
/**
 * 구조 지도(`frontend/docs/structure.md`)의 기계 담당 절반.
 *
 * 왜 있나: 지도가 손 갱신이면 반드시 낡는다(2026-07-21 확인 — 12,746자 지도가
 * 이틀 만에 델타 메모로 퇴화). 기계가 만들 수 있는 것(파일 목록·export 심볼)은
 * 기계가 만들고, 사람/AI는 기계가 못 주는 것(용도 한 줄·스텁 여부·경고)만 쓴다.
 *
 * 사용 (cwd 무관 — 어디서 실행해도 된다):
 *   node <리포 루트>/frontend/.claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs
 *       → 현재 소스 인벤토리 출력 (문서에 옮겨 적을 재료)
 *   node <같은 경로> --check
 *       → docs/structure.md ↔ 실제 파일 대조. 어긋나면 exit 1
 *
 * 대조가 잡는 것:
 *   - 파일은 있는데 문서에 행이 없다  → 새 파일 누락
 *   - 문서에 행은 있는데 파일이 없다  → 삭제·이동 미반영(이 문서의 가장 흔한 실패)
 *   - 개념 노트의 `설명하는코드`가 없는 파일을 가리킨다 → 볼트 쪽 같은 실패.
 *     [메모리]의 코드→개념 조인이 여기 걸려 있어, 썩으면 조회가 조용히 빈손이 된다.
 *     볼트가 없는 환경에서는 이 검사만 건너뛴다(TRIPPILOT_VAULT로 경로 지정 가능).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// 스크립트 위치에서 역산한다 — cwd에 기대면 안 된다.
// 서브 에이전트의 cwd는 호출마다 다르고(frontend/ · frontend/.claude/ 실측),
// cwd가 어긋나면 "docs/structure.md 이(가) 없다"는 **틀린 진단**이 나온다.
// scripts → trippilot-dev-cycle → skills → .claude → frontend
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DOC = path.join(ROOT, 'docs', 'structure.md');
const SCAN_DIRS = ['src', '__mocks__'];

// 옵시디언 볼트 — 개념 노트의 `설명하는코드` 유령 검사용.
// 없으면 그 검사만 건너뛴다(다른 기기·CI에서 실패시키지 않는다).
const VAULT =
  process.env.TRIPPILOT_VAULT ||
  path.join(
    os.homedir(),
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/TripPilot'
  );

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

/**
 * 개념 노트의 `설명하는코드: ["src/a.ts", ...]`를 (경로 → 개념명[]) 으로 모은다.
 * 볼트가 없으면 null — 호출부가 검사를 건너뛴다.
 */
function conceptCodePaths() {
  const dir = path.join(VAULT, '개념');
  if (!fs.existsSync(dir)) return null;
  const map = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (!fm) continue;
    const decl = /^설명하는코드:\s*(.*)$/m.exec(fm[1]);
    if (!decl) continue;
    for (const m of decl[1].matchAll(/"([^"]+)"/g)) {
      const p = m[1].trim();
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(name.slice(0, -3));
    }
  }
  return map;
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

  // 개념 노트의 `설명하는코드` 유령 — 구조 지도와 같은 실패(삭제·이동 미반영)가
  // 볼트 쪽에서 일어난 것이다. 여기가 썩으면 [메모리]의 코드→개념 조인이 빈손이 된다.
  const concepts = conceptCodePaths();
  let conceptGhost = [];
  if (concepts === null) {
    console.log(`\n(볼트 없음 — 개념 \`설명하는코드\` 검사 건너뜀: ${VAULT})`);
  } else {
    conceptGhost = [...concepts.entries()]
      .filter(([p]) => !fs.existsSync(path.join(ROOT, p)))
      .sort();
    if (conceptGhost.length) {
      console.log(`\n개념 유령 — \`설명하는코드\`가 없는 파일을 가리킨다 (${conceptGhost.length}):`);
      for (const [p, names] of conceptGhost) console.log(`  - ${p}  ←  ${names.join(' · ')}`);
    }
  }

  const total = missing.length + ghost.length + conceptGhost.length;
  console.log(
    total === 0
      ? `\nOK — 문서 ${documented.size}행 ↔ 실제 ${actual.length}파일 일치` +
          (concepts ? ` · 개념 경로 ${concepts.size}개 전부 실존` : '')
      : `\nFAIL — 불일치 ${total}건 (누락 ${missing.length} · 유령 ${ghost.length} · 개념 유령 ${conceptGhost.length})`
  );
  process.exit(total === 0 ? 0 : 1);
}

if (process.argv.includes('--check')) check();
else printInventory();
