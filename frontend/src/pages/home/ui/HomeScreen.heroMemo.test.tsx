import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { HOME_DEFAULT_PROPS } from '../model/homeFixtures';
import { HomeScreen } from './HomeScreen';

/**
 * TRIP-1349 — 히어로 캐러셀 스와이프(page state 변경)가 슬라이드 컴포넌트(MagazineHero)를 다시 그리지
 * 않는다. 슬라이드마다 LinearGradient 1개라, 스와이프 전후 호출 수 증가 0 이 곧 "슬라이드 5장 재렌더 0"이다.
 * 짝: 도트(page 를 읽는 쪽)는 실제로 갱신된다.
 */
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: jest.fn(() => null),
}));

describe('TRIP-1349 · 홈 히어로 캐러셀 memo', () => {
  it('H1 · 스와이프로 page 가 바뀌어도 슬라이드는 재렌더되지 않고 도트만 갱신된다', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);
    const gradient = LinearGradient as unknown as jest.Mock;
    const dotClass = (i: number): string =>
      screen.getByTestId(`home-hero-dot-${i}`).props.className as string;
    expect(dotClass(1)).toContain('opacity-50');

    const pager = screen.getByTestId('home-hero-page-0').parent!;
    const before = gradient.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    fireEvent(pager, 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 390, y: 0 } },
    });

    expect(dotClass(1)).not.toContain('opacity-50');
    expect(gradient.mock.calls.length).toBe(before);
  });

  it('H2 · 컬렉션 카드는 배경 없는 overflow-hidden 노드에 그림자를 얹지 않는다(잘려 안 보이는 오프스크린 비용)', () => {
    render(<HomeScreen {...HOME_DEFAULT_PROPS} />);
    expect(
      screen.getByTestId('home-collection-card-0').props.style
    ).toBeUndefined();
  });
});
