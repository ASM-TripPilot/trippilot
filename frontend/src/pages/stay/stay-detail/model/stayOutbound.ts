import * as Linking from 'expo-linking';

import { API_BASE_URL } from '@/shared/api';

/**
 * 제휴 시트 [이동](TRIP-1167 · BR-U1-29~32).
 *
 * 이동은 서버 아웃바운드 `GET /stays/{stayId}/outbound`(openapi — 302 · Location · 본문 없음)를 브라우저로
 * 여는 것이다. 서버가 클릭을 기록하고(BR-U1-32) 제휴 딥링크로 302 하며, 브라우저가 그 리다이렉트를 따라간다
 * — 목적지(OTA·검색) 결정은 서버 소유라 클라는 OTA URL을 조립하지 않는다. `openURL` 단일 사다리다.
 *
 * 실패 알림(BR-U1-55 · INV-4)의 사정거리: `openURL`은 **브라우저를 못 열 때만** 실패한다. 브라우저가 열린
 * 뒤 서버가 404(없는 숙소)·503을 주면 그 일은 브라우저 안에서 벌어져 클라는 알 수 없다 — 그쪽은 서버 응답
 * 화면이 담당한다.
 *
 * `expo-router`를 import하지 않는다(nextNav.ts AC-7 규율 계승) — 외부 웹만 열고 우리 라우트는
 * 그대로 두므로 복귀가 저절로 성립한다.
 */

/** [이동]이 어디로 가는가 — 제휴 딥링크(수수료 고지 대상, BR-U1-30) 또는 웹검색 폴백(BR-U1-31). */
export type StayOutboundMode = 'affiliate' | 'webSearch';

/**
 * 지금 계약의 이동 방식. 이동은 늘 서버 아웃바운드(제휴 딥링크)이므로 항상 `'affiliate'`다(TRIP-1167) —
 * 제휴 시트가 이 값으로 얼굴(수수료 고지 유무, BR-U1-30)을 고른다.
 */
export function stayOutboundMode(): StayOutboundMode {
  return 'affiliate';
}

export async function openStayOutbound(
  stayId: string,
  fallback: () => void
): Promise<'web' | 'failed'> {
  const outboundUrl = `${API_BASE_URL}/stays/${encodeURIComponent(stayId)}/outbound`;
  try {
    await Linking.openURL(outboundUrl);
    return 'web';
  } catch {
    // 브라우저조차 못 열면 침묵하지 않고 위로 알린다(BR-U1-55) — 전용 실패 화면은 없어
    // 호출부가 배너/시트 유지로 정직히 처리한다.
    fallback();
    return 'failed';
  }
}
