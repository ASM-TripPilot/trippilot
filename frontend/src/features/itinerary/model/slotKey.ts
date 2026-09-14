// TRIP-809 재수출 shim — 본체는 entities/itinerary-slot/lib/slotKey 로 파일째 바이트 이관됐다
// (807 formatPrice 선례). slotKey 를 무는 28 importer 가 그대로 green 이 되게 전 export 를 재수출한다.
// shim 정리는 TRIP-810.
export {
  buildSlotKey,
  parseSlotKey,
  buildSlotKeys,
} from '@/entities/itinerary-slot/lib/slotKey';
export type {
  ParsedSlotKey,
  SlotKeySet,
} from '@/entities/itinerary-slot/lib/slotKey';
