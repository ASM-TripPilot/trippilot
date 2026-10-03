// 개발·프리뷰용 부산 테마 플레이스홀더 사진 — PIL 로 그린 2색 그라디언트다(실사진 아님, 출처·라이선스는 home/CREDITS.md).
// 홈(pages/home)·매거진(pages/magazine) 두 형제 페이지가 함께 써서 shared 에 둔다(FSD asset-handling, TRIP-1161).
// 값은 require 의 번들 에셋 번호(number)다 — 문자열 URI 가 필요한 자리는 Image.resolveAssetSource(...).uri 로 푼다.
export const PLACEHOLDER_PHOTOS = {
  heroNight: require('./home/hero-night.jpg') as number,
  heroCoast: require('./home/hero-coast.jpg') as number,
  heroCafe: require('./home/hero-cafe.jpg') as number,
  heroMarket: require('./home/hero-market.jpg') as number,
  heroView: require('./home/hero-view.jpg') as number,
  collectionGamcheon: require('./home/collection-gamcheon.jpg') as number,
  collectionHaeundae: require('./home/collection-haeundae.jpg') as number,
  collectionYonggungsa: require('./home/collection-yonggungsa.jpg') as number,
  spotJeonpo: require('./home/spot-jeonpo.jpg') as number,
  spotJagalchi: require('./home/spot-jagalchi.jpg') as number,
  spotSup: require('./home/spot-sup.jpg') as number,
  spotHwangnyeong: require('./home/spot-hwangnyeong.jpg') as number,
} as const;
