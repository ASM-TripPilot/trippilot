/**
 * @jest-environment node
 */

/**
 * TRIP-1612 · 운영 번들 리포트 스크립트(`scripts/bundle-report.cjs`)의 순수 함수 계약.
 *
 * 무엇을 보장하나: 번들에 금지 경로(`app/_dev` + TRIP-1616 이 더한 `src/mocks`·`src/test-support`·`__fixtures__`·
 * `*.test.*`·도우미 가짜 어댑터/샘플)가 있는지 판정하는 규칙(공허 통과 금지 포함), s-m-e 결과 집계(가짜 항목
 * 분리·상위 20), 종료코드(0/1/2), MB 포맷, 리포트 JSON 스키마, 한 줄 요약·MD 고정 문구.
 * TRIP-1616 에서 결과 키·문구를 `devPaths`/`_dev N건` → `forbiddenPaths`/`금지 경로 N건` 으로 일반화했다.
 * 실제 `expo export`·s-m-e 실행·CI·문서 정정은 jest 대상이 아니다(실행 확인 — 02a §7).
 *
 * 테스트가 `.ts` 인 이유: jest testMatch 가 `.cjs` 를 줍지 않아서다. 스크립트는 `jest.requireActual` 로 읽는다.
 * 3동작 뼈대: 준비=입력 픽스처 → 실행=함수 호출 → 단언=반환값.
 */
import cp from 'child_process';
import fc from 'fast-check';
import fs from 'fs';

type Fake = { label: string; bytes: number };
type Mod = { path: string; bytes: number };
type Sme = {
  results: {
    bundleName: string;
    totalBytes: number;
    mappedBytes: number;
    unmappedBytes: number;
    eolBytes: number;
    sourceMapCommentBytes: number;
    files: Record<string, { size: number }>;
  }[];
};
type Report = {
  platform: 'ios';
  bytecode: boolean;
  totalJsBytes: number;
  totalAssetBytes: number;
  topModules: Mod[];
  excluded: Fake[];
  forbiddenPaths: string[];
};
type Verdict = { forbiddenPaths: string[]; toolError: string | null };
type Lib = {
  FORBIDDEN_PATTERNS: RegExp[];
  findForbiddenSources: (sources: string[], patterns?: RegExp[]) => string[];
  judgeSourceMap: (sources: unknown, patterns?: RegExp[]) => Verdict;
  decideExitCode: (v: {
    forbiddenPaths: string[];
    toolError: string | null;
  }) => 0 | 1 | 2;
  summarizeSme: (sme: unknown) => {
    totalJsBytes: number;
    topModules: Mod[];
    excluded: Fake[];
  };
  sumAssetBytes: (sizes: number[]) => number;
  buildReport: (input: {
    sme: unknown;
    sources: string[];
    assetSizes: number[];
  }) => Report;
  formatMB: (bytes: number) => string;
  renderSummaryLine: (report: Report) => string;
  renderMarkdown: (report: Report) => string;
  parseArgs: (argv: string[]) => { project: string | null };
  main: unknown;
};

// 실제 s-m-e@2.5.3 `--json` 출력(HEAD 운영 export)의 상위 항목을 그대로 축소했다. totalBytes 는 실값(6331083)을
// 유지하므로 files 합과 맞지 않는다 — 합을 단언하지 않는다.
const REAL_FILES: Record<string, { size: number }> = {
  '[unmapped]': { size: 286657 },
  '[no source]': { size: 169411 },
  '/node_modules/.pnpm/@sentry-internal+replay@10.12.0/node_modules/@sentry-internal/replay/build/npm/esm/index.js':
    { size: 133724 },
  '/node_modules/.pnpm/react-native@0.81.5_@babel+core@7.29.7_@types+react@19.1.17_react@19.1.0/node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js':
    { size: 120554 },
  '/node_modules/.pnpm/react-native@0.81.5_@babel+core@7.29.7_@types+react@19.1.17_react@19.1.0/node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js':
    { size: 118076 },
  '/node_modules/.pnpm/expo@54.0.36_@babel+core@7.29.7_@expo+metro-runtime@6.1.2_expo-router@6.0.24_graphql@16_777c7211684d667b86c70498061c8113/node_modules/expo/virtual/streams.js':
    { size: 64227 },
  '/app/(tabs)/_layout.tsx': { size: 1410 },
  '/app/trips/[tripId]/planb/index.tsx': { size: 1107 },
  '[EOLs]': { size: 3636 },
  '[sourceMappingURL]': { size: 108 },
};

