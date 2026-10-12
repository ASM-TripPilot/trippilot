import type { AssistantPort } from './assistantPort';
import { FakeAssistantAdapter } from './fakeAssistantAdapter';

/**
 * 교체 지점 — 도우미 서버 어댑터를 고르는 **유일한 곳**(TRIP-1319).
 *
 * 지금은 가짜 어댑터다(BE assistant API·ai `/interpret` 미구현, 2026-10-12). BE 가 열리면 http 어댑터
 * (`shared/api` axios 인스턴스로 §6 경로를 부르고 실패를 `AssistantApiError` 로 정규화)를 만들어 아래
 * 한 줄만 바꾼다 — 훅·화면은 `AssistantPort` 만 알아 한 줄도 안 바뀐다.
 */
let port: AssistantPort = new FakeAssistantAdapter({ latencyMs: 600 });

export function assistantPort(): AssistantPort {
  return port;
}

/** 테스트·프리뷰 전용 — 어댑터를 갈아끼우고 되돌리는 함수를 돌려준다. */
export function setAssistantPort(next: AssistantPort): () => void {
  const previous = port;
  port = next;
  return () => {
    port = previous;
  };
}
