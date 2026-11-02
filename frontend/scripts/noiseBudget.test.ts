/**
 * @jest-environment node
 */

/**
 * TRIP-1624 · 테스트 로그 소음 예산 — 판정 모듈(`scripts/noise-budget.cjs`)과 jest reporter 어댑터(`scripts/noise-reporter.cjs`)의 계약.
 *
 * 무엇을 보장하나: ① jest 가 모아 둔 console 항목(`testResult.console` 의 `{ message, type }`)을 5범주로 가르는 규칙(실제 CI 로그의
 * 메시지 문자열로 검증 · error/warn 만 센다 · 메시지 첫머리에서만 일치) ② 파일별 집계와 상위 파일 정렬 ③ 예산 경계(같으면 통과·하나 넘으면 초과)
 * ④ 리포트 문구(초과 범주·허용치·실제·상위 5파일) ⑤ reporter 가 여러 파일을 합산해 초과 때만 `getLastError()` 로 실패시키고,
 * 단일 파일·`--silent` 실행에서는 판정을 생략한다는 것 ⑥ 예산 표가 "느슨해지지 않는다"(결정적 범주 0 · 나머지는 before 이하) ⑦ 두 jest 설정이 버킷
 * 이름을 맞게 reporter 에 넘긴다.
 * 보장하지 않는 것: 실제 jest 실행에서 종료코드가 1 이 되는지 · 실제 로그가 이 규칙에 들어맞는지의 최종 확인 — 뮤테이션 M1~M3·M5·M6(02a §6)이 심판이다.
 *
 * 테스트가 `.ts` 인 이유: jest testMatch 가 `.cjs` 를 줍지 않아서다(bundleReport.test.ts 와 같다). 스크립트는 `jest.requireActual` 로 읽는다.
 * 3동작 뼈대: 준비=입력 픽스처 → 실행=함수 호출 → 단언=반환값.
 */
import fc from 'fast-check';
import fs from 'fs';
import path from 'path';

type Category =
  'layout-children' | 'msw-unhandled' | 'reanimated' | 'act' | 'other';
type Entry = { type: string; message: unknown };
type Counts = Record<Category, number>;
type FileCount = { file: string; count: number };
type FileResult = { file: string; console?: Entry[] | null };
type Aggregated = { totals: Counts; files: Record<Category, FileCount[]> };
type Verdict = {
  ok: boolean;
  over: { category: Category; allowed: number; actual: number }[];
};
type Lib = {
  CATEGORIES: Category[];
  BUDGETS: Record<'node' | 'integration', Counts>;
  TOP_FILES: number;
  classify: (entry: Entry) => Category | null;
  aggregate: (files: FileResult[]) => Aggregated;
  judgeBudget: (totals: Counts, budget: Counts) => Verdict;
  renderReport: (input: {
    bucket: string;
    budget: Counts;
    totals: Counts;
    files: Record<Category, FileCount[]>;
    rootDir: string;
  }) => string;
  describeBlindRun: (globalConfig: {
    silent?: boolean;
    verbose?: boolean;
  }) => string | null;
};
type GlobalConfig = { rootDir: string; silent?: boolean; verbose?: boolean };
type ReporterInstance = {
  onTestResult: (
    test: unknown,
    testResult: { testFilePath: string; console?: Entry[] | null }
  ) => void;
  onRunComplete: (contexts: unknown, results: unknown) => void;
  getLastError: () => Error | undefined;
};
type ReporterCtor = new (
  globalConfig: GlobalConfig,
  options?: { bucket?: string }
) => ReporterInstance;

const lib = jest.requireActual<Lib>('./noise-budget.cjs');
const Reporter = jest.requireActual<ReporterCtor>('./noise-reporter.cjs');

