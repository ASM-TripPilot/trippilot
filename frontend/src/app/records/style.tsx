import { TravelStylePage } from '@/pages/travel-style';

/**
 * j05 여행 스타일 분석 · 얇은 라우트 — 배선은 `pages/travel-style` 가 진다(`records/summary.tsx` 선례).
 * **계정 단위**(INV-U5-08)라 `tripId` 파라미터가 없다(`GET /me/style`) — `trips/[tripId]/records/*`
 * 와 달리 `app/records/` 아래에 산다. `app/records/index.tsx` 는 만들지 않는다(`(tabs)/records.tsx`
 * 가 이미 `/records` 를 소유 — 탭 충돌 회피). `(tabs)` 밖 파일시스템 라우트라 미인증 딥링크 노출
 * 구조를 공유한다(데이터는 서버 401). 앱 내 진입은 l03 마이 요약카드 상세진입이 배선한다.
 */
export default function TravelStyleRoute() {
  return <TravelStylePage />;
}
