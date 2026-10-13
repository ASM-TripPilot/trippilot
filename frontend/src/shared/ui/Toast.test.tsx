import { View } from 'react-native';
import { act, render, screen, within } from '@testing-library/react-native';

import {
  TOAST_VISIBLE_MS,
  ToastHost,
  hideToast,
  showToast,
  useRaisedToastBottom,
} from './Toast';

/**
 * TRIP-990 · T1~T3 — 공용 토스트 primitive(스토어 + 호스트 + 호출 함수).
 *
 * *(개념)* 토스트 = 화면 위에 잠깐 떴다 사라지는 한 줄 알림. 화면은 `showToast` 로 "이 문구를 띄워 줘"
 * 라고 요청만 하고, 실제로 그리는 것은 루트에 한 번 둔 `ToastHost` 다. 그래서 요청한 화면이 닫혀도
 * 토스트는 남는다.
 *
 * 무엇을 보장하나:
 *  - T1 띄우면 그 testID 가 문구와 함께 보이고, 띄우기 전에는 없다.
 *  - T2 정해 둔 표시 시간(`TOAST_VISIBLE_MS`)이 지나면 사라진다. 1ms 전에는 아직 보인다.
 *  - T3 한 번에 하나 — 연달아 띄우면 나중 것만 남고, 나중 것의 표시 시간은 새로 센다.
 *  - `hideToast` 는 즉시 지우고 자동 숨김 타이머까지 없앤다(테스트 사이 리셋 장치).
 *
 * TRIP-1286 — 하단 위치(`bottom-[220px]`)·형상 토큰·실제 겹침 없음은 실화면 QA 몫.
 *
 * 3동작 뼈대: 준비=가짜 타이머 + 호스트 렌더 → 실행=showToast / 시간 흘리기 → 단언=보임·사라짐.
 */

const PROBE_ROOT = 'toast-probe-root';

function renderHost(): void {
  render(
    <>
      <View testID={PROBE_ROOT} />
      <ToastHost />
    </>
  );
}

function show(message: string, testID: string): void {
  act(() => showToast({ message, testID }));
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  act(() => hideToast());
  jest.useRealTimers();
});

describe('🔴 T1 · 띄우기 (D19)', () => {
  it('띄우기 전에는 없고, showToast 뒤에는 그 testID 가 문구와 함께 보인다', () => {
    renderHost();

    // 짝: 트리는 살아 있는데 토스트만 없다.
    expect(screen.getByTestId(PROBE_ROOT)).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-a')).toBeNull();

    show('A 문구', 'toast-a');

    const toast = screen.getByTestId('toast-a');
    expect(within(toast).getByText('A 문구')).toBeOnTheScreen();
  });
});

describe('🔴 T2 · 자동으로 사라짐', () => {
  it('표시 시간 1ms 전에는 보이고, 시간이 되면 사라지며 타이머가 남지 않는다', () => {
    renderHost();
    show('A 문구', 'toast-a');

    advance(TOAST_VISIBLE_MS - 1);
    expect(screen.getByTestId('toast-a')).toBeOnTheScreen();

    advance(1);
    expect(screen.getByTestId(PROBE_ROOT)).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-a')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('🔴 T3 · 한 번에 하나', () => {
  it('연달아 띄우면 나중 문구 하나만 보인다', () => {
    renderHost();

    show('A 문구', 'toast-a');
    show('B 문구', 'toast-b');

    expect(screen.queryByTestId('toast-a')).toBeNull();
    expect(
      within(screen.getByTestId('toast-b')).getByText('B 문구')
    ).toBeOnTheScreen();
  });

  it('나중 토스트의 표시 시간은 새로 센다 — 앞 토스트의 만료 시점에 같이 지워지지 않는다', () => {
    renderHost();
    const half = Math.floor(TOAST_VISIBLE_MS / 2);

    show('A 문구', 'toast-a');
    advance(half);
    show('B 문구', 'toast-b');

    // A 가 원래 사라졌을 시점을 지나도 B 는 남는다.
    advance(TOAST_VISIBLE_MS - half + 1);
    expect(screen.getByTestId('toast-b')).toBeOnTheScreen();

    // B 자기 시간이 다 되면 사라진다.
    advance(TOAST_VISIBLE_MS);
    expect(screen.queryByTestId('toast-b')).toBeNull();
  });
});

describe('🔴 리셋 장치 · hideToast (01b Q1 — 테스트 간 싱글턴 리셋·타이머 정리)', () => {
  it('즉시 지우고 대기 중인 자동 숨김 타이머도 없앤다', () => {
    renderHost();
    show('A 문구', 'toast-a');
    expect(screen.getByTestId('toast-a')).toBeOnTheScreen();

    act(() => hideToast());

    expect(screen.getByTestId(PROBE_ROOT)).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-a')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});

// TRIP-1321 · G-U8-10 · BR-U8-52 — ✦ 도우미 FAB 가 있는 화면은 토스트 바닥을 ✦ 윗변 + 12(288)로 올린다.
// 올림은 그 화면이 붙어 있는 동안만 — 떨어지면 기본 220 으로 돌아간다. 실제 겹침 없음은 6-b 실기.
describe('🔴 위치 · 화면이 토스트 바닥을 올린다 (TRIP-1321)', () => {
  function Raiser({ bottom }: { bottom?: number }) {
    useRaisedToastBottom(bottom);
    return null;
  }

  it('올림이 붙어 있으면 그 바닥(style.bottom)에, 떨어지면 기본 220 토큰으로 돌아간다', () => {
    const { rerender } = render(
      <>
        <Raiser bottom={288} />
        <ToastHost />
      </>
    );
    show('A 문구', 'toast-a');
    const raised = screen.getByTestId('toast-a');
    expect(raised.props.style).toEqual(
      expect.objectContaining({ bottom: 288 })
    );

    rerender(
      <>
        <Raiser />
        <ToastHost />
      </>
    );
    const lowered = screen.getByTestId('toast-a');
    expect(lowered.props.style?.bottom).toBeUndefined();
  });

  it('여러 화면이 올리면 가장 높은 값을 쓴다(어느 ✦ 와도 안 겹치게)', () => {
    render(
      <>
        <Raiser bottom={152} />
        <Raiser bottom={288} />
        <ToastHost />
      </>
    );
    show('A 문구', 'toast-a');
    expect(screen.getByTestId('toast-a').props.style).toEqual(
      expect.objectContaining({ bottom: 288 })
    );
  });
});
