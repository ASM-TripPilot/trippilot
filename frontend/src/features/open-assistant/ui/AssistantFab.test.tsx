import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ToastHost, hideToast, showToast } from '@/shared/ui/Toast';
import { assistantHref } from '../model/assistantHref';
import { AssistantFab } from './AssistantFab';

/**
 * TRIP-1321 · BR-U8-50·52 — ✦ FAB 는 라우팅 목적지만 정하고(도우미 훅을 모른다), 스택 계산값에 뜨며,
 * 붙어 있는 동안 토스트 바닥을 올린다. 실제 겹침·탭바와의 거리는 6-b 실기.
 */

afterEach(() => act(() => hideToast()));

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
