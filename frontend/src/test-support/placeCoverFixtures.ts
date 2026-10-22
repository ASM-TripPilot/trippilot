import type { ImageSourcePropType } from 'react-native';

/**
 * 장소 카테고리 생성 이미지 **테스트 오라클**(사이클 20261022-place-category-covers).
 *
 * 구현(`shared/lib/placeCover.ts`)의 맵·해시를 가져오지 않고, 이 파일이 따로 쥔 사실표로 기대값을 만든다 — 호출부
 * 테스트가 구현 함수로 기대값을 계산하면(동어반복) 함수가 틀려도 통과한다.
 *  - `COVER`: 30장을 정적 `require` 로 손수 펼친 표. jest-expo 에서 `require('*.webp')` 는 파일마다 서로 다른
 *    `{ testUri }` 객체를 돌려준다(경로가 들어 있어 30장이 전부 구별된다).
 *  - `SLUG_OF`: 한글 카테고리 → 파일 slug(assets/place-categories/README.md 의 표).
 *  - `VARIANT_OF`: 테스트가 쓰는 poiId 마다 `FNV-1a 32비트(UTF-16 코드 단위) % 3 + 1` 값을 **독립 계산해 박은** 표.
 *    계산법(node): `h=0x811c9dc5; for 각 글자 { h^=code; h=Math.imul(h,0x01000193)>>>0 } return h%3+1`.
 *    이 표가 구현의 해시와 어긋나면 `placeCover.test.ts` 가 먼저 red 로 알린다.
 */

type Variant = 1 | 2 | 3;

export type CoverSlug =
  | 'sight'
  | 'food'
  | 'cafe'
  | 'night_view'
  | 'nature'
  | 'shopping'
  | 'culture'
  | 'activity'
  | 'art'
  | 'bar';

export const COVER_SLUGS: readonly CoverSlug[] = [
  'sight',
  'food',
  'cafe',
  'night_view',
  'nature',
  'shopping',
  'culture',
  'activity',
  'art',
  'bar',
];

export const COVER: Record<CoverSlug, Record<Variant, ImageSourcePropType>> = {
  sight: {
    1: require('../../assets/place-categories/sight-1.webp'),
    2: require('../../assets/place-categories/sight-2.webp'),
    3: require('../../assets/place-categories/sight-3.webp'),
  },
  food: {
    1: require('../../assets/place-categories/food-1.webp'),
    2: require('../../assets/place-categories/food-2.webp'),
    3: require('../../assets/place-categories/food-3.webp'),
  },
  cafe: {
    1: require('../../assets/place-categories/cafe-1.webp'),
    2: require('../../assets/place-categories/cafe-2.webp'),
    3: require('../../assets/place-categories/cafe-3.webp'),
  },
  night_view: {
    1: require('../../assets/place-categories/night_view-1.webp'),
    2: require('../../assets/place-categories/night_view-2.webp'),
    3: require('../../assets/place-categories/night_view-3.webp'),
  },
  nature: {
    1: require('../../assets/place-categories/nature-1.webp'),
    2: require('../../assets/place-categories/nature-2.webp'),
    3: require('../../assets/place-categories/nature-3.webp'),
  },
  shopping: {
    1: require('../../assets/place-categories/shopping-1.webp'),
    2: require('../../assets/place-categories/shopping-2.webp'),
    3: require('../../assets/place-categories/shopping-3.webp'),
  },
  culture: {
    1: require('../../assets/place-categories/culture-1.webp'),
    2: require('../../assets/place-categories/culture-2.webp'),
    3: require('../../assets/place-categories/culture-3.webp'),
  },
  activity: {
    1: require('../../assets/place-categories/activity-1.webp'),
    2: require('../../assets/place-categories/activity-2.webp'),
    3: require('../../assets/place-categories/activity-3.webp'),
  },
  art: {
    1: require('../../assets/place-categories/art-1.webp'),
    2: require('../../assets/place-categories/art-2.webp'),
    3: require('../../assets/place-categories/art-3.webp'),
  },
  bar: {
    1: require('../../assets/place-categories/bar-1.webp'),
    2: require('../../assets/place-categories/bar-2.webp'),
    3: require('../../assets/place-categories/bar-3.webp'),
  },
};

/** 알 수 없는 카테고리·null 의 중립 폴백. */
export const FALLBACK_COVER: ImageSourcePropType = require('../../assets/region-covers/placeholder/place.webp');

/** 한글 정본 10종만 받는다(영문 코드는 폴백 — 01b). */
export const SLUG_OF: Readonly<Record<string, CoverSlug>> = {
  명소: 'sight',
  맛집: 'food',
  카페: 'cafe',
  야경: 'night_view',
  자연: 'nature',
  쇼핑: 'shopping',
  문화: 'culture',
  액티비티: 'activity',
  미술: 'art',
  술집: 'bar',
};

