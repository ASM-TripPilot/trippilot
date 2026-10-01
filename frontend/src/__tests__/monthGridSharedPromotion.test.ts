/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-639 — 월 그리드 산술 네 함수(`daysInMonth`·`firstWeekdayOfMonth`·`shiftMonth`·
 * `isDateInRange`)의 `shared/date/monthGrid` 통합이 **이동이지 복제가 아니다**.
 *
 * 무엇을 보장하나:
 *  - **G1(AC-1)** 네 함수의 정의가 `shared/date/monthGrid.ts` 한 곳에만 있다 — trip 사본 0.
 *  - **G2(AC-2·Q1)** 옛 자리(`tripDatePicker.ts`)는 도메인 함수를 그대로 갖고,
 *    네 함수를 재수출(shim)하지 않는다 — import 경로가 두 곳으로 남으면 다음 사람이 헷갈린다.
 *
 * TRIP-1052 — 옛 stay 자리(`features/stay/model/stayDates.ts`)는 숙소 등록 날짜 입력과 함께 파일째
 * 삭제됐다. 그 파일을 읽던 G1·G2의 stay 절을 걷고, 그 파일에 들어 있던 monthGrid 성질 테스트는
 * `shared/date/monthGrid.property.test.ts`로 옮겼다(아래 CONSUMERS 한 행이 그 이관을 잠근다).
 * 파일 부재 자체는 `stayDateRemovalStructure.test.ts`가 잰다.
 *  - **G3(Q1·AC-3)** `src` 어디에서도 네 함수를 옛 자리에서 가져오지 않고, 알려진 소비처(화면·페이지·
 *    기존 단위 테스트)는 `@/shared/date/monthGrid`에서 가져온다.
 *
 * 시계·생성자 금지(AC-4)는 여기가 아니라 `tripWizardStep1Boundary.test.ts` AC-5가 monthGrid까지
 * 넓혀 잡는다(기존 가드 재조준 — 같은 탐지기를 두 곳에 두지 않는다).
 *
 * 가짜 통과 방지(리포 관례): 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const GRID = join(SRC_ROOT, 'shared', 'date', 'monthGrid.ts');
const TRIP = join(SRC_ROOT, 'features', 'trip', 'model', 'tripDatePicker.ts');
const GRID_IMPORT = '@/shared/date/monthGrid';

const FOUR = [
  'daysInMonth',
  'firstWeekdayOfMonth',
  'shiftMonth',
  'isDateInRange',
] as const;

/** 블록 주석 먼저, 그다음 줄 주석. `:` 바로 뒤 `//`(URL)는 주석으로 보지 않는다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/** export 여부와 무관한 로컬 정의 — `export`만 뗀 비공개 사본도 사본이다. */
function definesSymbol(source: string, name: string): boolean {
  return new RegExp(`\\b(?:function|const|let|var)\\s+${name}\\b`).test(source);
}

/** `export { name } from …` · `export { name }` · `export { name as x }` 재수출. */
function reExportsSymbol(source: string, name: string): boolean {
  return new RegExp(
    `export\\s*(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`
  ).test(source);
}

const STAR_REEXPORT = /export\s*\*\s*(?:as\s+\w+\s+)?from/;

