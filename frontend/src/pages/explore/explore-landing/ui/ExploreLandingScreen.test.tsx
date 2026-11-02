import { render, screen } from '@testing-library/react-native';

import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
} from './ExploreLandingScreen';

/**
 * d01 탐색 랜딩 — **출시 게이트 ⑤(접근성 하한, 44pt)만** 남긴 뷰 단위.
 *
 * 화면 동작은 B안(2026-11-01, README §테스트 전략 판정 4)으로 `ExploreLandingPage.test.tsx`·
 * `ExploreLandingPage.integration.test.tsx` 가 지킨다. 지역 칩 ✕ 는 보이는 크기 20 + hitSlop 12 = 44 라
 * README 판정 3 「출시 게이트로 남기는 생김새 검사」 ⑤ 대상이고, hitSlop 은 렌더 결과로만 보인다.
 */

function baseProps(): ExploreLandingScreenProps {
  return {
    heading: { title: '무엇을 둘러볼까요?', subtitle: '' },
    onPressSearch: jest.fn(),
    regionFilter: { label: '부산광역시', onClear: jest.fn() },
    stayLane: {
      error: false,
      cards: [],
      onRetry: jest.fn(),
      onSeeAll: jest.fn(),
    },
    savedMenu: {
      open: false,
      savedCount: 0,
      onToggle: jest.fn(),
      onPressSavedPlaces: jest.fn(),
      onPressSavedStays: jest.fn(),
    },
  };
}

/** hitSlop(숫자 또는 네 변 객체)의 가장 좁은 변. 없으면 0. */
function minHitSlop(hitSlop: unknown): number {
  if (typeof hitSlop === 'number') return hitSlop;
  if (hitSlop && typeof hitSlop === 'object') {
    const h = hitSlop as Record<string, number | undefined>;
    return Math.min(h.top ?? 0, h.bottom ?? 0, h.left ?? 0, h.right ?? 0);
  }
  return 0;
}

describe('출시 게이트 ⑤ · 지역 칩 ✕ 터치 영역', () => {
  it('✕ 는 버튼 역할이고 hitSlop 네 변이 모두 12 이상이다(시각 20 + hitSlop 12 = 히트 44)', () => {
    render(<ExploreLandingScreen {...baseProps()} />);

    const clear = screen.getByTestId('explore-region-chip-clear');
    expect(clear).toHaveProp('accessibilityRole', 'button');
    expect(minHitSlop(clear.props.hitSlop) >= 12).toBe(true);
  });
});
