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
    // ⚠️ TRIP-709: d05 목적지 상세 프리뷰 키(`destination-detail-default`, band d) 추가로 160→161.
    //    test-designer 02a 선반영(카운트 가드만) — implementer 는 preview.tsx 에 그 키 하나만 추가하고
    //    이 가드는 안 만진다(추가 전엔 160개라 이 단언이 red — 선반영이 red 를 만든다). devPreviewBandSort
    //    는 밴드 h·l 만 잠가 band d 와 무관(오갱신 금지).
    // ⚠️ TRIP-706: d02 select 모드 프리뷰 키 4개(`saved-places-select`·`-select-loading`·
    //    `-select-empty`·`-select-error`, band d) 추가로 161→165. test-designer 02a 선반영(카운트
    //    가드만) — implementer 는 preview.tsx 에 그 4키만 추가하고 이 가드는 안 만진다(추가 전엔
    //    161개라 이 단언이 red — 선반영이 red 를 만든다). devPreviewBandSort 는 밴드 h·l 만 잠가
    //    band d 와 무관(오갱신 금지).
    // ⚠️ TRIP-710: d06 장소 상세 프리뷰 키(`place-detail-default`, band d) 추가로 165→166.
    //    test-designer 02a 선반영(카운트 가드만) — implementer 는 preview.tsx 에 그 키 하나만 추가하고
    //    이 가드는 안 만진다(추가 전엔 165개라 이 단언이 red — 선반영이 red 를 만든다).
    //    devPreviewBandSort 는 밴드 h·l 만 잠가 band d 와 무관(오갱신 금지).
    // ⚠️ TRIP-726: e02 상태 5종 프리뷰 키(`stay-search-loading`·`stay-search-empty`·
    //    `stay-search-filter-zero`·`stay-search-partial-failure`·`stay-search-error`, band e)
    //    추가로 166→171. test-designer 02a 선반영(카운트 가드만) — implementer 는 preview.tsx 에
    //    그 5키만 추가하고 이 가드는 안 만진다(추가 전엔 166개라 이 단언이 red). devPreviewBandSort
    //    는 밴드 h·l 만 잠가 band e 와 무관(오갱신 금지 — e02 라벨은 /^[a-l]\d{2}/ 접두로 AC-1 통과).
    // ⚠️ TRIP-727: e03 프리뷰 병합으로 `stay-detail-saved` 키 1개 삭제(default 를 saved:true 로
    //    병합, Figma default=저장됨) → 171→170. test-designer 02a 선반영(카운트 가드만) —
    //    implementer 는 preview.tsx 에서 그 1키만 지울 뿐 이 가드는 안 만진다(삭제 전엔 171개라 이
    //    단언이 red). devPreviewBandSort 는 밴드 h·l 만 잠가 band e 와 무관(오갱신 금지).
    // ⚠️ TRIP-730: e05 등록 세대 병합 — 프리뷰 키 순변화 +1(개명 1·신규 3·삭제 2). 개명
    //    `stay-register-confirmed`→`stay-register-multi-candidate`, 신규 `stay-register-default`·
    //    `stay-register-multi`·`stay-register-error-mapapi`, 삭제 `stay-register-pin`·
    //    `stay-register-calendar`(코드 PinPanel·CalendarSheet 는 유지·키만 삭제) → 170→171.
    //    test-designer 02a 선반영(카운트 가드만) — implementer 는 preview.tsx 의 키만 재편하고 이
    //    가드는 안 만진다(재편 전엔 170개라 이 단언이 red). 정확히 그 키들인지는 아래 describe 가
    //    못박는다. devPreviewBandSort 는 밴드 h·l 만 잠가 band e 와 무관(오갱신 금지).
    // ⚠️ TRIP-724: e밴드 프리뷰 19키 재산정(TRIP-822) — stay-filter-sheet 신규 + stay-register-pin·
    //    stay-register-calendar 복원(730이 키만 삭제, 코드 유지) 3키 추가로 171→174.
    // ⚠️ TRIP-792: h08 지도+시트 셸 전환 — h11 DraftScreen 초안 프리뷰 5키
    //    ({itinerary-draft-default,-stale-failed,-loading,-empty,-nopins}) 삭제 +
    //    `h08-draft-expanded`(펼침, band h) 신규 1키 → net −4 로 174→170. test-designer 선반영
    //    (카운트 가드만) — implementer 는 preview.tsx 에서 그 5키를 지우고 expanded 1키만 추가할 뿐
    //    이 가드는 안 만진다(재편 전엔 174개라 이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-792'
    //    describe 가 못박는다. devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신.
    // ⚠️ TRIP-796: h11 같이 결과(CoPick 완료) 지도+시트 셸 프리뷰 키(`h11-copick-complete`, band `h`)
    //    추가로 170→171. test-designer 선반영(카운트 가드) — implementer 는 preview.tsx 에 그 키
    //    하나만 추가(MapSheetShell 을 5 CoPick 슬롯으로 조립)하고 이 가드는 안 만진다(추가 전엔 170개라
    //    이 단언이 red). 정확히 그 키인지는 아래 'TRIP-796' describe 가 못박는다. devPreviewBandSort 는
    //    band h 를 잠가 EXPECTED_H 도 동반 갱신(copick 을 h11 그룹 첫 항목으로 삽입).
    // ⚠️ TRIP-799: h14 완성 일정(TimelineScreen→지도+시트 셸). 옛 h25 프리뷰 4키(itinerary-timeline·
    //    -timeline-confirm-locked·itinerary-map·-timeline-placeholder) 삭제 + 신규 h14-plan-* 4키
    //    (default·distance-pending·map-fallback·no-base) 추가 → **net 0(−4+4)** 이라 카운트 171 무변경.
    //    test-designer 선반영(카운트 무변경 확인 + 아래 'TRIP-799' describe 로 키 교체를 못박음).
    //    implementer 는 preview.tsx 에서 옛 4키를 지우고 새 4키를 추가할 뿐 이 카운트는 안 만진다.
    //    devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(h14-plan-* 를 h14 위치에).
    // ⚠️ TRIP-784: h01 시작 방법 프리뷰 키 정리 — itinerary-method 개명(→h01-method, 카운트 불변) +
    //    itinerary-method-regenerate 삭제(재생성 로직·화면·배선·M-R1~R4 는 유지, 프리뷰 키만 제거)
    //    → 171→170. test-designer 선반영(카운트 가드) — implementer 는 preview.tsx 에서 그 두 키만
    //    재편하고 이 가드는 안 만진다(재편 전엔 171개라 이 단언이 red). 정확히 그 키들인지는 아래
    //    'TRIP-784' describe 가 못박는다. devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신.
    // ⚠️ TRIP-785: h02 꼭 갈 곳 프리뷰 재편 — itinerary-mustvisit-default → h02-mustvisit-default
    //    개명(카운트 불변) + 신규 h02-mustvisit-loading·-error 2키 → 170→172. test-designer 선반영
    //    (카운트 가드) — implementer 는 preview.tsx 에서 개명 1 + 신규 2키만 재편하고 이 가드는 안
    //    만진다(재편 전엔 170개라 이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-785' describe 가
    //    못박는다. devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(h02 3키를 h01·h07 사이).
    // ⚠️ TRIP-798: h13 장소 추가 프리뷰 재편 — place-add → h13-place-add 개명(카운트 불변) +
    //    place-add-notready 삭제(안내/notReady 배너 제거) → 172→171. test-designer 선반영(카운트
    //    가드) — implementer 는 preview.tsx 에서 개명 1 + 삭제 1만 하고 이 가드는 안 만진다(재편 전엔
    //    172개라 이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-798' describe 가 못박는다.
    //    devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(h13-place-add 를 h12↔h14 사이).
    // ⚠️ TRIP-786: h03 방문 시각 프리뷰 재편 — itinerary-mustvisit-time-default(h07) →
    //    h03-mustvisit-time-default(h03) 개명(카운트 불변) + 신규 h03-mustvisit-time-off·-error 2키
    //    → 171→173. test-designer 선반영(카운트 가드) — implementer 는 preview.tsx 에서 개명 1 +
    //    신규 2키만 재편하고 이 가드는 안 만진다(재편 전엔 171개라 이 단언이 red). 정확히 그 키들인지는
    //    아래 'TRIP-786' describe 가 못박는다. devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반
    //    갱신(h03 3키를 h02 직후·h07 앞에 삽입, 옛 h07 키 제거).
    // ⚠️ TRIP-787: itinerary-edit-time-sheet → h04-time-adjust-sheet **개명**(TimeSheet mode='h04' 정합)
    //    이라 카운트는 **173 무변경**(net 0). test-designer 는 이 카운트를 안 만진다(올리면 174로 거짓 red).
    //    정확히 그 키인지는 아래 'TRIP-787' describe 가 못박고, devPreviewBandSort 는 band h 를 잠가
    //    EXPECTED_H 도 동반 갱신(h04 를 h03↔h07 사이로).
    // ⚠️ TRIP-788: h05/h06 내 여행 목록 Figma 재번호 — my-trips-list→h05-my-trips-background(개명) +
    //    신규 h05-my-trips-done-bar(완료 도킹 배너) + my-trips-loading→h06-my-trips-loading(개명) +
    //    my-trips-empty→h06-my-trips-empty(개명). 개명 3 = net 0, 신규 done-bar 만 +1 → 173→174.
    //    test-designer 선반영(카운트 가드) — implementer 는 preview.tsx 에서 3키 개명 + done-bar 1키
    //    추가만 하고 이 가드는 안 만진다(재편 전엔 173개라 이 단언이 red). 정확히 그 키들인지는 아래
    //    'TRIP-788' describe 가 못박는다. devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신
    //    (my-trips 키가 h37 꼬리 → h05/h06 위치=h04 직후로 이동, 코드=정렬위치).
    // ⚠️ TRIP-789: h07 생성 loading 정합 — itinerary-generating(h09) → h07-generating-loading(h07)
    //    개명(net 0) + itinerary-generating-failed(h09) 키 삭제(핸들링 코드·GeneratingScreen failed
    //    표면은 유지, 프리뷰 진입점만 제거 — 부모 해석 G) → 174→173. test-designer 선반영(카운트 가드) —
    //    implementer 는 preview.tsx 에서 개명 1 + 삭제 1만 하고 이 가드는 안 만진다(재편 전엔 174개라
    //    이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-789' describe 가 못박고, devPreviewBandSort 는
    //    band h 를 잠가 EXPECTED_H 도 동반 갱신(loading 을 h07-generating-partial 뒤로, 옛 h09 2키 제거).
    // ⚠️ TRIP-791: h07 폴백 전용 인터스티셜 화면 신설 — 삭제 4키(itinerary-draft-fallback-{deterministic,
    //    minimal,demoted}·itinerary-draft-zero) + 신설 2키(h07-generating-fallback·h07-generating-fallback-failed)
    //    로 **순 −2** → 173→171. (itinerary-generating-failed 는 이미 TRIP-789 로 삭제돼 현존 안 함.)
    //    test-designer 선반영(카운트 가드만) — implementer 는 preview.tsx 에서 4키를 지우고 2키만 추가할 뿐
    //    이 가드는 안 만진다(재편 전엔 173개라 이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-791' describe 가
    //    못박고, devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(폴백 3키·zero 키 제거,
    //    h07-generating-fallback 2키를 loading 뒤에 삽입).
    // ⚠️ TRIP-793: h08 "다른 후보 시트" 통합 — 옛 h12/h18 프리뷰 8키(slot-candidate-panel·-pending·
    //    -degraded·-empty·-error·option-swap·option-swap-selected·option-swap-empty)를 h08 시트 2키
    //    (h08-candidate-sheet·h08-candidate-sheet-empty)로 병합해 **순 −6** → 171→165. test-designer
    //    선반영(카운트 가드만) — implementer 는 preview.tsx 에서 옛 8키를 지우고 2키만 추가할 뿐 이 가드는
    //    안 만진다(재편 전엔 171개라 이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-793' describe 가
    //    못박고, devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(h08-candidate-sheet 2키를
    //    h08-draft-expanded 직후, 옛 slot-candidate-panel 5키·option-swap 3키 제거).
    // ⚠️ TRIP-794: h09 컨셉 고르기(같이 고르기 위저드) 프리뷰 키(`h09-copick-concept`, band `h`)
    //    추가로 165→166. test-designer 선반영(카운트 가드만) — implementer 는 preview.tsx 에 그 키
    //    하나만 추가(ConceptPickerScreen 을 진행줄·스텝퍼 픽스처 props 로 렌더)하고 이 가드는 안
    //    만진다(추가 전엔 165개라 이 단언이 red). 정확히 그 키인지는 아래 'TRIP-794' describe 가
    //    못박고, devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(h09 를 h08 뒤·h11 앞에).
    // ⚠️ TRIP-795: h10 후보 선택 프리뷰 2키(`h10-copick-candidates`·`-wide`, band `h`) 추가로
    //    166→168. test-designer 선반영(카운트 가드만) — implementer 는 preview.tsx 에 그 2키(default·
    //    반경 넓힘, SlotFillScreen 순수 뷰 + 픽스처 props)만 추가하고 이 가드는 안 만진다(추가 전엔
    //    166개라 이 단언이 red). 정확히 그 키들인지는 아래 'TRIP-795' describe 가 못박고,
    //    devPreviewBandSort 는 band h 를 잠가 EXPECTED_H 도 동반 갱신(h10 2키를 h09↔h11 사이).
    // ⚠️ TRIP-746: i01 허브 재작성 — 옛 `live-itinerary` 1키를 지우고 `live-hub-closed`·`-half`·
    //    `-expanded` 3키(band `i`)를 더해 **순 +2** → 168→170. test-designer 선반영(카운트 가드만) —
    //    implementer 는 preview.tsx 에서 키만 바꾸고 이 가드는 안 만진다(재편 전엔 168개라 red).
    //    정확히 그 키들인지는 `devPreviewLiveHub.test.tsx` 가 못박는다.
    expect(PREVIEW_STATES).toHaveLength(170);

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

