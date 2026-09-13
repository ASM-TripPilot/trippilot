// TRIP-807 재수출 shim — 본체는 entities/stay/lib/formatPrice 로 이관됐다(806 formatDistance 선례).
// 옛 경로(`@/features/stay/model/formatPrice`)를 무는 무수정 소비처·테스트가 그대로 green이 되게
// 한 줄만 남긴다. shim 자체의 제거는 TRIP-810.
export { formatPrice } from '@/entities/stay/lib/formatPrice';