/** named import(여러 줄 포함)를 `{ specifier, names }`로. 이름은 `type ` 접두와 `as` 별칭을 뗀다. */
function importsOf(source: string): { specifier: string; names: string[] }[] {
  return [
    ...source.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
    ),
  ].map((match) => ({
    specifier: match[2],
    names: match[1]
      .split(',')
      .map((part) =>
        part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim()
      )
      .filter(Boolean),
  }));
}

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.tsx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join('/');
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 단언들이 의미를 갖는다', () => {
  it('주석 속 정의·재수출·import는 걷히고, 코드 줄 정의는 살아남는다', () => {
    const sample = stripComments(
      [
        '/** export function daysInMonth() {} */',
        "// export { shiftMonth } from '@/shared/date/monthGrid';",
        "// import { isDateInRange } from './stayDates';",
        'export function nightsBetween() {}',
      ].join('\n')
    );

    expect(
      FOUR.filter(
        (name) => definesSymbol(sample, name) || reExportsSymbol(sample, name)
      )
    ).toEqual([]);
    expect(importsOf(sample)).toEqual([]);
    expect(definesSymbol(sample, 'nightsBetween')).toBe(true);
  });

  it('재수출 세 형태를 전부 잡고, 도메인 선언은 재수출로 오인하지 않는다', () => {
    expect(
      reExportsSymbol(
        "export { daysInMonth, shiftMonth } from '@/shared/date/monthGrid';",
        'shiftMonth'
      )
    ).toBe(true);
    expect(
      reExportsSymbol(
        "import { isDateInRange } from '@/shared/date/monthGrid';\nexport { isDateInRange };",
        'isDateInRange'
      )
    ).toBe(true);
    expect(
      reExportsSymbol('export { daysInMonth as legacyDays };', 'daysInMonth')
    ).toBe(true);
    expect(STAR_REEXPORT.test("export * from '@/shared/date/monthGrid';")).toBe(
      true
    );

    const domain = [
      'export function nightsBetween() {}',
      'export interface StayDateRange { checkIn: string | null }',
    ].join('\n');
    expect(FOUR.filter((name) => reExportsSymbol(domain, name))).toEqual([]);
    expect(STAR_REEXPORT.test(domain)).toBe(false);
  });

  it('여러 줄·type·as 별칭·괄호 안 주석·URL 줄에서도 import 이름과 출처를 정확히 뽑는다', () => {
    const multi = stripComments(
      [
        'import {',
        '  applyDatePick,',
        '  shiftMonth as sm, // 주석',
        '  type StayDateRange,',
        "} from '@/features/stay/model/stayDates';",
      ].join('\n')
    );
    expect(importsOf(multi)).toEqual([
      {
        specifier: '@/features/stay/model/stayDates',
        names: ['applyDatePick', 'shiftMonth', 'StayDateRange'],
      },
    ]);

    const urlLine = stripComments(
      "const doc = 'https://figma.com/x'; import { shiftMonth } from '@/shared/date/monthGrid';"
    );
    expect(importsOf(urlLine)).toEqual([
      { specifier: '@/shared/date/monthGrid', names: ['shiftMonth'] },
    ]);
  });
});

describe('🔴 G1 · 한 벌(AC-1) — 네 함수의 정의는 shared/date/monthGrid 에만 있다', () => {
  it('monthGrid 가 네 함수를 export function 으로 정의하고, tripDatePicker 에는 정의가 0건이다', () => {
    const grid = read(GRID);
    // 긍정 — 통합 목적지에 본문이 실제로 있다.
    expect(
      FOUR.filter(
        (name) => !new RegExp(`export\\s+function\\s+${name}\\b`).test(grid)
      )
    ).toEqual([]);

    // 부정 — 옛 자리에 사본(export 여부 무관)이 남지 않는다.
    const leftovers = [TRIP].flatMap((file) => {
      const source = read(file);
      return FOUR.filter((name) => definesSymbol(source, name)).map(
        (name) => `${rel(file)}:${name}`
      );
    });
    expect(leftovers).toEqual([]);
  });
});