describe('🔴 TRIP-793 · h08 다른 후보 시트 프리뷰 8→2 병합 (band h)', () => {
  it('h08-candidate-sheet 2키가 있고, 옛 h12/h18 8키는 없으며, 형제 band h 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 병합된 h08 시트 2키(정상·0건).
    expect(keys).toContain('h08-candidate-sheet');
    expect(keys).toContain('h08-candidate-sheet-empty');

    // 부정 — 옛 h12 인라인 패널 5키 + h18 옵션 교체 3키는 사라진다(병합 전엔 present 라 red).
    // 카운트(165)만으론 "아무 8키나 지워도" 통과하므로, 이 짝이 '병합된 게 정확히 그 키들'임을 못박는다.
    expect(keys).not.toContain('slot-candidate-panel');
    expect(keys).not.toContain('slot-candidate-panel-pending');
    expect(keys).not.toContain('slot-candidate-panel-degraded');
    expect(keys).not.toContain('slot-candidate-panel-empty');
    expect(keys).not.toContain('slot-candidate-panel-error');
    expect(keys).not.toContain('option-swap');
    expect(keys).not.toContain('option-swap-selected');
    expect(keys).not.toContain('option-swap-empty');

    // 형제 band h 앵커 — 기존 h08 셸 키가 딸려 사라지지 않았음(공허 통과 방지).
    expect(keys).toContain('h08-draft-collapsed');
  });
});

