// TRIP-808 · entities/trip/model — trip 도메인의 공개 창구(AC-1). 806 place·807 stay 동형.
//
// 서버 계약 타입(Trip·TripStatus·TripDestination)은 새로 만들지 않고 `@/shared/api/generated`의
// 원본을 그대로 다시 내보낸다(re-export) — 서버 계약의 정본은 여전히 shared/api다(`api` 세그먼트 0).
// TripStatus 는 generated 에서 const object(값)이자 type 인데, 여기선 **타입만** 재수출한다.
export type {
  Trip,
  TripStatus,
  TripDestination,
} from '@/shared/api/generated/schemas';

/** h06 카드 배지 — 'done'=완성(itinerary CONFIRMED) · 'draft'=작성중 · null=itinerary 미도착(배지 미정). */
export type MyTripBadge = 'done' | 'draft' | null;

/**
 * h06 "내 여행" 카드 뷰모델 — 화면이 그대로 그릴 값(features/itinerary/ui/MyTripCard 로컬 정의에서 이관).
 * metaLine 은 컨테이너가 조립해 완성한 문자열이고, 배지/resume 은 badge 필드에서 파생한다(별도 필드 없음).
 */
export interface MyTripCardVM {
  tripId: string;
  title: string;
  metaLine: string;
  badge: MyTripBadge;
  extra: string | null;
  /** TRIP-788 · resume CTA 노출 신호(배지와 독립, AC-5 seam). 미전달=배지 파생 폴백(TripCard). */
  resume?: boolean;
  /** TRIP-788 · 카드 사진(픽스처 전용, AC-6 G7). 프로덕션 항상 null(INV-1 — Trip 에 사진 필드 없음). */
  imageUrl?: string | null;
}

/**
 * j07 지난 여행 카드 뷰모델 — 제목 + (있으면) 날짜범위·박수 라벨(features/record/model/recordsCalendar
 * 로컬 정의에서 이관). `Trip` 계약에 사진·통계 필드가 없어 카드가 지어내지 않는다(INV-1). 못 만든 라벨은
 * null(가짜 날짜·가짜 "0박" 금지).
 */
export interface PastTripCardVM {
  tripId: string;
  title: string;
  dateRangeLabel: string | null;
  nightsLabel: string | null;
}
