import * as Linking from 'expo-linking';

import type { ProjectedSlot } from './slotProgress';

/**
 * TRIP-399 · nextNav — i01 "다음 예정지 길찾기" 순수 로직(딥링크 폴백 사다리).
 *
 * 화면(LiveSlotCard)은 순수 뷰라 Linking 을 모른다 — 딥링크 판정은 전부 여기 모인다.
 * expo-router 를 import 하지 않는다(AC-7): 외부 앱/웹 지도만 띄우고 우리 라우트는 그대로
 * 두므로 복귀가 저절로 성립한다. 소스 스캔이 이 라우터 미개입을 구조로 강제한다.
 */

export interface NavDest {
  lat: number;
  lng: number;
  nameKo: string | null;
  distanceRange: string | null;
}

export function buildAppNavUrl({
  lat,
  lng,
}: Pick<NavDest, 'lat' | 'lng'>): string {
  return `kakaomap://route?ep=${lat},${lng}`;
}

export function buildWebNavUrl({
  lat,
  lng,
  nameKo,
}: Pick<NavDest, 'lat' | 'lng' | 'nameKo'>): string {
  return `https://map.kakao.com/link/to/${nameKo ?? '장소'},${lat},${lng}`;
}

export function resolveNextDest(slots: ProjectedSlot[]): NavDest | null {
  const next = slots.find((projected) => projected.state === 'upcoming');
  if (!next) return null;

  const { lat, lng, nameKo, distanceRange } = next.slot;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat: lat as number,
    lng: lng as number,
    nameKo: nameKo ?? null,
    distanceRange: distanceRange ?? null,
  };
}

export async function openNextNav(
  dest: NavDest,
  fallback: (distanceRange: string | null) => void
): Promise<'app' | 'web' | 'distance'> {
  const appUrl = buildAppNavUrl(dest);
  const webUrl = buildWebNavUrl(dest);

  if (await Linking.canOpenURL(appUrl)) {
    try {
      await Linking.openURL(appUrl);
      return 'app';
    } catch {
      // 외부 앱 열기 실패 → 웹 지도로 강등.
    }
  }

  try {
    await Linking.openURL(webUrl);
    return 'web';
  } catch {
    fallback(dest.distanceRange);
    return 'distance';
  }
}