// 아래 메시지는 develop CI run 40645712423 의 `Run pnpm test` 로그에 실제로 찍힌 것(첫 줄 + 이어지는 줄 일부)이다.
// `testResult.console[i].message` 는 jest 가 들여쓰기를 붙이기 전의 원문이라 첫 글자부터 시작한다(로컬 덤프로 확인 — 02a §5).
const LAYOUT_MISSING = `[Layout children]: No route named "stays/index" exists in nested children: [\n  '+not-found',\n  'force-update',\n  'reconsent'\n]`;
const LAYOUT_EXTRANEOUS =
  '[Layout children]: Too many screens defined. Route "itinerary" is extraneous.';
const MSW_ERROR =
  '[MSW] Error: intercepted a request without a matching request handler:\n\n  • GET http://localhost:8080/api/v1/me/location-consent\n\nIf you still wish to intercept this unhandled request, please create a request handler for it.';
const MSW_WARNING =
  '[MSW] Warning: intercepted a request without a matching request handler:\n\n  • GET http://localhost:8080/api/v1/me/settings';
const REANIMATED_REF =
  '[Reanimated] animatedRef is not initialized in useScrollOffset. Make sure to pass the animated ref to the scrollable component to get scroll offset updates.';
const ACT_UPDATE =
  'An update to CountUpText inside a test was not wrapped in act(...).\n\nWhen testing, code that causes React state updates should be wrapped into act(...):\n\nact(() => {\n  /* fire events that update state */\n});';
const ACT_ENV =
  'The current testing environment is not configured to support act(...)\n\n  at isConcurrentActEnvironment (node_modules/react-test-renderer.development.js:10243:17)';
const STRICT_MODE =
  'findNodeHandle is deprecated in StrictMode. findNodeHandle was passed an instance of View which is inside StrictMode.';
const SET_STATE_IN_RENDER =
  'Cannot update a component (`DraftPage`) while rendering a different component (`DraftPage`). To locate the bad setState() call inside `DraftPage`, follow the stack trace.';

const warn = (message: string): Entry => ({ type: 'warn', message });
const error = (message: string): Entry => ({ type: 'error', message });
const zero = (): Counts => ({
  'layout-children': 0,
  'msw-unhandled': 0,
  reanimated: 0,
  act: 0,
  other: 0,
});
const counts = (patch: Partial<Counts>): Counts => ({ ...zero(), ...patch });
const emptyFiles = (): Record<Category, FileCount[]> => ({
  'layout-children': [],
  'msw-unhandled': [],
  reanimated: [],
  act: [],
  other: [],
});

describe('classify (AC3 범주 분류 — 실제 CI 로그 메시지)', () => {
  it.each([
    ['Layout — 없는 라우트 이름', 'layout-children', warn(LAYOUT_MISSING)],
    ['Layout — 선언이 표보다 많음', 'layout-children', warn(LAYOUT_EXTRANEOUS)],
    ['MSW — 미처리 요청(error 모드)', 'msw-unhandled', error(MSW_ERROR)],
    ['MSW — 미처리 요청(warn 모드)', 'msw-unhandled', warn(MSW_WARNING)],
    ['Reanimated — animatedRef 미초기화', 'reanimated', warn(REANIMATED_REF)],
    ['act — 감싸지 않은 업데이트', 'act', error(ACT_UPDATE)],
    ['act — 환경 미설정', 'act', error(ACT_ENV)],
    ['기타 — findNodeHandle StrictMode', 'other', error(STRICT_MODE)],
    ['기타 — 렌더 중 setState', 'other', error(SET_STATE_IN_RENDER)],
    ['기타 — 처음 보는 console.error', 'other', error('boom')],
    ['기타 — 처음 보는 console.warn', 'other', warn('deprecated thing')],
  ])('%s → %s', (_name, expected, entry) => {
    expect(lib.classify(entry as Entry)).toBe(expected);
  });

  it('error·warn 이 아닌 type(log·info·debug)은 세지 않는다 — null', () => {
    ['log', 'info', 'debug'].forEach((type) => {
      expect(lib.classify({ type, message: LAYOUT_MISSING })).toBeNull();
      expect(lib.classify({ type, message: 'boom' })).toBeNull();
    });
  });

  it('메시지 첫머리에서만 일치한다 — 문장 중간에 키워드가 있으면 other', () => {
    expect(lib.classify(error(`see ${LAYOUT_EXTRANEOUS}`))).toBe('other');
    expect(lib.classify(error(`wrapped: ${ACT_UPDATE}`))).toBe('other');
    expect(lib.classify(error(`caused by ${MSW_ERROR}`))).toBe('other');
  });

  it('앞쪽 공백·개행은 무시하고 분류한다', () => {
    expect(lib.classify(error(`\n  ${ACT_UPDATE}`))).toBe('act');
  });

  it('Reanimated 는 알려진 환경 소음(animatedRef) 하나만 reanimated — 다른 [Reanimated] 경고는 other 라 새 종류가 예산 0 에 걸린다', () => {
    expect(
      lib.classify(
        warn(
          '[Reanimated] Reading from `value` during component render. Please ensure that you do not access the `value` property.'
        )
      )
    ).toBe('other');
  });

  it('MSW 의 다른 경고(미처리 요청이 아닌 것)는 other', () => {
    expect(
      lib.classify(warn('[MSW] Warning: captured a request without a handler'))
    ).toBe('other');
  });

  it('message 가 문자열이 아니어도(undefined) throw 하지 않고 error 면 other', () => {
    expect(lib.classify({ type: 'error', message: undefined })).toBe('other');
  });
});