describe('🔴 TRIP-794 · h09 컨셉 고르기 프리뷰 키 (band h)', () => {
  it('키 집합에 h09-copick-concept 가 있고 형제 band h 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — h09-copick-concept 는 implementer 가 preview.tsx 에 추가하기 전엔 없다(band h,
    // ConceptPickerScreen 을 진행줄·스텝퍼 픽스처 props 로 렌더). 카운트(166)만으론 "아무 키나 1개
    // 추가해도" 통과하므로, 이 단언이 '추가된 키가 h09-copick-concept'임을 못박는다(TRIP-796 미러).
    expect(keys).toContain('h09-copick-concept');

    // 형제 band h 앵커 — 기존 h08·h11 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('h08-candidate-sheet');
    expect(keys).toContain('h11-copick-complete');
  });
});

describe('🔴 TRIP-795 · h10 후보 선택 프리뷰 2키 (band h)', () => {
  it('키 집합에 h10-copick-candidates·-wide 가 있고 형제 band h(h09·h11) 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — 두 키는 implementer 가 preview.tsx 에 추가하기 전엔 없다(band h, SlotFillScreen 을
    // default·반경 넓힘 픽스처 props 로 렌더). 카운트(168)만으론 "아무 2키나 추가해도" 통과하므로,
    // 이 단언이 '추가된 2키가 h10 키'임을 못박는다(TRIP-794 미러).
    expect(keys).toContain('h10-copick-candidates');
    expect(keys).toContain('h10-copick-candidates-wide');

    // 형제 band h 앵커 — 이웃 co-pick 키(h09 컨셉·h11 완료)가 딸려 사라지지 않았음(공허 통과 방지).
    expect(keys).toContain('h09-copick-concept');
    expect(keys).toContain('h11-copick-complete');
  });
});

