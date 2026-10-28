/**
 * 테스트 로그 소음 예산(TRIP-1624) — 순수 판정 함수 + 버킷별 예산 표.
 *
 * jest 가 파일마다 모아 둔 `testResult.console`(항목 = `{ message, origin, type }`)을 5범주로 가르고,
 * 버킷(node·integration)별 허용치와 견줘 초과를 알린다. jest 에 붙이는 어댑터는 `noise-reporter.cjs`.
 * 계약 테스트: `scripts/noiseBudget.test.ts`.
 */
const path = require('path');

const CATEGORIES = [
  'layout-children',
  'msw-unhandled',
  'reanimated',
  'act',
  'other',
];

// 규칙: 위에서부터 첫 일치. 메시지 맨 앞(앞쪽 공백 제거 후)에서만 일치 — 문장 중간 키워드는 other.
// Reanimated 는 알려진 환경 소음 하나만 reanimated 로 세고, 다른 [Reanimated] 경고는 other 로 가 새 종류가 바로 걸린다.
const RULES = [
  ['layout-children', [/^\[Layout children\]:/]],
  [
    'msw-unhandled',
    [
      /^\[MSW\] (Error|Warning): intercepted a request without a matching request handler/,
    ],
  ],
  [
    'reanimated',
    [/^\[Reanimated\] animatedRef is not initialized in useScrollOffset/],
  ],
  [
    'act',
    [
      /^An update to .+ inside a test was not wrapped in act\(\.\.\.\)/,
      /^The current testing environment is not configured to support act\(\.\.\.\)/,
    ],
  ],
];

const TOP_FILES = 5;

// 예산 = 이 버킷에서 허용하는 error·warn 건수. 소음을 줄였으면 같은 PR 에서 여기 숫자를 실측으로 내린다.
// noiseBudget.test.ts 가 못박는 것은 두 가지뿐이다: ① layout-children(·node 의 msw-unhandled)은 0, ② 나머지는 "고치기 전(before) 값 이하".
// 그 사이(after ~ before) 값으로 올리는 것은 테스트가 막지 않는다 — 막는 것은 리뷰(숫자 diff)다.
// 기준(TRIP-1624): before = develop CI run 40645712423, after = 로컬 전체 버킷 실측 2회 이상(03_implementer_notes.md 표).
const BUDGETS = {
  node: {
    // 결정적 범주: 가짜 라우트 표가 채워져 0 이어야 한다.
    'layout-children': 0,
    // node 버킷은 MSW 서버를 쓰지 않는다.
    'msw-unhandled': 0,
    // jest 환경 산물(EditorView 의 animatedRef 경고) — 숨기지 않고 정확값 고정. 새 사용처가 늘면 red.
    reanimated: 59,
    // 남은 act 는 타이머가 늦게 도착하는 비결정 갈래(assistantQueries·useVisitMemo·HomePage 등 TanStack notifyManager) —
    // 천장이다. 로컬 실측 17·21 / CI before 194 − 고친 결정적 174(동작 줄이기 답 144 + zustand reset 30) = 20 → max(21, 20) × 1.25 올림.
    act: 27,
    // GeneratingPage.hookMock.test 의 findNodeHandle StrictMode 경고 1건.
    other: 1,
  },
  integration: {
    'layout-children': 0,
    // 남은 24건: DraftPage 12 · ItineraryMethodPage 11 · TripRecordsPage 1 — 정리 순서와 다른 원인이라 이 칸에서 못 고쳤다(새 티켓).
    'msw-unhandled': 24,
    reanimated: 174,
    // 로컬 실측 72·72 인데 CI before 는 230(TripRecordsPage·VirtualizedList 늦은 타이머가 CI 에서 훨씬 많다).
    // CI before 230 − 고친 결정적 48 = 182 → max(72, 182) × 1.25 올림. CI 에서 몇 회 관찰한 뒤 내린다.
    // 주의: 이 값은 "CI before 의 비결정을 흡수"하려는 천장이라 로컬 after(66~115)보다 약 100 높다.
    // 그 여유 안에서는 이 칸이 고친 통합 act(zustand reset·카운트업 리스너)가 되살아나도 예산이 red 가 되지 않는다.
    // 후속: CI 관찰 뒤 내린다.
    act: 228,
    // DraftPage.integration 의 렌더 중 setState 1건(앱 코드 가능성 — 새 티켓 후보, 가리지 않음).
    other: 1,
  },
};

function classify(entry) {
  if (!entry || (entry.type !== 'error' && entry.type !== 'warn')) return null;
  const message = typeof entry.message === 'string' ? entry.message : '';
  const head = message.replace(/^\s+/, '');
  for (const [category, patterns] of RULES) {
    if (patterns.some((p) => p.test(head))) return category;
  }
  return 'other';
}

function emptyCounts() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
}

function aggregate(files) {
  const totals = emptyCounts();
  const perFile = Object.fromEntries(CATEGORIES.map((c) => [c, new Map()]));
  for (const { file, console: entries } of files) {
    if (!entries || entries.length === 0) continue;
    for (const entry of entries) {
      const category = classify(entry);
      if (!category) continue;
      totals[category] += 1;
      perFile[category].set(file, (perFile[category].get(file) ?? 0) + 1);
    }
  }
  const sorted = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      [...perFile[c]]
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => b.count - a.count || (a.file < b.file ? -1 : 1)),
    ])
  );
  return { totals, files: sorted };
}

function judgeBudget(totals, budget) {
  const over = [];
  for (const category of CATEGORIES) {
    const allowed = budget[category];
    if (!Number.isInteger(allowed)) {
      throw new Error(`소음 예산에 범주 "${category}" 허용치가 없다`);
    }
    if (totals[category] > allowed) {
      over.push({ category, allowed, actual: totals[category] });
    }
  }
  return { ok: over.length === 0, over };
}

function renderReport({ bucket, budget, totals, files, rootDir }) {
  const { ok, over } = judgeBudget(totals, budget);
  const overSet = new Set(over.map((o) => o.category));
  const lines = [`[소음 예산:${bucket}] ${ok ? '통과' : '초과'}`];
  for (const c of CATEGORIES) {
    lines.push(
      `  ${c}: ${totals[c]} / ${budget[c]}${overSet.has(c) ? ' ← 초과' : ''}`
    );
  }
  for (const c of CATEGORIES) {
    if (!overSet.has(c)) continue;
    lines.push(`  ${c} 상위 파일 (최대 ${TOP_FILES}):`);
    for (const { file, count } of files[c].slice(0, TOP_FILES)) {
      const rel = path.relative(rootDir, file);
      lines.push(`    ${count}  ${rel.startsWith('..') ? file : rel}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// 단일 파일 실행은 jest 가 verbose 로 바꾸고, verbose·silent 에서는 console 이 버퍼링되지 않아 reporter 가 소음을 못 본다.
function describeBlindRun({ silent, verbose }) {
  if (silent) return '--silent 실행이라 console 이 기록되지 않는다';
  if (verbose) {
    return '단일 파일 실행(verbose)이라 console 이 기록되지 않는다 — 전체 버킷으로 돌려야 판정한다';
  }
  return null;
}

module.exports = {
  CATEGORIES,
  BUDGETS,
  TOP_FILES,
  classify,
  aggregate,
  judgeBudget,
  renderReport,
  describeBlindRun,
};
