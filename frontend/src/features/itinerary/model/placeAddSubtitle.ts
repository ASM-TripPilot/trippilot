import type { Place } from '@/shared/api/index.schemas';

export type PlaceAddSubtitleInput = Pick<
  Place,
  'tags' | 'category' | 'region' | 'address'
>;

export interface PlaceAddSubtitle {
  parts: string[];
  address: string | null;
}

// null·undefined·빈 문자열·공백뿐(전각 포함)은 전부 "없음" — 값을 지어내지 않는다.
const present = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

/** h13 모양 행(장소 추가·즉석 방문 피커) 부제 — 1줄 `[지역?, #태그…, 카테고리]` · 2줄 주소. */
export function placeAddSubtitle(
  place: PlaceAddSubtitleInput
): PlaceAddSubtitle {
  return {
    parts: [
      ...(present(place.region) ? [place.region] : []),
      ...place.tags.map((tag) => `#${tag}`),
      place.category,
    ],
    address: present(place.address) ? place.address : null,
  };
}