describe('🔴 TRIP-785 · h02 꼭 갈 곳 프리뷰 키 재편 (band h)', () => {
  it('h02-mustvisit-default 로 개명되고, loading·error 2키가 생기며, 옛 키는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 개명 원본은 사라진다(재편 전엔 present 라 red). 카운트만으론 "아무 키나 재편해도"
    // 통과하므로, 이 짝이 '바뀐 게 정확히 그 키'임을 못박는다(TRIP-784 미러).
    expect(keys).not.toContain('itinerary-mustvisit-default');

    // 긍정 — 개명 + 신규 2키(loading·error).
    expect(keys).toContain('h02-mustvisit-default');
    expect(keys).toContain('h02-mustvisit-loading');
    expect(keys).toContain('h02-mustvisit-error');

    // 형제 band h 앵커 — 방문 시각 키가 딸려 사라지지 않았음(공허 통과 방지). TRIP-786 이
    //    itinerary-mustvisit-time-default → h03-mustvisit-time-default 로 개명하므로 새 이름으로 잡는다.
    expect(keys).toContain('h03-mustvisit-time-default');
  });
});

describe('🔴 TRIP-786 · h03 방문 시각 프리뷰 키 재편 (band h)', () => {
  it('h03-mustvisit-time-default 로 개명되고 off·error 2키가 생기며, 옛 h07 키는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 옛 h07 키는 h03 으로 개명돼 사라진다(재편 전엔 present 라 red). 카운트만으론
    //    "아무 키나 재편해도" 통과하므로, 이 짝이 '바뀐 게 정확히 그 키'임을 못박는다(TRIP-785 미러).
    expect(keys).not.toContain('itinerary-mustvisit-time-default');

    // 긍정 — 개명 + 신규 2키(off·error).
    expect(keys).toContain('h03-mustvisit-time-default');
    expect(keys).toContain('h03-mustvisit-time-off');
    expect(keys).toContain('h03-mustvisit-time-error');

    // 형제 band h 앵커 — h02 꼭 갈 곳 키가 딸려 사라지지 않았음(공허 통과 방지).
    expect(keys).toContain('h02-mustvisit-default');
  });
});

