import { fireEvent, render, screen } from '@testing-library/react-native';

import { Toggle } from './Toggle';

/**
 * TRIP-780 · AC-1 — 공유 스위치 `shared/ui/Toggle`(DS Toggle 46×28, 손잡이 22).
 *
 * 무엇을 보장하나:
 *  - 루트는 role switch + checked/disabled 접근성 상태 + **real `disabled`** 라서, 비활성이면 눌러도
 *    onPress 가 안 나간다(accessibilityState 만 있는 "가짜 disabled"는 press 가 샌다 — 609 선례).
 *  - ON / OFF / disabled 세 모양이 트랙·손잡이 클래스로 갈린다. disabled 는 checked 보다 우선한다
 *    (OS 권한 거부인데 켜진 색이 보이면 거짓 표시다).
 *
 * 색·크기·여백·반경은 className 토큰 단위로 본다. 실제 픽셀은 6-b 몫.
 */

/** className 을 공백으로 쪼갠 토큰 배열 — `bg-primary` 가 다른 토큰에 부분 일치하는 것을 막는다. */
function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function renderToggle(props: { checked: boolean; disabled?: boolean }) {
  const onPress = jest.fn();
  render(<Toggle testID="t" onPress={onPress} {...props} />);
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

describe('TRIP-780 · Toggle — 모양(AC-1 · Q2 46×28 · Q6 disabled 색)', () => {
  it('ON: 트랙 primary + 손잡이 오른쪽, 손잡이 흰색', () => {
    const { track, thumb } = renderToggle({ checked: true });

    expect(tokens(track)).toEqual(
      expect.arrayContaining(['bg-primary', 'items-end'])
    );
    expect(tokens(track)).not.toContain('bg-hairline-strong');
    expect(tokens(track)).not.toContain('bg-[#ECECEC]');
    expect(tokens(thumb)).toContain('bg-canvas');
  });

  it('OFF: 트랙 hairline-strong + 손잡이 왼쪽, 손잡이 흰색', () => {
    const { track, thumb } = renderToggle({ checked: false });

    expect(tokens(track)).toEqual(
      expect.arrayContaining(['bg-hairline-strong', 'items-start'])
    );
    expect(tokens(track)).not.toContain('bg-primary');
    expect(tokens(track)).not.toContain('bg-[#ECECEC]');
    expect(tokens(thumb)).toContain('bg-canvas');
  });

  it('disabled: 트랙 #ECECEC + 회색 손잡이 #C4C9CF, 손잡이 왼쪽', () => {
    const { track, thumb } = renderToggle({ checked: false, disabled: true });

    expect(tokens(track)).toEqual(
      expect.arrayContaining(['bg-[#ECECEC]', 'items-start'])
    );
    expect(tokens(track)).not.toContain('bg-hairline-strong');
    expect(tokens(thumb)).toContain('bg-[#C4C9CF]');
    expect(tokens(thumb)).not.toContain('bg-canvas');
  });

  it('disabled 는 checked 보다 우선한다 — ON 색이 나오지 않는다', () => {
    const { track, thumb } = renderToggle({ checked: true, disabled: true });

    expect(tokens(track)).toEqual(
      expect.arrayContaining(['bg-[#ECECEC]', 'items-start'])
    );
    expect(tokens(track)).not.toContain('bg-primary');
    expect(tokens(track)).not.toContain('items-end');
    expect(tokens(thumb)).toContain('bg-[#C4C9CF]');
  });

  it.each([
    ['ON', { checked: true }],
    ['OFF', { checked: false }],
    ['disabled', { checked: false, disabled: true }],
  ])('%s 모두 트랙 46×28 · 손잡이 22 (옛 52×30 아님)', (_label, props) => {
    const { track, thumb } = renderToggle(props);

    expect(tokens(track)).toEqual(
      expect.arrayContaining(['h-[28px]', 'w-[46px]'])
    );
    expect(tokens(track)).not.toContain('w-[52px]');
    expect(tokens(track)).not.toContain('h-[30px]');
    expect(tokens(thumb)).toEqual(
      expect.arrayContaining(['h-[22px]', 'w-[22px]'])
    );
  });

  it.each([
    ['ON', { checked: true }],
    ['OFF', { checked: false }],
    ['disabled', { checked: false, disabled: true }],
  ])(
    '%s 모두 트랙은 알약 모양 + 안쪽 여백 3, 손잡이는 원형',
    (_label, props) => {
      const { track, thumb } = renderToggle(props);

      // 여백 3이 없으면 22px 손잡이가 46px 트랙 끝에 붙는다.
      expect(tokens(track)).toEqual(
        expect.arrayContaining(['rounded-pill', 'px-[3px]'])
      );
      expect(tokens(thumb)).toContain('rounded-pill');
    }
  );
});