const REAL_MODULES: Mod[] = [
  {
    path: '/node_modules/.pnpm/@sentry-internal+replay@10.12.0/node_modules/@sentry-internal/replay/build/npm/esm/index.js',
    bytes: 133724,
  },
  {
    path: '/node_modules/.pnpm/react-native@0.81.5_@babel+core@7.29.7_@types+react@19.1.17_react@19.1.0/node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js',
    bytes: 120554,
  },
  {
    path: '/node_modules/.pnpm/react-native@0.81.5_@babel+core@7.29.7_@types+react@19.1.17_react@19.1.0/node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js',
    bytes: 118076,
  },
  {
    path: '/node_modules/.pnpm/expo@54.0.36_@babel+core@7.29.7_@expo+metro-runtime@6.1.2_expo-router@6.0.24_graphql@16_777c7211684d667b86c70498061c8113/node_modules/expo/virtual/streams.js',
    bytes: 64227,
  },
  { path: '/app/(tabs)/_layout.tsx', bytes: 1410 },
  { path: '/app/trips/[tripId]/planb/index.tsx', bytes: 1107 },
];

const REAL_FAKES: Fake[] = [
  { label: '[unmapped]', bytes: 286657 },
  { label: '[no source]', bytes: 169411 },
  { label: '[EOLs]', bytes: 3636 },
  { label: '[sourceMappingURL]', bytes: 108 },
];

function smeOf(
  files: Record<string, { size: number }>,
  totalBytes = 6331083
): Sme {
  return {
    results: [
      {
        // 실제 해시(32-hex)를 쓰면 socialSdkSecrets 의 키 리터럴 스캔에 걸린다.
        bundleName: '_expo/static/js/ios/index-<hash>.js',
        totalBytes,
        mappedBytes: totalBytes - 286657,
        unmappedBytes: 286657,
        eolBytes: 3636,
        sourceMapCommentBytes: 108,
        files,
      },
    ],
  };
}

const SME = smeOf(REAL_FILES);
const CLEAN_SOURCES = [
  '/index.ts',
  '/src/app/a.ts',
  '/node_modules/react/index.js',
];
const DEV_SOURCES = ['/app/_dev/preview.tsx', '/app/_dev/assets/a.jpg'];

let lib: Lib;
let callsDuringLoad: Record<string, number>;

// 로드 순간에 부작용 함수가 불리는지 보려고 spy 를 먼저 심고 모듈을 처음 읽는다 — 가드(`require.main === module`)가
// 없으면 이 순간 실제 `expo export` 가 도는 사고가 spy 에서 막힌다. 로드가 끝나면 spy 는 곧바로 푼다(jest 내부 쓰기 보호).
beforeAll(() => {
  const trap = (name: string) => () => {
    throw new Error(`bundle-report 를 require 하는 것만으로 ${name} 이 불렸다`);
  };
  const spies = {
    'process.exit': jest
      .spyOn(process, 'exit')
      .mockImplementation(trap('process.exit') as never),
    'fs.writeFileSync': jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(trap('fs.writeFileSync')),
    'fs.mkdirSync': jest
      .spyOn(fs, 'mkdirSync')
      .mockImplementation(trap('fs.mkdirSync')),
    'child_process.spawnSync': jest
      .spyOn(cp, 'spawnSync')
      .mockImplementation(trap('child_process.spawnSync')),
    'child_process.execFileSync': jest
      .spyOn(cp, 'execFileSync')
      .mockImplementation(trap('child_process.execFileSync')),
    'child_process.execSync': jest
      .spyOn(cp, 'execSync')
      .mockImplementation(trap('child_process.execSync')),
  };
  try {
    lib = jest.requireActual<Lib>('./bundle-report.cjs');
  } finally {
    callsDuringLoad = Object.fromEntries(
      Object.entries(spies).map(([name, spy]) => [name, spy.mock.calls.length])
    );
    Object.values(spies).forEach((spy) => spy.mockRestore());
  }
});

