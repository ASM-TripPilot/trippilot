import { DestinationDetailPage } from '@/pages/destination-detail';

/**
 * d03 목적지 상세 라우트 — TRIP-183 "준비 중" 스텁을 실화면으로 교체(2026-08-22).
 * `region`(regionCode) params는 페이지가 직접 읽는다(`places.tsx`·`saved-places.tsx` 동형
 * 관례) — 얇은 래퍼, 조회·마크업 0.
 */
export default function DestinationRoute() {
  return <DestinationDetailPage />;
}
