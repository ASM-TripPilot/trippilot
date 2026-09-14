// TRIP-809 재수출 shim — 본체는 entities/itinerary-slot/ui/SlotPhotoPlaceholder 로 바이트 이관됐다
// (807 formatPrice 선례). TimelineScreen 은 재작성된 entities 경로로 소비하고, 옛 경로를 무는 무수정
// 소비처가 그대로 green 이 되게 재수출한다. shim 정리는 TRIP-810.
export { SlotPhotoPlaceholder } from '@/entities/itinerary-slot/ui/SlotPhotoPlaceholder';
export type { SlotPhotoPlaceholderProps } from '@/entities/itinerary-slot/ui/SlotPhotoPlaceholder';