describe('🔴 TRIP-784 · h01 시작 방법 프리뷰 키 재편 (band h)', () => {
  it('h01-method 가 있고, 옛 itinerary-method·itinerary-method-regenerate 는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 짝 — 개명된 h01-method 가 실재한다.
    expect(keys).toContain('h01-method');

    // 부정 — 옛 키는 사라진다(개명 원본 + 삭제된 재생성 프리뷰).
    expect(keys).not.toContain('itinerary-method');
    expect(keys).not.toContain('itinerary-method-regenerate');
  });
});

describe('🔴 TRIP-787 · h04 시각 조정 시트 프리뷰 키 개명 (band h · net 0)', () => {
  it('h04-time-adjust-sheet 로 개명되고, 옛 itinerary-edit-time-sheet 키는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 개명된 h04-time-adjust-sheet 가 실재한다(개명 전엔 부재라 red).
    expect(keys).toContain('h04-time-adjust-sheet');

    // 부정 — 개명 원본(프리뷰 키)은 사라진다(개명 전엔 present 라 red). 카운트(173, net 0)만으론
    //   "아무 키나 개명해도" 통과하므로, 이 짝이 '바뀐 게 정확히 그 키'임을 못박는다(TRIP-798 미러).
    //   ⚠️ 이 문자열은 preview.tsx 의 프리뷰 **키**다 — default 시트의 렌더 testID(같은 문자열, 다른
    //   물건)는 이 개명과 무관(mode 미전달 소비처는 그대로, 02a ★1).
    expect(keys).not.toContain('itinerary-edit-time-sheet');

    // 형제 band h 앵커 — 방문 시각(h03) 키가 딸려 사라지지 않았음(공허 통과 방지).
    expect(keys).toContain('h03-mustvisit-time-default');
  });
});

describe('🔴 TRIP-798 · h13 장소 추가 프리뷰 키 재편 (band h)', () => {
  it('h13-place-add 로 개명되고, place-add·place-add-notready 는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 개명된 h13-place-add 가 실재한다.
    expect(keys).toContain('h13-place-add');

    // 부정 — 개명 원본(place-add) + 삭제된 notReady 프리뷰가 사라진다(재편 전엔 present 라 red).
    // 카운트만으론 "아무 키나 재편해도" 통과하므로, 이 짝이 '바뀐 게 정확히 그 키'임을 못박는다.
    expect(keys).not.toContain('place-add');
    expect(keys).not.toContain('place-add-notready');

    // 형제 band h 앵커 — h12 편집기 키가 딸려 사라지지 않았음(공허 통과 방지).
    expect(keys).toContain('h12-editor-filled');
  });
});

describe('🔴 TRIP-730 · e05 등록 프리뷰 키 재편 (band e)', () => {
  it('옛 3키가 없고, 새 4키가 있으며, 형제 e키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 개명 대상 confirmed 는 사라진다(재편 전엔 present 라 red). 카운트만으론 "아무 키나
    // 재편해도" 통과하므로, 이 짝이 '바뀐 게 정확히 그 키'임을 못박는다(TRIP-727 미러).
    // ⚠️ TRIP-724: pin·calendar 는 730 이 지웠다가 19키 재산정으로 복원 — 부정 단언은 아래
    //    'TRIP-724 · e밴드 19키 복원' describe 의 긍정으로 대체(730 시점엔 삭제가 맞았다).
    expect(keys).not.toContain('stay-register-confirmed');

    // 긍정 — 새 4키(default·multi·multi-candidate·error-mapapi)가 실재한다.
    expect(keys).toContain('stay-register-default');
    expect(keys).toContain('stay-register-multi');
    expect(keys).toContain('stay-register-multi-candidate');
    expect(keys).toContain('stay-register-error-mapapi');

    // 형제 band e 앵커 — e02 검색 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('stay-search-default');
  });
});