describe('aggregate (파일별 집계 · 상위 정렬)', () => {
  const A = '/repo/frontend/src/a.integration.test.tsx';
  const B = '/repo/frontend/src/b.integration.test.tsx';
  const C = '/repo/frontend/src/c.test.tsx';

  it('범주별 합계를 모든 범주 키(0 포함)로 돌려준다', () => {
    const { totals } = lib.aggregate([
      {
        file: A,
        console: [
          warn(LAYOUT_MISSING),
          warn(LAYOUT_EXTRANEOUS),
          error(MSW_ERROR),
          warn(REANIMATED_REF),
        ],
      },
      { file: B, console: [error(ACT_UPDATE), error('boom')] },
    ]);
    expect(totals).toEqual(
      counts({
        'layout-children': 2,
        'msw-unhandled': 1,
        reanimated: 1,
        act: 1,
        other: 1,
      })
    );
  });

  it('Reanimated 는 집계에서 빠지지 않는다(숨기지 않는다) — 건수 그대로 센다', () => {
    const { totals } = lib.aggregate([
      {
        file: A,
        console: Array.from({ length: 7 }, () => warn(REANIMATED_REF)),
      },
    ]);
    expect(totals.reanimated).toBe(7);
  });

  it('범주별 파일 목록은 건수 내림차순, 같으면 경로 오름차순', () => {
    const { files } = lib.aggregate([
      { file: B, console: [warn(LAYOUT_MISSING)] },
      { file: A, console: [warn(LAYOUT_MISSING)] },
      {
        file: C,
        console: [
          warn(LAYOUT_MISSING),
          warn(LAYOUT_EXTRANEOUS),
          warn(LAYOUT_MISSING),
        ],
      },
    ]);
    expect(files['layout-children']).toEqual([
      { file: C, count: 3 },
      { file: A, count: 1 },
      { file: B, count: 1 },
    ]);
  });

  it('같은 파일이 여러 번 들어오면 합친다 · 그 범주 항목이 없는 파일은 목록에 없다', () => {
    const { files } = lib.aggregate([
      { file: A, console: [error(ACT_UPDATE)] },
      { file: A, console: [error(ACT_UPDATE), warn(LAYOUT_MISSING)] },
    ]);
    expect(files.act).toEqual([{ file: A, count: 2 }]);
    expect(files['msw-unhandled']).toEqual([]);
  });

  it('console 이 undefined·null·빈 배열인 파일(jest 는 소음이 없으면 undefined)은 건너뛴다', () => {
    const { totals, files } = lib.aggregate([
      { file: A },
      { file: B, console: null },
      { file: C, console: [] },
    ]);
    expect(totals).toEqual(zero());
    expect(files).toEqual(emptyFiles());
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input: FileResult[] = [{ file: A, console: [warn(LAYOUT_MISSING)] }];
    const before = JSON.parse(JSON.stringify(input));
    lib.aggregate(input);
    expect(input).toEqual(before);
  });

  it('속성: error·warn 항목 수 = 5범주 합계(모든 항목은 정확히 한 범주로 간다)', () => {
    const samples = [
      LAYOUT_MISSING,
      LAYOUT_EXTRANEOUS,
      MSW_ERROR,
      MSW_WARNING,
      REANIMATED_REF,
      ACT_UPDATE,
      ACT_ENV,
      STRICT_MODE,
    ];
    const entry = fc.record({
      type: fc.constantFrom('error', 'warn', 'log', 'info', 'debug'),
      message: fc.oneof(fc.constantFrom(...samples), fc.string()),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 40 }), (entries) => {
        const { totals } = lib.aggregate([{ file: A, console: entries }]);
        const counted = entries.filter(
          (e) => e.type === 'error' || e.type === 'warn'
        ).length;
        const sum = lib.CATEGORIES.reduce((n, c) => n + totals[c], 0);
        expect(sum).toBe(counted);
        expect(Object.keys(totals).sort()).toEqual([...lib.CATEGORIES].sort());
      })
    );
  });
});

