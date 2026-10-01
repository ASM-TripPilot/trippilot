/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1123 · AC-9 — 마이페이지 목록·CTA 를 걷어내며 생긴 고아가 남지 않는다(01 §6, 결정 2(b) 분기).
 *
 * 무엇을 보장하나:
 *  - 세그(`TripStatusSegment`)·여행 카드(`features/settings/ui/TripCard`)·마이 카드 컨테이너
 *    (`pages/my-page/ui/TripCardContainer`) 파일이 없다.
 *  - 옛 서버 status 사영(`tripStatusBucket`·`STATUS_BUCKET`)·CTA 글리프(`PlusGlyph`, settings 판)·빈 문구 표
 *    (`EMPTY_TEXT`)·세그/CTA 배선(`onChangeSegment`·`onPressCreateTrip`·`useTripWizardStore`·`byStartAsc`)이 소스에 없다.
 *  - 남는 것(지난 여행 `PastTripRow`·캘린더 ›)은 여기서 보지 않는다 — 동작은 `MyPage.counts.test.tsx` AC-8.
 *
 * 소스는 주석을 걷고 스캔한다(리포 관례, 줄 주석은 `:` 뒤 제외) — 설명 주석에 옛 이름이 남는 것은 허용한다.
 * 파일 목록·지도 갱신(`structure-index --write`·`--check`)은 [검증] 명령 몫이다.
 */

const SRC = path.resolve('src');

const GONE_FILES = [
  'features/settings/ui/TripStatusSegment.tsx',
  'features/settings/ui/TripCard.tsx',
  'pages/my-page/ui/TripCardContainer.tsx',
];

/** 파일별로 코드(주석 제외)에 남으면 안 되는 식별자. */
const GONE_SYMBOLS: Record<string, string[]> = {
  'features/settings/model/tripBuckets.ts': [
    'tripStatusBucket',
    'STATUS_BUCKET',
  ],
  'features/settings/ui/SettingsGlyphs.tsx': ['PlusGlyph'],
  'features/settings/ui/MyPageScreen.tsx': [
    'TripStatusSegment',
    'EMPTY_TEXT',
    'onChangeSegment',
    'onPressCreateTrip',
    'activeEmpty',
    'PlusGlyph',
  ],
  'pages/my-page/ui/MyPage.tsx': [
    'TripCardContainer',
    'useTripWizardStore',
    'onPressCreateTrip',
    'onChangeSegment',
    'byStartAsc',
  ],
};

/** 블록 주석 먼저 → 줄 주석(콜론 예외). 순서를 바꾸면 한 줄 안 코드가 소실된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function codeOf(rel: string): string {
  return stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'));
}

function hasIdentifier(code: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(code);
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석 속 이름은 걷히고, 코드 속 이름은 살아남는다(부분 이름은 안 걸린다)', () => {
    const sample = [
      '/** 옛 PlusGlyph 는 지웠다 */',
      '// EMPTY_TEXT 도',
      "const figma = 'https://example.com/x';",
      'export function PlusGlyphLarge() {}',
      'const onPressCreateTrip = () => {};',
    ].join('\n');

    const code = stripComments(sample);

    expect(hasIdentifier(code, 'PlusGlyph')).toBe(false); // 주석·더 긴 이름만
    expect(hasIdentifier(code, 'EMPTY_TEXT')).toBe(false); // 줄 주석
    expect(hasIdentifier(code, 'onPressCreateTrip')).toBe(true); // 코드
    expect(code).toContain("'https://example.com/x'"); // URL 은 안 잘린다
  });
});

describe('🔴 AC-9 · 고아 파일이 없다', () => {
  it.each(GONE_FILES)('%s 가 없다', (rel) => {
    // 앵커 — 경로 기준이 맞다(같은 폴더의 살아남는 파일은 있다).
    expect(
      fs.existsSync(path.join(SRC, 'features/settings/ui/ProfileCard.tsx'))
    ).toBe(true);
    expect(fs.existsSync(path.join(SRC, rel))).toBe(false);
  });
});

describe('🔴 AC-9 · 고아 심볼이 코드에 없다', () => {
  it.each(Object.entries(GONE_SYMBOLS))('%s', (rel, names) => {
    const code = codeOf(rel);
    // 앵커 — 실제 소스를 읽었다(빈 문자열 공허 통과 차단).
    expect(code.length).toBeGreaterThan(100);

    const left = names.filter((name) => hasIdentifier(code, name));
    expect(left).toEqual([]);
  });
});
