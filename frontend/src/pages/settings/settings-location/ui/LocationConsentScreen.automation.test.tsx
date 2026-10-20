import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { revokeImpact } from '@/shared/location/index.view';

import { LocationConsentScreen } from './LocationConsentScreen';

/**
 * TRIP-1341 · l06 자동 기록 상태 행·사용처·철회 중단 목록(DEC-U10-13 · G-U10-8 · Figma u10d 4860:3767·4860:3848).
 * 3동작 뼈대: 준비=automation 뷰·impact → 실행=렌더·탭 → 단언=행·문구·콜백.
 */
const base = {
  consentOn: true,
  disabled: false,
  onGrant: jest.fn(),
  onOpenSettings: jest.fn(),
};

describe('LocationConsentScreen automation', () => {
  it('LA1 플래그 ON·무장 → 상태 행 켜짐 + 사용처 자동 방문 기록·이동 경로 행', () => {
    render(
      <LocationConsentScreen
        {...base}
        impact={revokeImpact({ automation: true })}
        onRevokeConfirmed={jest.fn()}
        automation={{
          status: 'on',
          reason: '여행 날짜 동안 기록 중이에요',
          action: null,
        }}
      />
    );
    expect(
      screen.getByTestId('settings-location-automation-status')
    ).toHaveTextContent('켜짐');
    expect(
      screen.getByTestId('settings-location-usage-row-automation')
    ).toHaveTextContent(/자동 방문 기록 · 이동 경로/);
  });

  it('LA2 꺼짐 + [켜기]/설정 열기 콜백', () => {
    const onEnable = jest.fn();
    const onSettings = jest.fn();
    const { rerender } = render(
      <LocationConsentScreen
        {...base}
        impact={revokeImpact({ automation: true })}
        onRevokeConfirmed={jest.fn()}
        automation={{
          status: 'off',
          reason: "위치 권한이 '사용하는 동안'이에요",
          action: 'enable',
        }}
        onPressAutomationEnable={onEnable}
        onPressAutomationSettings={onSettings}
      />
    );
    expect(
      screen.getByTestId('settings-location-automation-status')
    ).toHaveTextContent('꺼짐');
    fireEvent.press(screen.getByTestId('settings-location-automation-enable'));
    expect(onEnable).toHaveBeenCalledTimes(1);
    rerender(
      <LocationConsentScreen
        {...base}
        impact={revokeImpact({ automation: true })}
        onRevokeConfirmed={jest.fn()}
        automation={{
          status: 'off',
          reason: '위치 권한이 꺼져 있어요',
          action: 'settings',
        }}
        onPressAutomationEnable={onEnable}
        onPressAutomationSettings={onSettings}
      />
    );
    fireEvent.press(
      screen.getByTestId('settings-location-automation-open-settings')
    );
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('LA3 철회 다이얼로그 중단 목록에 경로 삭제 항목 · 확정 전 철회 호출 0회', () => {
    const onRevokeConfirmed = jest.fn();
    render(
      <LocationConsentScreen
        {...base}
        impact={revokeImpact({ automation: true })}
        onRevokeConfirmed={onRevokeConfirmed}
        automation={{ status: 'on', reason: 'x', action: null }}
      />
    );
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    const dialog = screen.getByTestId('settings-location-revoke-confirm');
    expect(
      within(dialog).getByText(/자동 방문 기록·이동 경로 \(저장된 경로 삭제\)/)
    ).toBeTruthy();
    expect(onRevokeConfirmed).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('settings-location-revoke-cancel'));
    expect(onRevokeConfirmed).not.toHaveBeenCalled();
  });

  it('LA4 플래그 OFF(automation 미전달) → 자동 기록 행·사용처 추가·철회 문구 추가 없음(현행)', () => {
    render(
      <LocationConsentScreen
        {...base}
        impact={revokeImpact()}
        onRevokeConfirmed={jest.fn()}
      />
    );
    expect(screen.queryByTestId('settings-location-automation-row')).toBeNull();
    expect(
      screen.queryByTestId('settings-location-usage-row-automation')
    ).toBeNull();
    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    expect(screen.queryByText(/자동 방문 기록/)).toBeNull();
  });

  // TRIP-1486 · 일시 중지한 여행은 "꺼짐"으로 접지 않고 「일시 중지」 알약으로 보인다(사용자 결정 Q4 · Figma u10d 일시 중지 변형).
  // 알약의 색은 생김새라 단언하지 않는다(실화면 QA 몫) — 문구와 행동 버튼 부재만 본다.
  it('LA5 일시 중지 → 알약 「일시 중지」 · 사유 줄 · [켜기]/설정 열기 없음(l06 에서 재개하지 않는다)', () => {
    render(
      <LocationConsentScreen
        {...base}
        impact={revokeImpact({ automation: true })}
        onRevokeConfirmed={jest.fn()}
        automation={{
          status: 'paused',
          reason: '이 여행은 일시 중지했어요',
          action: null,
        }}
      />
    );
    expect(
      screen.getByTestId('settings-location-automation-status')
    ).toHaveTextContent('일시 중지');
    expect(
      screen.getByTestId('settings-location-automation-row')
    ).toHaveTextContent(/이 여행은 일시 중지했어요/);
    expect(
      screen.queryByTestId('settings-location-automation-enable')
    ).toBeNull();
    expect(
      screen.queryByTestId('settings-location-automation-open-settings')
    ).toBeNull();
  });
});
