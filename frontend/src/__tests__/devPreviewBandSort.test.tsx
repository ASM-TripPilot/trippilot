import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * TRIP-644 — dev 정적 프리뷰(`_dev/preview.tsx`)의 밴드 그룹 안 코드 번호순 정렬.
 *
 * 무엇을 보장하나:
 *  (1) AC-1 — 밴드 안 모든 칩 라벨이 코드 접두(밴드문자+2자리, zero-pad)를 갖는다.
 *      `기타`(map-default) 하나만 예외. 이 2자리 강제가 사전순 비교=번호순 성립의 전제를
 *      기계로 굳힌다(643이 이미 충족 → 회귀 가드).
 *  (2) AC-2 — 각 밴드 그룹 안 칩이 코드 오름차순으로 서고, 같은 코드 여러 얼굴은
 *      배열 삽입 순서 그대로(안정 정렬) 인접한다.
 *
 * ★ within(그룹) 스코프 필수: 641 show-not-mount 계약상 비선택 밴드 그룹도
 * `{width:0,height:0,overflow:'hidden'}`로 접힐 뿐 트리에 남는다 — RNTL v13은 이걸
 * 쿼리에서 안 뺀다(display:none/aria-hidden만 제외). within 없이 `screen.getAllByTestId`
 * 하면 10밴드 165칩을 전부 긁어 배열이 오염된다.
 *
 * ★ getAllByTestId(/정규식/)의 반환 순서 = 렌더 트리 순서(pre-order). node_modules 실측
 * (`build/helpers/find-all.js` — "preserve original tree walk order") + 리포 선례
 * `tabsItineraryRoute.test.tsx`(`getAllByTestId(/^my-trip-card-/)` 트리순 배열 비교).
 * 그래서 testID 배열이 곧 화면상 칩 순서 → 정렬 심판이 성립.
 *
 * 기대 배열은 비교자를 재구현하지 않고 정렬 결과를 손으로 산출한 하드코딩이다(순환 심판 회피).
 *
 * 목킹 규약은 형제 `devPreviewBandNav`/`devPreviewMap` 을 그대로 따른다(지뢰 목 포함).
 */

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
}));

// 네이티브 런타임 의존을 통과 컴포넌트로 목킹(수동 목: __mocks__/*) — 동결 devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 네트워크 계층을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '밴드 정렬 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const previewModule = require('@/app/_dev/preview');
const DevPreview = previewModule.default as ComponentType;
const PREVIEW_STATES = previewModule.PREVIEW_STATES as {
  key: string;
  label: string;
  band: string;
}[];