describe('findForbiddenSources · FORBIDDEN_PATTERNS (AC2)', () => {
  it('T1 _dev 경로만 입력 순서대로 돌려준다', () => {
    const sources = ['/index.ts', DEV_SOURCES[0], '/src/a.ts', DEV_SOURCES[1]];
    expect(lib.findForbiddenSources(sources)).toEqual(DEV_SOURCES);
  });

  it('T2 위반이 없으면 빈 배열', () => {
    expect(lib.findForbiddenSources(CLEAN_SOURCES)).toEqual([]);
  });

  it('T3 윈도 구분자(\\) 경로도 잡는다', () => {
    expect(lib.findForbiddenSources(['\\app\\_dev\\preview.tsx'])).toEqual([
      '\\app\\_dev\\preview.tsx',
    ]);
  });

  it('T4 app/_devtools·_dev.ts 같은 접두 일치는 잡지 않는다', () => {
    expect(
      lib.findForbiddenSources([
        '/app/_devtools/x.ts',
        '/src/app/devices/_dev.ts',
      ])
    ).toEqual([]);
  });

  it('T5 앵커가 없다 — node_modules 속 app/_dev/ 도 잡는다(metro blockList 와 동일)', () => {
    expect(
      lib.findForbiddenSources(['/node_modules/pkg/app/_dev/x.js'])
    ).toEqual(['/node_modules/pkg/app/_dev/x.js']);
  });

  it('T6 patterns 인자로 다른 패턴을 주면 그것만 적용하고, 소스당 1번만 돌려준다', () => {
    const both = '/fixtures/a.mock.ts';
    expect(
      lib.findForbiddenSources(
        ['/index.ts', both, '/app/_dev/preview.tsx'],
        [/fixtures[\\/]/, /\.mock\./]
      )
    ).toEqual([both]);
  });

  it('T7 기본 패턴 목록은 RegExp 배열이고 _dev 패턴이 그 안에 있다', () => {
    expect(lib.FORBIDDEN_PATTERNS.length).toBeGreaterThanOrEqual(1);
    lib.FORBIDDEN_PATTERNS.forEach((pattern) =>
      expect(pattern).toBeInstanceOf(RegExp)
    );
    expect(lib.FORBIDDEN_PATTERNS.some((p) => p.test('/app/_dev/x'))).toBe(
      true
    );
  });
});

