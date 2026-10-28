import { View } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import {
  TOAST_ACTION_VISIBLE_MS,
  TOAST_VISIBLE_MS,
  ToastHost,
  hideToast,
  showToast,
} from './Toast';
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

/**
 * TRIP-1618 · T8~T12 — 토스트 계약 확장: 옵셔널 "액션 버튼"(`action`)과 오류 톤(`tone`).
 *
 * *(개념)* 액션 = 토스트 오른쪽의 텍스트 버튼("보기"). 누르면 소비처가 넘긴 `onPress` 를 부르고 토스트는 사라진다.
 * 지금까지 토스트는 `pointerEvents="none"`(터치가 그냥 통과)이었다 — 버튼을 받으려면 컨테이너는 `box-none`(자기는 통과, 자식만 터치 수신)이어야 한다.
 *
 * 무엇을 보장하나:
 *  - T8 `action` 이 없으면 옛 토스트와 똑같다(버튼 없음·성공 체크·터치 통과·표시 시간 그대로).
 *  - T9 `action` 이 있으면 `{testID}-action` 버튼이 라벨과 함께 보이고 컨테이너가 `box-none` 이 된다.
 *  - T10 누르면 `onPress` 가 정확히 1번 불리고 토스트가 사라지며 타이머가 남지 않는다 — 한 렌더 안의 연타도 1번이다.
 *  - T11 액션 토스트는 읽고 누를 시간이 있도록 더 오래(`TOAST_ACTION_VISIBLE_MS`) 떠 있다.
 *  - T12 `tone:'error'` 면 성공 체크 대신 오류 아이콘이다.
 *
 * jest 가 못 보는 것: 버튼 아래 영역의 터치가 실제로 아래 화면에 통과하는지·버튼이 눌리는지(실측: RNTL 의 `fireEvent.press` 는
 * 부모 `pointerEvents="none"` 을 무시한다) — 그래서 컨테이너의 `pointerEvents` 값을 단언하고, 실제 터치는 6-b 실기가 본다.
 * 모양(Figma NoticeBar 4464:1583/1598)도 6-b.
 */

function showWithAction(
  testID: string,
  onPress: () => void,
  extra: { tone?: 'success' | 'error' } = {}
): void {
  act(() =>
    showToast({
      message: 'A 문구',
      testID,
      action: { label: '보기', onPress },
      ...extra,
    })
  );
}

describe('🔴 T8 · action 이 없으면 옛 토스트와 같다 (AC6①)', () => {
  it('버튼이 없고, 성공 체크만 있고, 터치는 통과(none)하며, 표시 시간은 그대로다', () => {
    renderHost();
    expect(screen.queryByTestId('toast-a')).toBeNull();

    show('A 문구', 'toast-a');

    expect(screen.getByTestId('toast-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-a-action')).toBeNull();
    expect(screen.getByTestId('toast-a-success-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-a-error-icon')).toBeNull();
    expect(screen.getByTestId('toast-a')).toHaveProp('pointerEvents', 'none');

    advance(TOAST_VISIBLE_MS);
    expect(screen.queryByTestId('toast-a')).toBeNull();
  });
});

describe('🔴 T9 · action 이 있으면 버튼이 라벨과 보인다 (AC6②)', () => {
  it('{testID}-action 버튼에 라벨이 있고, 컨테이너는 자식 터치만 받는다(box-none)', () => {
    renderHost();
    expect(screen.queryByTestId('toast-a-action')).toBeNull();

    showWithAction('toast-a', jest.fn());

    const button = screen.getByTestId('toast-a-action');
    expect(within(button).getByText('보기')).toBeOnTheScreen();
    expect(screen.getByTestId('toast-a')).toHaveProp(
      'pointerEvents',
      'box-none'
    );
    // 본문 문구도 그대로 보인다.
    expect(
      within(screen.getByTestId('toast-a')).getByText('A 문구')
    ).toBeOnTheScreen();
  });
});

describe('🔴 T10 · 누르면 onPress 1번 + 사라진다 (AC6②)', () => {
  it('누르면 onPress 를 1번 부르고 토스트가 사라지며 타이머가 남지 않는다', () => {
    const onPress = jest.fn();
    renderHost();
    showWithAction('toast-a', onPress);
    expect(onPress).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('toast-a-action'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(PROBE_ROOT)).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-a')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('한 렌더 안에서 두 번 눌러도 onPress 는 1번이다 (연타)', () => {
    const onPress = jest.fn();
    renderHost();
    showWithAction('toast-a', onPress);
    const button = screen.getByTestId('toast-a-action');

    // 한 act 로 묶는다 — 순서대로 누르면 첫 누름이 버튼을 지워 잠금이 없어도 1번으로 보인다(02a ★3).
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 T11 · 액션 토스트는 더 오래 떠 있다 (AC6④)', () => {
  it('TOAST_ACTION_VISIBLE_MS 는 TOAST_VISIBLE_MS 보다 길고, 그 시간 직전까지 보이다가 사라진다', () => {
    expect(TOAST_ACTION_VISIBLE_MS).toBeGreaterThan(TOAST_VISIBLE_MS);
    renderHost();
    showWithAction('toast-a', jest.fn());

    // 일반 토스트가 사라지는 시간이 지나도 아직 보인다.
    advance(TOAST_VISIBLE_MS);
    expect(screen.getByTestId('toast-a')).toBeOnTheScreen();

    advance(TOAST_ACTION_VISIBLE_MS - TOAST_VISIBLE_MS - 1);
    expect(screen.getByTestId('toast-a')).toBeOnTheScreen();

    advance(1);
    expect(screen.queryByTestId('toast-a')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('액션 토스트를 일반 토스트가 교체하면 시간이 TOAST_VISIBLE_MS 로 돌아온다', () => {
    renderHost();
    showWithAction('toast-a', jest.fn());

    show('B 문구', 'toast-b');

    advance(TOAST_VISIBLE_MS - 1);
    expect(screen.getByTestId('toast-b')).toBeOnTheScreen();
    advance(1);
    expect(screen.queryByTestId('toast-b')).toBeNull();
  });
});

describe('🔴 T12 · 오류 톤 (AC6③)', () => {
  it("tone:'error' 면 오류 아이콘만, 생략하거나 'success' 면 성공 체크만 그린다", () => {
    renderHost();

    showWithAction('toast-e', jest.fn(), { tone: 'error' });
    expect(screen.getByTestId('toast-e-error-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-e-success-icon')).toBeNull();

    showWithAction('toast-s', jest.fn(), { tone: 'success' });
    expect(screen.getByTestId('toast-s-success-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-s-error-icon')).toBeNull();

    showWithAction('toast-d', jest.fn());
    expect(screen.getByTestId('toast-d-success-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('toast-d-error-icon')).toBeNull();
  });
});
