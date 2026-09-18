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
 *       → 현재 소스 인벤토리 출력 (stdout)
 *   node <같은 경로> --write
 *       → docs/structure.generated.md 에 인벤토리를 생성/덮어쓴다 (기계 담당 절반).
 *         이 파일은 손으로 고치지 않는다 — 새 파일·삭제가 여기 자동 반영된다.
 *   node <같은 경로> --check
 *       → docs/structure.md + layer-*.md + structure.generated.md ↔ 실제 파일 대조. 어긋나면 exit 1
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
// 기계 담당 절반 — `--write`가 생성하는 인벤토리. 손으로 고치지 않는다(다음 --write가 덮는다).
const GEN_DOC = path.join(ROOT, 'docs', 'structure.generated.md');
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

/** 문서 본문의 백틱 안에서 리포 상대 경로만 뽑는다.
 *  층별 파일 표는 `.claude/rules/layer-*.md`(path-scoped)로 이관됐으므로 거기까지 읽는다. */
function documentedPaths() {
  const sources = [];
  if (fs.existsSync(DOC)) sources.push(fs.readFileSync(DOC, 'utf8'));
  // 기계 담당 절반 — 파일 목록·export는 여기서 자동 충당된다(손 갱신 대상 아님).
  if (fs.existsSync(GEN_DOC)) sources.push(fs.readFileSync(GEN_DOC, 'utf8'));
  const rulesDir = path.join(ROOT, '.claude', 'rules');
  if (fs.existsSync(rulesDir)) {
    for (const name of fs.readdirSync(rulesDir)) {
      if (name.startsWith('layer-') && name.endsWith('.md'))
        sources.push(fs.readFileSync(path.join(rulesDir, name), 'utf8'));
    }
  }
  if (!sources.length) return null;
  const set = new Set();
  for (const doc of sources)
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

/** 파일 목록 + export 를 마크다운 문자열로 조립한다(--write·기본 출력 공용). */
function buildInventory(files) {
  const lines = [];
  let dir = null;
  for (const f of files) {
    const d = path.dirname(f);
    if (d !== dir) {
      dir = d;
      lines.push(`\n## ${d}/`);
    }
    const ex = exportsOf(f);
    lines.push(`- \`${f}\`${ex.length ? `  →  ${ex.join(' · ')}` : '  →  (export 없음)'}`);
  }
  lines.push(`\n합계 ${files.length}개 파일`);
  return lines.join('\n');
}

function printInventory() {
  console.log(buildInventory(actualFiles()));
}

/** 인벤토리를 docs/structure.generated.md 에 생성/덮어쓴다 — 기계 담당 절반. */
function writeInventory() {
  const files = actualFiles();
  const header =
    '<!-- 자동 생성 — structure-index.cjs --write 가 만든다. 손으로 고치지 마라(다음 --write가 덮는다).\n' +
    '     기계 담당 절반: 파일 목록·export 심볼. 용도·경고·재사용 근거 같은 사람 담당은 structure.md 에. -->\n' +
    '# 구조 인벤토리 (자동 생성)\n';
  fs.writeFileSync(GEN_DOC, header + buildInventory(files) + '\n');
  console.log(`WROTE ${path.relative(ROOT, GEN_DOC)} — ${files.length}개 파일`);
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
    console.log(`  → 기계 담당 파일이면 \`--write\`로 인벤토리를 재생성한다(손으로 적지 마라).`);
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

// ── --stale: 만진 폴더의 path-scoped 문서에서 낡은 심볼 참조를 찾는다 ──────────
// 사이클 끝 [기록]에서 **바뀐 경로만** 넘겨 돌린다: 그 경로에 매칭되는 layer-*.md·traps-*.md
// 안의 컴포넌트·훅류 백틱 심볼이 코드에 더 이상 없으면(리네임·삭제) 경고한다.
// `--check`(파일 경로 유령)가 못 잡는 **심볼 리네임**이 사정거리다(예: SlotCandidateSheetContainer).

/** 최소 glob→정규식 (`**`=경로 넘어 아무거나, `*`=슬래시 빼고). */
function globToRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*');
  return new RegExp('^' + re + '$');
}

/** 규칙 문서 frontmatter의 `paths:` 목록. */
function docFrontmatterPaths(file) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
  if (!fm) return [];
  return [...fm[1].matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** 코드 전체(테스트 포함)를 한 덩어리로 — 심볼 존재 여부 코퍼스. */
function allSrcText() {
  return SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => {
      try {
        return fs.readFileSync(path.join(ROOT, f), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

/** 백틱 심볼 중 "코드에 있어야 마땅한" 고신호만 — 컴포넌트·훅류. testID(케밥)·클래스·한글은 자연 제외. */
function isCodeSymbol(t) {
  return /^(use[A-Z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*(Container|Screen|Page|Sheet|Panel|Glyph|Provider|View|Store|Card|Bar|Gate|Form|Modal))$/.test(
    t
  );
}

function stale() {
  const i = process.argv.indexOf('--stale');
  const changed = process.argv.slice(i + 1).filter((a) => !a.startsWith('--'));
  const rulesDir = path.join(ROOT, '.claude', 'rules');
  if (!fs.existsSync(rulesDir)) {
    console.log('규칙 디렉토리 없음 — 건너뜀');
    return;
  }
  const docs = fs
    .readdirSync(rulesDir)
    .filter((n) => /^(layer|traps)-.*\.md$/.test(n));
  // 바뀐 경로에 매칭되는 문서만(경로 미지정이면 전체 — 정례 대조용).
  const targets = changed.length
    ? docs.filter((d) => {
        const globs = docFrontmatterPaths(path.join(rulesDir, d)).map(globToRe);
        return changed.some((c) => globs.some((re) => re.test(c)));
      })
    : docs;
  if (!targets.length) {
    console.log(
      changed.length
        ? '만진 경로에 매칭되는 path-scoped 문서 없음 — 낡은 심볼 검사 대상 없음'
        : '검사할 문서 없음'
    );
    return;
  }
  const src = allSrcText();
  let hits = 0;
  for (const d of targets) {
    const text = fs.readFileSync(path.join(rulesDir, d), 'utf8');
    const seen = new Set();
    const dead = [];
    for (const m of text.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) {
      const t = m[1];
      if (seen.has(t) || !isCodeSymbol(t)) continue;
      seen.add(t);
      // 단어 경계로 코드에 존재하는지 — 부분일치 오탐 방지.
      if (!new RegExp(`\\b${t}\\b`).test(src)) dead.push(t);
    }
    if (dead.length) {
      hits += dead.length;
      console.log(`\n${d} — 코드에 없는 심볼 참조 (${dead.length}):`);
      for (const t of dead) console.log(`  - ${t}`);
    }
  }
  console.log(
    hits === 0
      ? `\nOK — 만진 폴더 문서 ${targets.length}개, 낡은 심볼 참조 0`
      : `\n낡음 ${hits}건 (리네임·삭제된 심볼을 문서가 아직 가리킴 — 고치거나 제거하라)`
  );
  // 경고만 — 오탐 여지가 있어 exit 1로 막지 않는다(scribe가 판단).
}

if (process.argv.includes('--write')) writeInventory();
else if (process.argv.includes('--check')) check();
else if (process.argv.includes('--stale')) stale();
else printInventory();
