// TRIP-809 · entities/itinerary-slot/model — 슬롯 도메인의 공개 창구(AC-1). 806 place·807 stay·808 trip 동형.
//
// 서버 계약 타입(PoiCategory·ItineraryDaysItemSlotsItem·PlannedSlot)은 새로 만들지 않고
// `@/shared/api/generated`의 원본을 그대로 다시 내보낸다(re-export) — 서버 계약의 정본은 여전히
// shared/api다(`api` 세그먼트 0). PoiCategory 는 generated 에서 const object(값)이자 type 이라 값으로
// 재수출하고, 나머지 둘은 타입만 재수출한다(place/model 의 PoiCategory·Place 배치와 동형).
export { PoiCategory } from '@/shared/api/generated/schemas';
export type {
  ItineraryDaysItemSlotsItem,
  PlannedSlot,
} from '@/shared/api/generated/schemas';

/**
 * i13 재계획안 슬롯 행 상태 배지 — 'fixed' 는 상단 배지가 아니라 우측 고정 pill 이 표시한다
 * (ReplanSlotRow.tsx 로컬 정의에서 이관). null 은 배지 없음.
 */
export type SlotBadgeKind =
  'visited' | 'inProgress' | 'changed' | 'fixed' | null;

/**
 * i13 재계획안 슬롯 1행 뷰모델 — 화면이 그대로 그릴 값(ReplanSlotRow.tsx 로컬 정의에서 이관).
 * metaText 는 서버가 준 거리·시각범위를 통과 렌더하는 값이고(소요시간 조립 없음, INV-3),
 * 배지·후보 어포던스 파생은 소비처가 채운다(파생 함수 0).
 */
export interface ReplanSlotVM {
  slotKey: string;
  badgeKind: SlotBadgeKind;
  placeName: string;
  metaText: string;
  candidateCount?: number;
  isFixed: boolean;
}