// TRIP-1616 — 테스트·프리뷰 전용 파일이 운영 소스맵에 섞이면 잡는 패턴들(AC1-b·c). 소스맵 경로는 프로젝트 루트 기준 `/src/…` 꼴이다.
describe('FORBIDDEN_PATTERNS 확장 — 테스트·프리뷰 전용 경로', () => {
  it.each([
    [
      '도우미 가짜 어댑터',
      '/src/pages/assistant/assistant-sheet/api/fakeAssistantAdapter.ts',
    ],
    [
      '도우미 샘플 데이터',
      '/src/pages/assistant/assistant-sheet/api/assistantSamples.ts',
    ],
    ['홈 프리뷰 픽스처 폴더', '/src/pages/home/model/__fixtures__/x.ts'],
    [
      '단계별 홈 픽스처 파일',
      '/src/pages/home/model/__fixtures__/homePhaseFixtures.ts',
    ],
    ['src/mocks', '/src/mocks/server.ts'],
    ['src/test-support', '/src/test-support/freezeDate.ts'],
    ['src 아래 단위 테스트', '/src/pages/home/ui/HomeScreen.test.tsx'],
    ['src 아래 통합 테스트', '/src/a/b.integration.test.tsx'],
    ['app 아래 테스트', '/app/(tabs)/index.test.tsx'],
    ['윈도 구분자 src\\mocks', '\\src\\mocks\\server.ts'],
    [
      '윈도 구분자 __fixtures__',
      '\\src\\pages\\home\\model\\__fixtures__\\x.ts',
    ],
  ])('잡는다 — %s', (_name, source) => {
    expect(lib.findForbiddenSources(['/index.ts', source])).toEqual([source]);
  });

  it.each([
    ['운영 홈 기본값 파일', '/src/pages/home/model/homeFixtures.ts'],
    [
      '운영 매거진 데이터(이름만 Fixtures)',
      '/src/pages/magazine/model/magazineFixtures.ts',
    ],
    [
      '도우미 계약 파일',
      '/src/pages/assistant/assistant-sheet/api/assistantContract.ts',
    ],
    [
      '도우미 포트 파일',
      '/src/pages/assistant/assistant-sheet/api/assistantPort.ts',
    ],
    ['node_modules 속 __fixtures__', '/node_modules/pkg/__fixtures__/a.js'],
    ['node_modules 속 .test. 파일', '/node_modules/pkg/x.test.js'],
    ['접두만 같은 폴더 src/mocksmith', '/src/mocksmith/a.ts'],
    ['접두만 같은 폴더 src/test-supporter', '/src/test-supporter/a.ts'],
    ['__fixtures__ 와 이름만 비슷한 폴더', '/src/a/__fixtures__x/b.ts'],
    ['.test. 가 아닌 파일명 latest', '/src/pages/home/model/latest.tsx'],
    ['.test. 가 아닌 파일명 b.testing', '/src/a/b.testing.ts'],
    ['실제 라우트 파일', '/app/(tabs)/_layout.tsx'],
  ])('잡지 않는다 — %s', (_name, source) => {
    expect(lib.findForbiddenSources(['/index.ts', source])).toEqual([]);
  });

  it('새 금지 경로가 섞인 소스맵은 exit 1 이고 그 경로가 forbiddenPaths 에 담긴다', () => {
    const leaked = '/src/test-support/freezeDate.ts';
    const verdict = lib.judgeSourceMap([...CLEAN_SOURCES, leaked]);
    expect(verdict.forbiddenPaths).toEqual([leaked]);
    expect(lib.decideExitCode(verdict)).toBe(1);
  });
});

