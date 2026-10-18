import { fireEvent, render, screen } from '@testing-library/react-native';

import { ToggleRow } from './ToggleRow';

/**
 * 알림 설정 한 행(푸시·인앱 스위치 2개). 행은 푸시 열을 항상 그린다(TRIP-1442 개통 — 옛 `showPushColumn` 제거).
 */

const PUSH_ID = 'notification-settings-toggle-push-STAY';
const INAPP_ID = 'notification-settings-toggle-inapp-STAY';

function renderRow({
  available,
  pushEnabled,
  inAppEnabled,
}: {
  available: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
}) {
  const onToggle = jest.fn();
  render(
    <ToggleRow
      kind="STAY"
      label="숙소 등록·저장 완료"
      value={{ pushEnabled, inAppEnabled }}
      pushColumnAvailable={available}
      onToggle={onToggle}
      showDivider={false}
    />
  );
  return onToggle;
}

// TRIP-991
describe('🔴 ToggleRow · 스위치 이름', () => {
  it('푸시·인앱 스위치가 "{행 라벨} 푸시" / "{행 라벨} 인앱" 으로 구분돼 읽힌다', () => {
    renderRow({ available: true, pushEnabled: true, inAppEnabled: false });

    expect(
      screen.getByRole('switch', { name: '숙소 등록·저장 완료 푸시' })
    ).toHaveProp('testID', PUSH_ID);
    expect(
      screen.getByRole('switch', { name: '숙소 등록·저장 완료 인앱' })
    ).toHaveProp('testID', INAPP_ID);
  });
});

// TRIP-1442 · BR-U6-16 · PBT-U6-F2 — 화면 읽기 값(accessibilityState.checked)은 색과 달리 거짓 켜짐을 드러낸다.
describe('ToggleRow · 푸시 켜짐은 권한과 서버 값이 둘 다 참일 때만', () => {
  it.each([
    // 권한, 푸시 값, 인앱 값
    [true, true, true],
    [true, true, false],
    [true, false, true],
    [true, false, false],
    [false, true, true],
    [false, true, false],
    [false, false, true],
    [false, false, false],
  ])(
    '권한 %s · 푸시 값 %s · 인앱 값 %s',
    (available, pushEnabled, inAppEnabled) => {
      renderRow({ available, pushEnabled, inAppEnabled });

      const push = screen.getByTestId(PUSH_ID);
      const inApp = screen.getByTestId(INAPP_ID);

      // 푸시: 권한이 없으면 서버 값이 켜짐이어도 꺼짐으로 읽히고 잠긴다.
      if (available && pushEnabled) expect(push).toBeChecked();
      else expect(push).not.toBeChecked();
      if (available) expect(push).not.toBeDisabled();
      else expect(push).toBeDisabled();

      // 인앱: 권한과 무관하게 값대로, 늘 조작 가능.
      if (inAppEnabled) expect(inApp).toBeChecked();
      else expect(inApp).not.toBeChecked();
      expect(inApp).not.toBeDisabled();
    }
  );

  it('권한이 있으면 켜진 푸시 스위치를 누를 때 onToggle(kind, "push", false) 가 1회 나간다', () => {
    const onToggle = renderRow({
      available: true,
      pushEnabled: true,
      inAppEnabled: true,
    });

    fireEvent.press(screen.getByTestId(PUSH_ID));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('STAY', 'push', false);
  });

  it('권한이 없으면 푸시 스위치를 눌러도 아무것도 나가지 않는다 (인앱은 눌린다)', () => {
    const onToggle = renderRow({
      available: false,
      pushEnabled: true,
      inAppEnabled: true,
    });

    fireEvent.press(screen.getByTestId(PUSH_ID));
    fireEvent.press(screen.getByTestId(INAPP_ID)); // 앵커 — 콜백 배선이 살아 있음을 보인다

    expect(onToggle.mock.calls.map((call) => call[1])).toEqual(['inapp']);
  });
});
