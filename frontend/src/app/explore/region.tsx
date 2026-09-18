import { RegionPickerPage } from '@/pages/region-picker';

/**
 * d1b·e00 지역 선택 — 정본 `frontend-components.md` §1의 `explore/region.tsx` 자리.
 * 목적은 쿼리 파라미터로 온다: `/explore/region`(기본 stay) · `/explore/region?purpose=trip`.
 */
export default function RegionRoute() {
  return <RegionPickerPage />;
}
