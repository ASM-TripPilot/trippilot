import { MustVisitListPage } from '@/pages/trip-new-mustvisit';

/** S12 꼭 갈 곳 전용 목록 — 얇은 라우트, 배선은 `pages/trip-new-mustvisit`가 진다(`step1.tsx` 선례). */
export default function TripNewMustVisitsRoute() {
  return <MustVisitListPage />;
}
