import { DeviceEventEmitter, Keyboard } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ToastHost, hideToast, showToast } from '@/shared/ui/Toast';
import { assistantHref } from '../model/assistantHref';
import { AssistantFab } from './AssistantFab';

/**
 * TRIP-1321 · BR-U8-50·52 — ✦ FAB 는 라우팅 목적지만 정하고(도우미 훅을 모른다), 스택 계산값에 뜨며,
 * 붙어 있는 동안 토스트 바닥을 올린다. 실제 겹침·탭바와의 거리는 6-b 실기.
 */

// TRIP-1514 — 키보드 이벤트는 RN `Keyboard` 가 구독하는 기기 이벤트 통로(DeviceEventEmitter)로 쏜다
// (선례 TripRecordsView.test).
type KeyboardEventName =
  | 'keyboardWillShow'
  | 'keyboardDidShow'
  | 'keyboardWillHide'
  | 'keyboardDidHide';

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

// `Keyboard` 는 "지금 떠 있나" 를 모듈 싱글턴에 기억한다(keyboardDidShow 로 켜지고 keyboardDidHide 로만
// 꺼짐). 한 케이스가 떠 있는 채로 끝나면 다음 케이스로 새므로 파일 최상위에서 매번 내린다.
afterEach(() => {
  act(() => hideToast());
  emitKeyboard('keyboardDidHide');
});

describe('AssistantFab (TRIP-1321)', () => {
  it('접근성 이름 "AI 도우미" 로 그려지고 탭하면 onPress 를 부른다', () => {
    const onPress = jest.fn();
    render(<AssistantFab onPress={onPress} bottom={220} />);
    const fab = screen.getByTestId('assistant-fab');
    expect(fab.props.accessibilityLabel).toBe('AI 도우미');
    fireEvent.press(fab);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('bottom 을 주면 그 바닥에 절대 배치된다(스택 2단 = 220)', () => {
    render(<AssistantFab onPress={jest.fn()} bottom={220} />);
    const style = [screen.getByTestId('assistant-fab').props.style].flat();
    expect(Object.assign({}, ...style)).toEqual(
      expect.objectContaining({ position: 'absolute', bottom: 220 })
    );
  });

  it('bottom 이 없으면 흐름 배치(허브 앵커 열 안)다', () => {
    render(<AssistantFab onPress={jest.fn()} />);
    const style = [screen.getByTestId('assistant-fab').props.style].flat();
    expect(Object.assign({}, ...style).position).toBeUndefined();
  });

  it('toastBottom 을 주면 붙어 있는 동안 토스트가 그 바닥으로 오른다(BR-U8-52)', () => {
    render(
      <>
        <AssistantFab onPress={jest.fn()} bottom={220} toastBottom={288} />
        <ToastHost />
      </>
    );
    act(() => showToast({ message: '저장했어요', testID: 'toast-x' }));
    expect(screen.getByTestId('toast-x').props.style).toEqual(
      expect.objectContaining({ bottom: 288 })
    );
  });
});

describe('AssistantFab · 키보드 (TRIP-1514 · BR-U8-53)', () => {
  const FAB = 'assistant-fab';

  it.each<KeyboardEventName>(['keyboardWillShow', 'keyboardDidShow'])(
    '%s 로 키보드가 뜨면 ✦ 가 사라진다(iOS 는 Will, Android 는 Did 만 온다)',
    (showEvent) => {
      render(<AssistantFab onPress={jest.fn()} bottom={220} />);
      // 아직 있다 — 이 앵커가 없으면 앞 케이스가 남긴 "떠 있음"이 새도 green 이 된다
      expect(screen.getByTestId(FAB)).toBeOnTheScreen();

      emitKeyboard(showEvent);

      expect(screen.queryByTestId(FAB)).toBeNull();
    }
  );

  it.each<KeyboardEventName>(['keyboardWillHide', 'keyboardDidHide'])(
    '%s 로 키보드가 내려가면 ✦ 가 돌아와 다시 눌린다',
    (hideEvent) => {
      const onPress = jest.fn();
      render(<AssistantFab onPress={onPress} bottom={220} />);
      emitKeyboard('keyboardDidShow');
      expect(screen.queryByTestId(FAB)).toBeNull();

      emitKeyboard(hideEvent);

      expect(screen.getByTestId(FAB)).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId(FAB));
      expect(onPress).toHaveBeenCalledTimes(1);
    }
  );

  it('숨겨진 동안 토스트 바닥 올림이 풀리고, 돌아오면 다시 오른다', () => {
    render(
      <>
        <AssistantFab onPress={jest.fn()} bottom={220} toastBottom={288} />
        <ToastHost />
      </>
    );
    act(() => showToast({ message: '저장했어요', testID: 'toast-k' }));
    const toastBottom = () =>
      Object.assign({}, ...[screen.getByTestId('toast-k').props.style].flat())
        .bottom;
    // 아직 올라 있다 — 앵커
    expect(toastBottom()).toBe(288);

    emitKeyboard('keyboardDidShow');
    expect(screen.queryByTestId(FAB)).toBeNull();
    expect(toastBottom()).toBeUndefined();

    emitKeyboard('keyboardDidHide');
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();
    expect(toastBottom()).toBe(288);
  });

  it('언마운트하면 키보드 구독을 푼다(이후 이벤트에도 경고 없음)', () => {
    // `Keyboard` 는 처음 쓰일 때 자기 몫 리스너를 단다 — 그 뒤에 기준선을 재야 한다.
    Keyboard.isVisible();
    const names: KeyboardEventName[] = [
      'keyboardWillShow',
      'keyboardDidShow',
      'keyboardWillHide',
      'keyboardDidHide',
    ];
    const counts = () =>
      names.map((name) => DeviceEventEmitter.listenerCount(name));
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    const before = counts();

    const { unmount } = render(<AssistantFab onPress={jest.fn()} />);
    expect(sum(counts())).toBeGreaterThan(sum(before));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    unmount();
    expect(counts()).toEqual(before);
    emitKeyboard('keyboardDidShow');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('assistantHref (TRIP-1321)', () => {
  it('surface·tripId 만 싣는다(BR-U8-02)', () => {
    expect(assistantHref('HOME')).toEqual({
      pathname: '/assistant',
      params: { surface: 'HOME' },
    });
    expect(assistantHref('ITINERARY', 't1')).toEqual({
      pathname: '/assistant',
      params: { surface: 'ITINERARY', tripId: 't1' },
    });
  });
});