describe('🔴 TRIP-724 · e밴드 19키 복원·신설 (band e)', () => {
  it('pin·calendar 복원 + filter-sheet 신설 3키가 실재하고, 형제 e키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 730 이 지운 pin·calendar 복원(코드 PinPanel·CalendarSheet 유지) + filter-sheet 신설
    // (StayFilterSheet 코드 실재). TRIP-822 재산정 19키의 마지막 3키. 없으면 red(추가 전엔 부재).
    expect(keys).toContain('stay-register-pin');
    expect(keys).toContain('stay-register-calendar');
    expect(keys).toContain('stay-filter-sheet');

    // 형제 e 앵커 — 기존 e05·e02 키가 딸려 사라지지 않았음(공허 통과 방지).
    expect(keys).toContain('stay-register-default');
    expect(keys).toContain('stay-price-sheet');
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

describe('🔴 TRIP-709 AC-10 · d05 목적지 상세 프리뷰 키 (band d)', () => {
  it('키 집합에 destination-detail-default 가 있고 형제 band d 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — destination-detail-default 는 implementer 가 preview.tsx 에 추가하기 전엔 없다
    // (band d, DestinationDetailScreen 렌더). 카운트(161)만으론 "아무 키나 1개 추가해도" 통과하므로
    // 이 단언이 '추가된 키가 destination-detail-default'임을 못박는다(TRIP-695/697/700 미러).
    expect(keys).toContain('destination-detail-default');

    // 형제 band d 앵커 — 기존 d 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('explore-landing-default');
  });
});

describe('🔴 TRIP-706 AC-V · d02 select 프리뷰 키 4종 (band d)', () => {
  it('키 집합에 select 4종이 있고 형제 band d 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — 4키는 implementer 가 preview.tsx 에 추가하기 전엔 없다(band d, MustVisitPickScreen
    // 4얼굴 렌더). 카운트(165)만으론 "아무 4키나 추가해도" 통과하므로, 이 단언이 '추가된 4키가
    // select 키'임을 못박는다(TRIP-695/697/700/709 미러).
    expect(keys).toContain('saved-places-select');
    expect(keys).toContain('saved-places-select-loading');
    expect(keys).toContain('saved-places-select-empty');
    expect(keys).toContain('saved-places-select-error');

    // 형제 band d 앵커 — 기존 d 키(save default)가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('saved-places-default');
  });
});

describe('🔴 TRIP-710 AC-4 · d06 장소 상세 프리뷰 키 (band d)', () => {
  it('키 집합에 place-detail-default 가 있고 형제 band d 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — place-detail-default 는 implementer 가 preview.tsx 에 추가하기 전엔 없다(band d,
    // PlaceDetailScreen 렌더). 카운트(166)만으론 "아무 키나 1개 추가해도" 통과하므로, 이 단언이
    // '추가된 키가 place-detail-default'임을 못박는다(TRIP-695/697/700/709 미러).
    expect(keys).toContain('place-detail-default');

    // 형제 band d 앵커 — 기존 d 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('explore-landing-default');
  });
});

describe('🔴 TRIP-726 AC-P2 · e02 상태 5종 프리뷰 키 (band e)', () => {
  it('키 집합에 상태 5키가 있고 형제 e앵커(stay-search-default)는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // red-first — 5키는 implementer 가 preview.tsx 에 추가하기 전엔 없다(band e, StaySearchScreen 을
    // 상태별로 렌더). 카운트(171)만으론 "아무 5키나 추가해도" 통과하므로, 이 단언이 '추가된 5키가
    // 상태 키'임을 못박는다(TRIP-709/710 미러).
    expect(keys).toContain('stay-search-loading');
    expect(keys).toContain('stay-search-empty');
    expect(keys).toContain('stay-search-filter-zero');
    expect(keys).toContain('stay-search-partial-failure');
    expect(keys).toContain('stay-search-error');

    // 형제 e앵커 — 기존 e키(TRIP-725 default)가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    expect(keys).toContain('stay-search-default');
  });
});

