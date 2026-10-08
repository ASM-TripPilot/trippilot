/**
 * h14·h16 일정 지도 중심(TRIP-1275). 사다리 첫 칸이 이긴다:
 *  ① 선택한 날의 첫 좌표 장소
 *  ② 다른 날 중 날짜 순으로 처음 나오는 좌표 장소
 *  ③ 거점 숙소 좌표(거점엔 좌표가 없어 등록 숙소와 잇는다 · 대기·실패면 건너뜀)
 *  ④ 서울시청 — {0,0} 은 기니만 바다다.
 * ③의 거점 고르기는 편집기 `resolveEditorMapCenter`(itinerary-manual)와 같은 규칙이다 — 형제 page
 * 슬라이스라 import 할 수 없어 같은 모양을 여기 둔다.
 */

type Coord = { lat: number; lng: number };
type Point = { lat?: number | null; lng?: number | null };

const FALLBACK_CENTER: Coord = { lat: 37.5665, lng: 126.978 };

/** 핀과 같은 판정(`buildDraftPins`) — lat·lng 둘 다 number 여야 좌표다. */
function firstCoord(points: readonly Point[]): Coord | undefined {
  for (const { lat, lng } of points) {
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  return undefined;
}

export function resolvePlanMapCenter(input: {
  days: readonly {
    date: string;
    slots: readonly Point[];
  }[];
  selectedDate: string;
  bases:
    | readonly { savedStayId: string; dateFrom: string; dateTo: string }[]
    | undefined;
  stays:
    | readonly {
        savedStayId: string;
        lat?: number | null;
        lng?: number | null;
      }[]
    | undefined;
}): Coord {
  const selected = input.days.find((day) => day.date === input.selectedDate);
  const slotCenter =
    firstCoord(selected?.slots ?? []) ??
    firstCoord(input.days.flatMap((day) => day.slots));
  if (slotCenter !== undefined) return slotCenter;

  const located = (input.bases ?? []).flatMap((base) => {
    const stay = input.stays?.find((s) => s.savedStayId === base.savedStayId);
    const lat = stay?.lat;
    const lng = stay?.lng;
    return typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
      ? [{ base, coord: { lat, lng } }]
      : [];
  });

  // 그날을 덮는 거점(체크아웃 날은 안 덮는다) → 가장 이른 거점. ISO 날짜라 문자열 비교가 곧 날짜 비교다.
  const covering = located.find(
    ({ base }) =>
      base.dateFrom <= input.selectedDate && input.selectedDate < base.dateTo
  );
  if (covering !== undefined) return covering.coord;

  const earliest = located.reduce<(typeof located)[number] | undefined>(
    (min, entry) =>
      min === undefined || entry.base.dateFrom < min.base.dateFrom
        ? entry
        : min,
    undefined
  );
  return earliest?.coord ?? FALLBACK_CENTER;
}
