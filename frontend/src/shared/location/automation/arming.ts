/**
 * TRIP-1332 · 무장 판정 (BR-U10-02~07 · business-logic-model §3 · NFR LC-U10 F1 확장).
 *
 * ARMED 는 **저장하지 않는다** — 앱 시작·포그라운드 복귀·백그라운드 wake 마다 이 함수로 다시 계산한다.
 * 저장해 두면 OS 설정이 바뀐 뒤에도 "켜져 있다"고 믿는다.
 *
 * 순수 함수다 — 권한 조회·OS 요청은 호출자(어댑터) 몫이고, 여기서는 이미 읽은 값만 판정한다.
 */

export type OsPermission = 'granted' | 'denied' | 'undetermined';

export interface ArmingInput {
  /** 빌드 기능 플래그(app.config extra.locationAutomation). */
  flagOn: boolean;
  /** 서버 킬 스위치(auto-events 응답 automationEnabled — NFR 델타 4). 모르면 true. */
  serverEnabled: boolean;
  /** OS when-in-use 권한. */
  foreground: OsPermission;
  /** OS '항상 허용' 권한. */
  background: OsPermission;
  /** OS 가 '항상 허용'을 아직 물을 수 있는가(거부 확정이면 false). */
  backgroundCanAskAgain: boolean;
  /** 정확한 위치(iOS 정밀 위치 ON). */
  precise: boolean;
  /** 앱 위치 동의 토글(L2·L3). */
  consentOn: boolean;
  /** 여행지 기준 여행 날짜 구간 안. */
  inTripWindow: boolean;
  /** i01 허브 진입에서 판정 중인가 — 설명은 허브에서만 뜬다(BR-U10-05). */
  onHub: boolean;
  /** 이 여행에서 설명을 이미 보였는가([나중에] 포함). */
  explainerAsked: boolean;
  /** TRIP-1486 · 사용자가 이 여행의 자동 기록을 일시 중지했는가(기기에 저장되는 유일한 입력). */
  tripPaused: boolean;
}

export type ArmingState = 'ARMED' | 'MANUAL' | 'EXPLAINER';

export type ArmingReason =
  | 'armed'
  | 'explainer'
  | 'flag-off'
  | 'server-disabled'
  | 'consent-off'
  | 'outside-trip'
  | 'no-permission'
  | 'when-in-use'
  | 'background-blocked'
  | 'approximate'
  | 'paused';

export interface ArmingResult {
  state: ArmingState;
  reason: ArmingReason;
}

const manual = (reason: ArmingReason): ArmingResult => ({
  state: 'MANUAL',
  reason,
});

export function resolveArming(input: ArmingInput): ArmingResult {
  // 플래그 OFF 는 가장 먼저 — 어떤 입력이든 MANUAL(권한 요청 경로 0, BR-U10-07).
  if (!input.flagOn) return manual('flag-off');
  if (!input.serverEnabled) return manual('server-disabled');
  // 토글 OFF 사용자에게는 always 를 묻지 않는다(BR-U10-04).
  if (!input.consentOn) return manual('consent-off');
  if (!input.inTripWindow) return manual('outside-trip');
  if (input.foreground !== 'granted') return manual('no-permission');

  if (input.background === 'granted') {
    if (!input.precise) return manual('approximate');
    // 일시 중지는 "원래 무장됐을 여행"만 막는다 — 다른 사유(권한·동의·구간)를 가리지 않는다.
    return input.tripPaused
      ? manual('paused')
      : { state: 'ARMED', reason: 'armed' };
  }

  // when-in-use 사용자 = 수동 체크인 사용자(BR-U10-03). 설명은 허브 첫 진입 1회(BR-U10-05).
  if (!input.backgroundCanAskAgain) return manual('background-blocked');
  if (input.onHub && !input.explainerAsked) {
    return { state: 'EXPLAINER', reason: 'explainer' };
  }
  return manual('when-in-use');
}
