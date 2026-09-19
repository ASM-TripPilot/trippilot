import type { ComponentType } from 'react';
import type { ViewStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * TRIP-641 파트 2 — dev 정적 프리뷰(`_dev/preview.tsx`)의 밴드 2단 네비.
 *
 * 무엇을 보장하나:
 *  (1) AC-6 — 170개 프리뷰 상태가 전부 Figma 밴드(10종) 하나로 분류되고, 그룹핑해도 하나도
 *      드롭되지 않는다(대규모 기계 편집의 누락 위험을 순수 데이터로 잠근다),
 *  (2) AC-1 — 상단에 first-cut 9개 밴드 버튼이 서고, 밴드를 누르면 그 밴드 칩 그룹만 "보이고"
 *      나머지 밴드 그룹은 "접힌다"(시각적 필터),
 *  (3) AC-2 — 밴드 선택 후 칩을 누르면 기존처럼 실화면이 그려진다,
 *  (4) AC-3 — 딥링크(`?state=`)로 열면 그 상태의 화면 + 그 밴드가 자동 선택된다.
 *
 * ★ show-not-mount 계약(00 메모·01b 시드): 비선택 밴드 칩은 **트리에서 언마운트하지 않고**
 * 시각적으로만 접는다. 접힘 스타일은 `display:'none'` 금지 — RNTL v13 은 `display:'none'`
 * 만 쿼리에서 제외하고 `width:0`/`height:0`/`overflow:'hidden'` 은 findable 로 남긴다
 * (node_modules 실측 + 샌드박스 1회 실행으로 확인, 02a §실검증). 그래서 접힌 밴드의 칩도
 * `getByTestId`/`fireEvent.press` 가 그대로 동작 → 동결·형제 프리뷰 7스위트가 무수정 green(AC-4).
 *
 * 접힘/보임을 jest 가 관찰하는 신호: 밴드 그룹 래퍼 View 의 인라인 `style`. `toHaveStyle` 은
 * StyleSheet.flatten 후 **부분집합** 비교라(node_modules 실측), 접힌 그룹은
 * `{width:0,height:0,overflow:'hidden'}` 를 갖고 보임 그룹은 안 갖는다.
 *
 * 목킹 규약은 형제 `devPreviewMap`/`devPreviewDeepLink` 를 그대로 따른다(지뢰 목 포함).
 */

// 딥링크 쿼리(`?state=X`)를 흉내내는 홀더 — `mock` 접두라 jest.mock 팩토리 안에서 참조 가능.
const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 네이티브 런타임 의존을 통과 컴포넌트로 목킹(수동 목: __mocks__/*) — 동결 devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 네트워크 계층을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '밴드 네비 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const previewModule = require('@/app/_dev/preview');
const DevPreview = previewModule.default as ComponentType;
// AC-6 순수 데이터 단언용 — 구현자가 `export` 로 열어야 한다(현재 미export → 이 배열은 undefined
// → 데이터 스위트가 red 로 뜨는 것이 구현 전 정상 상태).
const PREVIEW_STATES = previewModule.PREVIEW_STATES as {
  key: string;
  label: string;
  band: string;
}[];

// TRIP-742 AC-6 순수 데이터 단언용 — g01 '꼭 갈 곳' 스트립 픽스처. `PREVIEW_STATES` 선례와
// 동형으로 구현자가 `export` 로 열어야 한다(현재 미export → undefined → AC-6 데이터 단언이 red).
const MUST_VISIT_THUMBNAILS = previewModule.MUST_VISIT_THUMBNAILS as
  { name: string; region: string }[] | undefined;

// figma-structure.md first-cut 9밴드 + 프레임 없는 발명 화면용 '기타'.
const ALLOWED_BANDS = ['a', 'c', 'd', 'e', 'g', 'h', 'i', 'j', 'l', '기타'];
const FIRST_CUT_BANDS = ['a', 'c', 'd', 'e', 'g', 'h', 'i', 'j', 'l'];

// 비선택 밴드 그룹의 접힘 스타일 계약(★ show-not-mount): display:none 아님.
const COLLAPSED_STYLE: ViewStyle = {
  width: 0,
  height: 0,
  overflow: 'hidden',
};

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('AC-6 · 밴드 데이터 무결성 (순수 데이터)', () => {
  it('170개 엔트리가 전부 10종 밴드 중 하나를 갖고, 그룹핑해도 하나도 드롭되지 않는다', () => {
    // 준비 — 렌더 없이 모듈의 PREVIEW_STATES 배열을 그대로 읽는다.
    // 단언 ① — 대규모 기계 편집에서 엔트리가 하나도 안 빠졌다(실측 166개, TRIP-649로 saved-places-empty +1).
    // ⚠️ TRIP-665: 신 default 재작성으로 제거된 화면 prop 을 쓰던 g01 프리뷰 키 3개
    //    (`trip-new-step1-search-empty`·`-datesheet`·`-prefsheet`)를 삭제해 166→163.
    // ⚠️ TRIP-666: 여행지 편집 시트 프리뷰 키(`trip-new-step1-destination-sheet`) 추가로 163→164.
    // ⚠️ TRIP-667: 기간 편집 시트 프리뷰 키(`trip-new-step1-period-sheet`) 추가로 164→165.
    // ⚠️ TRIP-668: 동행 편집 시트 프리뷰 키(`trip-new-step1-companion-sheet`) 추가로 165→166.
    // ⚠️ TRIP-669: 취향 편집 시트 프리뷰 키(`trip-new-step1-pref-sheet`) 추가로 166→167.
    // ⚠️ TRIP-670: 예산 편집 시트 프리뷰 키(`trip-new-step1-budget-sheet`, band `g`) 추가로 167→168.
    // ⚠️ TRIP-671: g01 empty·loading 프리뷰 키 2개(`trip-new-step1-empty`·`trip-new-step1-loading`,
    //    band `g`) 추가로 168→170.
    //    test-designer 선반영(브리프 맹점④ — S2~S5 implementer 4연속 손편집 종료). implementer 는
    //    `preview.tsx` 에 그 키들을 추가할 뿐 이 가드는 만지지 않는다(추가 전엔 168개라 이 단언이 red).
    // ⚠️ TRIP-672: g02 default 재작성으로 옛 개념(후보/coverage/blocked/fixSheet)을 쓰던 프리뷰
    //    키 11개를 신 계약 5개(`trip-new-step2-{default,no-stay,loading,error,notrip}`)로 줄여
    //    170→164. TRIP-665(g01 default 재작성으로 키 3개 삭제 166→163)와 동형 — 프리뷰 키에서
    //    제거된 화면 prop 이 사라지면서 총계가 준다.
    // ⚠️ TRIP-673: g02 숙소 선택 시트 프리뷰 키(`trip-new-step2-staysheet`, band `g`) 추가로
    //    164→165. TRIP-666~671 시트 키 추가와 동형 — 신 프리뷰 키 1개가 총계를 1 늘린다.
    // ⚠️ TRIP-674: g02 empty 얼굴 신설로 `trip-new-step2-empty`(band `g`) 1키 추가 165→166.
    //    `-loading` 은 신 스켈레톤으로 정합될 뿐(키 이미 존재)이라 총계 불변 — empty 만 +1.
    //    test-designer 선반영(D4) — implementer 는 preview.tsx 에 `-empty` 키만 추가하고 이 가드는
    //    안 만진다(추가 전엔 165개라 이 단언이 red).
    // ⚠️ TRIP-676: S12 꼭 갈 곳 전용 목록 프리뷰 키 2개(`trip-new-mustvisit-list`·`-empty`, band `g`)
    //    추가로 166→168. test-designer 선반영(S8·S9 놓침 재발 방지 관례) — implementer 는 preview.tsx 에
    //    두 키(render: <MustVisitListScreen …/>, 순수 뷰 import)만 추가하고 이 가드는 안 만진다
    //    (추가 전엔 166개라 이 단언이 red).
    // ⚠️ TRIP-783: h08 지도+시트 셸 접힘 프리뷰 키(`h08-draft-collapsed`, band `h`) 추가로 168→169.
    //    test-designer 가 이 데이터 미러 가드(카운트)를 선반영하지 못해 implementer 가 preview.tsx 에
    //    키를 추가하며 함께 갱신(devPreviewBandSort EXPECTED_H 도 동반 — 문제로그 계열, 03 에 HONEST 신고).
    // ⚠️ TRIP-734: g01 저장 실패 배너 전용 프리뷰 키(`trip-new-step1-save-error`, band `g`) 추가로
    //    169→170. test-designer 선반영(카운트 가드만) — implementer 는 preview.tsx 에 키만 추가하고
    //    이 가드는 안 만진다(추가 전엔 169개라 이 단언이 red). devPreviewBandSort 는 밴드 h·l 만 잠가
    //    band g 와 무관(추가 갱신 불필요).
    // ⚠️ TRIP-743: g03 꼭 갈 곳 전용 목록 화면 제거로 프리뷰 키 2개(`trip-new-mustvisit-list`·`-empty`,
    //    band `g`)를 삭제해 170→168. test-designer 선반영(카운트 가드만) — implementer 는 preview.tsx 에서
    //    두 키 + `MustVisitListScreen` import 를 지울 뿐 이 가드는 안 만진다(삭제 전엔 170개라 이 단언이 red).
    //    devPreviewBandSort 는 밴드 h·l 만 잠가 band g 와 무관(오갱신 금지, 맹점③).
    // ⚠️ TRIP-742: g 밴드 프리뷰 키 4개 삭제(`trip-new-step1-no-saved`·`trip-new-step2-no-stay`·
    //    `trip-new-step2-error`·`trip-new-step2-notrip`)로 168→164. test-designer 선반영(카운트 가드만) —
    //    implementer 는 preview.tsx 에서 그 4키만 지울 뿐 이 가드는 안 만진다(삭제 전엔 168개라 이 단언이 red).
    //    INV-4: 삭제는 프리뷰 배선뿐 — 폴백 얼굴(TripWizardStep2Screen variant error/notrip)은 코드로 남는다.
    //    devPreviewBandSort 는 밴드 h·l 만 잠가 band g 와 무관(오갱신 금지).
    // ⚠️ TRIP-701: a01 프리뷰 정리로 홈 프리뷰 키 4개(no-trip·empty·collecting·upcoming 얼굴,
    //    band a) 삭제로 164→160. test-designer 선반영(카운트 가드만) — implementer 는
    //    preview.tsx 에서 그 4키만 지울 뿐 이 가드는 안 만진다(삭제 전엔 164개라 이 단언이 red).
    //    devPreviewBandSort 는 밴드 h·l 만 잠가 band a 와 무관(오갱신 금지).
    // ⚠️ TRIP-695: a01 담은 곳 메뉴 배지 프리뷰 3키(`home-saved-menu`·`-badge`·`-badge-99`,
    //    band a) 추가로 160→163. test-designer 02a 선반영(카운트 가드만) — implementer 는
    //    preview.tsx 에 세 키만 추가하고 이 가드는 안 만진다(추가 전엔 160개라 이 단언이 red).
    //    티켓의 "168→171"·"171" 은 stale(TRIP-701 이 프리뷰 4키를 삭제해 실측 160 → 163 이 정답).
    //    devPreviewBandSort 는 밴드 h·l 만 잠가 band a 와 무관(오갱신 금지).
    // ⚠️ TRIP-697: a01 '여행 중' 얼굴 프리뷰 키(`home-traveling`, band a) 추가로 163→164.
    //    test-designer 02a 선반영(카운트 가드만, traps-shell 관례) — implementer 는 preview.tsx 에
    //    `home-traveling` 키(HOME_TRAVELING_PROPS 렌더) 하나만 추가하고 이 가드는 안 만진다(추가 전엔
    //    163개라 이 단언이 red). devPreviewBandSort 는 밴드 h·l 만 잠가 band a 와 무관(오갱신 금지).
    // ⚠️ TRIP-700: a02 매거진 목록 프리뷰 키(`magazine-default`, band a) 추가로 164→165.
    //    test-designer 02a 선반영(카운트 가드만, traps-shell 관례) — implementer 는 preview.tsx 에
    //    `magazine-default` 키(MAGAZINE_DEFAULT_PROPS 를 withShellTabBar 로 렌더) 하나만 추가하고
    //    이 가드는 안 만진다(추가 전엔 164개라 이 단언이 red). 티켓의 "168→171"·"171" 은 stale
    //    (TRIP-697 이 home-traveling 을 더해 실측 164 → 165 가 정답). devPreviewBandSort 는 밴드
    //    h·l 만 잠가 band a 와 무관(오갱신 금지).
    // ⚠️ TRIP-717: c08 거부 안내 카드형 복귀로 `onboarding-location-denied-dismissed` 키 1개
    //    삭제(× 닫힘 상태 프리뷰가 소멸 — 카드는 항상 떠 닫기 없음) 165→164. devPreviewBandSort 는
    //    밴드 h·l 만 잠가 band c 와 무관(오갱신 금지).
    // ⚠️ TRIP-722: c밴드 프리뷰 정리로 키 3개(`splash-loading`·`onboarding-terms-agreed`·
    //    `onboarding-nickname-taken`) 삭제로 164→161(-denied-dismissed 는 TRIP-717 에서 이미 삭제).
    //    login-cancelled·login-age-restriction 은 결정 확정(TRIP-720·721)대로 유지. devPreviewBandSort 는
    //    밴드 h·l 만 잠가 band c 와 무관(오갱신 금지).
    // ⚠️ TRIP-704: d01 랜딩 loading 프리뷰 키(`explore-landing-loading`, band `d`) 추가로
    //    161→162. 오케 직접(경량) — preview.tsx 에 키 하나 추가하며 이 가드도 함께 올림.
    //    devPreviewBandSort 는 밴드 h·l 만 잠가 band d 와 무관(오갱신 금지).
    // ⚠️ TRIP-705: d02 담은 장소 loading 프리뷰 키(`saved-places-loading`, band `d`) 추가로
    //    162→163. `saved-places-results`→`saved-places-default` 개명은 총계 중립(키 수 불변).
    // ⚠️ TRIP-711: d 프리뷰 정리 — 키 3개(`saved-places-released`·`explore-landing-empty-bridge`·
    //    `explore-landing-stay-error`) 삭제로 163→160(G5, 화면 코드는 유지·키만 삭제).
    //    ★배치 잔여: d 밴드 최종 13키(D절)는 706(d02 select 4)·709(d05)·710(d06)이 이 배치에 없어
    //    미완 — 현재 d 밴드 7키. 그 3티켓 완료 후 별도로 13키 완결·라벨 검수(711 재개).
    expect(PREVIEW_STATES).toHaveLength(160);

    // 단언 ② — 모든 엔트리의 band 가 허용 10종 안이다(허용 밖 band 는 그룹핑에서 드롭된다).
    const offenders = PREVIEW_STATES.filter(
      (state) => !ALLOWED_BANDS.includes(state.band)
    ).map((state) => state.key);
    expect(offenders).toEqual([]);

    // 단언 ③ — 밴드별로 그룹핑해 합치면 전체 key 집합과 정확히 같다(누락·드롭 0).
    const groupedKeys = ALLOWED_BANDS.flatMap((band) =>
      PREVIEW_STATES.filter((state) => state.band === band).map(
        (state) => state.key
      )
    );
    const allKeys = PREVIEW_STATES.map((state) => state.key);
    expect(new Set(groupedKeys)).toEqual(new Set(allKeys));
    expect(groupedKeys).toHaveLength(allKeys.length);
  });
});

describe('TRIP-711 · d밴드 프리뷰 키 3개 삭제 (band d)', () => {
  it('삭제 3키가 없고, 형제 d키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 삭제 대상 3키는 사라진다(삭제 전엔 present 라 red). 카운트(160)만으론 "아무 3키나
    // 지워도" 통과하므로, 이 짝이 '지운 게 정확히 그 3키'임을 못박는다(TRIP-722/742 패턴 미러).
    expect(keys).not.toContain('saved-places-released');
    expect(keys).not.toContain('explore-landing-empty-bridge');
    expect(keys).not.toContain('explore-landing-stay-error');

    // 긍정 — 형제 d키는 살아 있다(공허 통과 방지: 위 부정이 "d밴드가 통째로 비어서" 참이 아님).
    expect(keys).toContain('explore-landing-default');
    expect(keys).toContain('explore-landing-loading');
    expect(keys).toContain('saved-places-default');
    expect(keys).toContain('saved-places-loading');
    expect(keys).toContain('saved-places-empty');
    expect(keys).toContain('region-picker-default');
    expect(keys).toContain('places-default');
  });
});

describe('TRIP-722 · c밴드 프리뷰 키 3개 삭제 (band c)', () => {
  it('삭제 3키가 없고, 결정상 유지 키와 형제 c키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 삭제 대상 3키는 사라진다(삭제 전엔 present 라 red). 카운트(161)만으론 "아무 3키나
    // 지워도" 통과하므로, 이 짝이 '지운 게 정확히 그 3키'임을 못박는다(TRIP-742 AC-1 패턴 미러).
    expect(keys).not.toContain('splash-loading');
    expect(keys).not.toContain('onboarding-terms-agreed');
    expect(keys).not.toContain('onboarding-nickname-taken');
    // 긍정 짝 ① — 결정 확정(TRIP-720·721)대로 유지되는 두 키는 그대로(과잉 삭제 차단).
    expect(keys).toContain('login-cancelled');
    expect(keys).toContain('login-age-restriction');
    // 긍정 짝 ② — 같은 화면의 default 형제 키는 그대로(공허 통과·과잉 삭제 차단).
    expect(keys).toContain('splash');
    expect(keys).toContain('onboarding-terms-default');
    expect(keys).toContain('onboarding-nickname-default');
  });
});

describe('🔴 TRIP-695 AC-5 · 담은 곳 메뉴 배지 프리뷰 3키 (band a)', () => {
  it('키 집합에 home-saved-menu·-badge·-badge-99 가 있고 형제 band a 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — 세 키는 implementer 가 preview.tsx 에 추가하기 전엔 없다.
    expect(keys).toContain('home-saved-menu'); // open, 0/0(무배지)
    expect(keys).toContain('home-saved-menu-badge'); // 7/3
    expect(keys).toContain('home-saved-menu-badge-99'); // 100(→99+)/24

    // 형제 band a 앵커 — 기존 홈 키가 딸려 사라지지 않았음을 못박는다.
    expect(keys).toContain('home-default');
  });
});

describe('🔴 TRIP-697 AC-5 · 여행 중 얼굴 프리뷰 키 (band a)', () => {
  it('키 집합에 home-traveling 이 있고 형제 band a 홈 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — home-traveling 은 implementer 가 preview.tsx 에 추가하기 전엔 없다(band a,
    // HOME_TRAVELING_PROPS 렌더). 카운트(164)만으론 "아무 키나 1개 추가해도" 통과하므로 이 단언이
    // '추가된 키가 home-traveling'임을 못박는다(맹점 방지, TRIP-695 3키 describe 미러).
    expect(keys).toContain('home-traveling');

    // 형제 band a 앵커 — 기존 홈 계획 중 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('home-planning');
    expect(keys).toContain('home-default');
  });
});

describe('🔴 TRIP-700 AC-9 · 매거진 목록 프리뷰 키 (band a)', () => {
  it('키 집합에 magazine-default 가 있고 형제 band a 홈 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — magazine-default 는 implementer 가 preview.tsx 에 추가하기 전엔 없다(band a,
    // MAGAZINE_DEFAULT_PROPS 렌더). 카운트(165)만으론 "아무 키나 1개 추가해도" 통과하므로 이
    // 단언이 '추가된 키가 magazine-default'임을 못박는다(TRIP-697 home-traveling describe 미러).
    expect(keys).toContain('magazine-default');

    // 형제 band a 앵커 — 기존 홈 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('home-default');
  });
});

describe('TRIP-732 AC-11 · g01 프리뷰 키 개명 (-seeded → -default)', () => {
  it('키 집합에 trip-new-step1-default 가 있고 trip-new-step1-seeded 는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 개명은 엔트리 **수**를 안 바꾼다(위 AC-6 의 169 무변경) — 이름만 바뀐다.
    expect(keys).toContain('trip-new-step1-default');
    expect(keys).not.toContain('trip-new-step1-seeded');
  });
});

describe('TRIP-743 AC-4 · g03 프리뷰 키 제거 (band g)', () => {
  it('키 집합에 trip-new-mustvisit-list·-empty 가 없고, 형제 band g 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — g03 전용 목록 두 키는 사라진다(삭제 전엔 present 라 red). 카운트(168)만으론
    // "아무 두 키나 지워도" 통과하므로, 이 단언이 '지운 두 키가 g03 키'임을 못박는다(맹점③).
    expect(keys).not.toContain('trip-new-mustvisit-list');
    expect(keys).not.toContain('trip-new-mustvisit-empty');
    // 긍정 짝 — 같은 band g 형제 키는 그대로(빈/과잉 삭제 오구현 차단, 공허 통과 방지).
    expect(keys).toContain('trip-new-step1-default');
  });
});

describe('TRIP-742 AC-1 · g 밴드 프리뷰 키 4개 삭제 (band g)', () => {
  it('삭제 대상 4키가 없고, 형제 default 키(step1·step2)는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 삭제 대상 4키는 사라진다(삭제 전엔 present 라 red). 카운트(164)만으론 "아무 4키나
    // 지워도" 통과하므로, 이 짝이 '지운 게 정확히 그 4키'임을 못박는다(TRIP-743 AC-4 패턴 미러).
    expect(keys).not.toContain('trip-new-step1-no-saved');
    expect(keys).not.toContain('trip-new-step2-no-stay');
    expect(keys).not.toContain('trip-new-step2-error');
    expect(keys).not.toContain('trip-new-step2-notrip');
    // 긍정 짝 — 같은 화면(step1·step2)의 default 형제 키는 그대로(과잉 삭제·공허 통과 차단).
    expect(keys).toContain('trip-new-step1-default');
    expect(keys).toContain('trip-new-step2-default');
  });
});

describe('TRIP-742 AC-3 · g 밴드 라벨 규약 개정 (gNN · 화면명 상태)', () => {
  // 목표 라벨(브리프 AC-3 표) — 7키. 모두 ' · ' 구분자 + g0N 접두를 유지하므로 devPreviewBandSort
  // AC-1(접두 /^[a-l]\d{2}/) 은 계속 green(그 파일은 band h·l 만 잠가 band g 라벨 문자열엔 무관).
  const TARGET_LABELS: Record<string, string> = {
    'trip-new-step1-default': 'g01 · 여행 만들기 default',
    'trip-new-step1-empty': 'g01 · 여행 만들기 empty',
    'trip-new-step1-loading': 'g01 · 여행 만들기 loading',
    'trip-new-step1-save-error': 'g01 · 여행 만들기 save-error',
    'trip-new-step2-default': 'g02 · 거점 숙소 default',
    'trip-new-step2-loading': 'g02 · 거점 숙소 loading',
    'trip-new-step2-empty': 'g02 · 거점 숙소 empty',
  };

  it('7개 키의 라벨이 목표 문자열과 정확히 일치한다', () => {
    // 준비 — key→label 맵을 만들고, 7키의 실제 라벨만 추린다.
    const labelByKey = new Map(
      PREVIEW_STATES.map((state) => [state.key, state.label])
    );
    const actualLabels = Object.fromEntries(
      Object.keys(TARGET_LABELS).map((key) => [key, labelByKey.get(key)])
    );

    // 단언 — 7키 라벨이 목표와 완전일치(개정 전 라벨 `g01 · 만들기 1/2 …` 등이라 전부 red, 단일 diff).
    expect(actualLabels).toEqual(TARGET_LABELS);
  });
});

describe('TRIP-742 AC-6 · g01 꼭 갈 곳 픽스처 Figma 정합 (3742:2068)', () => {
  // Figma 6장 이름·구(01b 시드, 좌→우 스트립 렌더 순서). 사진(imageUrl)은 jest 스텁 .uri=undefined
  // 라 구조 심판 밖(6-b 육안) — 여기선 이름·구·개수·순서만 잠근다.
  const FIGMA_MUST_VISITS = [
    { name: '감천문화마을', region: '사하구' },
    { name: '광안리 해변', region: '수영구' },
    { name: '전포 카페거리', region: '부산진구' },
    { name: '해운대 해변', region: '해운대구' },
    { name: '해동용궁사', region: '기장군' },
    { name: '자갈치 시장', region: '중구' },
  ];

  it('MUST_VISIT_THUMBNAILS 가 Figma 6장(이름·구)과 순서까지 일치한다', () => {
    // 준비/실행 — 모듈 export 를 읽어 {name, region} 만 뽑는다(imageUrl 은 안 본다).
    // 구현 전엔 미export → undefined → `?? []` → 아래 두 단언이 clean red(크래시 아님).
    const actual = (MUST_VISIT_THUMBNAILS ?? []).map((item) => ({
      name: item.name,
      region: item.region,
    }));

    // 단언 ① — 개수 6(옛 픽스처 7장에서 순감 + 7번째 발명 금지, INV-1).
    expect(MUST_VISIT_THUMBNAILS ?? []).toHaveLength(6);
    // 단언 ② — 이름·구가 Figma 6장과 순서까지 완전일치(옛 이름 광안리해수욕장·태종대·흰여울문화마을·
    //          송정해수욕장 소멸 + 해운대 해변·자갈치 시장 편입을 한 번에 못박음).
    expect(actual).toEqual(FIGMA_MUST_VISITS);
  });
});

describe('AC-1 · 밴드 버튼 줄 + 밴드별 칩 필터', () => {
  it('first-cut 9개 밴드 버튼이 모두 렌더된다', () => {
    // 준비/실행 — 프리뷰 루트 렌더.
    render(<DevPreview />);

    // 단언 — a·c·d·e·g·h·i·j·l 9개 밴드 버튼이 트리에 있다(2단 네비 상단 줄).
    FIRST_CUT_BANDS.forEach((band) => {
      expect(screen.getByTestId(`dev-preview-band-${band}`)).toBeOnTheScreen();
    });
  });

  it('밴드 a 를 누르면 a밴드 그룹은 보이고 c밴드 그룹은 접힌다 — 칩은 양쪽 다 트리에 남는다', () => {
    // 준비 — 렌더(기본 밴드 c).
    render(<DevPreview />);

    // 실행 — 밴드 a 버튼을 누른다.
    fireEvent.press(screen.getByTestId('dev-preview-band-a'));

    // 단언 ① — a 그룹은 접힘 스타일이 아니다(=보임).
    expect(screen.getByTestId('dev-preview-band-group-a')).not.toHaveStyle({
      width: 0,
    });
    // 단언 ② — c 그룹은 접힘 스타일이다(=시각적으로 감춤).
    expect(screen.getByTestId('dev-preview-band-group-c')).toHaveStyle(
      COLLAPSED_STYLE
    );
    // 단언 ③ — 접힌 c밴드의 칩도 여전히 findable 하다(접힘 ≠ 언마운트, AC-4 의 근거).
    expect(
      screen.getByTestId('dev-preview-state-login-idle')
    ).toBeOnTheScreen();
  });
});

describe('AC-2 · 밴드 선택 → 칩 press → 실화면 렌더', () => {
  it('밴드 a 선택 후 home-default 칩을 누르면 홈 컬렉션 카드가 그려진다', () => {
    // 준비 — 렌더(기본 밴드 c, home-default 는 a밴드라 접힌 그룹 안).
    render(<DevPreview />);

    // 실행 — 밴드 a 로 전환 후 그 안의 home-default 칩을 누른다.
    fireEvent.press(screen.getByTestId('dev-preview-band-a'));
    fireEvent.press(screen.getByTestId('dev-preview-state-home-default'));

    // 단언 — 실물 홈 화면의 컬렉션 카드가 그려진다(기존 토글 동작 보존).
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
  });
});

describe('AC-3 · 딥링크 초기 밴드 자동선택 (폴백 함수 재사용)', () => {
  it('딥링크 없이 열면 기본 밴드가 c 다 — splash→c, resolveInitialStateKey 재사용', () => {
    // 준비/실행 — state 없이 렌더(폴백 = splash).
    render(<DevPreview />);

    // 단언 — c 그룹 보임 · a 그룹 접힘. 초기 selectedBand 가 band(resolveInitialStateKey(undefined))
    // = band('splash') = 'c' 임을 확인(하드코딩 초기값이면 실패).
    expect(screen.getByTestId('dev-preview-band-group-c')).not.toHaveStyle({
      width: 0,
    });
    expect(screen.getByTestId('dev-preview-band-group-a')).toHaveStyle(
      COLLAPSED_STYLE
    );
  });

  it('state=home-default(a밴드) 딥링크로 열면 홈 화면 + a밴드 자동선택', () => {
    // 준비 — 딥링크 쿼리를 a밴드 키로 세팅.
    mockSearchParams.state = 'home-default';

    // 실행 — 렌더(토글 안 누름 — 딥링크만).
    render(<DevPreview />);

    // 단언 ① — 홈 화면이 초기 렌더된다.
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
    // 단언 ② — a밴드 자동선택(보임) · c밴드 접힘.
    expect(screen.getByTestId('dev-preview-band-group-a')).not.toHaveStyle({
      width: 0,
    });
    expect(screen.getByTestId('dev-preview-band-group-c')).toHaveStyle(
      COLLAPSED_STYLE
    );
  });
});
