// 네트워크·컨테이너를 싣지 않는 진입점(순수 뷰·글리프·config·순수 model 만) — 개발 프리뷰처럼 네트워크 없이
// 그려야 하는 소비자용. index.ts 를 물면 슬라이스 전체가 평가돼 devPreviewReleaseGate 지뢰가 터진다(TRIP-1157).

export { WATCH_CATEGORY_LABEL, WATCH_STATUS_LABEL } from './config/watchLabels';
export type { WatchKind } from './config/watchLabels';
export { triggerLabel } from './model/triggerLabel';
export { triggerPillCopy } from './model/triggerPillCopy';
export { AppliedAlertGlyph, RiskWarningGlyph } from './ui/PlanbGlyphs';
