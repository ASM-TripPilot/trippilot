import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * SC-6 — dev 정적 프리뷰의 홈 상태 2키(default·loading). TRIP-701 로 no-trip·empty 프리뷰 키를
 * 삭제해 4→2 로 줄었다(no-trip 은 default 와 바이트 동일이라 병합, empty 픽스처는 통째 제거).
 *
 * 무엇을 보장하나: `_dev/preview.tsx`가 홈 2상태를 딥링크(`?state=home-*`)로 초기 조준하고,
 * 정식 토글로도 진입되며, 미존재 키는 결정론적으로 splash로 폴백한다(INV-4 정신) — 전부
 * 동결 `devPreview.test.tsx`·`devPreviewDeepLink.test.tsx`가 로그인·온보딩 상태에 대해
 * 이미 검증한 것과 같은 계약을 **홈 관점**에서 잠근다.
 *
 * 왜 신규 파일인가: 동결 `devPreview.test.tsx`·`devPreviewDeepLink.test.tsx`는 게이트①
 * 해시 동결 대상이라 수정할 수 없다 — 그래서 홈 키 검증은 새 파일로 추가한다.
 *
 * 지뢰 `@/shared/api`: 홈은 프레젠테이션 전용이라 네트워크 계층을 절대 로드하면 안 된다
 * (브리프 §6-1). 이 목은 그 모듈이 **전이 의존까지 포함해** require되는 순간 즉시
 * 예외를 던진다 — 동결 devPreview.test의 지뢰 장치를 홈 경유로 계승한다.
 */

// jest.mock 팩토리는 파일 상단으로 호이스트되지만 `mock` 접두 변수는 참조가 허용된다 —
// devPreviewDeepLink.test.tsx와 같은 패턴으로 딥링크 쿼리 파라미터를 흉내낸다.
const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// @gorhom/bottom-sheet은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다
// (수동 목: __mocks__/@gorhom/bottom-sheet.tsx — 동결 devPreview.test와 같은 장치).
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 홈이 이 모듈을 (직접이든 전이든) require하면 즉시 터진다. 홈은 프레젠테이션
// 전용이라 네트워크 계층을 로드하면 회귀다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '홈 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

// 딥링크 상태 키 2개 ↔ 그 상태에 나타나는 실물 홈 마커(신 프레임 재정합). TRIP-701 프리뷰 정리로
// no-trip(default 와 바이트 동일이라 병합)·empty(픽스처 통째 삭제) 두 케이스를 뺐다(4→2).
// 남은 default·loading 은 preview.tsx 에 존속하는 키라 이 딥링크 조준 계약은 무회귀(제거는 완화라
// 지금도 green, 구현 후에도 green — 삭제 키는 애초에 미존재가 될 뿐).
const HOME_DEEP_LINK_CASES = [
  { state: 'home-default', marker: 'home-collection-card-0' },
  { state: 'home-loading', marker: 'home-collections-skeleton' },
] as const;

describe('dev 프리뷰 홈 2키 — 딥링크 초기 조준 (SC-6 · E-1)', () => {
  it.each(HOME_DEEP_LINK_CASES)(
    'state=$state로 열면 $marker가 초기 렌더된다',
    ({ state, marker }) => {
      mockSearchParams.state = state;

      render(<DevPreview />);

      // 토글을 누르지 않았다 — 딥링크만으로 이 마커가 떠야 자동 조준이 성립한다.
      expect(screen.getByTestId(marker)).toBeOnTheScreen();
    }
  );
});

describe('dev 프리뷰 홈 — 토글로도 진입되는 정식 상태 (SC-6 · E-2)', () => {
  it('딥링크 없이 열어 home-default 토글을 누르면 컬렉션 카드 마커가 그려진다', () => {
    render(<DevPreview />);

    fireEvent.press(screen.getByTestId('dev-preview-state-home-default'));

    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
  });
});

describe('dev 프리뷰 홈 — 결정론 유지 (E-3)', () => {
  it('존재하지 않는 홈 키는 splash로 폴백하고 홈 루트는 그려지지 않는다', () => {
    mockSearchParams.state = 'home-nope';

    render(<DevPreview />);

    // 홈 키 2개(default·loading)를 둔 뒤에도 폴백 결정론(INV-4 정신)이 유지되는지 확인한다.
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-dashboard-root')).toBeNull();
  });
});
