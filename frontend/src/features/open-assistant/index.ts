// ✦ AI 도우미 진입(FAB + 스택 배치 계산 + 시트 라우트) 공개 API — 진입 화면 4곳(home·stay-search·
// itinerary-plan·live)과 도우미 시트 page 가 쓴다. 네트워크 없음(프리뷰도 이 index 를 물어도 된다).
export {
  ASSISTANT_FAB_SIZE,
  FAB_STACK_GAP,
  TAB_FAB_BASE,
  TAB_TWO_STACK,
  assistantFabBottom,
  stackTop,
  toastBottomWith,
  type FabStack,
} from './model/fabStack';
export {
  assistantHref,
  type AssistantHref,
  type AssistantSurface,
} from './model/assistantHref';
export { AssistantFab, type AssistantFabProps } from './ui/AssistantFab';
export { SparkleGlyph } from './ui/AssistantGlyphs';
