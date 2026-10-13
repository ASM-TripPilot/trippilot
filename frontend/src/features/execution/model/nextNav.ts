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

/** 출발지 — 없으면(생략) 네이버 지도 앱이 현재 위치를 쓴다. */
export interface NavOrigin {
  lat: number;
  lng: number;
  nameKo: string | null;
}

export interface NavDest {
  lat: number;
  lng: number;
  nameKo: string | null;
  distanceRange: string | null;
  /** TRIP-1189 슬롯별 [길찾기] — 바로 앞 슬롯. 첫 예정지·앞 슬롯 좌표 결측이면 키 자체가 없다(현재 위치). */
  origin?: NavOrigin | null;
  /**
   * TRIP-1222 (a) — 웹 폴백 전용 출발지(바로 앞 슬롯, 방문 완료 포함). 웹 길찾기엔 "현재 위치"가 없어
   * 출발을 생략하면 입력칸이 빈다 — 그래서 첫 예정지(앱은 현재 위치)도 웹에선 앞 슬롯을 출발로 쓴다.
   */
  webOrigin?: NavOrigin | null;
}

const APP_NAME = 'com.trippilot.travel';

type NavUrlInput = Pick<
  NavDest,
  'lat' | 'lng' | 'nameKo' | 'origin' | 'webOrigin'
>;

export function buildAppNavUrl({
  lat,
  lng,
  nameKo,
  origin,
}: NavUrlInput): string {
  const dname = encodeURIComponent(nameKo ?? '장소');
  const from = origin
    ? `slat=${origin.lat}&slng=${origin.lng}&sname=${encodeURIComponent(origin.nameKo ?? '장소')}&`
    : '';
  return `nmap://route/public?${from}dlat=${lat}&dlng=${lng}&dname=${dname}&appname=${APP_NAME}`;
}

// 웹 형식(/directions/{출발}/{도착}/-/transit)은 공식 문서에 없다 — iOS 시뮬레이터에서 출발·도착이 모두 채워짐을
// 확인했다(TRIP-1222 a, Safari 가 빠른길찾기로 넘긴다). 출발 `-` 는 입력칸이 빈다 = 웹엔 현재 위치가 없다.
export function buildWebNavUrl({
  lat,
  lng,
  nameKo,
  origin,
  webOrigin,
}: NavUrlInput): string {
  const name = encodeURIComponent(nameKo ?? '장소');
  const start = origin ?? webOrigin;
  const from = start
    ? `${start.lng},${start.lat},${encodeURIComponent(start.nameKo ?? '장소')}`
    : '-';
  return `https://map.naver.com/p/directions/${from}/${lng},${lat},${name}/-/transit`;
}

const hasCoords = (slot: ProjectedSlot['slot']): boolean =>
  Number.isFinite(slot.lat) && Number.isFinite(slot.lng);

/**
 * 슬롯마다의 [길찾기] 도착지(+직전 슬롯 출발지), poiId 키.
 * 예정·진행 중 + 유한 좌표 슬롯만 담는다(방문 완료는 없음). 출발지는 바로 앞 슬롯 —
 * 단 첫 예정지는 현재 위치(생략)이고, 앞 슬롯 좌표가 없어도 생략으로 폴백한다.
 */
export function resolveSlotDests(slots: ProjectedSlot[]): Map<string, NavDest> {
  const firstUpcoming = slots.findIndex((p) => p.state === 'upcoming');
  const dests = new Map<string, NavDest>();
  slots.forEach(({ slot, state }, i) => {
    if (state === 'done' || !hasCoords(slot)) return;
    const dest: NavDest = {
      lat: slot.lat as number,
      lng: slot.lng as number,
      nameKo: slot.nameKo ?? null,
      distanceRange: slot.distanceRange ?? null,
    };
    const prev = i > 0 ? slots[i - 1].slot : null;
    if (prev && hasCoords(prev)) {
      const prevOrigin: NavOrigin = {
        lat: prev.lat as number,
        lng: prev.lng as number,
        nameKo: prev.nameKo ?? null,
      };
      // 앱 스킴은 첫 예정지에서 출발을 생략한다(현재 위치). 웹 폴백은 항상 앞 슬롯을 출발로 쓴다.
      dest.webOrigin = prevOrigin;
      if (i !== firstUpcoming) dest.origin = prevOrigin;
    }
    dests.set(slot.poiId, dest);
  });
  return dests;
}

export function resolveNextDest(slots: ProjectedSlot[]): NavDest | null {
  const next = slots.find((projected) => projected.state === 'upcoming');
  return next ? (resolveSlotDests(slots).get(next.slot.poiId) ?? null) : null;
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
