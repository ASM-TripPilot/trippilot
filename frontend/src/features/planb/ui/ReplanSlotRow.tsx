// TRIP-809 재수출 shim — 본체는 entities/itinerary-slot/ui/ReplanSlotRow 로 바이트 이관됐고,
// VM 타입(ReplanSlotVM·SlotBadgeKind)은 entities/itinerary-slot/model 로 갔다. ReplanDraftScreen 은
// 재작성된 entities 경로로 소비하고, _dev/preview.tsx 가 이 shim 으로 ReplanSlotVM 타입을 계속 받아
// src/app 무변경(6-b SKIP · 02a ★10). shim 정리는 TRIP-810.
export { ReplanSlotRow } from '@/entities/itinerary-slot/ui/ReplanSlotRow';
export type {
  ReplanSlotVM,
  SlotBadgeKind,
} from '@/entities/itinerary-slot/model';
