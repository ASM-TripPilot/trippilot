/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-445 지역 카탈로그 서버 연동 + '내 주변' 제거 — 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 렌더 단언과 사정거리가 다르다. 렌더 테스트는 "이번 렌더에서 나온 출력"만
 * 본다. 여기서는 **삭제됐어야 할 상수·import·배선이 소스에 남아 있는가**를 본다 — jest가
 * red로 못 잡는 "상수 잔존"·"내 주변 배선 잔존"을 이걸로 잠근다(AC-1·AC-7).
 *
 * 범위(D5): 스캔 대상은 **프로덕션 화면·모델·페이지**뿐이다. `_dev/preview.tsx`·
 * `exploreFixtures.ts`·`*.test.*`는 제외한다 — 서버 이름·프리뷰 픽스처엔 지역 이름 리터럴이
 * 정상으로 남는다.
 *
 * 전제 — 모든 스캔은 `stripComments`로 주석을 걷은 소스에 대고 한다. 걷지 않으면 머리말
 * 산문("'내 주변'을 제거한다")이 부정 단언을 대신 만족시키는 거짓 green을 낸다. 룩비하인드
 * `(^|[^:])//`는 `'https://…'`의 `//`를 주석으로 오인하지 않게 한다(02a §5-②).
 */

const ROOT = path.resolve('src');

const SCREEN_REL = 'features/explore/ui/RegionPickerScreen.tsx';
const PAGE_REL = 'pages/region-picker/ui/RegionPickerPage.tsx';
const WIZARD_PAGE_REL = 'pages/trip-new-step1/ui/TripNewStep1Page.tsx';
const MODEL_REL = 'features/explore/model/regions.ts';
const GLYPHS_REL = 'features/explore/ui/ExploreGlyphs.tsx';
const RESOLVE_NEARBY_REL = 'features/explore/model/resolveNearby.ts';

/** 지역 목록을 그리는 세 프로덕션 소비처 — 상수·내 주변 배선이 있으면 여기 있다. */
const CONSUMER_RELS = [SCREEN_REL, PAGE_REL, WIZARD_PAGE_REL];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/** 소비처 소스를 (파일, 가공소스) 쌍으로. */
function consumerSources(): { file: string; source: string }[] {
  return CONSUMER_RELS.map((rel) => ({ file: rel, source: read(rel) }));
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석의 금칙어는 걷히고, 코드의 lat/lng·resolveNearby·URL은 살아남는다', () => {
    const sample = [
      '// 내 주변 진입 — REGIONS 상수 제거 대상',
      'router.push(`/stays?lat=${result.lat}&lng=${result.lng}`);',
      'const nearby = resolveNearby(deps);',
      "const url = 'https://example.com/x'; // 주석",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석으로 적은 금칙어는 안 걸린다 — 걷지 않으면 머리말이 스스로 red 를 낸다.
    expect(stripped).not.toContain('제거 대상');
    // ② ★ 코드의 lat/lng push·resolveNearby·URL 은 **살아남아야** 부정 스캔이 유효하다.
    expect(stripped).toContain('lat=${result.lat}&lng=${result.lng}');
    expect(stripped).toContain('resolveNearby(deps)');
    expect(stripped).toContain("'https://example.com/x'");
  });
});

describe('AC-1 · 프로덕션 소비처에 지역 이름 상수·닫힌 tint 가 없다', () => {
  it('세 소비처에 REGIONS·RegionCode·REGION_TINT 가 0건이고, 서버 전환 증거가 있다', () => {
    const sources = consumerSources();

    // 부정 — 하드코딩 상수·닫힌 tint Record 는 서버 전환으로 사라져야 한다.
    // (대소문자 구분: 서버 필드 `regionCode`·prop `regions` 는 정당하므로 안 잡는다.)
    const offenders = sources.flatMap(({ file, source }) =>
      [/\bREGIONS\b/, /\bRegionCode\b/, /\bREGION_TINT\b/]
        .filter((re) => re.test(source))
        .map((re) => `${file}: ${re}`)
    );
    expect(offenders).toEqual([]);

    // 긍정 짝 — 서버로 전환한 증거(해시 tint·서버 조회)가 실제로 있다. 공허 통과 방지.
    const union = sources.map(({ source }) => source).join('\n');
    expect(union).toContain('regionTint');
    expect(union).toContain('useRegions');
  });
});

describe('AC-1(모델) · regions.ts 가 새 API 를 노출하고 구 상수를 지운다', () => {
  it('useRegions·regionTint·filterRegions 가 있고, REGIONS 상수·RegionCode 유니온이 없다', () => {
    const source = read(MODEL_REL);

    // 긍정 — 새 API 실재.
    expect(source).toContain('useRegions');
    expect(source).toContain('regionTint');
    expect(source).toContain('filterRegions');

    // 부정 — 구 상수·유니온 삭제(⚠️ 02a ★1: greening 이 동결·형제 위저드 테스트 6개를
    // 강제한다 — 게이트 결정 대상).
    expect(/export\s+const\s+REGIONS\b/.test(source)).toBe(false);
    expect(/\bRegionCode\b/.test(source)).toBe(false);
  });
});

describe('AC-4 · 두 소비처가 같은 useRegions 출처를 문다', () => {
  it('RegionPickerPage 와 TripNewStep1Page 둘 다 useRegions 를 참조하고 REGIONS 를 안 문다', () => {
    const page = read(PAGE_REL);
    const wizard = read(WIZARD_PAGE_REL);

    expect(page).toContain('useRegions');
    expect(wizard).toContain('useRegions');
    expect(/\bREGIONS\b/.test(page)).toBe(false);
    expect(/\bREGIONS\b/.test(wizard)).toBe(false);
  });
});

describe("AC-7 · '내 주변' 배선이 소스에서 사라졌다", () => {
  it('세 소비처에 내 주변 판정·배선·testID 가 0건이다', () => {
    const sources = consumerSources();

    const NEARBY_NEEDLES = [
      'resolveNearby',
      'onSelectNearby',
      'NearbyState',
      'firstConfirmedSavedStayCoords',
      'explore-region-nearby',
      '/stays?lat=',
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      NEARBY_NEEDLES.filter((needle) => source.includes(needle)).map(
        (needle) => `${file}: ${needle}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('resolveNearby.ts 파일이 삭제됐고, NearbyPinGlyph 고아가 제거됐다', () => {
    // 판정 본체 파일 자체가 사라졌다(+ 그 테스트도).
    expect(fs.existsSync(path.join(ROOT, RESOLVE_NEARBY_REL))).toBe(false);
    // 자기 변경이 만든 고아(NearbyPinGlyph)를 함께 지웠다 — 사용처가 RegionPicker 하나뿐이었다.
    expect(read(GLYPHS_REL)).not.toContain('NearbyPinGlyph');
  });
});

describe('구조가드 · 서버 응답 순서를 화면이 재정렬하지 않는다', () => {
  it('세 소비처에 .sort( 가 0건이다 (서버가 시도→층→이름 순 보장)', () => {
    // 선례 staySearchStructure — 지금은 없지만 미래에 붙는 재정렬을 잠근다(선제 green).
    const offenders = consumerSources()
      .filter(({ source }) => source.includes('.sort('))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
