import { PlaceExplorePage } from '@/pages/place-explore';

/**
 * d04 장소 탐색 default — 정본 `frontend-components.md` §1의 `explore/places.tsx` 자리.
 * 지역은 쿼리 파라미터로 온다: `/explore/places`(전국) · `/explore/places?region=jeju`.
 */
export default function PlaceExploreRoute() {
  return <PlaceExplorePage />;
}
