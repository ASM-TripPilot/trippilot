import { fireEvent, render, screen } from '@testing-library/react-native';

import { BottomTabBar } from './BottomTabBar';

/**
 * AC-6~AC-8 · Q4 — 순수 뷰 탭바(`shared/ui/BottomTabBar`).
 *
 * 무엇을 보장하나: 탭바는 네비게이션을 몰라야 한다(`activeKey`·`onPressTab` prop만으로
 * 동작하는 순수 뷰) — 5탭 렌더 · 활성/비활성 표시 · press 콜백 세 가지를 이 파일이 잠근다.
 * Q4(탭바 전면 커스텀)가 요구하는 접근성 속성(`accessibilityRole="tab"`·
 * `accessibilityState.selected`) 수동 보강이 여기서 강제된다.
 */

const TAB_KEYS = ['home', 'explore', 'itinerary', 'records', 'my'] as const;

// key ↔ Figma 라벨 텍스트 매핑 — B-1이 5개 라벨 전부를 확인한다.
const TAB_LABELS: Record<(typeof TAB_KEYS)[number], string> = {
  home: '홈',
  explore: '탐색',
  itinerary: '일정',
  records: '기록',
  my: '마이',
};

describe('BottomTabBar — 5탭 렌더 (AC-6 · Q4 접근성)', () => {
  it('5개 탭 testID·라벨과 accessibilityRole=tab 요소 5개가 렌더된다', () => {
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    TAB_KEYS.forEach((key) => {
      expect(screen.getByTestId(`shell-tabbar-tab-${key}`)).toBeOnTheScreen();
      expect(screen.getByText(TAB_LABELS[key])).toBeOnTheScreen();
    });

    // Q4: 접근성 수동 보강의 계약 — 5개 탭 모두 role="tab"이어야 한다.
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });
});

describe('BottomTabBar — 활성/비활성 (AC-7)', () => {
  it('activeKey에 해당하는 탭만 selected + 채움 글리프이고, rerender로 활성 탭이 옮겨간다', () => {
    const { rerender } = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );

    // home만 selected + 채움(active) 글리프, 아웃라인(inactive) 글리프는 없다(배타).
    expect(screen.getByTestId('shell-tabbar-tab-home')).toBeSelected();
    expect(
      screen.getByTestId('shell-tabbar-icon-home-active')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('shell-tabbar-icon-home-inactive')).toBeNull();

    // 나머지 4탭은 반대(비활성) 상태.
    TAB_KEYS.filter((key) => key !== 'home').forEach((key) => {
      expect(screen.getByTestId(`shell-tabbar-tab-${key}`)).not.toBeSelected();
      expect(
        screen.getByTestId(`shell-tabbar-icon-${key}-inactive`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`shell-tabbar-icon-${key}-active`)
      ).toBeNull();
    });

    // rerender: 같은 트리에 새 props를 흘려 넣는다(라우트 전환 시 활성 탭 이동의 축소판).
    rerender(<BottomTabBar activeKey="records" onPressTab={jest.fn()} />);

    expect(screen.getByTestId('shell-tabbar-tab-records')).toBeSelected();
    expect(
      screen.getByTestId('shell-tabbar-icon-records-active')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('shell-tabbar-tab-home')).not.toBeSelected();
    expect(
      screen.getByTestId('shell-tabbar-icon-home-inactive')
    ).toBeOnTheScreen();
  });
});

describe('BottomTabBar — press 콜백 (AC-8)', () => {
  it('탭을 누르면 onPressTab이 눌린 순서대로 해당 key로 호출된다', () => {
    const onPressTab = jest.fn();
    render(<BottomTabBar activeKey="home" onPressTab={onPressTab} />);

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-explore'));
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-my'));

    expect(onPressTab).toHaveBeenNthCalledWith(1, 'explore');
    expect(onPressTab).toHaveBeenNthCalledWith(2, 'my');
  });
});
