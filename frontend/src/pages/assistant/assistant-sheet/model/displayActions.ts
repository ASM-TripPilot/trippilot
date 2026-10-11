import type { NextAction } from '../api/assistantContract';
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
