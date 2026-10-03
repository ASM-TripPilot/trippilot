import { render, screen } from '@testing-library/react-native';

import { ToggleRow } from './ToggleRow';

/**
 * TRIP-991 · 알림 설정 한 행(푸시·인앱 스위치 2개)의 스위치 이름(AC-3).
 *
 * 무엇을 보장하나: 한 행의 두 스위치가 같은 이름으로 읽히지 않도록 `{행 라벨} 푸시` / `{행 라벨} 인앱`
 * 으로 구분된다. 운영 화면은 푸시 열을 숨기므로(TRIP-939 `PUSH_COLUMN_READY`) 행 부품을 직접
 * 렌더해 `showPushColumn` 을 켠다.
 * 3동작 뼈대: 준비=행 라벨·두 열 → 실행=render → 단언=switch 역할·이름·testID.
 */

describe('🔴 ToggleRow · TRIP-991 스위치 이름', () => {
  it('푸시·인앱 스위치가 "{행 라벨} 푸시" / "{행 라벨} 인앱" 으로 구분돼 읽힌다', () => {
    render(
      <ToggleRow
        kind="STAY"
        label="숙소 등록·저장 완료"
        value={{ pushEnabled: true, inAppEnabled: false }}
        pushColumnAvailable
        showPushColumn
        onToggle={jest.fn()}
        showDivider={false}
      />
    );

    expect(
      screen.getByRole('switch', { name: '숙소 등록·저장 완료 푸시' })
    ).toHaveProp('testID', 'notification-settings-toggle-push-STAY');
    expect(
      screen.getByRole('switch', { name: '숙소 등록·저장 완료 인앱' })
    ).toHaveProp('testID', 'notification-settings-toggle-inapp-STAY');
  });
});
