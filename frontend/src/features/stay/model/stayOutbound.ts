import * as Linking from 'expo-linking';

import type { StayItem } from '@/shared/api/generated/schemas';

/**
 * 제휴 시트 [이동] 딥링크 사다리(TRIP-457 AC-9 · 01b Q2 — nextNav.ts 패턴 미러).
 *
 * 실 OTA 딥링크 계약(`/stays/{id}/outbound`)이 없고 `StayItem`엔 이동 URL이 없다. 그래서 이동은
 * **웹검색 폴백**(BR-U1-31 "장소 검색 우회"가 명시 허용)으로만 성립한다 — 실 OTA 앱 스킴 단계가
 * 아예 없어(nextNav의 app→web→distance 3단이 아니라) `openURL` 단일 사다리다(★F-5). 실패하면
 * 침묵하지 않고 fallback으로 정직히 알린다(BR-U1-55 · INV-4).
 *
 * `expo-router`를 import하지 않는다(nextNav.ts AC-7 규율 계승) — 외부 웹만 열고 우리 라우트는
 * 그대로 두므로 복귀가 저절로 성립한다.
 */

export function buildStaySearchUrl(item: Pick<StayItem, 'name'>): string {
  return (
    'https://www.google.com/search?q=' + encodeURIComponent(`${item.name} 예약`)
  );
}

export async function openStayOutbound(
  item: Pick<StayItem, 'name'>,
  fallback: () => void
): Promise<'web' | 'failed'> {
  const searchUrl = buildStaySearchUrl(item);
  try {
    await Linking.openURL(searchUrl);
    return 'web';
  } catch {
    // 브라우저조차 못 열면 침묵하지 않고 위로 알린다(BR-U1-55) — 전용 실패 화면은 없어
    // 호출부가 배너/시트 유지로 정직히 처리한다.
    fallback();
    return 'failed';
  }
}
