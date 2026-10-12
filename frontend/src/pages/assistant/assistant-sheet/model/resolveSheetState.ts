import type { AssistantSession } from '../api/assistantContract';
import { isAssistantApiError } from '../api/assistantPort';

/**
 * 시트 상태 판정(TRIP-1320 · frontend-components §3) — 페이지에서 1회 부르고 뷰는 결과만 받는다
 * (U4 `resolveReplanState` 선례).
 *
 * FD 의 4상태(LOADING·READY·OPEN_FAILED·NO_CONTEXT)에 `UNAUTHORIZED` 를 더했다 — 세션 생성 401 이면
 * 페이지가 시트를 닫는다(§1). 오류 표면으로 그리지 않으므로 OPEN_FAILED 와 갈라 둔다.
 */

export type SheetState =
  'LOADING' | 'READY' | 'NO_CONTEXT' | 'OPEN_FAILED' | 'UNAUTHORIZED';

export interface SheetSessionQuery {
  status: 'pending' | 'error' | 'success';
  error: unknown;
  session?: AssistantSession;
}

export function resolveSheetState(query: SheetSessionQuery): SheetState {
  if (query.status === 'error') {
    return isAssistantApiError(query.error) &&
      query.error.code === 'UNAUTHORIZED'
      ? 'UNAUTHORIZED'
      : 'OPEN_FAILED';
  }
  if (query.status === 'pending' || !query.session) return 'LOADING';
  return query.session.tripId === null ? 'NO_CONTEXT' : 'READY';
}
