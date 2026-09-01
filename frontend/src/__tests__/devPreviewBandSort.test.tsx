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
jest.mock('react-native-webview');

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
  'dev-preview-state-itinerary-method', // h04
  'dev-preview-state-itinerary-method-regenerate', // h04
  'dev-preview-state-itinerary-mustvisit-default', // h05
  'dev-preview-state-itinerary-mustvisit-time-default', // h07
  'dev-preview-state-itinerary-generating', // h09
  'dev-preview-state-itinerary-generating-failed', // h09
  'dev-preview-state-itinerary-draft-generating', // h10
  'dev-preview-state-itinerary-draft-default', // h11
  'dev-preview-state-itinerary-draft-stale-failed', // h11
  'dev-preview-state-itinerary-draft-loading', // h11
  'dev-preview-state-itinerary-draft-empty', // h11
  'dev-preview-state-itinerary-draft-nopins', // h11
  'dev-preview-state-itinerary-draft-fallback-deterministic', // h11
  'dev-preview-state-itinerary-draft-fallback-minimal', // h11
  'dev-preview-state-itinerary-draft-fallback-demoted', // h11
  'dev-preview-state-slot-candidate-panel', // h12
  'dev-preview-state-slot-candidate-panel-pending', // h12
  'dev-preview-state-slot-candidate-panel-degraded', // h12
  'dev-preview-state-slot-candidate-panel-empty', // h12
  'dev-preview-state-slot-candidate-panel-error', // h12
  'dev-preview-state-option-swap', // h18
  'dev-preview-state-option-swap-selected', // h18
  'dev-preview-state-option-swap-empty', // h18
  'dev-preview-state-manual-empty', // h19
  'dev-preview-state-manual-filled', // h19
  'dev-preview-state-place-add', // h20
  'dev-preview-state-place-add-notready', // h20
  'dev-preview-state-itinerary-edit', // h24
  'dev-preview-state-itinerary-edit-time-sheet', // h24
  'dev-preview-state-itinerary-timeline', // h25
  'dev-preview-state-itinerary-timeline-confirm-locked', // h25
  'dev-preview-state-itinerary-map', // h25
  'dev-preview-state-itinerary-timeline-placeholder', // h25
  'dev-preview-state-itinerary-confirmed', // h34
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
