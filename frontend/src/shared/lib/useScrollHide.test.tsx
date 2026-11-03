import { Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useScrollHide } from './useScrollHide';

/**
 * `useScrollHide` 단위 — "세로 스크롤 중이면 hidden" 을 돌려주는 공용 훅(TRIP-1555: 홈의 인라인 로직을
 * 탐색 랜딩·장소 탐색 d04 와 같이 쓰려고 승격). 이벤트가 올 때마다 숨김을 연장해 **마지막 이벤트로부터**
 * settleMs(기본 250) 뒤에 다시 보인다(디바운스). 3동작: 준비=하네스 렌더 → 실행=스크롤 이벤트·시간 진행 → 단언=글자.
 *
 * TRIP-1733 — `onScroll` 이 Reanimated worklet 핸들러가 되어 평범한 함수로 부를 수 없으므로, 실제 화면처럼
 * `Animated.ScrollView` 에 꽂은 하네스에 `fireEvent.scroll` 을 쏜다.
 *
 * 개념: 가짜 타이머(`jest.useFakeTimers`)는 시계를 우리가 돌린다 — `advanceTimersByTime(ms)` 로만 시간이 간다.
 * 가짜 타이머는 `queueMicrotask` 도 가짜로 바꾼다 — worklet 이 `runOnJS` 로 미룬 상태 변경도 시계를 돌려야 반영된다.
 */

let renders = 0;

function Harness({
  keepVisible,
  settleMs,
}: {
  keepVisible?: boolean;
  settleMs?: number;
}) {
  renders += 1;
  const { hidden, onScroll } = useScrollHide(keepVisible, settleMs);
  return (
    <>
      <Animated.ScrollView
        testID="harness-scroll"
        onScroll={onScroll}
        scrollEventThrottle={16}
      />
      <Text testID="harness-state">{hidden ? '숨김' : '보임'}</Text>
    </>
  );
}

// 가짜 시계·렌더 카운터는 파일 최상위에서 켜고 되돌린다(02a ★10).
beforeEach(() => {
  renders = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

// 세 필드를 다 싣는다 — FlatList 는 layoutMeasurement 가 없으면 던진다(02a ★3).
const SCROLL_EVENT = {
  nativeEvent: {
    contentOffset: { x: 0, y: 120 },
    contentSize: { width: 390, height: 2000 },
    layoutMeasurement: { width: 390, height: 600 },
  },
};

const tick = (ms: number) => act(() => jest.advanceTimersByTime(ms));

/** 스크롤 한 번 — 뒤의 0ms 는 runOnJS 가 미룬 상태 변경(가짜 마이크로태스크)을 비운다. 경계 계산엔 영향 없음(02a ★2). */
function scroll() {
  fireEvent.scroll(screen.getByTestId('harness-scroll'), SCROLL_EVENT);
  tick(0);
}

const expectState = (state: '숨김' | '보임') =>
  expect(screen.getByTestId('harness-state')).toHaveTextContent(state);

describe('useScrollHide — 스크롤 중 숨김', () => {
  // 앵커가 "숨김"까지 단언해야 핸들러가 0회 돌 때 red 가 난다(02a ★1).
  it('스크롤 전엔 보이고, 스크롤 이벤트가 오면 곧바로 숨는다(앵커)', () => {
    render(<Harness />);
    expectState('보임');

    scroll();

    expectState('숨김');
  });

  it('마지막 스크롤로부터 250ms 에 다시 보인다 — 249ms 는 아직 숨김(경계)', () => {
    render(<Harness />);
    scroll();

    tick(249);
    expectState('숨김');

    tick(1);
    expectState('보임');
  });

  it('settleMs 를 넘기면 그 시간으로 재표시한다', () => {
    render(<Harness settleMs={100} />);
    scroll();

    tick(99);
    expectState('숨김');

    tick(1);
    expectState('보임');
  });

  // 5-b W1 — 복귀 때 "스크롤 중" 표시를 되돌리지 않으면 두 번째 제스처부터 안 숨는다. 한 번만 쏘는 it 들은 이걸 못 본다.
  it('멈춘 뒤 다시 스크롤하면 또 숨는다(두 번째 제스처)', () => {
    render(<Harness />);
    scroll();
    tick(250);
    expectState('보임');

    scroll();

    expectState('숨김');
  });

  it('스크롤이 이어지면 숨김이 연장된다(디바운스)', () => {
    render(<Harness />);
    scroll();
    tick(200);
    scroll();

    // 첫 이벤트 기준 250ms 는 이미 지났지만(=449 중 250) 두 번째 이벤트 기준으로는 1ms 남았다.
    tick(249);
    expectState('숨김');

    tick(1);
    expectState('보임');
  });

  it('연타(16ms 간격 10회)해도 재렌더가 폭주하지 않는다', () => {
    render(<Harness />);
    scroll();
    const afterFirst = renders;

    for (let i = 0; i < 10; i += 1) {
      tick(16);
      scroll();
    }

    // 같은 값 setState 는 React 가 한 번 더 그린 뒤 건너뛴다(실측) — "0" 이 아니라 "≤1" 이 올바른 계약이다.
    expect(renders - afterFirst).toBeLessThanOrEqual(1);
  });
});

describe('useScrollHide — keepVisible(담은 곳 메뉴 열림)', () => {
  it('keepVisible 이면 스크롤해도 숨기지 않는다', () => {
    render(<Harness keepVisible />);

    scroll();

    expectState('보임');
  });

  it('keepVisible 은 파생이다 — 스크롤 도중 열면 즉시 보이고, 창이 안 끝났을 때 닫으면 다시 숨는다', () => {
    render(<Harness keepVisible={false} />);
    scroll();
    expectState('숨김');

    screen.rerender(<Harness keepVisible />);
    expectState('보임');

    screen.rerender(<Harness keepVisible={false} />);
    expectState('숨김');

    tick(250);
    expectState('보임');
  });
});

describe('useScrollHide — 정리', () => {
  it('언마운트하면 대기 중인 예약이 남지 않는다', () => {
    render(<Harness />);
    scroll();
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    screen.unmount();
    // 정리가 UI 런타임으로 미뤄질 수 있어 0ms 를 흘린 뒤 센다 — 0ms 로는 250ms 예약이 만료되지 않는다(02a ★12).
    tick(0);

    expect(jest.getTimerCount()).toBe(0);
  });
});
