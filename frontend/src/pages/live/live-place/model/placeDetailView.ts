import { normalizeOpeningHours } from '@/entities/itinerary-slot/lib/normalizeOpeningHours';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-398 · i05 현재 장소 상세 — 순수 도출. 슬롯 POI 합성 필드에서 화면 표시용 뷰를 만든다.
 *
 * 무엇을 보장하나:
 *  - 결측 필드는 빈칸이 아니라 "미확인"(BR-U4-40, `mapPeek.ts` 선례 `nameKo ?? '미확인'`).
 *  - 매칭 슬롯이 없으면 null(D8) → 페이지가 "장소를 찾을 수 없어요" 얼굴로 접는다.
 */

const MISSING = '미확인';

export interface PlaceDetailView {
  name: string;
  category: string | null;
  tags: string[];
  imageUrl: string | null;
  /** 히어로 갤러리(TRIP-755). 운영은 대표 사진 1장뿐(`imageUrl`), 그 이상은 계약 공백(G6·TRIP-823). */
  galleryUrls: string[];
  /** 전체 사진 수("1 / N" 칩·"+N"). 계약 공백 — 운영은 null(INV-1, 지어내지 않는다). */
  photoTotal: number | null;
  /** 추천 카피 제목·본문. 계약 공백 — 운영은 null(G6). */
  pitchTitle: string | null;
  pitchBody: string | null;
  openingHours: string;
  /** openingHours == null → 값 자리를 `-unknown-openhours` testID 로 바꾸는 스위치(AC-2). */
  openingHoursMissing: boolean;
  /** openingHoursKnown===false 일 때만 "확인 필요"(D4). 그 외(true·null)는 null. */
  hoursCaption: string | null;
  /** 주소·입장료 — 슬롯 계약에 없어 운영은 null. 화면이 "미확인"으로 적는다(BR-U4-40). */
  address: string | null;
  admissionFee: string | null;
  lat: number | null;
  lng: number | null;
}

export function buildPlaceDetailView(
  slots: readonly ItineraryDaysItemSlotsItem[],
  poiId: string
): PlaceDetailView | null {
  const slot = slots.find((candidate) => candidate.poiId === poiId);
  if (slot === undefined) return null;

  const rawHours = slot.openingHours;
  const openingHoursMissing = rawHours === null || rawHours === undefined;

  return {
    name: slot.nameKo ?? MISSING,
    category: slot.category ?? null,
    tags: slot.tags,
    imageUrl: slot.imageUrl ?? null,
    galleryUrls: slot.imageUrl ? [slot.imageUrl] : [],
    photoTotal: null,
    pitchTitle: null,
    pitchBody: null,
    openingHours: openingHoursMissing
      ? MISSING
      : normalizeOpeningHours(rawHours),
    openingHoursMissing,
    hoursCaption: slot.openingHoursKnown === false ? '확인 필요' : null,
    address: null,
    admissionFee: null,
    lat: slot.lat ?? null,
    lng: slot.lng ?? null,
  };
}

/** OS 공유 시트 문구(TRIP-755 AC-5) — 장소명, 주소가 있으면 다음 줄에 덧붙인다. 순수 함수로 뺀
 * 이유: 운영 주소는 늘 null 이라 페이지 경로로는 주소 분기에 닿을 수 없다(V-9 가 여기서 잰다). */
export function buildPlaceShareMessage(
  view: Pick<PlaceDetailView, 'name' | 'address'>
): string {
  return view.address === null ? view.name : `${view.name}\n${view.address}`;
}