// 코드 오름차순(안정) 정렬 후 기대되는 그룹 내 칩 testID 순서 — 실 배열을 손으로 산출한 정본.
// 같은 코드 블록은 배열 삽입 순서 그대로(안정 정렬 관찰). 코드는 확인용 트레일링 주석.
const EXPECTED_H = [
  // TRIP-784: itinerary-method → h01-method 개명(코드 h04→h01 라 안정 정렬이 이 칩을 band h
  // 그룹 선두로 올린다) + itinerary-method-regenerate 프리뷰 키 삭제(재생성 로직·M-R1~R4 는
  // 유지, 프리뷰 키만 정리).
  'dev-preview-state-h01-method', // h01
  // TRIP-785: itinerary-mustvisit-default(h05) → h02-mustvisit-default(h02) 개명 + 신규
  // h02-mustvisit-loading·-error 2키. 라벨 코드가 h02 라 안정 정렬이 h01(method) 뒤·h07
  // (mustvisit-time) 앞에 세 칩을 인접시킨다. 같은 h02 코드 3키는 PREVIEW_STATES 배열 삽입
  // 순서(default→loading→error)로 안정정렬되므로 구현자는 그 순서로 삽입한다(배열 위치=정렬 위치).
  'dev-preview-state-h02-mustvisit-default', // h02
  'dev-preview-state-h02-mustvisit-loading', // h02
  'dev-preview-state-h02-mustvisit-error', // h02
  'dev-preview-state-itinerary-mustvisit-time-default', // h07
  // TRIP-790: 옛 h10 `itinerary-draft-generating`(만드는 중 · DraftScreen 인라인 게이지)을
  // h07 부분 결과(셸 얼굴)로 개명. 라벨 코드가 h07 이라 안정 정렬이 mustvisit-time 뒤에 붙는다
  // (개명 엔트리는 PREVIEW_STATES 배열상 draft 구역이라 mustvisit-time 보다 늦다 · 02a ★10).
  'dev-preview-state-h07-generating-partial', // h07
  'dev-preview-state-h08-draft-collapsed', // h08 (TRIP-783 지도+시트 셸 접힘)
  // TRIP-792: h08 펼침(시트 상단 스냅 · initialIndex={1}) 신규. 코드가 h08 이라 안정 정렬이
  // collapsed 바로 뒤에 붙는다(PREVIEW_STATES 배열에서도 expanded 를 collapsed 직후에 삽입 —
  // 그래야 안정 정렬이 이 순서를 낸다). 동시에 옛 h11 DraftScreen 초안 5키(default·stale-failed·
  // loading·empty·nopins)는 삭제돼 이 배열에서도 빠진다(band h 소비처 이동, 폴백 3키는 유지).
  'dev-preview-state-h08-draft-expanded', // h08 (TRIP-792 지도+시트 셸 펼침)
  'dev-preview-state-itinerary-generating', // h09
  'dev-preview-state-itinerary-generating-failed', // h09
  // TRIP-796: h11 같이 결과(CoPick 완료) 지도+시트 셸. 코드가 h11 이라 안정 정렬이 h11 그룹 안에
  // 들어가고, PREVIEW_STATES 배열에서 이 프리뷰를 fallback 3키보다 **앞**(그 직전)에 삽입하므로
  // 안정 정렬이 이 순서(copick → fallback 3)를 낸다(02a ★13 · h08 D5 선례 — 배열 위치=정렬 위치).
  'dev-preview-state-h11-copick-complete', // h11 (TRIP-796 지도+시트 셸 · 같이 결과)
  'dev-preview-state-itinerary-draft-fallback-deterministic', // h11
  'dev-preview-state-itinerary-draft-fallback-minimal', // h11
  'dev-preview-state-itinerary-draft-fallback-demoted', // h11
  'dev-preview-state-slot-candidate-panel', // h12
  'dev-preview-state-slot-candidate-panel-pending', // h12
  'dev-preview-state-slot-candidate-panel-degraded', // h12
  'dev-preview-state-slot-candidate-panel-empty', // h12
  'dev-preview-state-slot-candidate-panel-error', // h12
  // TRIP-797: h12 편집기 통일. 옛 manual-empty(h19)→h12-editor-empty·manual-filled(h19)+
  // itinerary-edit(h24)→h12-editor-filled(2→1 병합)·h12-editor-dragging(신규). 라벨 접두가 h12 라
  // 안정 정렬이 slot-candidate-panel(h12) 뒤·h14(plan) 앞에 세 칩을 인접시킨다 — 구현자는 preview.tsx
  // 에서 이 3블록을 slot-candidate-panel-error 블록 **직후**에 연속 삽입한다(배열 위치=정렬 위치,
  // h11 copick·h14 선례 · 02a ★8·§5). 净 카운트 0(삭제 3 + 추가 3) → devPreviewBandNav 172 무변경.
  'dev-preview-state-h12-editor-empty', // h12 (구 manual-empty)
  'dev-preview-state-h12-editor-filled', // h12 (구 manual-filled + itinerary-edit)
  'dev-preview-state-h12-editor-dragging', // h12 (신규 · dragging 정적 얼굴)
  // TRIP-799: h14 완성 일정(TimelineScreen→지도+시트 셸) 4얼굴. 라벨 코드가 h14 라 안정 정렬이
  // h12(slot-candidate-panel) 와 h18(option-swap) 사이로 들어간다(옛 h25 위치에서 h14 로 이동 —
  // 라이브 Figma 재번호 h01~h17, 02a ★14). 같은 h14 코드 4키는 PREVIEW_STATES 배열 삽입 순서
  // (default→distance-pending→map-fallback→no-base)로 안정정렬되므로 구현자는 그 순서로 삽입한다
  // (h08 collapsed/expanded·h11 copick 선례 — 배열 위치=정렬 위치).
  'dev-preview-state-h14-plan-default', // h14
  'dev-preview-state-h14-plan-distance-pending', // h14
  'dev-preview-state-h14-plan-map-fallback', // h14
  'dev-preview-state-h14-plan-no-base', // h14
  // TRIP-801: 옛 itinerary-confirmed(h34, CONFIRMED TimelineScreen)를 h16-plan-confirmed 로 개명
  // (CONFIRMED→지도+시트 셸). 라벨 코드가 h34→h16 이라 정렬 위치가 파일 끝(h34)에서 h14/h18 사이로
  // 이동한다(개명=count 불변, 위치만 이동 · 02a ★11).
  'dev-preview-state-h16-plan-confirmed', // h16
  'dev-preview-state-option-swap', // h18
  'dev-preview-state-option-swap-selected', // h18
  'dev-preview-state-option-swap-empty', // h18
  // TRIP-797: h19 manual-empty·manual-filled 는 h12-editor-* 로 개명·병합돼 위 h12 그룹으로 이동.
  'dev-preview-state-place-add', // h20
  'dev-preview-state-place-add-notready', // h20
  // TRIP-797: h24 itinerary-edit 는 h12-editor-filled 로 병합돼 삭제. itinerary-edit-time-sheet 는
  // TimeSheet 위젯 직접 렌더라 유지(카드 ⌄ 가 여는 시트, 제거 화면과 무관 · 02a ★9).
  'dev-preview-state-itinerary-edit-time-sheet', // h24
  // TRIP-799: 옛 h25 TimelineScreen PLANNED 프리뷰 4키는 h14-plan-* 4키로 교체됐다(위 참조).
  // TRIP-801: itinerary-confirmed(h34)는 h16-plan-confirmed(h16)로 개명·상단 이동(위 h16 줄 참조)
  // 돼 이 자리에서 사라진다.
  'dev-preview-state-itinerary-draft-zero', // h35
  'dev-preview-state-my-trips-list', // h37
  'dev-preview-state-my-trips-empty', // h37
  'dev-preview-state-my-trips-loading', // h37
];

