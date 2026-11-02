import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  BottomTabBar,
  TAB_BAR_MIN_HEIGHT,
  TAB_BAR_PADDING_TOP,
  TAB_BAR_TOP,
} from './BottomTabBar';
import { getToastBottoms, resetToastBottoms } from './toastBottom';

/**
 * AC-6~AC-8 · Q4 — 순수 뷰 탭바(`shared/ui/BottomTabBar`).
 *
 * 무엇을 보장하나: 탭바는 네비게이션을 몰라야 한다(`activeKey`·`onPressTab` prop만으로
 * 동작하는 순수 뷰) — 5탭 렌더 · 활성/비활성 표시 · press 콜백 세 가지를 이 파일이 잠근다.
 * Q4(탭바 전면 커스텀)가 요구하는 접근성 속성(`accessibilityRole="tab"`·
 * `accessibilityState.selected`) 수동 보강이 여기서 강제된다.
 */

// TRIP-1559 — 토스트 바닥 레지스트리는 모듈 싱글턴이다. 파일 최상위(describe 밖)에서 리셋해야 앞 테스트의 신고가 안 샌다.
afterEach(() => resetToastBottoms());

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

describe('BottomTabBar — 토스트 바닥 신고 (TRIP-1559 T4·T5)', () => {
  it('내비게이션 없이 그려도 throw 하지 않고, 그리는 동안 알약 윗변(TAB_BAR_TOP)을 신고하며 unmount 로 해제한다', () => {
    // 준비 — 그리기 전엔 신고가 없다(앵커).
    expect(getToastBottoms()).toEqual([]);

    // 실행 — 네비게이터 밖 단독 렌더.
    const view = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );

    // 단언 — 상수는 import 해서 비교한다(리터럴 복제 금지). 값 자체는 6-b 가 본다.
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);

    view.unmount();
    expect(getToastBottoms()).toEqual([]);
  });

  it('활성 탭이 바뀌어 다시 그려도 신고는 하나다', () => {
    const view = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );

    view.rerender(<BottomTabBar activeKey="records" onPressTab={jest.fn()} />);

    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);
  });
});

// TRIP-1642 — 띠 실측 높이로 토스트 바닥을 따라간다. jest 는 레이아웃을 계산하지 않으므로
// 띠(`shell-tabbar-root`)에 "이 높이로 확정됐다"는 layout 이벤트를 직접 쏴서 배선만 본다.
describe('BottomTabBar — 측정한 띠 높이를 토스트 바닥으로 신고 (TRIP-1642 AC1·AC2)', () => {
  const measureBand = (height: number) =>
    fireEvent(screen.getByTestId('shell-tabbar-root'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    });

  it('상수 관계: 측정 전 기본값(TAB_BAR_TOP)은 띠 최소 높이에서 위 패딩을 뺀 값이다', () => {
    expect(TAB_BAR_MIN_HEIGHT - TAB_BAR_PADDING_TOP).toBe(TAB_BAR_TOP);
  });

  it('띠가 커지면 신고값이 늘어난 만큼 따라가고, 여러 번 바뀌어도 신고는 하나이며, 언마운트로 해제된다', () => {
    // 준비 — 첫 레이아웃 전에는 기본값 하나(앵커).
    const view = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);

    // 실행·단언 — 띠가 40 커졌다 → 신고값도 40 커진다(교체, 추가 아님).
    measureBand(TAB_BAR_MIN_HEIGHT + 40);
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP + 40]);

    // 실행·단언 — 더 커지면 다시 교체. 신고가 둘로 불어나지 않는다.
    measureBand(TAB_BAR_MIN_HEIGHT + 90);
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP + 90]);

    // 단언 — 측정값이 쌓인 뒤 언마운트하면 하나도 남지 않는다(옛 항목 누수 없음).
    view.unmount();
    expect(getToastBottoms()).toEqual([]);
  });

  it('활성 탭이 바뀌어 다시 그려도 측정값이 유지된다', () => {
    const view = render(
      <BottomTabBar activeKey="home" onPressTab={jest.fn()} />
    );
    measureBand(TAB_BAR_MIN_HEIGHT + 40);

    view.rerender(<BottomTabBar activeKey="records" onPressTab={jest.fn()} />);

    expect(getToastBottoms()).toEqual([TAB_BAR_TOP + 40]);
  });

  it('기본 높이(TAB_BAR_MIN_HEIGHT)를 재면 값이 그대로이고, 커졌다 기본으로 돌아오면 기본값으로 돌아온다', () => {
    render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

    // 실행·단언 — 기본 배율 화면: 측정이 와도 값이 안 바뀐다(AC2).
    measureBand(TAB_BAR_MIN_HEIGHT);
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);

    // 실행·단언 — 글자를 키워 띠가 커졌다가, 다시 기본으로 줄면 따라 줄어든다.
    measureBand(TAB_BAR_MIN_HEIGHT + 40);
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP + 40]);
    measureBand(TAB_BAR_MIN_HEIGHT);
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);
  });

  it.each([
    ['0(비정상 측정)', 0],
    ['위 패딩과 같은 높이', TAB_BAR_PADDING_TOP],
    ['기본보다 조금 작은 높이', TAB_BAR_MIN_HEIGHT - 10],
  ])(
    '측정이 기본보다 작아도(%s) 신고값은 TAB_BAR_TOP 아래로 내려가지 않는다',
    (_label, height) => {
      render(<BottomTabBar activeKey="home" onPressTab={jest.fn()} />);

      measureBand(height);

      expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);
    }
  );
});
