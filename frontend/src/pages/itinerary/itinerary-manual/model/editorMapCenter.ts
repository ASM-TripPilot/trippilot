/**
 * 직접 짜기 편집기 지도 중심(TRIP-1022 #075 · 결정 1). 사다리 첫 칸이 이긴다:
 *  ① 그날 핀이 있으면 첫 핀
 *  ② 그날을 덮는 거점(`dateFrom ≤ date < dateTo` — 체크아웃 날은 안 덮는다)의 숙소 좌표
 *  ③ 좌표가 온전한 거점 중 `dateFrom` 이 가장 이른 숙소(1박 2일의 2일차가 서울로 튀지 않게)
 *  ④ 서울시청 — {0,0} 은 기니만 바다라 무의미하다.
 * 거점 응답엔 좌표가 없어 등록 숙소(`SavedStay.lat/lng`, nullable)에서 찾는다.
 */

type Coord = { lat: number; lng: number };

const FALLBACK_CENTER: Coord = { lat: 37.5665, lng: 126.978 };

export function resolveEditorMapCenter(input: {
  pins: readonly Coord[];
  date: string;
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
  const [firstPin] = input.pins;
  if (firstPin !== undefined) return { lat: firstPin.lat, lng: firstPin.lng };

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

  const covering = located.find(
    ({ base }) => base.dateFrom <= input.date && input.date < base.dateTo
  );
  if (covering !== undefined) return covering.coord;

  // ISO 날짜('YYYY-MM-DD')라 문자열 비교가 곧 날짜 비교다.
  const earliest = located.reduce<(typeof located)[number] | undefined>(
    (min, entry) =>
      min === undefined || entry.base.dateFrom < min.base.dateFrom
        ? entry
        : min,
    undefined
  );
  return earliest?.coord ?? FALLBACK_CENTER;
}