describe('judgeBudget (예산 경계)', () => {
  const budget = counts({ act: 5, reanimated: 3 });

  it('모든 범주가 허용치 이하면 통과 — 같은 값도 통과(경계)', () => {
    expect(lib.judgeBudget(counts({ act: 5, reanimated: 3 }), budget)).toEqual({
      ok: true,
      over: [],
    });
    expect(lib.judgeBudget(zero(), budget)).toEqual({ ok: true, over: [] });
  });

  it('허용치보다 하나만 많아도 초과 — 범주·허용치·실제를 담고 CATEGORIES 순서', () => {
    const verdict = lib.judgeBudget(
      counts({ act: 6, 'layout-children': 2 }),
      budget
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.over).toEqual([
      { category: 'layout-children', allowed: 0, actual: 2 },
      { category: 'act', allowed: 5, actual: 6 },
    ]);
  });

  it('허용치 0 인 범주는 1건으로도 초과(other 의 "새 종류 즉시 red")', () => {
    expect(lib.judgeBudget(counts({ other: 1 }), budget).over).toEqual([
      { category: 'other', allowed: 0, actual: 1 },
    ]);
  });

  it('예산에 범주가 빠져 있으면 조용히 통과시키지 않고 throw', () => {
    const broken = { ...budget } as Partial<Counts>;
    delete broken.act;
    expect(() => lib.judgeBudget(zero(), broken as Counts)).toThrow();
  });
});