describe('🔴 TRIP-727 AC-9 · e03 프리뷰 병합 (stay-detail-saved 삭제)', () => {
  it('키 집합에 stay-detail-saved 가 없고, 형제 e03 키(default·notfound)는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — stay-detail-saved 는 사라진다(default 를 saved:true 로 병합, 삭제 전엔 present 라 red).
    //   카운트(170)만으론 "아무 1키나 지워도" 통과하므로, 이 짝이 '지운 게 정확히 그 키'임을 못박는다
    //   (TRIP-711/722/742/743 음성 가드 패턴 미러).
    expect(keys).not.toContain('stay-detail-saved');

    // 긍정 짝 — 같은 e03 형제 키는 그대로(과잉 삭제·공허 통과 차단).
    expect(keys).toContain('stay-detail-default');
    expect(keys).toContain('stay-detail-notfound');
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

describe('🔴 TRIP-790 · h07 부분 결과 프리뷰 키 개명 (band h)', () => {
  it('키 집합에 h07-generating-partial 이 있고 itinerary-draft-generating 은 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 개명은 엔트리 **수**를 안 바꿨다(당시 174 무변경) — 이름·render 만 바뀐다
    // (옛 h10 DraftScreen 인라인 게이지 → h07 셸 얼굴, TRIP-732 개명 describe 미러).
    expect(keys).toContain('h07-generating-partial');
    expect(keys).not.toContain('itinerary-draft-generating');

    // 형제 band h 앵커 — 기존 h 키가 딸려 사라지지 않았음을 못박는다(공허 통과 방지).
    // ⚠️ TRIP-792 로 `itinerary-draft-default` 가 삭제돼 앵커를 생존 키 `h08-draft-collapsed`(band h)로
    //    옮겼다 — 옛 앵커를 그대로 두면 이 형제 anchor 가 삭제와 충돌해 red 가 된다(선반영 갱신).
    expect(keys).toContain('h08-draft-collapsed');
  });
});

describe('🔴 TRIP-792 · h08 셸 전환 프리뷰 키 재편 (band h)', () => {
  it('h11 DraftScreen 초안 5키가 없고, h08-draft-expanded 가 있으며, 형제 h 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — h11 DraftScreen 초안 프리뷰 5키가 사라진다(삭제 전엔 present 라 red). 카운트(170)만으론
    //   "아무 키나 재편해도" 통과하므로, 이 짝이 '지운 게 정확히 그 5키'임을 못박는다(TRIP-711/742 미러).
    expect(keys).not.toContain('itinerary-draft-default');
    expect(keys).not.toContain('itinerary-draft-stale-failed');
    expect(keys).not.toContain('itinerary-draft-loading');
    expect(keys).not.toContain('itinerary-draft-empty');
    expect(keys).not.toContain('itinerary-draft-nopins');

    // 긍정 — 신규 펼침 키가 실재한다(추가 전엔 부재라 red). 접힘 키(TRIP-783)는 유지.
    expect(keys).toContain('h08-draft-expanded');
    expect(keys).toContain('h08-draft-collapsed');

    // 형제 band h 앵커 — 인접 밴드 키가 딸려 사라지지 않았다(과잉 삭제·공허 통과 차단).
    //   ⚠️ TRIP-791: 옛 앵커 itinerary-draft-fallback-minimal(h11 폴백 배너 프리뷰)이 인터스티셜 승격으로
    //      삭제됐다 — 삭제에 안 딸려가는 안정 band h 앵커로 h07-generating-partial(TRIP-790)로 교체.
    expect(keys).toContain('h07-generating-partial');
  });
});

describe('🔴 TRIP-789 · h07 생성 loading 프리뷰 키 재편 (band h)', () => {
  it('h07-generating-loading 로 개명되고, 옛 itinerary-generating·-failed 키는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 개명된 loading 키(band h, 라벨 h07)가 실재한다(개명 전엔 부재라 red).
    expect(keys).toContain('h07-generating-loading');

    // 부정 — 개명 원본(itinerary-generating) + 삭제된 failed 키가 사라진다(재편 전엔 present 라 red).
    //   카운트(173)만으론 "아무 키나 재편해도" 통과하므로, 이 짝이 '바뀐 게 정확히 그 키들'임을
    //   못박는다(TRIP-798/787 미러). failed 는 핸들링 코드·GeneratingScreen 실패 표면은 유지되고
    //   프리뷰 진입점만 삭제(부모 해석 G).
    expect(keys).not.toContain('itinerary-generating');
    expect(keys).not.toContain('itinerary-generating-failed');

    // 형제 band h 앵커 — 인접 h07 부분 결과 키(TRIP-790)가 딸려 사라지지 않았다(공허 통과 방지).
    //   ★ h07 두 얼굴: loading(GeneratingScreen, 데이터 前) ≠ partial(MapSheetShell, day1 도착) — 안 섞음.
    expect(keys).toContain('h07-generating-partial');
  });
});

describe('🔴 TRIP-791 · h07 폴백 인터스티셜 프리뷰 키 재편 (band h)', () => {
  it('폴백 3키·zero 키가 없고, h07-generating-fallback 2키가 있으며, 형제 h 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 곁줄 배너 3키 + h35 후보 0건 키가 인터스티셜 승격으로 사라진다(삭제 전엔 present 라 red).
    //   카운트(171, net −2)만으론 "아무 4키나 지우고 2키나 더해도" 통과하므로, 이 짝이 '지운 게 정확히
    //   그 4키'임을 못박는다(TRIP-711/722/742 음성 가드 패턴 미러).
    expect(keys).not.toContain('itinerary-draft-fallback-deterministic');
    expect(keys).not.toContain('itinerary-draft-fallback-minimal');
    expect(keys).not.toContain('itinerary-draft-fallback-demoted');
    expect(keys).not.toContain('itinerary-draft-zero');

    // 긍정 — 신설 인터스티셜 2키(성공·하드실패)가 실재한다(추가 전엔 부재라 red).
    expect(keys).toContain('h07-generating-fallback');
    expect(keys).toContain('h07-generating-fallback-failed');

    // 형제 band h 앵커 — 인접 h07 loading·partial 키가 딸려 사라지지 않았다(과잉 편집·공허 통과 차단).
    expect(keys).toContain('h07-generating-loading');
    expect(keys).toContain('h07-generating-partial');
  });
});

describe('🔴 TRIP-796 · h11 같이 결과(CoPick 완료) 셸 프리뷰 키 추가 (band h)', () => {
  it('키 집합에 h11-copick-complete 가 있고, 형제 band h 키(h08·폴백)는 그대로다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 신규 CoPick 완료 셸 프리뷰 키가 실재한다(추가 전엔 부재라 red). 카운트(171)만으론
    //   "아무 키나 추가해도" 통과하므로, 이 짝이 '더한 게 정확히 그 키'임을 못박는다.
    expect(keys).toContain('h11-copick-complete');

    // 형제 band h 앵커 — 인접 h08·h07 키가 딸려 사라지지 않았다(과잉 편집·공허 통과 차단).
    //   ⚠️ TRIP-791: 옛 앵커 itinerary-draft-fallback-deterministic 이 인터스티셜 승격으로 삭제됐다 —
    //      삭제에 안 딸려가는 안정 band h 앵커로 h07-generating-loading 으로 교체.
    expect(keys).toContain('h08-draft-collapsed');
    expect(keys).toContain('h07-generating-loading');
  });
});