const EXPECTED_L = [
  'dev-preview-state-notification-inbox-default', // l01
  'dev-preview-state-notification-inbox-empty', // l01
  'dev-preview-state-l02-notification-default', // l02
  'dev-preview-state-l02-notification-denied', // l02
  'dev-preview-state-my-page-default', // l03
  'dev-preview-state-my-page-empty', // l03
  'dev-preview-state-my-style-card-insufficient', // l03
  'dev-preview-state-my-stays-default', // l04
  'dev-preview-state-my-stays-empty', // l04
  'dev-preview-state-settings-preferences', // l05
  'dev-preview-state-settings-preferences-error', // l05
  'dev-preview-state-settings-default', // l05
  'dev-preview-state-settings-export-truncated', // l05
  'dev-preview-state-settings-export-error', // l05
  'dev-preview-state-settings-pending', // l05
  'dev-preview-state-settings-delete-dialog', // l05
  'dev-preview-state-l05-personalization-applied', // l05
  'dev-preview-state-l05-personalization-consent-missing', // l05
  'dev-preview-state-l05-personalization-not-enough', // l05
  'dev-preview-state-l06-location-consent-default', // l06
  'dev-preview-state-l06-location-consent-denied', // l06
  'dev-preview-state-l06-location-revoke-dialog', // l06
];

// 접두 파싱은 구현과 같은 규약(라벨의 ' · ' 앞 토큰). 비교자는 재구현하지 않는다.
const codeOf = (label: string) => label.split(' · ')[0];

describe('AC-1 · 코드 접두 가드 (순수 데이터)', () => {
  it('band !== 기타 엔트리는 라벨이 [밴드문자+2자리]로 시작한다 (zero-pad 강제)', () => {
    // 준비 — 렌더 없이 모듈의 PREVIEW_STATES 를 그대로 읽는다.
    // 실행 — 코드 접두가 밴드문자+2자리(/^[a-l]\d{2}/)가 아닌 non-기타 엔트리를 모은다.
    const offenders = PREVIEW_STATES.filter(
      (state) => state.band !== '기타'
    ).filter((state) => !/^[a-l]\d{2}/.test(codeOf(state.label)));

    // 단언 — 위반 0. 라벨 하나를 1자리(h5)로 바꾸면 이 배열에 잡혀 red.
    expect(offenders.map((state) => state.key)).toEqual([]);
  });

  it('기타는 유일 예외 — map-default 하나뿐이다', () => {
    // 준비/실행 — 접두 없는 라벨은 기타 밴드에만 허용된다(map-default).
    const etc = PREVIEW_STATES.filter((state) => state.band === '기타').map(
      (state) => state.key
    );

    // 단언 — 접두 없는 예외를 map-default 하나로 고정(새 접두 없는 엔트리를 기타에 숨기는 우회 차단).
    expect(etc).toEqual(['map-default']);
  });
});

describe('AC-2 · 밴드 그룹 안 코드 오름차순 (핵심, within 스코프)', () => {
  it('h 밴드 그룹의 칩이 코드 오름차순으로 선다 (뒤섞임 → 정렬, 안정)', () => {
    // 준비 — 프리뷰 루트 렌더(기본 밴드 c). h는 접힌 그룹이지만 show-not-mount 라 칩 전부 트리 잔류.
    render(<DevPreview />);

    // 실행 — h 그룹으로 스코프해 칩 testID 를 렌더 트리 순서대로 뽑는다.
    const order = within(screen.getByTestId('dev-preview-band-group-h'))
      .getAllByTestId(/^dev-preview-state-/)
      .map((node) => node.props.testID);

    // 단언 — 코드 오름차순 + 같은 코드는 배열 원순서. 정렬 없으면(현재) 배열 추가 순서라 red.
    expect(order).toEqual(EXPECTED_H);
  });

  it('l 밴드 그룹의 칩이 코드 오름차순으로 선다 (l05×10 안정 인접)', () => {
    // 준비 — 프리뷰 루트 렌더(l도 접힌 그룹, 칩 트리 잔류).
    render(<DevPreview />);

    // 실행 — l 그룹으로 스코프해 칩 testID 를 렌더 트리 순서대로 뽑는다.
    const order = within(screen.getByTestId('dev-preview-band-group-l'))
      .getAllByTestId(/^dev-preview-state-/)
      .map((node) => node.props.testID);

    // 단언 — l05 10얼굴이 배열상 4덩이로 흩어져 있어도 원순서로 모여 인접(안정 정렬). 비안정이면 red.
    expect(order).toEqual(EXPECTED_L);
  });
});
