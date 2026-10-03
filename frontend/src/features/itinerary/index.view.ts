// 네트워크·컨테이너를 싣지 않는 진입점(순수 뷰·글리프·config·순수 model 만) — 개발 프리뷰처럼 네트워크 없이
// 그려야 하는 소비자용. index.ts 를 물면 슬라이스 전체가 평가돼 devPreviewReleaseGate 지뢰가 터진다(TRIP-1157).

export {
  countPickedCoPickSlots,
  firstCoPickSlotKey,
  nextCoPickSlotKey,
} from './model/coPickSlots';
export {
  DRAFT_POLL_INTERVAL_MS,
  buildDraftDayTabs,
  buildDraftPins,
  buildGenerationGauge,
  foldGenerationGauge,
  formatCoPickDayHeader,
  formatDraftDayHeader,
  resolveDraftView,
  resolveFallbackNotice,
  shouldKeepPollingDraft,
} from './model/draftView';
export type {
  DraftDayTab,
  DraftPin,
  DraftView,
  GenerationDayState,
} from './model/draftView';
export {
  MUST_VISIT_NAME_PLACEHOLDER,
  buildMustVisitPins,
  fixedTimeLabel,
  joinMustVisits,
  resolveMustVisitListView,
} from './model/mustVisitList';
export type {
  MustVisitListItem,
  MustVisitListView,
} from './model/mustVisitList';
export {
  buildPlanDayTabs,
  isConfirmLocked,
  itineraryDestinationHref,
  resolveItineraryDestination,
  resolvePlanState,
} from './model/planState';
export { resolveUnplacedNames } from './model/unplacedMustVisits';
export {
  AlertCircleGlyph,
  BackChevronGlyph,
  CalendarGlyph,
  CheckCircleGlyph,
  CheckGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  ClockGlyph,
  CloseGlyph,
  CoPickGlyph,
  DashGlyph,
  DiamondGlyph,
  FullAiGlyph,
  InfoCircleGlyph,
  LinkChevronGlyph,
  LocationOffGlyph,
  LockGlyph,
  ManualGlyph,
  PencilGlyph,
  PlusGlyph,
  SortCheckGlyph,
  WarningTriangleGlyph,
} from './ui/ItineraryGlyphs';
export { PlaceAddHeader, PlaceAddRow } from './ui/PlaceAddScreen';
export { UnplacedMustVisitNotice } from './ui/UnplacedMustVisitNotice';
