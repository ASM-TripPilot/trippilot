import { automationStatusView } from './statusView';

/** TRIP-1341 · l06 자동 기록 상태 행 판정. */
const ok = {
  foreground: 'granted',
  background: 'granted',
  backgroundCanAskAgain: true,
  precise: true,
} as const;

describe('automationStatusView', () => {
  it('SV1 무장 중이면 켜짐', () => {
    expect(
      automationStatusView({ armed: true, consentOn: true, snapshot: ok })
    ).toEqual({
      status: 'on',
      reason: '여행 날짜 동안 기록 중이에요',
      action: null,
    });
  });
  it('SV2 when-in-use 이고 다시 물을 수 있으면 [켜기], 거부 확정이면 설정 열기', () => {
    const wiu = { ...ok, background: 'undetermined' as const };
    expect(
      automationStatusView({ armed: false, consentOn: true, snapshot: wiu })
        .action
    ).toBe('enable');
    expect(
      automationStatusView({
        armed: false,
        consentOn: true,
        snapshot: { ...wiu, backgroundCanAskAgain: false },
      }).action
    ).toBe('settings');
  });
  it('SV3 동의 OFF 면 꺼짐·행동 없음(BR-U10-04 — always 를 묻지 않는다)', () => {
    expect(
      automationStatusView({ armed: false, consentOn: false, snapshot: ok })
    ).toMatchObject({
      status: 'off',
      action: null,
    });
  });
  it('SV4 권한 다 있는데 무장 아님 → 여행 날짜에만', () => {
    expect(
      automationStatusView({ armed: false, consentOn: true, snapshot: ok })
        .reason
    ).toBe('여행 날짜에만 켜져요');
  });
});
