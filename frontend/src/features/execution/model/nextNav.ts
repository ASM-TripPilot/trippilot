import * as Linking from 'expo-linking';

import type { ProjectedSlot } from '@/entities/itinerary-slot';

/**
 * TRIP-399 · nextNav — i01 "다음 예정지 길찾기" 순수 로직(딥링크 폴백 사다리).
 * TRIP-1189 — 지도 공급자는 네이버 지도다(출발지 생략 = 앱이 현재 위치를 쓴다 · 이동수단 대중교통 고정).
 * `canOpenURL` 은 iOS 에서 `LSApplicationQueriesSchemes`(네이티브·재빌드)가 있어야 해서 쓰지 않는다 —
 * `openURL` 은 등록 없이 동작하고 처리할 앱이 없으면 reject 되므로 그 reject 로 앱 → 웹 → 거리 안내로 강등한다.
 *
 * 화면(SlotProgressCard)은 순수 뷰라 Linking 을 모른다 — 딥링크 판정은 전부 여기 모인다.
 * expo-router 를 import 하지 않는다(AC-7): 외부 앱/웹 지도만 띄우고 우리 라우트는 그대로
 * 두므로 복귀가 저절로 성립한다. 소스 스캔이 이 라우터 미개입을 구조로 강제한다.
 */

export interface NavDest {
  lat: number;
  lng: number;
  nameKo: string | null;
  distanceRange: string | null;
}

const APP_NAME = 'com.trippilot.travel';

export function buildAppNavUrl({
  lat,
  lng,
  nameKo,
}: Pick<NavDest, 'lat' | 'lng' | 'nameKo'>): string {
  const dname = encodeURIComponent(nameKo ?? '장소');
  return `nmap://route/public?dlat=${lat}&dlng=${lng}&dname=${dname}&appname=${APP_NAME}`;
}

export function buildWebNavUrl({
  lat,
  lng,
  nameKo,
}: Pick<NavDest, 'lat' | 'lng' | 'nameKo'>): string {
  const name = encodeURIComponent(nameKo ?? '장소');
  return `https://map.naver.com/p/directions/-/${lng},${lat},${name}/-/transit`;
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

  try {
    await Linking.openURL(appUrl);
    return 'app';
  } catch {
    // 네이버 앱 없음/열기 실패 → 웹 지도로 강등.
  }

  try {
    await Linking.openURL(webUrl);
    return 'web';
  } catch {
    fallback(dest.distanceRange);
    return 'distance';
  }
}
