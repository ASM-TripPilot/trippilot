/**
 * 장소 카테고리 생성 이미지 — 사진 없는 장소·숙소 칸을 채우는 번들 그림을 고르는 순수 함수.
 * 카테고리 10종 × 가로 3변형(`assets/place-categories/<slug>-<n>.webp`) + 숙소 일반 그림 6장(`'숙소'`,
 * `assets/stay-covers/stay-<n>.webp`, TRIP-1587) + 중립 폴백(`place.webp`).
 * React Native(Metro)는 정적 `require` 문자열만 번들하므로 36장을 손으로 펼친다. 만든 방법·규격은 각 폴더 `README.md`.
 */
import type { ImageSourcePropType } from 'react-native';

type Covers = readonly ImageSourcePropType[];

const COVERS: Readonly<Record<string, Covers>> = {
  명소: [
    require('../../../assets/place-categories/sight-1.webp'),
    require('../../../assets/place-categories/sight-2.webp'),
    require('../../../assets/place-categories/sight-3.webp'),
  ],
  맛집: [
    require('../../../assets/place-categories/food-1.webp'),
    require('../../../assets/place-categories/food-2.webp'),
    require('../../../assets/place-categories/food-3.webp'),
  ],
  카페: [
    require('../../../assets/place-categories/cafe-1.webp'),
    require('../../../assets/place-categories/cafe-2.webp'),
    require('../../../assets/place-categories/cafe-3.webp'),
  ],
  야경: [
    require('../../../assets/place-categories/night_view-1.webp'),
    require('../../../assets/place-categories/night_view-2.webp'),
    require('../../../assets/place-categories/night_view-3.webp'),
  ],
  자연: [
    require('../../../assets/place-categories/nature-1.webp'),
    require('../../../assets/place-categories/nature-2.webp'),
    require('../../../assets/place-categories/nature-3.webp'),
  ],
  쇼핑: [
    require('../../../assets/place-categories/shopping-1.webp'),
    require('../../../assets/place-categories/shopping-2.webp'),
    require('../../../assets/place-categories/shopping-3.webp'),
  ],
  문화: [
    require('../../../assets/place-categories/culture-1.webp'),
    require('../../../assets/place-categories/culture-2.webp'),
    require('../../../assets/place-categories/culture-3.webp'),
  ],
  액티비티: [
    require('../../../assets/place-categories/activity-1.webp'),
    require('../../../assets/place-categories/activity-2.webp'),
    require('../../../assets/place-categories/activity-3.webp'),
  ],
  미술: [
    require('../../../assets/place-categories/art-1.webp'),
    require('../../../assets/place-categories/art-2.webp'),
    require('../../../assets/place-categories/art-3.webp'),
  ],
  술집: [
    require('../../../assets/place-categories/bar-1.webp'),
    require('../../../assets/place-categories/bar-2.webp'),
    require('../../../assets/place-categories/bar-3.webp'),
  ],
  // 숙소 사진 칸(TRIP-1587) — 유형과 무관한 일반 숙소 그림. 키는 호출부가 주는 숙소 키(`stayKey` 또는 `savedStayId`).
  // 일정 슬롯의 거점 POI 도 카테고리가 `'숙소'` 라 같은 그림을 받는다.
  숙소: [
    require('../../../assets/stay-covers/stay-1.webp'),
    require('../../../assets/stay-covers/stay-2.webp'),
    require('../../../assets/stay-covers/stay-3.webp'),
    require('../../../assets/stay-covers/stay-4.webp'),
    require('../../../assets/stay-covers/stay-5.webp'),
    require('../../../assets/stay-covers/stay-6.webp'),
  ],
};

const FALLBACK: ImageSourcePropType = require('../../../assets/region-covers/placeholder/place.webp');

/** FNV-1a 32비트 해시 — 같은 문자열은 어느 실행에서나 같은 0 이상 2^32 미만 정수. 알고리즘을 바꾸면 이미 본 장소의 그림이 바뀐다. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 카테고리(한글 정본)·poiId(숙소는 숙소 키) → 번들 그림. 변형은 `fnv1a32 % 그 카테고리 장수` — poiId 가 없으면
 * 해시하지 않고 첫 장, 카테고리를 모르면 폴백.
 * 조회는 `hasOwnProperty` — `'constructor'` 같은 상속 이름이 폴백을 우회하지 못하게 한다.
 */
export function placeCoverSource(
  category: string | null | undefined,
  poiId?: string | null
): ImageSourcePropType {
  if (!category || !Object.prototype.hasOwnProperty.call(COVERS, category)) {
    return FALLBACK;
  }
  const covers = COVERS[category];
  return covers[poiId ? fnv1a32(poiId) % covers.length : 0];
}
