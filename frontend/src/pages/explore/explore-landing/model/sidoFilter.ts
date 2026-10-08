import { addressInRegion } from '@/features/trip/index.view';
import type { StayItem } from '@/shared/api/index.schemas';

/**
 * TRIP-1300 — d01 지역 필터 숙소 레인을 카탈로그 시도로 한 번 더 거른다(동명 구 서울·부산 강서구).
 *
 * ⚠️ 사본이다 — 원본은 `src/pages/stay/stay-search/model/sidoFilter.ts`(TRIP-1273). 형제 page 라
 * import 할 수 없어 같은 이름·의미로 베꼈다. 한쪽을 고치면 다른 쪽도 고친다(기계 강제 없음).
 * 시도가 없으면 거르지 않고, 주소를 모르면 남긴다(fail-open · INV-4). 비파괴.
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
