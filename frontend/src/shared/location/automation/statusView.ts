import type { PermissionSnapshot } from './permission';

/**
 * TRIP-1341 · l06 '자동 기록' 상태 행(DEC-U10-13 · Figma u10d 4860:3767). 켜짐/꺼짐 · 사유 · 행동([켜기]→설명 / 설정 열기).
 * 무장은 저장하지 않는 판정이라 "켜짐"은 지금 열린 지오펜스 구간이 있을 때만이다.
 */
export interface AutomationStatusView {
  status: 'on' | 'off' | 'paused';
  reason: string;
  action: 'enable' | 'settings' | null;
}

export function automationStatusView(input: {
  armed: boolean;
  consentOn: boolean;
  snapshot: PermissionSnapshot;
  /** TRIP-1486 · 이 여행(기간 안)을 일시 중지했는가. */
  paused: boolean;
}): AutomationStatusView {
  const { armed, consentOn, snapshot } = input;
  if (armed)
    return {
      status: 'on',
      reason: '여행 날짜 동안 기록 중이에요',
      action: null,
    };
  if (!consentOn)
    return {
      status: 'off',
      reason: '위치정보 동의가 꺼져 있어요',
      action: null,
    };
  if (snapshot.foreground !== 'granted')
    return {
      status: 'off',
      reason: '위치 권한이 꺼져 있어요',
      action: 'settings',
    };
  if (snapshot.background !== 'granted')
    return {
      status: 'off',
      reason: "위치 권한이 '사용하는 동안'이에요",
      action: snapshot.backgroundCanAskAgain ? 'enable' : 'settings',
    };
  if (!snapshot.precise)
    return {
      status: 'off',
      reason: '정확한 위치가 꺼져 있어요',
      action: 'settings',
    };
  if (input.paused)
    return {
      status: 'paused',
      reason: '이 여행은 일시 중지했어요',
      action: null,
    };
  return { status: 'off', reason: '여행 날짜에만 켜져요', action: null };
}
