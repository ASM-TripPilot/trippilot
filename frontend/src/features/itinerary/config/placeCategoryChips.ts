import type { PoiCategory } from '@/shared/api/generated/schemas';

/**
 * h13 장소 추가 카테고리 칩의 정본(TRIP-798 · AC-2). 화면이 `Object.values(PoiCategory)` 로 즉석
 * 나열하지 않고 이 목록 하나에서 순서·라벨·전송값을 받는다(`methodPicker.ts` 와 같은 features config
 * 세그먼트, 배럴 없이 화면이 직접 import).
 *
 * ★ 라벨 ≠ 전송값: '전시' 칩은 표시만 '전시'이고 서버 `category` 로는 **'문화'**(PoiCategory 실존)를
 * 보낸다 — enum 에 '전시'가 없어 라벨이 그대로 값으로 새면 서버 400/빈목록이 된다. `testId`·`label`·
 * `category` 세 필드를 명시 분리해 그 누출을 원천 차단한다.
 */
export type PlaceCategoryChip = {
  /** testID 접미 (`itinerary-place-category-${testId}`). */
  testId: string;
  /** 화면 표시 라벨. */
  label: string;
  /** 서버 전송값 (null = 전체). */
  category: PoiCategory | null;
};

export const PLACE_CATEGORY_CHIPS: readonly PlaceCategoryChip[] = [
  { testId: 'all', label: '전체', category: null },
  { testId: '맛집', label: '맛집', category: '맛집' },
  { testId: '명소', label: '명소', category: '명소' },
  { testId: '카페', label: '카페', category: '카페' },
  { testId: '전시', label: '전시', category: '문화' },
  { testId: '야경', label: '야경', category: '야경' },
];
