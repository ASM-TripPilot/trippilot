// 네트워크·컨테이너를 싣지 않는 진입점(순수 뷰·글리프·config·순수 model 만) — 개발 프리뷰처럼 네트워크 없이
// 그려야 하는 소비자용. index.ts 를 물면 슬라이스 전체가 평가돼 devPreviewReleaseGate 지뢰가 터진다(TRIP-1157).

export { formatKm } from './model/formatKm';
export { buildMagazineVM, splitHighlight } from './model/magazineVM';
export type {
  MagazineCoverVM,
  MagazineInput,
  MagazinePicture,
  MagazineQuoteVM,
  MagazineRouteStop,
  MagazineSlot,
  MagazineStatTile,
  MagazineVM,
} from './model/magazineVM';
export {
  CATEGORY_PALETTES,
  MAGAZINE_TONES,
  dominantPaletteKey,
} from './model/categoryPalette';
export type { CategoryPalette, PaletteKey } from './model/categoryPalette';
export { ReflectionMagazine } from './ui/ReflectionMagazine';
export {
  MagazineCover,
  MagazinePhoto,
  MagazineQuote,
  MagazineRoute,
  MagazineStats,
} from './ui/MagazineParts';
export {
  CAPTION_MAX_LENGTH,
  HASHTAG_MAX_COUNT,
  SHARE_FORMATS,
  buildShareCard,
  formatShareCardStats,
  validateCaption,
  validateHashtags,
} from './model/shareCard';
export type { ShareCardVM, ShareFormat } from './model/shareCard';
export { pickReflectionDate } from './model/recordBarNav';
export type { RecordBarNav } from './model/recordBarNav';
export type { CoverPhoto } from './model/coverPhoto';
export { buildSummaryMagazineVM } from './model/summaryMagazineVM';
export type {
  SummaryDayCardVM,
  SummaryMagazineInput,
  SummaryMagazineVM,
} from './model/summaryMagazineVM';
export { summaryStats } from './model/summaryStats';
export type { SummaryStatCells } from './model/summaryStats';
export {
  daySubtitle,
  distanceSourceLabel,
  resolveSummaryView,
  shareEnabled,
  toOrderedVisitList,
} from './model/summaryView';
export type { OrderedVisit } from './model/summaryView';
export {
  EmptyCircleGlyph,
  ReflectionLocationOffGlyph,
  PhotoOffGlyph,
  ReflectionRetryGlyph,
} from './ui/ReflectionGlyphs';
