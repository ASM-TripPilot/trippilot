// TRIP-809 재수출 shim — 본체는 entities/itinerary-slot/lib/categoryPlaceholder 로 바이트 이관됐다
// (807 formatPrice 선례). 옛 경로(`@/features/itinerary/model/categoryPlaceholder`)를 무는 무수정
// 소비처·테스트가 그대로 green 이 되게 재수출만 남긴다. shim 정리는 TRIP-810.
export { resolveCategoryPlaceholder } from '@/entities/itinerary-slot/lib/categoryPlaceholder';
export type { CategoryPlaceholder } from '@/entities/itinerary-slot/lib/categoryPlaceholder';
