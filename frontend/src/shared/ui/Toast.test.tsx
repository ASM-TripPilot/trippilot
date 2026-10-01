import { View } from 'react-native';
import { act, render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { Path } from 'react-native-svg';

import { TOAST_VISIBLE_MS, ToastHost, hideToast, showToast } from './Toast';

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
 *  - 형상: Figma NoticeBar tone=success 토큰(`bg-canvas`·`border-hairline`·`rounded-button`) + success 체크.
 *
 * 커버하지 않는 것: 화면 하단 위치·픽셀·네비게이션 뒤 실제 표시는 6-b 실기.
 *
 * 3동작 뼈대: 준비=가짜 타이머 + 호스트 렌더 → 실행=showToast / 시간 흘리기 → 단언=보임·사라짐.
 */

const PROBE_ROOT = 'toast-probe-root';
const SUCCESS_STROKE = '#0E9384';

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

function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
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

describe('🔴 비주얼 · NoticeBar tone=success 토큰 (구조 가드)', () => {
  it('배경·테두리·반경 토큰을 쓰고, success 색 체크 글리프를 품는다', () => {
    renderHost();
    show('A 문구', 'toast-a');

    const toast = screen.getByTestId('toast-a');
    const tokens = classTokens(toast);
    expect(tokens).toContain('bg-canvas');
    expect(tokens).toContain('border-hairline');
    expect(tokens).toContain('rounded-button');

    const strokes = toast
      .findAll((node) => node.type === Path)
      .map((node) => String(node.props.stroke ?? '').toUpperCase());
    expect(strokes).toContain(SUCCESS_STROKE);
  });
});