describe('judgeSourceMap · decideExitCode (AC2 종료코드)', () => {
  it('T8 정상(비어 있지 않고 _dev 없음) → 오류 없음, exit 0', () => {
    const verdict = lib.judgeSourceMap(CLEAN_SOURCES);
    expect(verdict).toEqual({ forbiddenPaths: [], toolError: null });
    expect(lib.decideExitCode(verdict)).toBe(0);
  });

  it('T9 _dev 가 섞이면 그 경로를 담고 exit 1', () => {
    const verdict = lib.judgeSourceMap([...CLEAN_SOURCES, DEV_SOURCES[0]]);
    expect(verdict.forbiddenPaths).toEqual([DEV_SOURCES[0]]);
    expect(lib.decideExitCode(verdict)).toBe(1);
  });

  it('T10 빈 sources 는 통과가 아니라 도구 오류 — exit 2 (공허 통과 금지)', () => {
    const verdict = lib.judgeSourceMap([]);
    expect(verdict.forbiddenPaths).toEqual([]);
    expect(typeof verdict.toolError).toBe('string');
    expect((verdict.toolError as string).length).toBeGreaterThan(0);
    expect(lib.decideExitCode(verdict)).toBe(2);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['sources 키 없는 맵 객체', {}],
  ])('T11 sources 가 배열이 아니면(%s) exit 2', (_name, input) => {
    expect(lib.decideExitCode(lib.judgeSourceMap(input))).toBe(2);
  });

  it.each([
    ['아무 일 없음', { forbiddenPaths: [], toolError: null }, 0],
    ['_dev 검출', { forbiddenPaths: ['/app/_dev/a.ts'], toolError: null }, 1],
    ['도구 오류', { forbiddenPaths: [], toolError: 'export failed' }, 2],
    [
      '둘 다면 판정이 끝난 _dev 검출(1)이 우선',
      { forbiddenPaths: ['/app/_dev/a.ts'], toolError: 's-m-e failed' },
      1,
    ],
  ])('T12 decideExitCode — %s', (_name, input, expected) => {
    expect(lib.decideExitCode(input)).toBe(expected);
  });

  describe('T13 속성', () => {
    // 세그먼트에 `_`·`.`·`-` 가 없으니 어떻게 이어 붙여도 `app/_dev/`·`__fixtures__/`·`.test.`·`test-support/` 가 생길 수 없다.
    // 남는 우연은 `src/mocks/` 뿐이라(TRIP-1616 추가 패턴) `mocks` 세그먼트만 걸러 확률 0 으로 만든다.
    const segment = fc
      .stringMatching(/^[a-z0-9]{1,8}$/)
      .filter((name) => name !== 'mocks');
    const safePath = fc
      .array(segment, { minLength: 1, maxLength: 5 })
      .map((parts) => `/${parts.join('/')}`);
    const safeSources = fc.array(safePath, { minLength: 1, maxLength: 20 });

    it('_dev 가 못 나오는 임의의 비어 있지 않은 sources 는 항상 exit 0', () => {
      fc.assert(
        fc.property(safeSources, (sources) => {
          expect(lib.decideExitCode(lib.judgeSourceMap(sources))).toBe(0);
        })
      );
    });

    it('거기에 금지 경로 하나(/app/_dev/…·/src/mocks/…·/src/test-support/…)를 어디에 끼워도 항상 exit 1 이고 끼운 경로가 forbiddenPaths', () => {
      fc.assert(
        fc.property(
          safeSources,
          segment,
          fc.constantFrom('app/_dev', 'src/mocks', 'src/test-support'),
          fc.nat(),
          (sources, name, folder, at) => {
            const leaked = `/${folder}/${name}.tsx`;
            const mixed = [...sources];
            mixed.splice(at % (mixed.length + 1), 0, leaked);
            const verdict = lib.judgeSourceMap(mixed);
            expect(verdict.forbiddenPaths).toEqual([leaked]);
            expect(lib.decideExitCode(verdict)).toBe(1);
          }
        )
      );
    });
  });
});

describe('summarizeSme (AC1 상위 20 · 가짜 항목)', () => {
  it('T14 totalJsBytes 는 s-m-e totalBytes 그대로', () => {
    expect(lib.summarizeSme(SME).totalJsBytes).toBe(6331083);
  });

  it('T15 가짜 4종(대괄호 키)은 excluded 로 — 큰 순서', () => {
    expect(lib.summarizeSme(SME).excluded).toEqual(REAL_FAKES);
  });

  it('T16 topModules 는 실모듈만 큰 순서 — 더 큰 [unmapped] 가 1위를 가로채지 못하고 입력은 안 바뀐다', () => {
    const before = JSON.parse(JSON.stringify(SME));
    expect(lib.summarizeSme(SME).topModules).toEqual(REAL_MODULES);
    expect(SME).toEqual(before);
  });

  it('T17 실모듈 25개면 상위 20개로 자른다', () => {
    const files: Record<string, { size: number }> = {};
    for (let i = 0; i < 25; i += 1) {
      files[`/m/${String(i).padStart(2, '0')}.js`] = { size: 1000 + i };
    }
    const top = lib.summarizeSme(smeOf(files)).topModules;
    expect(top).toHaveLength(20);
    expect(top.map((m) => m.bytes)).toEqual(
      Array.from({ length: 20 }, (_, i) => 1024 - i)
    );
  });

  it('T18 같은 크기는 path 오름차순 — 입력 순서가 달라도 결과가 같다', () => {
    const entry = (p: string) => [p, { size: 500 }] as const;
    const forward = Object.fromEntries(
      ['/m/a.js', '/m/b.js', '/m/c.js'].map(entry)
    );
    const reversed = Object.fromEntries(
      ['/m/c.js', '/m/b.js', '/m/a.js'].map(entry)
    );
    const expected = ['/m/a.js', '/m/b.js', '/m/c.js'].map((path) => ({
      path,
      bytes: 500,
    }));
    expect(lib.summarizeSme(smeOf(forward)).topModules).toEqual(expected);
    expect(lib.summarizeSme(smeOf(reversed)).topModules).toEqual(expected);
  });

  it('T19 실모듈이 20개보다 적으면 있는 만큼만', () => {
    const files = {
      '/m/a.js': { size: 3 },
      '/m/b.js': { size: 2 },
      '/m/c.js': { size: 1 },
    };
    expect(lib.summarizeSme(smeOf(files)).topModules).toHaveLength(3);
  });

  it('T20 [tripId] 같은 Expo Router 동적 라우트 실경로는 모듈로 남는다', () => {
    const result = lib.summarizeSme(SME);
    const dynamic = '/app/trips/[tripId]/planb/index.tsx';
    expect(result.topModules.map((m) => m.path)).toContain(dynamic);
    expect(result.excluded.map((f) => f.label)).not.toContain(dynamic);
  });

  it.each([
    ['results 가 비어 있음', { results: [] }],
    ['results 가 2개', { results: [SME.results[0], SME.results[0]] }],
    ['results 키가 없음', {}],
  ])('T21 정확히 1개가 아니면 throw — %s', (_name, input) => {
    expect(() => lib.summarizeSme(input)).toThrow();
  });
});

