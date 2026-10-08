import { addressInRegion } from '@/features/trip/index.view';
import type { StayItem } from '@/shared/api/index.schemas';

/**
 * TRIP-1273(F3) — 숙소 목록 응답을 지역 피커가 실어 준 시도로 한 번 더 거른다.
 *
 * `/stays/search?region=` 은 이름으로 지역을 풀어 동명 구(서울·부산 강서구)를 합쳐 주고, 시도·코드
 * 파라미터가 없다(계약 공백) — `filterByPriceRange` 와 같은 클라 파생 필터이고, 서버가 생기면 옮긴다.
 * 시도가 없으면 거르지 않고(코드 없는 진입 현행), 주소를 모르면 남긴다(fail-open · INV-4). 비파괴.
 * ⚠️ 사본이 있다 — `src/pages/explore/explore-landing/model/sidoFilter.ts`(TRIP-1300, d01 레인). 함께 고친다.
 */
export function filterBySido(
  items: StayItem[],
  sido: string | undefined
): StayItem[] {
  if (!sido) return [...items];
  return items.filter(
    (item) => item.address == null || addressInRegion(item.address, sido)
  );
}
