// TRIP-806 · entities/place/model — place 도메인의 공개 창구(AC-M1).
//
// 서버 계약 타입(Place·PoiCategory·SavedPlace)은 새로 만들지 않고 `@/shared/api/generated`의
// 원본을 그대로 다시 내보낸다(re-export) — 서버 계약의 정본은 여전히 shared/api다(`api` 세그먼트 0).
// entities 는 "여기가 place 도메인 진입점"이라는 표시일 뿐이다.
export { PoiCategory } from '@/shared/api/generated/schemas';
export type { Place, SavedPlace } from '@/shared/api/generated/schemas';

/**
 * 레인 카드 경량 뷰모델 — 화면이 아는 최소 필드(ExploreLandingScreen 로컬 정의에서 이관).
 * `imageUrl` 은 옵셔널(없으면 회색 자리, 기본 이미지를 지어내지 않는다 · INV-1).
 */
export interface PlaceCardVM {
  poiId: string;
  name: string;
  region: string;
  imageUrl?: string | null;
}
