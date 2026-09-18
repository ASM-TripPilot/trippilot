import { MyTripsListPage } from '@/pages/itinerary-list';

/**
 * (tabs) 일정 진입 라우트 — TRIP-468로 "첫 여행 리다이렉트 문지기"를 **내 여행 목록 뷰**로
 * 재작성(핵심 결함 수정: 둘째 이후 여행이 이 탭에서 영영 접근 불가였던 것을 해소). 조회·정렬·
 * 카드 배선은 `pages/itinerary-list` 가 진다 — 라우트는 얇은 배선뿐(pages 층 전역 가드 사정거리 유지).
 */
export default function ItineraryTab() {
  return <MyTripsListPage />;
}
