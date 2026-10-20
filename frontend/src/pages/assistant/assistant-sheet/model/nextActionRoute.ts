import type { AssistantSurface, NextAction } from '../api/assistantContract';

/**
 * next action → 이동(TRIP-1320 · frontend-components §4.1). closed-set 표로만 라우트가 된다 —
 * 표에 없는 type·필수 파라미터가 빠진 값은 null 이고, 호출부가 그 버튼 대신 `SHOW_CAPABILITIES` 를
 * 그린다(BR-U8-06). 파라미터는 경로 조각으로 인코딩한다(서버 문자열이 경로를 바꾸지 못하게).
 *
 * - `OPEN_OTA` 는 외부 URL 을 직접 열지 않고 숙소 상세로 보낸다 — 제휴 고지 시트(BR-U1-30)를 건너뛰지 않게.
 * - `OPEN_PLACE` 의 "여행 중" 판정은 도우미를 연 화면이 여행 중 허브(`LIVE`)인가로 한다.
 * - `RESTORE_REVISION` 은 FE 에 리비전 화면(h36)이 없어 null(→ 능력 목록) — FD 개정 블록에 갭으로 남긴다.
 */

export type InternalAction =
  'RETRY_TURN' | 'CONTINUE_WITHOUT_ASSISTANT' | 'SHOW_CAPABILITIES';

export type NextActionTarget =
  | { kind: 'route'; href: string }
  | { kind: 'internal'; action: InternalAction };

export interface NextActionContext {
  tripId: string | null;
  surface: AssistantSurface;
}

const INTERNAL: readonly string[] = [
  'RETRY_TURN',
  'CONTINUE_WITHOUT_ASSISTANT',
  'SHOW_CAPABILITIES',
];

function seg(value: string): string {
  return encodeURIComponent(value);
}

function route(href: string): NextActionTarget {
  return { kind: 'route', href };
}

export function nextActionRoute(
  action: NextAction,
  { tripId, surface }: NextActionContext
): NextActionTarget | null {
  if (INTERNAL.includes(action.type)) {
    return { kind: 'internal', action: action.type as InternalAction };
  }
  const params = action.params ?? {};
  const trip = tripId ? `/trips/${seg(tripId)}` : null;

  switch (action.type) {
    case 'OPEN_STAY_SEARCH':
      return route('/stays');
    case 'OPEN_STYLE':
      return route('/records/style');
    case 'CREATE_TRIP':
      return route('/trips/new/step1');
    case 'OPEN_OTA':
      return params.stayId ? route(`/stays/${seg(params.stayId)}`) : null;
    case 'OPEN_PLACE':
      if (!params.poiId) return null;
      if (surface === 'LIVE' && trip) {
        return route(`${trip}/live/place/${seg(params.poiId)}`);
      }
      return route(`/explore/places/${seg(params.poiId)}`);
  }

  if (!trip) return null;
  switch (action.type) {
    case 'OPEN_ITINERARY':
      return route(`${trip}/itinerary`);
    case 'OPEN_ITINERARY_EDIT':
      return route(`${trip}/itinerary/edit`);
    case 'OPEN_ITINERARY_METHOD':
    case 'OPEN_REGENERATE':
      return route(`${trip}/itinerary/method`);
    case 'OPEN_REPLAN':
      return route(`${trip}/planb`);
    case 'OPEN_LIVE':
      return route(`${trip}/live`);
    case 'OPEN_REFLECTION':
      return route(
        params.date
          ? `${trip}/records/reflection/${seg(params.date)}`
          : `${trip}/records`
      );
    case 'OPEN_TRIP_SUMMARY':
      return route(`${trip}/records/summary`);
    default:
      return null;
  }
}
