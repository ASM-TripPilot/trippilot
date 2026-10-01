// TRIP-809 · entities/itinerary-slot/model — 슬롯 도메인의 공개 창구(AC-1). 806 place·807 stay·808 trip 동형.
//
// 서버 계약 타입(PoiCategory·ItineraryDaysItemSlotsItem·PlannedSlot)은 새로 만들지 않고
// `@/shared/api/generated`의 원본을 그대로 다시 내보낸다(re-export) — 서버 계약의 정본은 여전히
// shared/api다(`api` 세그먼트 0). PoiCategory 는 generated 에서 const object(값)이자 type 이라 값으로
// 재수출하고, 나머지 둘은 타입만 재수출한다(place/model 의 PoiCategory·Place 배치와 동형).
import type { ImageSourcePropType } from 'react-native';

export { PoiCategory } from '@/shared/api/generated/schemas';
export type {
  ItineraryDaysItemSlotsItem,
  PlannedSlot,
} from '@/shared/api/generated/schemas';

/**
 * i06 재계획안 행 번호 원의 톤(TRIP-751) — 방문·진행 중은 visited(초록), 예정은 planned(빨강).
 * 대안 없음 흐림 규칙도 이 축에서 도출한다(planned 행 전부 흐림, Seed Q3).
 */
export type ReplanSlotTone = 'visited' | 'planned';

/**
 * i05·i06 재계획안 슬롯 1행 뷰모델(TRIP-751) — 화면이 그대로 그릴 값. 시각·거리는 서버값 통과
 * 문자열이다(클라 재계산·소요시간 조립 없음, INV-2·INV-3). `distanceRange` 는 **이 슬롯까지 오는
 * 거리**라 커넥터는 다음 행의 값을 그린다. `photo` 는 `{uri}`·`require()` 둘 다 받는 RN 원천 타입.
 */
export interface ReplanSlotVM {
  slotKey: string;
  placeName: string;
  tone: ReplanSlotTone;
  photo: ImageSourcePropType | null;
  category: string | null;
  timeLabel: string | null;
  categoryLabel: string | null;
  distanceRange: string | null;
  isFixed: boolean;
}
