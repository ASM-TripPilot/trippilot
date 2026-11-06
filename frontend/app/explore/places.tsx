import { PlaceExplorePage } from '@/pages/explore/place-explore';

/**
 * d04 장소 탐색 default — 정본 `frontend-components.md` §1의 `explore/places.tsx` 자리.
 * 지역은 쿼리 파라미터로 온다: `/explore/places`(서비스 지역) · `/explore/places?region=고성군&regionCode=48820`.
 */
export default function PlaceExploreRoute() {
  return <PlaceExplorePage />;
}
