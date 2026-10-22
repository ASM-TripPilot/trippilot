/**
 * 장소 카테고리 생성 이미지 — 사진 없는 장소 칸을 채우는 번들 그림을 고르는 순수 함수.
 * 카테고리 10종 × 가로 3변형(`assets/place-categories/<slug>-<n>.webp`) + 중립 폴백(`place.webp`).
 * React Native(Metro)는 정적 `require` 문자열만 번들하므로 30장을 손으로 펼친다. 만든 방법·규격은 `assets/place-categories/README.md`.
 */
import type { ImageSourcePropType } from 'react-native';

type Variant = 0 | 1 | 2;
type Covers = readonly [
  ImageSourcePropType,
  ImageSourcePropType,
  ImageSourcePropType,
];

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
 * 카테고리(한글 정본)·poiId → 번들 그림. poiId 가 없으면 해시하지 않고 변형 1, 카테고리를 모르면 폴백.
 * 조회는 `hasOwnProperty` — `'constructor'` 같은 상속 이름이 폴백을 우회하지 못하게 한다.
 */
export function placeCoverSource(
  category: string | null | undefined,
  poiId?: string | null
): ImageSourcePropType {
  if (!category || !Object.prototype.hasOwnProperty.call(COVERS, category)) {
    return FALLBACK;
  }
  const variant = (poiId ? fnv1a32(poiId) % 3 : 0) as Variant;
  return COVERS[category][variant];
}
