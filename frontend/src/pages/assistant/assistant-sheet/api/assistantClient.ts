import type { AssistantPort } from './assistantPort';
import { HttpAssistantAdapter } from './httpAssistantAdapter';

/**
 * 교체 지점 — 도우미 서버 어댑터를 고르는 **유일한 곳**(TRIP-1319).
 *
 * 실 서버(BE `/api/v1/assistant/**`, TRIP-1410)다. 가짜 어댑터(`FakeAssistantAdapter`)는 프리뷰·테스트가
 * `setAssistantPort` 로 끼운다 — 훅·화면은 `AssistantPort` 만 안다.
 */
let port: AssistantPort = new HttpAssistantAdapter();

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
