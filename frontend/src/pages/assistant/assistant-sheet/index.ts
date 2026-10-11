// U8 AI 도우미 시트(b01~b07) 슬라이스 공개 API. 네트워크(어댑터·훅)를 싣는 진입점이다 —
// 프리뷰는 `index.view.ts` 를 문다.
export type * from './api/assistantContract';
export {
  AssistantApiError,
  isAssistantApiError,
  type AssistantErrorCode,
  type AssistantPort,
} from './api/assistantPort';
export { assistantPort, setAssistantPort } from './api/assistantClient';
export {
  FakeAssistantAdapter,
  fakeWithHistory,
  type FakeAssistantOptions,
} from './api/fakeAssistantAdapter';
export {
  assistantKeys,
  useApplyProposal,
  useAssistantMessages,
  useAssistantSession,
  useAssistantSessions,
  useClearSession,
  useDismissProposal,
  useSendTurn,
} from './model/assistantQueries';
