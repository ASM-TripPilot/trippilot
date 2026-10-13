/**
 * ✦ 도우미 시트 라우트(TRIP-1321 · BR-U8-02). 앱이 보내는 문맥은 화면 종류(`surface`)와 `tripId` 뿐이다 —
 * 그 외 화면 상태를 params 로 넘기지 않는다. 라우트는 루트 스택의 투명 모달 `app/assistant/index.tsx`.
 */

/** 도우미를 연 화면 — 서버 계약의 `screen.surface` 와 같은 값(frontend-components §1). */
export type AssistantSurface =
  'HOME' | 'STAY_SEARCH' | 'ITINERARY' | 'LIVE' | 'STAY_DETAIL';

export interface AssistantHref {
  pathname: '/assistant';
  params: { surface: AssistantSurface; tripId?: string };
}

export function assistantHref(
  surface: AssistantSurface,
  tripId?: string | null
): AssistantHref {
  return {
    pathname: '/assistant',
    params: tripId ? { surface, tripId } : { surface },
  };
}
