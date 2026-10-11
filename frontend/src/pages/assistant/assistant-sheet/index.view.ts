// 네트워크·컨테이너를 싣지 않는 진입점(계약 타입·샘플·순수 model·순수 뷰) — 개발 프리뷰용.
// index.ts 를 물면 어댑터·Query 훅이 함께 평가된다(devPreviewReleaseGate).
export type * from './api/assistantContract';
export {
  sampleActionLogs,
  sampleTranscript,
  type AssistantScenario,
} from './api/assistantSamples';
export {
  AssistantSheetView,
  type AssistantSheetViewProps,
} from './ui/AssistantSheetView';
export type { SheetState } from './model/resolveSheetState';
export { MessageCard } from './ui/AssistantCards';
export { TurnStatusRow } from './ui/AssistantSheetChrome';
export { HistoryView } from './ui/HistoryView';
export { displayMessage } from './model/displayActions';
export { currentQuickReplies, needsCapabilitiesChip } from './model/sheetModel';