describe('renderReport (AC3 출력 — 범주·허용치·실제·상위 5파일)', () => {
  const ROOT = '/repo/frontend';
  const file = (name: string) => `${ROOT}/src/${name}.integration.test.tsx`;

  it('초과면: 머리줄 "초과" · 모든 범주 한 줄씩 · 초과 줄에 표시 · 초과 범주만 상위 파일', () => {
    const files = emptyFiles();
    files['layout-children'] = [
      { file: file('a'), count: 5 },
      { file: file('b'), count: 2 },
    ];
    files.act = [{ file: file('c'), count: 4 }];
    const out = lib.renderReport({
      bucket: 'integration',
      budget: counts({ act: 10 }),
      totals: counts({ 'layout-children': 7, act: 4 }),
      files,
      rootDir: ROOT,
    });
    expect(out).toContain('[소음 예산:integration] 초과');
    expect(out).toMatch(/layout-children: 7 \/ 0 ← 초과/);
    expect(out).toMatch(/act: 4 \/ 10(?! ← 초과)/);
    lib.CATEGORIES.forEach((c) => expect(out).toContain(`${c}: `));
    expect(out).toMatch(/layout-children 상위 파일/);
    expect(out).toMatch(/^ {4}5 {2}src\/a\.integration\.test\.tsx$/m);
    expect(out).toMatch(/^ {4}2 {2}src\/b\.integration\.test\.tsx$/m);
    expect(out).not.toContain('act 상위 파일');
    expect(out).not.toContain(ROOT);
  });

  it('상위 파일은 최대 TOP_FILES(5)개까지만', () => {
    expect(lib.TOP_FILES).toBe(5);
    const files = emptyFiles();
    files.other = Array.from({ length: 8 }, (_, i) => ({
      file: file(`f${i}`),
      count: 8 - i,
    }));
    const out = lib.renderReport({
      bucket: 'node',
      budget: zero(),
      totals: counts({ other: 36 }),
      files,
      rootDir: ROOT,
    });
    const rows = out.split('\n').filter((l) => /^ {4}\d+ {2}src\//.test(l));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('f0');
    expect(rows[4]).toContain('f4');
  });

  it('통과면: 머리줄 "통과" · 초과 표시·상위 파일 목록 없음', () => {
    const out = lib.renderReport({
      bucket: 'node',
      budget: counts({ act: 10 }),
      totals: counts({ act: 4 }),
      files: emptyFiles(),
      rootDir: ROOT,
    });
    expect(out).toContain('[소음 예산:node] 통과');
    expect(out).not.toContain('초과');
    expect(out).not.toContain('상위 파일');
  });

  it('rootDir 밖의 경로는 그대로 보여 준다', () => {
    const files = emptyFiles();
    files.other = [{ file: '/elsewhere/x.test.tsx', count: 1 }];
    const out = lib.renderReport({
      bucket: 'node',
      budget: zero(),
      totals: counts({ other: 1 }),
      files,
      rootDir: ROOT,
    });
    expect(out).toContain('/elsewhere/x.test.tsx');
  });
});

describe('describeBlindRun (단일 파일·--silent 에서는 소음을 못 본다 — 알려진 사각)', () => {
  it('silent 면 --silent 를 언급하는 문구, verbose(단일 파일이면 jest 가 자동으로 켠다)면 그 사실을 언급하는 문구', () => {
    expect(lib.describeBlindRun({ silent: true })).toContain('--silent');
    expect(lib.describeBlindRun({ verbose: true })).toContain('verbose');
  });

  it('둘 다 아니면 null — 판정한다', () => {
    expect(lib.describeBlindRun({})).toBeNull();
    expect(lib.describeBlindRun({ silent: false, verbose: false })).toBeNull();
  });
});

describe('NoiseReporter (jest 어댑터 — 실제 종료코드는 뮤테이션 M1~M3 이 심판)', () => {
  const ROOT = '/repo/frontend';
  const config = (extra: Partial<GlobalConfig> = {}): GlobalConfig => ({
    rootDir: ROOT,
    silent: false,
    verbose: false,
    ...extra,
  });
  let written: string;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    written = '';
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string | Uint8Array
    ) => {
      written += String(chunk);
      return true;
    }) as never);
  });
  afterEach(() => stderrSpy.mockRestore());

  function run(
    bucket: string,
    results: { testFilePath: string; console?: Entry[] | null }[],
    globalConfig = config()
  ) {
    const reporter = new Reporter(globalConfig, { bucket });
    results.forEach((r) => reporter.onTestResult({}, r));
    reporter.onRunComplete([], {});
    return reporter;
  }

  it('버킷 이름이 없거나 모르는 값이면 생성 시점에 throw — 오타가 무예산으로 조용히 넘어가지 않는다', () => {
    expect(() => new Reporter(config(), {})).toThrow();
    expect(() => new Reporter(config())).toThrow();
    expect(() => new Reporter(config(), { bucket: 'unit' })).toThrow();
    expect(() => new Reporter(config(), { bucket: 'node' })).not.toThrow();
    expect(
      () => new Reporter(config(), { bucket: 'integration' })
    ).not.toThrow();
  });

  it('소음이 없으면 getLastError 는 undefined(= 종료코드 영향 없음) · 출력에 "통과"', () => {
    const reporter = run('integration', [
      { testFilePath: `${ROOT}/src/a.integration.test.tsx` },
      { testFilePath: `${ROOT}/src/b.integration.test.tsx`, console: [] },
    ]);
    expect(reporter.getLastError()).toBeUndefined();
    expect(written).toContain('[소음 예산:integration] 통과');
  });

  it('허용치 0 인 범주(layout-children)에 한 건이라도 있으면 Error 를 돌려준다 — 메시지에 범주·실제·허용치', () => {
    const reporter = run('integration', [
      {
        testFilePath: `${ROOT}/src/a.integration.test.tsx`,
        console: [warn(LAYOUT_MISSING)],
      },
    ]);
    const err = reporter.getLastError();
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('layout-children');
    expect(err?.message).toMatch(/1/);
    expect(written).toContain('[소음 예산:integration] 초과');
    expect(written).toMatch(/layout-children: 1 \/ 0 ← 초과/);
    expect(written).toContain('src/a.integration.test.tsx');
  });

  it('파일 여러 개의 소음을 한 실행으로 합산한다 — 상위 파일은 많은 순', () => {
    const reporter = run('integration', [
      {
        testFilePath: `${ROOT}/src/few.integration.test.tsx`,
        console: [warn(LAYOUT_MISSING)],
      },
      {
        testFilePath: `${ROOT}/src/many.integration.test.tsx`,
        console: [warn(LAYOUT_MISSING), warn(LAYOUT_EXTRANEOUS)],
      },
    ]);
    expect(reporter.getLastError()).toBeInstanceOf(Error);
    expect(written).toMatch(/layout-children: 3 \/ 0 ← 초과/);
    expect(written.indexOf('src/many.integration.test.tsx')).toBeLessThan(
      written.indexOf('src/few.integration.test.tsx')
    );
  });

  it('log 같은 비대상 type 만 있으면 통과', () => {
    const reporter = run('integration', [
      {
        testFilePath: `${ROOT}/src/a.integration.test.tsx`,
        console: [{ type: 'log', message: LAYOUT_MISSING }],
      },
    ]);
    expect(reporter.getLastError()).toBeUndefined();
  });

  it.each([
    ['단일 파일 실행(jest 가 verbose 로 전환)', { verbose: true }],
    ['--silent', { silent: true }],
  ])(
    '%s 에서는 판정을 생략한다 — 침묵으로 오해하지 않게 사유를 출력하고 실패시키지 않는다',
    (_name, extra) => {
      const reporter = run(
        'integration',
        [
          {
            testFilePath: `${ROOT}/src/a.integration.test.tsx`,
            console: [warn(LAYOUT_MISSING)],
          },
        ],
        config(extra)
      );
      expect(reporter.getLastError()).toBeUndefined();
      expect(written).toContain('판정 생략');
      expect(written).not.toContain('초과');
    }
  );

  it('출력은 stderr 로, 실행 완료 시점에만(onTestResult 중에는 쓰지 않는다)', () => {
    const reporter = new Reporter(config(), { bucket: 'node' });
    reporter.onTestResult(
      {},
      { testFilePath: `${ROOT}/src/a.test.tsx`, console: [error('boom')] }
    );
    expect(stderrSpy).not.toHaveBeenCalled();
    reporter.onRunComplete([], {});
    expect(stderrSpy).toHaveBeenCalled();
  });
});

