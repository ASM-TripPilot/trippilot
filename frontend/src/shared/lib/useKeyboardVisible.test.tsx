import { DeviceEventEmitter, Keyboard } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useKeyboardVisible } from './useKeyboardVisible';

/**
 * `useKeyboardVisible` 단위 — "소프트 키보드가 떠 있나"를 돌려주는 공용 훅(TRIP-1524a 가 AssistantFab 인라인
 * 구독을 승격). iOS 는 Will* 이 먼저, Android 는 Did* 만 오므로 둘 다 듣는다.
 *
 * 3동작 뼈대: 준비=훅 렌더 → 실행=기기 이벤트 발사 → 단언=돌려준 불리언·남은 리스너 수.
 */

type KeyboardEventName =
  | 'keyboardWillShow'
  | 'keyboardDidShow'
  | 'keyboardWillHide'
  | 'keyboardDidHide';

const ALL_EVENTS: KeyboardEventName[] = [
  'keyboardWillShow',
  'keyboardDidShow',
  'keyboardWillHide',
  'keyboardDidHide',
];

function emitKeyboard(name: KeyboardEventName): void {
  const frame = { screenX: 0, screenY: 508, width: 390, height: 336 };
  act(() => {
    DeviceEventEmitter.emit(name, {
      startCoordinates: frame,
      endCoordinates: frame,
      duration: 250,
      easing: 'keyboard',
      isEventFromThisApp: true,
    });
  });
}

// `Keyboard` 는 "지금 떠 있나" 를 모듈 싱글턴에 기억한다 — 떠 있는 채 끝난 케이스가 다음 케이스로 새지 않게
// 파일 최상위에서 매번 내린다.
afterEach(() => {
  emitKeyboard('keyboardDidHide');
});

describe('useKeyboardVisible', () => {
  it('처음에는 false 다', () => {
    const { result } = renderHook(() => useKeyboardVisible());
    expect(result.current).toBe(false);
  });

  it.each<KeyboardEventName>(['keyboardWillShow', 'keyboardDidShow'])(
    '%s 로 키보드가 뜨면 true 가 된다',
    (showEvent) => {
      const { result } = renderHook(() => useKeyboardVisible());
      // 아직 false — 앞 케이스가 남긴 "떠 있음"이 새도 green 이 되는 것을 막는 앵커
      expect(result.current).toBe(false);

      emitKeyboard(showEvent);

      expect(result.current).toBe(true);
    }
  );

  it.each<KeyboardEventName>(['keyboardWillHide', 'keyboardDidHide'])(
    '%s 로 키보드가 내려가면 다시 false 가 된다',
    (hideEvent) => {
      const { result } = renderHook(() => useKeyboardVisible());
      emitKeyboard('keyboardDidShow');
      expect(result.current).toBe(true);

      emitKeyboard(hideEvent);

      expect(result.current).toBe(false);
    }
  );

  it('언마운트하면 구독 4종을 모두 풀고 이후 이벤트에도 경고가 없다', () => {
    // `Keyboard` 는 처음 쓰일 때 자기 몫 리스너를 단다 — 그 뒤에 기준선을 재야 한다.
    Keyboard.isVisible();
    const counts = () =>
      ALL_EVENTS.map((name) => DeviceEventEmitter.listenerCount(name));
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    const before = counts();

    const { unmount } = renderHook(() => useKeyboardVisible());
    expect(sum(counts())).toBeGreaterThan(sum(before));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    unmount();
    expect(counts()).toEqual(before);
    emitKeyboard('keyboardDidShow');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
