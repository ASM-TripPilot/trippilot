/**
 * @jest-environment node
 */
// TRIP-808 · AC-10 · INV-1·INV-3 — entities/trip 층 구조 가드(fs 소스 스캔). 806 place·807 stay 동형.
// entities 는 shared 만 참조하고 props-only(상태·라우터·query·store 0) 여야 한다. 카드가 이미지 URL 을
// 지어내면(INV-1) · 소요시간을 표시하면(INV-3) 여기서 잡힌다.
//
// ⚠️ trip 은 stay 와 같은 결이다 — Trip 계약에 사진 필드가 없어(브리프 §① h06) 카드 사진 자리는 항상
//    회색(h06 MyTripCard 는 `bg-surface-soft`, 807 stay 의 `surface-strong` 과 색 토큰만 다르다). 그래서
//    G4 긍정 짝을 `surface-soft`(회색 자리 실재)로 둔다. j07 PastTripRow 는 사진 자리 자체가 없다.
// ⚠️ 박수 라벨 `N박 M일`은 **일수지 소요시간이 아니다**(repo-traps INV-3 주). lib 이 그 라벨을 만들어도
//    INV-3 스캔(`/duration/i` 식별자)에는 안 걸린다(박·일에 duration 문자열 없음).
//
// 이 파일은 `pnpm test -- <경로>` 로 돈다(ESLint 미사용이라 NODE_OPTIONS 불필요).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const TRIP_DIR = path.join(ROOT, 'entities', 'trip');

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석 먼저(순서 바꾸면 한 줄 코드가 소실). 줄 주석은 **바로 앞이
 * `:` 면 주석으로 안 본다** — `'https://…'` 의 슬래시를 주석 시작으로 오인하지 않기 위함(문제로그
 * [[stripComments 가 URL 슬래시 오인]] 계열 회귀 방지). 807 entitiesStay* 에서 이 세션 실검증됨(§5-E).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 디렉토리를 재귀로 훑어 프로덕션 소스(.ts/.tsx, 테스트·generated 제외) 절대경로를 모은다. */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readScoped(dir: string): { file: string; source: string }[] {
  return listSourceFiles(dir).map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 소스 스캔이 의미를 갖는다', () => {
  it('주석 속 금칙어는 걷히고, 코드의 URL·자기참조·duration 은 살아남는다', () => {
    const sample = [
      '/** layer-entities.md: @/features/x 는 entities 가 못 본다. */',
      "// import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';",
      "import type { Trip } from '@/shared/api/generated/schemas';",
      "const doc = 'https://example.com/a//b';",
      "const bad = '@/features/trip/ui/Foo';",
      'const dwell = slotDuration;',
    ].join('\n');

    const s = stripComments(sample);

    // 주석 속 @/features 는 걷힌다.
    const commentLines = s.split('\n').slice(0, 2).join('\n');
    expect(/@\/features\//.test(commentLines)).toBe(false);
    // 코드의 @/features·URL·shared 는 살아남는다(콜론 뒤 `//` 는 주석 아님).
    expect(/@\/features\//.test(s)).toBe(true);
    expect(/https?:\/\//.test(s)).toBe(true);
    expect(s).toContain('@/shared/api/generated/schemas');
    // INV-3 는 substring `/duration/i` — `\bduration\b` 는 slotDuration 을 놓친다(807 ★9).
    expect(/duration/i.test(s)).toBe(true);
    expect(/\bduration\b/i.test(s)).toBe(false);
  });
});

describe('G1 · entities/trip 3세그먼트 대표 파일 실재(빈 층 공허 통과 차단)', () => {
  it('model·lib(포맷터 2벌)·ui 에 대표 파일이 있다', () => {
    expect(fs.existsSync(path.join(TRIP_DIR, 'model'))).toBe(true);
    // lib 은 도메인별 2파일(기간 포맷터 · 박수 포맷터, 01b 인터뷰 결정).
    expect(
      fs.existsSync(path.join(TRIP_DIR, 'lib', 'formatTripPeriod.ts'))
    ).toBe(true);
    expect(fs.existsSync(path.join(TRIP_DIR, 'lib', 'formatNights.ts'))).toBe(
      true
    );
    const uiFiles = listSourceFiles(path.join(TRIP_DIR, 'ui'));
    expect(uiFiles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('G2 · props-only — entities/trip 은 shared 만 참조한다(상태·라우터·query·store 0)', () => {
  it('금칙 import 0 + shared 참조 긍정 짝', () => {
    const sources = readScoped(TRIP_DIR);

    // 긍정 짝 — 모집단이 채워졌고 shared(타입 재수출 등)를 참조한다(빈 층이면 red).
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.some(({ source }) => source.includes('@/shared/'))).toBe(
      true
    );

    // 부정 — 역참조·상태·라우터·query·store·네트워크 금지.
    const FORBIDDEN = [
      { name: '@/features/', hit: (s: string) => s.includes('@/features/') },
      { name: 'expo-router', hit: (s: string) => s.includes('expo-router') },
      { name: 'zustand', hit: (s: string) => s.includes('zustand') },
      {
        name: '@tanstack/react-query',
        hit: (s: string) => s.includes('@tanstack/react-query'),
      },
      { name: 'axios', hit: (s: string) => /from ['"]axios['"]/.test(s) },
      {
        name: 'customInstance',
        hit: (s: string) => s.includes('customInstance'),
      },
      {
        name: 'query/mutation hook',
        hit: (s: string) =>
          /\buse(Get|Post|Put|Patch|Delete)[A-Z]\w*|\buse(Query|Mutation)\b/.test(
            s
          ),
      },
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      FORBIDDEN.filter((rule) => rule.hit(source)).map(
        (rule) => `${file}: ${rule.name}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('ui 카드는 로컬 상태를 갖지 않는다(useState·useReducer 0)', () => {
    const uiSources = readScoped(path.join(TRIP_DIR, 'ui'));

    // 긍정 짝 — ui 모집단이 실재.
    expect(uiSources.length).toBeGreaterThanOrEqual(1);

    const offenders = uiSources
      .filter(({ source }) => /\buseState\b|\buseReducer\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('G3 · INV-3 — entities/trip(ui·lib) 에 소요시간 표기 0(거리·기간만, 박수 라벨은 일수)', () => {
  it('duration 식별자 0 + 기간 포맷터 실재 긍정 짝', () => {
    const sources = [
      ...readScoped(path.join(TRIP_DIR, 'ui')),
      ...readScoped(path.join(TRIP_DIR, 'lib')),
    ];

    // 긍정 짝 — 기간 포맷터가 실재(빈 층 공허 통과 차단).
    expect(
      sources.some(({ source }) => source.includes('formatTripRange'))
    ).toBe(true);

    // 부정 — substring `/duration/i`(807 ★9, `\bduration\b` 는 slotDuration 을 놓친다).
    // `N박 M일` 은 일수라 여기 안 걸린다(박·일에 duration 문자열 없음, repo-traps INV-3 주).
    const offenders = sources
      .filter(({ source }) => /duration/i.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('G4 · INV-1 — 카드가 이미지 URL 을 지어내지 않는다(Trip 계약에 사진 필드 0 · 회색 자리)', () => {
  it('ui 소스에 외부 이미지 URL 리터럴 0 + 회색 자리(surface-soft) 긍정 짝', () => {
    const uiSources = readScoped(path.join(TRIP_DIR, 'ui'));

    // 긍정 짝 — h06 TripCard 사진 자리가 회색(Trip 계약에 이미지 필드가 없어 지어내지 않는다).
    // 807 stay 는 `surface-strong` 이었고 trip h06 는 `surface-soft`(MyTripCard 실측). j07 PastTripRow
    // 는 사진 자리 자체가 없어 이 긍정 짝은 TripCard 하나가 진다.
    expect(
      uiSources.some(({ source }) => source.includes('surface-soft'))
    ).toBe(true);

    // 부정 — 코드 리터럴 URL 0(주석 URL 은 stripComments 로 이미 걷힘, `://` 보존 후 코드만 스캔).
    const offenders = uiSources
      .filter(({ source }) => /https?:\/\//.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
