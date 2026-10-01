import { RegionPickerPage } from '@/pages/region-picker';

/**
 * d1b·e00 지역 선택 — 정본 `frontend-components.md` §1의 `explore/region.tsx` 자리.
 * 목적은 쿼리 파라미터로 온다: `/explore/region`(기본 stay) · 나머지 철자는 `regionPickerHref`(TRIP-985).
 */
export default function RegionRoute() {
  return <RegionPickerPage />;
}
