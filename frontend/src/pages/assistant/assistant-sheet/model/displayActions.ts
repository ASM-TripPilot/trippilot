import type {
  AssistantMessage,
  NextAction,
  ReviewPayload,
} from '../api/assistantContract';
import { nextActionRoute, type NextActionContext } from './nextActionRoute';

/**
 * 화면에 그릴 next action 목록(TRIP-1322 · BR-U8-06). 앱이 갈 수 없는 것(모르는 type·필수 파라미터 누락)은
 * 그리지 않고 `SHOW_CAPABILITIES` 하나로 대신한다 — 결과는 절대 비지 않는다(INV-U8-03 의 화면 쪽 짝).
 * 판정은 page 가 한 번 하고, 뷰는 이 결과만 그린다.
 */

export const CAPABILITIES_LABEL = '내가 할 수 있는 것 보기';

export const CAPABILITIES_ACTION: NextAction = {
  type: 'SHOW_CAPABILITIES',
  label: CAPABILITIES_LABEL,
  params: {},
};

export function displayActions(
  actions: readonly NextAction[],
  ctx: NextActionContext
): NextAction[] {
  const shown: NextAction[] = [];
  let substituted = false;
  for (const action of actions) {
    if (nextActionRoute(action, ctx) !== null) {
      shown.push(action);
    } else {
      substituted = true;
    }
  }
  const hasCapabilities = shown.some((a) => a.type === 'SHOW_CAPABILITIES');
  if ((substituted || shown.length === 0) && !hasCapabilities) {
    shown.push(CAPABILITIES_ACTION);
  }
  return shown;
}

/**
 * 메시지 하나를 화면용으로 거른다(TRIP-1323) — next action 목록과, 진행 검토 문제 행의 해결 행동까지.
 * 문제 행의 행동이 갈 수 없는 것이면 그 행은 "내가 할 수 있는 것 보기"로 잇는다(행을 지우지 않는다 — BR-U8-14
 * 문제 수는 서버가 정한다).
 */
export function displayMessage(
  message: AssistantMessage,
  ctx: NextActionContext
): AssistantMessage {
  if (message.role !== 'ASSISTANT') return message;
  const shown: AssistantMessage = {
    ...message,
    nextActions: displayActions(message.nextActions, ctx),
  };
  if (
    message.kind === 'REVIEW' &&
    message.payload &&
    'problems' in message.payload
  ) {
    const payload = message.payload as ReviewPayload;
    shown.payload = {
      ...payload,
      problems: payload.problems.map((problem) => ({
        ...problem,
        fixAction:
          nextActionRoute(problem.fixAction, ctx) === null
            ? CAPABILITIES_ACTION
            : problem.fixAction,
      })),
    };
  }
  return shown;
}

/** 여행 없음(NO_CONTEXT) 아이콘 행의 앞 글리프 — 숙소 탐색만 돋보기, 나머지는 플러스(기본값은 확인 대상). */
export function noContextActionIcon(type: string): 'search' | 'plus' {
  return type === 'OPEN_STAY_SEARCH' ? 'search' : 'plus';
}
