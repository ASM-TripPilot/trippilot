/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * TRIP-1042 — 꼭 갈 곳 고르기(d02 select) 지역 판정의 소스 가드.
 *
 * 무엇을 보장하나:
 *  - G1 페이지·화면에 **시도 이름 상수표가 없다**(TRIP-445 · 맹점 ②). 시도 짧은 이름은 서버 카탈로그
 *    (`useRegions` 의 SIDO 행) + `sidoKey` 규칙으로만 만든다. `regionMatch.ts` 는 `regionMatch.test.ts` 가
 *    이미 같은 축으로 훑으므로 여기서는 그 가드가 안 보는 두 파일만 본다.
 *  - G2 폐지된 폴백(TRIP-982 D6)의 prop·testID 가 두 파일 어디에도 남지 않는다(고아 정리).
 *  - G3 페이지가 판정·표기를 **PBT 로 잠근 순수 함수**(`regionCodeInTrip`·`placeLocationLabel`)로 한다 —
 *    인라인으로 다시 쓰면 `regionMatch.code.test.ts` 가 죽은 코드를 검증하게 된다.
 *
 * 커버하지 않는 것: 새 파일(예: `features/explore/model/sidoNames.ts`)에 상수표를 두는 우회 — 그 파일을
 * 페이지가 import 하는지까지는 보지 않는다(모집단을 두 파일로 좁힌 대가).
 */

const ROOT = path.resolve('src');
const PAGE_REL = 'pages/saved-places/ui/SavedPlacesPage.tsx';
const SCREEN_REL = 'features/explore/ui/MustVisitPickScreen.tsx';

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 블록 주석 → 줄 주석 순서로 걷는다. 줄 주석은 앞 글자가 `:` 이면 남긴다(`https://` 보존). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 시도 이름 조각 — `regionMatch.test.ts` 와 같은 탐지기. */
const SIDO_NAME_IN_SOURCE =
  /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;

const FALLBACK_NEEDLES = ['regionFallback', 'region-fallback'];

/** `import { a, b } from '@/features/trip/model/regionMatch'` 의 중괄호 안 이름들(여러 줄 import 포함). */
function namesImportedFromRegionMatch(source: string): string[] {
  const statement =
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@\/features\/trip\/model\/regionMatch'/g;
  return [...source.matchAll(statement)].flatMap((match) =>
    match[1]
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '')
  );
}

describe('TRIP-1042 G0 · 탐지기 자가검사 — 실제 문자열에 태워 본다', () => {
  it('주석 속 지역명·폴백 이름은 걷히고, 코드 속은 살아남으며, URL 과 여러 줄 import 가 온전하다', () => {
    const sample = [
      '// 서울특별시 → 서울, regionFallback 은 폐지', // 주석 → 걷힘
      '/* 부산 region-fallback */', // 블록 주석 → 걷힘
      "const FIXED = ['제주'];", // 코드 → 생존
      'const flag = regionFallback;', // 코드 → 생존
      "const url = 'https://example.com/a';", // URL 슬래시 보존
      'import {',
      '  placeLocationLabel,',
      '  regionCodeInTrip,',
      "} from '@/features/trip/model/regionMatch';",
    ].join('\n');

    const stripped = stripComments(sample);

    expect(stripped).not.toMatch(/서울|부산/);
    expect(stripped).toMatch(/제주/);
    expect(SIDO_NAME_IN_SOURCE.test(stripped)).toBe(true);
    expect(stripped).toMatch(/https:\/\/example\.com/);
    expect(
      FALLBACK_NEEDLES.filter((needle) => stripped.includes(needle))
    ).toEqual(['regionFallback']);
    expect(namesImportedFromRegionMatch(stripped).sort()).toEqual([
      'placeLocationLabel',
      'regionCodeInTrip',
    ]);
  });
});

describe('TRIP-1042 G1 · 페이지·화면에 시도 이름 상수표가 없다 (TRIP-445 · 맹점 ②)', () => {
  it('두 파일(주석 제외)에 시도 이름 조각이 0건이다', () => {
    const page = stripComments(read(PAGE_REL));
    const screenSource = stripComments(read(SCREEN_REL));

    // 긍정 짝 — 읽은 것이 정말 그 두 파일이다(빈 파일·다른 파일 공짜 통과 차단).
    expect(page).toContain('MustVisitPickScreen');
    expect(screenSource).toMatch(/export function MustVisitPickScreen\b/);

    expect(page).not.toMatch(SIDO_NAME_IN_SOURCE);
    expect(screenSource).not.toMatch(SIDO_NAME_IN_SOURCE);
  });
});

describe('🔴 TRIP-1042 G2 · 폐지된 폴백의 prop·testID 가 남지 않는다 (TRIP-982 D6 뒤집기)', () => {
  it('페이지·화면에 regionFallback·region-fallback 이 0건이고, 지역 밖 머리글은 그대로 있다', () => {
    const page = stripComments(read(PAGE_REL));
    const screenSource = stripComments(read(SCREEN_REL));

    // 긍정 짝 — 지역 밖 표면은 살아 있다(폴백과 함께 지워지면 안 된다).
    expect(screenSource).toContain('mustvisit-pick-region-outside');

    const offenders = [
      ...FALLBACK_NEEDLES.filter((needle) => page.includes(needle)).map(
        (needle) => `${PAGE_REL}: ${needle}`
      ),
      ...FALLBACK_NEEDLES.filter((needle) => screenSource.includes(needle)).map(
        (needle) => `${SCREEN_REL}: ${needle}`
      ),
    ];
    expect(offenders).toEqual([]);
  });
});

describe('🔴 TRIP-1042 G3 · 페이지가 판정·표기를 PBT 로 잠근 순수 함수로 한다', () => {
  it('페이지가 regionMatch 에서 regionCodeInTrip·placeLocationLabel 을 import 한다', () => {
    const page = stripComments(read(PAGE_REL));

    expect(namesImportedFromRegionMatch(page)).toEqual(
      expect.arrayContaining(['regionCodeInTrip', 'placeLocationLabel'])
    );
  });
});
