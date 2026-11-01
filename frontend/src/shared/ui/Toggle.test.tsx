import { fireEvent, render, screen } from '@testing-library/react-native';

import { Toggle } from './Toggle';

/**
 * TRIP-780 · AC-1 — 공유 스위치 `shared/ui/Toggle`(DS Toggle 46×28, 손잡이 22).
 *
 * 무엇을 보장하나:
 *  - 루트는 role switch + checked/disabled 접근성 상태 + **real `disabled`** 라서, 비활성이면 눌러도
 *    onPress 가 안 나간다(accessibilityState 만 있는 "가짜 disabled"는 press 가 샌다 — 609 선례).
 *
 * 트랙 색·크기·여백·반경·실제 픽셀은 실화면 QA 몫(disabled 는 checked 보다 우선해 회색이어야 한다).
 */

function renderToggle(props: { checked: boolean; disabled?: boolean }) {
  const onPress = jest.fn();
  render(
    <Toggle
      testID="t"
      accessibilityLabel="알림 받기"
      onPress={onPress}
      {...props}
    />
  );
  return {
    onPress,
    track: screen.getByTestId('t'),
    thumb: screen.getByTestId('t-thumb'),
  };
}

describe('TRIP-780 · Toggle — 동작(AC-1)', () => {
  it('ON 이면 checked 로 읽히고, 누르면 onPress 가 1회 나간다', () => {
    const { onPress, track } = renderToggle({ checked: true });

    fireEvent.press(track);

    expect(track).toBeChecked();
    expect(track).not.toBeDisabled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('OFF 이면 unchecked 로 읽히고, 누르면 onPress 가 1회 나간다', () => {
    const { onPress, track } = renderToggle({ checked: false });

    fireEvent.press(track);

    expect(track).not.toBeChecked();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled 이면 real disabled 라서 눌러도 onPress 가 안 나간다', () => {
    const { onPress, track } = renderToggle({ checked: false, disabled: true });

    fireEvent.press(track);

    expect(track).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('disabled + checked 여도 press 는 차단된다', () => {
    const { onPress, track } = renderToggle({ checked: true, disabled: true });

    fireEvent.press(track);

    expect(track).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });
});

// 「모양」(ON/OFF/disabled 트랙 색 토큰)은 jest-cut 에서 지웠다 — 색 토큰이라 실화면 QA 몫. 상태 전달은 위 접근성·press 절과 TRIP-991 이 본다.

describe('🔴 TRIP-991 · Toggle — 스위치 이름(AC-3)', () => {
  it.each([true, false])(
    'checked=%s 여도 이름은 라벨 그대로("알림 받기")이고 상태는 checked 로만 전달된다',
    (checked) => {
      renderToggle({ checked });

      const toggle = screen.getByRole('switch', { name: '알림 받기' });
      expect(toggle).toHaveProp('testID', 't');
      if (checked) expect(toggle).toBeChecked();
      else expect(toggle).not.toBeChecked();
    }
  );

  it('라벨 없이 쓰면 타입 오류다 — accessibilityLabel 은 필수 prop (심판은 pnpm tsc)', () => {
    const withoutLabel = (
      // @ts-expect-error accessibilityLabel 은 필수다 — 라벨 없는 스위치는 VoiceOver 에 이름 없이 읽힌다
      <Toggle testID="t" checked={false} onPress={() => {}} />
    );

    expect(withoutLabel).toBeTruthy();
  });
});
