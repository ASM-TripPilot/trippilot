import { View } from 'react-native';
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { TOAST_VISIBLE_MS, ToastHost, hideToast, showToast } from './Toast';
import * as toastBottom from './toastBottom';

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
 * TRIP-1286 — 형상 토큰·실제 겹침 없음은 실화면 QA 몫. 하단 위치는 TRIP-1559 부터 화면마다 달라진다(아래 T7 — 숫자 자체는 단언하지
 * 않고 "순수 함수의 출력이 호스트에 전달되는가"만 본다. 실제로 어디에 보이는가는 6-b).
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
  // 바닥 레지스트리도 모듈 싱글턴이다 — hideToast 는 (자동 숨김에도 불리므로) 레지스트리를 비우면 안 되고, 리셋은 여기서 따로 한다.
  act(() => toastBottom.resetToastBottoms());
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

describe('🔴 T6·T7 · 바닥은 순수 함수의 출력으로 정한다 (TRIP-1559)', () => {
  // `resolveToastBottom` 을 실물 그대로 감시한다 — 어떤 인자로 불렸고 그 반환값이 호스트의 `bottom` 이 됐는지가 배선이다.
  // 반환값을 스파이에서 읽어 비교하므로 이 파일에 위치 숫자(px) 리터럴은 없다.
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest.spyOn(toastBottom, 'resolveToastBottom');
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  function lastArgs(): unknown[] {
    const call = resolveSpy.mock.lastCall;
    if (call === undefined) {
      throw new Error('호스트가 resolveToastBottom 을 부르지 않았다');
    }
    return call;
  }

  function lastResult(): unknown {
    return resolveSpy.mock.results[resolveSpy.mock.results.length - 1]?.value;
  }

  it('T6 SafeAreaProvider·내비게이션 없이 그려도 throw 하지 않고, 등록이 없으면 ([], 인셋 0) 으로 묻는다', () => {
    renderHost();

    show('A 문구', 'toast-a');

    expect(screen.getByTestId('toast-a')).toBeOnTheScreen();
    expect(lastArgs()).toEqual([[], 0]);
    expect(screen.getByTestId('toast-a')).toHaveStyle({
      bottom: lastResult() as number,
    });
  });

  it('T7 하단 인셋은 SafeArea 컨텍스트에서 읽어 그대로 넘긴다', () => {
    render(
      <SafeAreaInsetsContext.Provider
        value={{ top: 47, bottom: 34, left: 0, right: 0 }}
      >
        <ToastHost />
      </SafeAreaInsetsContext.Provider>
    );

    show('A 문구', 'toast-a');

    expect(lastArgs()).toEqual([[], 34]);
  });

  it('T7 토스트가 떠 있는 동안 등록이 바뀌면 호스트가 다시 계산해 그 값을 쓰고, 해제하면 되돌아온다', () => {
    renderHost();
    show('A 문구', 'toast-a');
    expect(lastArgs()).toEqual([[], 0]);

    // 실행 — 한 화면이 "아래 70 을 막고 있다"고 신고.
    let release = () => {};
    act(() => {
      release = toastBottom.registerToastBottom(70);
    });

    expect(lastArgs()).toEqual([[70], 0]);
    expect(screen.getByTestId('toast-a')).toHaveStyle({
      bottom: lastResult() as number,
    });

    // 해제하면 다시 비어 있는 때의 인자로 계산한다.
    act(() => release());
    expect(lastArgs()).toEqual([[], 0]);
  });

  it('(금지) 토스트가 자동으로 사라져도 등록은 지워지지 않아, 다음 토스트도 그 등록을 따른다', () => {
    // hideToast 는 타이머 만료에도 불린다 — 거기서 레지스트리까지 비우면 포커스 화면의 신고가 첫 토스트 뒤에 사라진다.
    renderHost();
    act(() => {
      toastBottom.registerToastBottom(70);
    });
    show('A 문구', 'toast-a');
    advance(TOAST_VISIBLE_MS);
    expect(screen.queryByTestId('toast-a')).toBeNull();

    show('B 문구', 'toast-b');

    expect(toastBottom.getToastBottoms()).toEqual([70]);
    expect(lastArgs()).toEqual([[70], 0]);
  });
});
