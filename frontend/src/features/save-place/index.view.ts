// 네트워크·컨테이너를 싣지 않는 진입점(순수 뷰·글리프·config·순수 model 만) — 개발 프리뷰처럼 네트워크 없이
// 그려야 하는 소비자용. index.ts 를 물면 슬라이스 전체가 평가돼 devPreviewReleaseGate 지뢰가 터진다(TRIP-1157).

export {
  COORD_BLOCKED_NOTICE,
  REMOVE_FAILURE_NOTICE,
  SAVE_FAILURE_NOTICE,
  hasUsableCoords,
} from './model/placeSaveGuard';
export type { PlaceSaveNotice } from './model/placeSaveGuard';
export { usePlaceSaveToggle } from './model/placeSaveToggle';
export { optimisticSavedPlaceId } from './model/savedPlaceIndex';
