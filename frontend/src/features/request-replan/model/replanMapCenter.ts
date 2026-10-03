import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-979 B · AC-B1 · Seed Q5 — 재계획 지도(진행·결과·위치 입력) 중심을 "이 여행"에서 고른다.
 *
 * 순서: ① 세션 출발 좌표(위도·경도 둘 다) → ② 기준 날짜의 첫 좌표 슬롯 → ③ 일정 전체의 첫 좌표
 * 슬롯 → ④ 서울시청 상수. 슬롯에서 골랐으면 그 이름을 함께 돌려줘 `{이름} 인근` 라벨의 재료가 된다.
 * 여행지 대표 좌표·숙소 좌표 단은 계약에 필드가 없어 두지 않는다(Q5).
 */

/** 좌표를 하나도 못 찾았을 때의 중심 — 서울시청(LiveHubView 선례 값). */
export const REPLAN_MAP_FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };

type LatLng = { lat: number; lng: number };

interface ReplanMapAnchor {
  center: LatLng;
  placeName: string | null;
}

/** 반쪽 좌표(한쪽만 있음)는 없는 것으로 본다. */
function coordsOf(point?: {
  lat?: number | null;
  lng?: number | null;
}): LatLng | null {
  return typeof point?.lat === 'number' && typeof point.lng === 'number'
    ? { lat: point.lat, lng: point.lng }
    : null;
}

function firstCoordSlot(
  slots: readonly ItineraryDaysItemSlotsItem[]
): ReplanMapAnchor | null {
  for (const slot of slots) {
    const center = coordsOf(slot);
    if (center) return { center, placeName: slot.nameKo ?? null };
  }
  return null;
}

export function deriveReplanMapAnchor(input: {
  days?: readonly ItineraryDaysItem[];
  preferredDate?: string;
  origin?: { lat?: number | null; lng?: number | null };
}): ReplanMapAnchor {
  const origin = coordsOf(input.origin);
  if (origin) return { center: origin, placeName: null };

  const days = input.days ?? [];
  const preferred = days.find((day) => day.date === input.preferredDate);
  return (
    (preferred && firstCoordSlot(preferred.slots)) ??
    firstCoordSlot(days.flatMap((day) => day.slots)) ?? {
      center: REPLAN_MAP_FALLBACK_CENTER,
      placeName: null,
    }
  );
}