describe('BUDGETS (예산 표는 느슨해지지 않는다 — 올리려면 이 테스트를 고쳐야 해서 리뷰에 보인다)', () => {
  // develop CI run 40645712423(기준 cd17a7f1a) 버킷별 before. 02a §3 에서 `PASS` 줄로 파일을 귀속해 센 값.
  const BEFORE = {
    node: { reanimated: 59, act: 194, other: 1 },
    integration: { reanimated: 174, act: 230, other: 1, msw: 325 },
  };

  it('두 버킷 모두 5범주 전부에 음이 아닌 정수 허용치가 있다', () => {
    (['node', 'integration'] as const).forEach((bucket) => {
      expect(Object.keys(lib.BUDGETS[bucket]).sort()).toEqual(
        [...lib.CATEGORIES].sort()
      );
      lib.CATEGORIES.forEach((c) => {
        expect(Number.isInteger(lib.BUDGETS[bucket][c])).toBe(true);
        expect(lib.BUDGETS[bucket][c]).toBeGreaterThanOrEqual(0);
      });
    });
  });

  it('layout-children 은 두 버킷 모두 0 — 이 칸이 가짜 라우트 표를 채워 결정적으로 0 이 된다', () => {
    expect(lib.BUDGETS.node['layout-children']).toBe(0);
    expect(lib.BUDGETS.integration['layout-children']).toBe(0);
  });

  it('msw-unhandled: node 버킷은 MSW 를 안 쓰니 0, 통합 버킷은 범위 밖 잔여 138(=325−176−11) 이하', () => {
    expect(lib.BUDGETS.node['msw-unhandled']).toBe(0);
    expect(lib.BUDGETS.integration['msw-unhandled']).toBeLessThanOrEqual(
      BEFORE.integration.msw - 176 - 11
    );
  });

  it('reanimated · act · other 는 before 이하(내림만 허용 — 천장이 before 보다 큰 값으로 올라가지 못한다)', () => {
    expect(lib.BUDGETS.node.reanimated).toBeLessThanOrEqual(
      BEFORE.node.reanimated
    );
    expect(lib.BUDGETS.integration.reanimated).toBeLessThanOrEqual(
      BEFORE.integration.reanimated
    );
    expect(lib.BUDGETS.node.act).toBeLessThanOrEqual(BEFORE.node.act);
    expect(lib.BUDGETS.integration.act).toBeLessThanOrEqual(
      BEFORE.integration.act
    );
    expect(lib.BUDGETS.node.other).toBeLessThanOrEqual(BEFORE.node.other);
    expect(lib.BUDGETS.integration.other).toBeLessThanOrEqual(
      BEFORE.integration.other
    );
  });
});