describe('sumAssetBytes · formatMB (AC1 단위)', () => {
  it('T22 에셋 크기 목록의 합 (빈 목록 0, int32 를 넘어도 안 잘림)', () => {
    expect(lib.sumAssetBytes([])).toBe(0);
    expect(lib.sumAssetBytes([100, 250, 0])).toBe(350);
    expect(lib.sumAssetBytes([3e9, 3e9])).toBe(6e9);
  });

  it.each([
    [0, '0.00'],
    [1_000_000, '1.00'],
    [1_048_576, '1.05'],
    [6_331_083, '6.33'],
    [6_500_000, '6.50'],
    [14_000, '0.01'],
    [4_000, '0.00'],
    [12_345_678, '12.35'],
    [1_234_567_890, '1234.57'],
  ])('T23 formatMB(%i) = %s (1MB = 1,000,000B)', (bytes, expected) => {
    expect(lib.formatMB(bytes)).toBe(expected);
  });
});

describe('buildReport (AC1 JSON 스키마)', () => {
  const input = {
    sme: SME,
    sources: CLEAN_SOURCES,
    assetSizes: [6_000_000, 500_000],
  };

  it('T24 고정 스키마 7키 — 커밋·시각·duration 없음', () => {
    const report = lib.buildReport(input);
    expect(report).toEqual({
      platform: 'ios',
      bytecode: false,
      totalJsBytes: 6331083,
      totalAssetBytes: 6_500_000,
      topModules: REAL_MODULES,
      excluded: REAL_FAKES,
      forbiddenPaths: [],
    });
    expect(Object.keys(report).sort()).toEqual(
      [
        'bytecode',
        'forbiddenPaths',
        'excluded',
        'platform',
        'topModules',
        'totalAssetBytes',
        'totalJsBytes',
      ].sort()
    );
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('T25 forbiddenPaths 는 s-m-e 가 아니라 원본 sources 에서 구한다', () => {
    const report = lib.buildReport({
      ...input,
      sources: [...CLEAN_SOURCES, '/app/_dev/preview.tsx'],
    });
    expect(report.forbiddenPaths).toEqual(['/app/_dev/preview.tsx']);
    expect(report.topModules).toEqual(REAL_MODULES);
  });
});

describe('renderSummaryLine · renderMarkdown (AC1·AC4 문구)', () => {
  const clean = () =>
    lib.buildReport({
      sme: SME,
      sources: CLEAN_SOURCES,
      assetSizes: [6_000_000, 500_000],
    });
  const dirty = (sources: string[]) =>
    lib.buildReport({
      sme: SME,
      sources: [...CLEAN_SOURCES, ...sources],
      assetSizes: [6_000_000, 500_000],
    });

  it('T26 한 줄 요약은 고정 문구 · 개행 없음', () => {
    expect(lib.renderSummaryLine(clean())).toBe(
      'iOS JS 6.33MB · assets 6.50MB · 금지 경로 0건 (--no-bytecode)'
    );
    const thirteen = Array.from(
      { length: 13 },
      (_, i) => `/app/_dev/assets/${i}.jpg`
    );
    const line = lib.renderSummaryLine(dirty(thirteen));
    expect(line).toContain('금지 경로 13건');
    expect(line).not.toContain('\n');
  });

  it('T27 bytecode:false 보고서의 MD 에 --no-bytecode 고정 문구가 있다', () => {
    expect(lib.renderMarkdown(clean())).toContain(
      '--no-bytecode 기준이라 출하 hbc 크기와 다름'
    );
  });

  it('T28 같은 보고서도 bytecode:true 면 그 문구가 없다(문구는 bytecode 값이 구동)', () => {
    const md = lib.renderMarkdown({ ...clean(), bytecode: true });
    expect(md).not.toContain('--no-bytecode 기준이라 출하 hbc 크기와 다름');
  });

  it('T29 표 머리가 있고, 순위 행은 topModules 순서·개수 그대로 경로와 MB 를 담는다', () => {
    const report = clean();
    const md = lib.renderMarkdown(report);
    expect(md).toMatch(/^\|\s*#\s*\|\s*module\s*\|\s*bytes\s*\|/m);
    const rankRows = md
      .split('\n')
      .filter((line) => /^\|\s*\d+\s*\|/.test(line));
    expect(rankRows).toHaveLength(report.topModules.length);
    report.topModules.forEach((module, i) => {
      expect(rankRows[i]).toContain(module.path);
      expect(rankRows[i]).toContain(lib.formatMB(module.bytes));
    });
  });

  it('T30 가짜 항목은 MD 에 별도 줄로 있고 순위 행에는 없다', () => {
    const md = lib.renderMarkdown(clean());
    const rankRows = md
      .split('\n')
      .filter((line) => /^\|\s*\d+\s*\|/.test(line));
    REAL_FAKES.forEach((fake) => {
      expect(md).toContain(fake.label);
      expect(rankRows.some((row) => row.includes(fake.label))).toBe(false);
    });
    expect(md).toContain(lib.formatMB(286657));
  });

  it('T31 총 JS·에셋 MB 와 금지 경로 0건/N건 줄(N건이면 경로도)', () => {
    const cleanMd = lib.renderMarkdown(clean());
    expect(cleanMd).toContain('6.33');
    expect(cleanMd).toContain('6.50');
    expect(cleanMd).toContain('금지 경로 0건');
    const dirtyMd = lib.renderMarkdown(dirty(DEV_SOURCES));
    expect(dirtyMd).toContain('금지 경로 2건');
    DEV_SOURCES.forEach((p) => expect(dirtyMd).toContain(p));
  });
});

describe('parseArgs (AC3 --project)', () => {
  it('T32 인자가 없으면 project null, --project 값은 그대로', () => {
    expect(lib.parseArgs([])).toEqual({ project: null });
    expect(lib.parseArgs(['--project', '/x/frontend'])).toEqual({
      project: '/x/frontend',
    });
  });

  it.each([
    ['값이 없는 --project', ['--project']],
    ['플래그 모양의 값', ['--project', '--foo']],
    ['모르는 플래그', ['--bogus']],
  ])('T33 %s 는 throw — HEAD 로 조용히 도는 것을 막는다', (_name, argv) => {
    expect(() => lib.parseArgs(argv)).toThrow();
  });
});

describe('require 가드 (module.exports + require.main === module)', () => {
  it('T34 모듈을 읽기만 해서는 export·파일쓰기·process.exit 이 일어나지 않는다', () => {
    expect(callsDuringLoad).toEqual({
      'process.exit': 0,
      'fs.writeFileSync': 0,
      'fs.mkdirSync': 0,
      'child_process.spawnSync': 0,
      'child_process.execFileSync': 0,
      'child_process.execSync': 0,
    });
    expect(typeof lib.main).toBe('function');
  });
});