describe('🔴 TRIP-799 · h14 완성 일정 셸 프리뷰 키 교체 (band h · net 0)', () => {
  it('옛 h25 timeline 4키가 없고, 새 h14-plan 4키가 있으며, CONFIRMED·형제 h키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 옛 h25 TimelineScreen PLANNED 프리뷰 4키는 사라진다(삭제 전엔 present 라 red). 카운트
    //   (171, net 0)만으론 "아무 키나 4↔4 교체해도" 통과하므로, 이 짝이 '지운 게 정확히 그 4키'임을
    //   못박는다(TRIP-711/722/742 음성 가드 패턴 미러).
    expect(keys).not.toContain('itinerary-timeline');
    expect(keys).not.toContain('itinerary-timeline-confirm-locked');
    expect(keys).not.toContain('itinerary-map');
    expect(keys).not.toContain('itinerary-timeline-placeholder');

    // 긍정 — 새 h14 지도+시트 셸 프리뷰 4키가 실재한다(추가 전엔 부재라 red).
    expect(keys).toContain('h14-plan-default');
    expect(keys).toContain('h14-plan-distance-pending');
    expect(keys).toContain('h14-plan-map-fallback');
    expect(keys).toContain('h14-plan-no-base');

    // 긍정 짝 — CONFIRMED 프리뷰는 TRIP-801 로 h16-plan-confirmed 로 개명됐다(옛 itinerary-confirmed
    //   앵커는 이제 stale) + 형제 h키(h11-copick-complete)도 딸려 사라지지 않았다.
    expect(keys).toContain('h16-plan-confirmed');
    expect(keys).toContain('h11-copick-complete');
  });
});

describe('🔴 TRIP-801 · h16 확정 일정 셸 프리뷰 키 개명 (band h · net 0)', () => {
  it('옛 itinerary-confirmed 가 없고 h16-plan-confirmed 가 있으며 형제 h14/h11 키는 남는다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 부정 — 옛 CONFIRMED TimelineScreen 프리뷰 키는 사라진다(개명 전엔 present 라 red).
    expect(keys).not.toContain('itinerary-confirmed');

    // 긍정 — 새 h16 지도+시트 셸 프리뷰 키가 실재한다(개명 후 present).
    expect(keys).toContain('h16-plan-confirmed');

    // 형제 band h 앵커 — 인접 h14/h11 키가 딸려 사라지지 않았다(과잉 편집·공허 통과 차단).
    //   개명=net 0 이라 위 카운트 가드(171)는 무변경(02a ★11).
    expect(keys).toContain('h14-plan-default');
    expect(keys).toContain('h11-copick-complete');
  });
});

describe('🔴 TRIP-788 · h05/h06 내 여행 목록 프리뷰 키 재편 (band h)', () => {
  it('h05/h06 개명 3 + 신규 done-bar 가 있고, 옛 my-trips-* 키는 없다', () => {
    // 준비 — 렌더 없이 순수 데이터(PREVIEW_STATES key 집합)만 읽는다.
    const keys = PREVIEW_STATES.map((state) => state.key);

    // 긍정 — 개명 3(background·loading·empty) + 신규 1(done-bar). 추가/개명 전엔 부재라 red.
    expect(keys).toContain('h05-my-trips-background');
    expect(keys).toContain('h05-my-trips-done-bar');
    expect(keys).toContain('h06-my-trips-loading');
    expect(keys).toContain('h06-my-trips-empty');

    // 부정 — 옛 h37 키(개명 원본)는 사라진다(재편 전엔 present 라 red). 카운트(174)만으론 "아무 키나
    // 재편해도" 통과하므로, 이 짝이 '바뀐 게 정확히 그 키들'임을 못박는다(TRIP-798/787 미러).
    expect(keys).not.toContain('my-trips-list');
    expect(keys).not.toContain('my-trips-loading');
    expect(keys).not.toContain('my-trips-empty');

    // 형제 band h 앵커 — 인접 h키가 딸려 사라지지 않았다(공허 통과 방지).
    //   ⚠️ TRIP-791: 옛 앵커 itinerary-draft-zero(h35 후보 0건)가 인터스티셜 흡수로 삭제됐다 —
    //      삭제에 안 딸려가는 안정 band h 앵커로 h11-copick-complete 로 교체.
    expect(keys).toContain('h04-time-adjust-sheet');
    expect(keys).toContain('h11-copick-complete');
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