describe('G2 · 옛 자리 존치(AC-2) + 재수출 shim 금지(Q1)', () => {
  it('tripDatePicker 는 도메인 함수를 그대로 갖고, 네 함수를 재수출하지 않는다', () => {
    const trip = read(TRIP);

    // 긍정 — 여행 선택 전이·셀 조립(trip)은 남는다.
    const missing = [
      // TRIP-1027: `applyRangePick` 은 고아라 삭제됐다(01b O5 — 부재는 tripPeriodFromNightsStructure 가 잡는다).
      ...['dateCell']
        .filter(
          (name) => !new RegExp(`export\\s+function\\s+${name}\\b`).test(trip)
        )
        .map((name) => `tripDatePicker:${name}`),
      ...(/export\s+interface\s+TripDateRange\b/.test(trip)
        ? []
        : ['tripDatePicker:TripDateRange']),
    ];
    expect(missing).toEqual([]);

    // 부정 — 옛 자리를 거쳐 가는 두 번째 import 경로를 만들지 않는다.
    const shims = [TRIP].flatMap((file) => {
      const source = read(file);
      return FOUR.filter((name) => reExportsSymbol(source, name)).map(
        (name) => `${rel(file)}:${name}`
      );
    });
    expect(shims).toEqual([]);
    expect(STAR_REEXPORT.test(trip)).toBe(false);
  });
});

/** 알려진 소비처 — 화면·페이지(Q1)와 기존 단위 테스트(AC-3, 단언은 그대로 두고 대상만 통합본). */
const CONSUMERS: { file: string; names: string[] }[] = [
  {
    file: 'features/trip/ui/PeriodEditSheet.tsx',
    names: ['daysInMonth', 'firstWeekdayOfMonth', 'isDateInRange'],
  },
  {
    file: 'pages/trip-new-step1/ui/TripNewStep1Page.tsx',
    names: ['shiftMonth'],
  },
  // TRIP-1052 — StayRegisterScreen·StayRegisterPage(달력 소멸)와 stayDates.test·stayCalendarMonth.test
  // (파일 삭제) 네 행이 빠졌다. 그 두 테스트 파일에 있던 monthGrid 케이스는 아래 파일로 옮겼다 —
  // 이 행이 "이관 파일이 실재하고 통합본에서 가져온다"를 잠근다(없으면 ENOENT red).
  {
    file: 'shared/date/monthGrid.property.test.ts',
    names: [
      'daysInMonth',
      'firstWeekdayOfMonth',
      'isDateInRange',
      'shiftMonth',
    ],
  },
  {
    file: 'features/trip/model/tripDatePicker.test.ts',
    names: [
      'daysInMonth',
      'firstWeekdayOfMonth',
      'isDateInRange',
      'shiftMonth',
    ],
  },
];

describe('🔴 G3 · 소비처(Q1·AC-3) — 네 함수는 @/shared/date/monthGrid 에서만 가져온다', () => {
  it('src 어디에서도 네 함수를 stayDates·tripDatePicker 에서 import 하지 않는다', () => {
    // 이 파일은 뺀다 — G0 샘플 문자열 속 import 를 진짜로 읽으면 거짓 red 가 난다.
    const files = collectSources(SRC_ROOT).filter(
      (file) => file !== __filename
    );

    const sites = files.flatMap((file) =>
      importsOf(read(file))
        .filter(({ specifier }) =>
          /(^|\/)(stayDates|tripDatePicker)$/.test(specifier)
        )
        .map((entry) => ({ file, ...entry }))
    );
    // 긍정 짝 — 옛 자리의 도메인 함수 import(isStayRangeValid·TripDateRange 등)는 계속 보인다.
    // 0건이면 파서가 눈먼 것이라 아래 부정 단언이 공짜로 통과한다.
    expect(sites.length).toBeGreaterThan(0);

    const offenders = sites.flatMap(({ file, names }) =>
      names
        .filter((name) => (FOUR as readonly string[]).includes(name))
        .map((name) => `${rel(file)}:${name}`)
    );
    expect(offenders).toEqual([]);
  });

  it.each(CONSUMERS)(
    '$file 가 필요한 함수를 @/shared/date/monthGrid 에서 가져온다',
    ({ file, names }) => {
      const fromGrid = importsOf(read(join(SRC_ROOT, file)))
        .filter(({ specifier }) => specifier === GRID_IMPORT)
        .flatMap((entry) => entry.names);
      expect(names.filter((name) => !fromGrid.includes(name))).toEqual([]);
    }
  );
});
