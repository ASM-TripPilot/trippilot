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
      automationStatusView({
        armed: true,
        consentOn: true,
        snapshot: ok,
        paused: false,
      })
    ).toEqual({
      status: 'on',
      reason: '여행 날짜 동안 기록 중이에요',
      action: null,
    });
  });
  it('SV2 when-in-use 이고 다시 물을 수 있으면 [켜기], 거부 확정이면 설정 열기', () => {
    const wiu = { ...ok, background: 'undetermined' as const };
    expect(
      automationStatusView({
        armed: false,
        consentOn: true,
        snapshot: wiu,
        paused: false,
      }).action
    ).toBe('enable');
    expect(
      automationStatusView({
        armed: false,
        consentOn: true,
        snapshot: { ...wiu, backgroundCanAskAgain: false },
        paused: false,
      }).action
    ).toBe('settings');
  });
  it('SV3 동의 OFF 면 꺼짐·행동 없음(BR-U10-04 — always 를 묻지 않는다)', () => {
    expect(
      automationStatusView({
        armed: false,
        consentOn: false,
        snapshot: ok,
        paused: false,
      })
    ).toMatchObject({
      status: 'off',
      action: null,
    });
  });
  it('SV4 권한 다 있는데 무장 아님 → 여행 날짜에만', () => {
    expect(
      automationStatusView({
        armed: false,
        consentOn: true,
        snapshot: ok,
        paused: false,
      }).reason
    ).toBe('여행 날짜에만 켜져요');
  });

  // TRIP-1486 · 일시 중지한 여행(기간 안)은 l06 에서 "꺼짐"이 아니라 "일시 중지"로 보인다(사용자 결정 Q4).
  // 우선순위는 resolveArming 과 같은 원칙 — 다른 사유가 있으면 그 사유를 보이고, 일시 중지는 맨 끝이다.
  it('SV5 권한·동의가 다 멀쩡한데 일시 중지면 paused · 사유 줄 · 행동 없음', () => {
    expect(
      automationStatusView({
        armed: false,
        consentOn: true,
        snapshot: ok,
        paused: true,
      })
    ).toEqual({
      status: 'paused',
      reason: '이 여행은 일시 중지했어요',
      action: null,
    });
  });

  it.each([
    [
      '동의 꺼짐',
      { consentOn: false, snapshot: ok },
      '위치정보 동의가 꺼져 있어요',
    ],
    [
      '앱 권한 꺼짐',
      { consentOn: true, snapshot: { ...ok, foreground: 'denied' as const } },
      '위치 권한이 꺼져 있어요',
    ],
    [
      "'사용하는 동안'",
      { consentOn: true, snapshot: { ...ok, background: 'denied' as const } },
      "위치 권한이 '사용하는 동안'이에요",
    ],
    [
      '대략 위치',
      { consentOn: true, snapshot: { ...ok, precise: false } },
      '정확한 위치가 꺼져 있어요',
    ],
  ])(
    'SV6 일시 중지여도 %s 면 그 사유가 이긴다(status off 유지)',
    (_label, patch, reason) => {
      expect(
        automationStatusView({ armed: false, paused: true, ...patch })
      ).toMatchObject({ status: 'off', reason });
    }
  );

  it('SV7 이미 무장 중이면(armed) 일시 중지 입력이 있어도 켜짐 — 열린 구간이 진실이다', () => {
    expect(
      automationStatusView({
        armed: true,
        consentOn: true,
        snapshot: ok,
        paused: true,
      }).status
    ).toBe('on');
  });
});