/** 변형 1·2·3 이 각각 나오는 실 UUID 모양 poiId. */
export const UUID_V1 = '550e8400-e29b-41d4-a716-446655440000';
export const UUID_V2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const UUID_V3 = '123e4567-e89b-12d3-a456-426614174000';

export const VARIANT_OF: Readonly<Record<string, Variant>> = {
  p1: 2,
  p2: 3,
  p3: 1,
  p4: 2,
  p5: 3,
  'poi-1': 3,
  'poi-2': 3,
  'poi-3': 2,
  'poi-a': 3,
  'poi-b': 3,
  'poi-c': 2,
  'poi-z': 2,
  'poi-gwangalli': 2,
  X: 3,
  Z: 1,
  P: 2,
  Q: 3,
  a: 2,
  b: 2,
  current: 1,
  'poi-raw-7788': 2,
  rk0: 2,
  rk1: 1,
  rk2: 1,
  rk3: 3,
  rk4: 1,
  rk5: 3,
  rk6: 3,
  s0: 2,
  s5: 3,
  '550e8400-e29b-41d4-a716-446655440000': 1,
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8': 2,
  '123e4567-e89b-12d3-a456-426614174000': 3,
};

/**
 * 숙소 일반 그림 6장(TRIP-1587 · `assets/stay-covers/stay-1~6.webp`) — 장소처럼 카테고리 `'숙소'` 로 고르고
 * 변형은 `FNV-1a 32비트 % 6 + 1` 이다. 유형별 세트는 없다(호텔·리조트 구분 없이 한 세트).
 */
type StayVariant = 1 | 2 | 3 | 4 | 5 | 6;

export const STAY_COVER: Record<StayVariant, ImageSourcePropType> = {
  1: require('../../assets/stay-covers/stay-1.webp'),
  2: require('../../assets/stay-covers/stay-2.webp'),
  3: require('../../assets/stay-covers/stay-3.webp'),
  4: require('../../assets/stay-covers/stay-4.webp'),
  5: require('../../assets/stay-covers/stay-5.webp'),
  6: require('../../assets/stay-covers/stay-6.webp'),
};

/**
 * 테스트가 쓰는 숙소 키마다 `FNV-1a 32비트 % 6 + 1` 을 node 로 **독립 계산해 박은** 표(계산법은 위 `VARIANT_OF` 와 같고
 * 끝만 `h%6+1`). 키 모양은 검색 목록과 같은 `stayKey`(`{externalSource}:{externalId}`) 또는 외부 키가 없는 저장
 * 숙소의 `savedStayId`. `KAKAO:13`~`KAKAO:18` 은 변형 1~6 이 차례로 나오는 키다.
 */
export const STAY_VARIANT_OF: Readonly<Record<string, StayVariant>> = {
  'KAKAO:13': 1,
  'KAKAO:14': 2,
  'KAKAO:15': 3,
  'KAKAO:16': 4,
  'KAKAO:17': 5,
  'KAKAO:18': 6,
  'NAVER:n-99': 1,
  'NAVER:s1': 6,
  'NAVER:s2': 3,
  'NAVER:s3': 2,
  'TRIPCOM:123': 4,
  'ss-1': 6,
  'stay-a': 3,
  'stay-b': 4,
  'aaaaaaaa-0000-4000-8000-000000000001': 5,
  'aaaaaaaa-0000-4000-8000-000000000002': 6,
  'aaaaaaaa-0000-4000-8000-000000000003': 1,
  'ss-2': 3,
};

/** 숙소 키에 대한 **기대 숙소 그림**. 키가 표에 없으면 던진다 · 키가 없으면(undefined·'') 변형 1. */
export function stayCoverFor(key?: string): ImageSourcePropType {
  if (key === undefined || key === '') return STAY_COVER[1];
  const variant = STAY_VARIANT_OF[key];
  if (variant === undefined)
    throw new Error(`stayCoverFor: STAY_VARIANT_OF 에 없는 키 ${key}`);
  return STAY_COVER[variant];
}

/**
 * 한글 카테고리 + poiId 에 대한 **기대 생성 이미지**. poiId 가 표에 없으면 던진다(조용히 변형 1 로 가면 "poiId 를
 * 무시하는 구현" 이 통과한다). poiId 를 안 주면(undefined) 변형 1 이다.
 */
export function coverFor(
  category: string,
  poiId?: string
): ImageSourcePropType {
  const slug = SLUG_OF[category];
  if (slug === undefined)
    throw new Error(`coverFor: 모르는 카테고리 ${category}`);
  if (poiId === undefined || poiId === '') return COVER[slug][1];
  const variant = VARIANT_OF[poiId];
  if (variant === undefined)
    throw new Error(`coverFor: VARIANT_OF 에 없는 poiId ${poiId}`);
  return COVER[slug][variant];
}
