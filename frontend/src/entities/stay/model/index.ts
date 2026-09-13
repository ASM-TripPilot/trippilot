// TRIP-807 · entities/stay/model — stay 도메인의 공개 창구(AC-1). 806 entities/place/model 동형.
//
// 서버 계약 타입(StayItem·SavedStay·StayPrice)은 새로 만들지 않고 `@/shared/api/generated`의
// 원본을 그대로 다시 내보낸다(re-export) — 서버 계약의 정본은 여전히 shared/api다(`api` 세그먼트 0).
// entities 는 "여기가 stay 도메인 진입점"이라는 표시일 뿐이다.
export type {
  StayItem,
  SavedStay,
  StayPrice,
} from '@/shared/api/generated/schemas';

/**
 * 검색 풀/레인 카드 뷰모델 — 화면이 아는 최소 필드(ExploreLandingScreen 로컬 정의에서 이관).
 * priceText 는 라우트가 `formatPrice`로 조립해 넣는다(카드는 가격 포맷을 모른다).
 */
export interface StayCardVM {
  key: string;
  name: string;
  region: string;
  priceText: string;
}

/**
 * 저장 숙소 degrade 카드 뷰모델 — 이름과 (있으면)날짜라벨만(SavedStayListScreen 로컬 정의에서 이관).
 * `SavedStay` 계약에 사진·지역·거리·가격이 없어 그 필드는 두지 않는다(발명 0 · INV-1). dateLabel 은
 * 체크인/아웃이지 소요시간이 아니다(INV-3).
 */
export interface SavedStayCardVM {
  savedStayId: string;
  name: string;
  dateLabel?: string;
}
