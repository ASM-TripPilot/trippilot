import type { ComponentType } from 'react';
import type { ViewStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * TRIP-641 파트 2 — dev 정적 프리뷰(`_dev/preview.tsx`)의 밴드 2단 네비.
 *
 * 무엇을 보장하나:
 *  (1) AC-6 — 165개 프리뷰 상태가 전부 Figma 밴드(10종) 하나로 분류되고, 그룹핑해도 하나도
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
jest.mock('react-native-webview');

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
  it('166개 엔트리가 전부 10종 밴드 중 하나를 갖고, 그룹핑해도 하나도 드롭되지 않는다', () => {
    // 준비 — 렌더 없이 모듈의 PREVIEW_STATES 배열을 그대로 읽는다.
    // 단언 ① — 대규모 기계 편집에서 엔트리가 하나도 안 빠졌다(실측 166개, TRIP-649로 saved-places-empty +1).
    expect(PREVIEW_STATES).toHaveLength(166);

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