describe('jest 설정 배선 (버킷 이름을 맞게 reporter 에 넘긴다)', () => {
  type JestConfig = {
    reporters?: (string | [string, Record<string, unknown>])[];
  };
  const nodeConfig = jest.requireActual<JestConfig>('../jest.config.js');
  const integrationConfig = jest.requireActual<JestConfig>(
    '../jest.integration.config.js'
  );

  const noiseEntry = (config: JestConfig) =>
    (config.reporters ?? []).find(
      (r): r is [string, Record<string, unknown>] =>
        Array.isArray(r) && /scripts\/noise-reporter\.cjs$/.test(String(r[0]))
    );

  it.each([
    ['node 버킷(jest.config.js)', 'node', nodeConfig],
    [
      '통합 버킷(jest.integration.config.js) — ...base 로 물려받은 node 값을 덮는다',
      'integration',
      integrationConfig,
    ],
  ])('%s 는 reporter 에 bucket:%s 를 넘긴다', (_name, bucket, config) => {
    const entry = noiseEntry(config);
    expect(entry).toBeDefined();
    expect(entry?.[1]).toEqual({ bucket });
  });

  it.each([
    ['node', nodeConfig],
    ['integration', integrationConfig],
  ])(
    "%s 설정의 reporters 에 'default' 가 남아 있다 — 빠지면 jest 기본 출력(PASS/FAIL·요약)이 사라진다",
    (_name, config) => {
      expect(
        (config.reporters ?? []).some(
          (r) => r === 'default' || (Array.isArray(r) && r[0] === 'default')
        )
      ).toBe(true);
    }
  );

  it('reporter 경로가 실제 파일을 가리킨다(<rootDir> 는 frontend/)', () => {
    const entry = noiseEntry(nodeConfig);
    const resolved = path.resolve(
      __dirname,
      '..',
      String(entry?.[0]).replace('<rootDir>/', '')
    );
    expect(fs.existsSync(resolved)).toBe(true);
  });
});
