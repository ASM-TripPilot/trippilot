import fc from 'fast-check';

import { NEXT_ACTION_TYPES, type NextAction } from '../api/assistantContract';
import {
  CAPABILITIES_ACTION,
  displayActions,
  displayMessage,
} from './displayActions';
import type { NextActionContext } from './nextActionRoute';

/**
 * TRIP-1322 · BR-U8-06 — 화면에 그릴 next action 목록. 앱이 갈 수 없는 것(모르는 type·파라미터 누락)은
 * 그리지 않고 "내가 할 수 있는 것 보기" 하나로 대신한다 — 빈 버튼 줄로 끝나지 않는다.
 */

const ctx: NextActionContext = { tripId: 't1', surface: 'ITINERARY' };
const act = (
  type: string,
  params: Record<string, string> = {}
): NextAction => ({
  type,
  label: type,
  params,
});

describe('displayActions (TRIP-1322)', () => {
  it('갈 수 있는 것은 그대로 둔다', () => {
    expect(
      displayActions([act('OPEN_ITINERARY'), act('CREATE_TRIP')], ctx)
    ).toEqual([act('OPEN_ITINERARY'), act('CREATE_TRIP')]);
  });

  it('모르는 type 은 SHOW_CAPABILITIES 로 바뀌고 중복은 하나로 접힌다', () => {
    expect(displayActions([act('OPEN_ADMIN'), act('FOO')], ctx)).toEqual([
      CAPABILITIES_ACTION,
    ]);
  });

  it('속성 · 입력이 무엇이든 결과는 비지 않고 전부 갈 수 있는 것이다', () => {
    const typeArb = fc.oneof(
      fc.constantFrom(...NEXT_ACTION_TYPES),
      fc.string()
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: typeArb,
            label: fc.string(),
            params: fc.constant({}),
          })
        ),
        (actions) => {
          const shown = displayActions(actions, ctx);
          expect(shown.length).toBeGreaterThanOrEqual(1);
          shown.forEach((action) =>
            expect(NEXT_ACTION_TYPES as readonly string[]).toContain(
              action.type
            )
          );
        }
      ),
      { examples: [[[]], [[{ type: 'OPEN_OTA', label: 'x', params: {} }]]] }
    );
  });

  // TRIP-1513 · RESTORE_REVISION 은 h36 이 생겨 이제 갈 수 있는 행동이다(옛 기대: 능력 목록으로 대체)
  it('RESTORE_REVISION 은 여행 문맥이 있으면 대체되지 않고 그대로 그린다', () => {
    expect(displayActions([act('RESTORE_REVISION')], ctx)).toEqual([
      act('RESTORE_REVISION'),
    ]);
  });

  it('RESTORE_REVISION 도 여행 문맥이 없으면 갈 수 없어 "내가 할 수 있는 것"으로 바뀐다', () => {
    expect(
      displayActions([act('RESTORE_REVISION')], {
        tripId: null,
        surface: 'HOME',
      })
    ).toEqual([CAPABILITIES_ACTION]);
  });
});

describe('displayMessage (TRIP-1323)', () => {
  it('진행 검토 문제 행의 해결 행동도 갈 수 없으면 "내가 할 수 있는 것"으로 바뀐다', () => {
    const shown = displayMessage(
      {
        id: 'r',
        role: 'ASSISTANT',
        kind: 'REVIEW',
        payload: {
          title: 't',
          summary: [],
          problems: [
            { reason: 'a', fixAction: act('OPEN_ITINERARY') },
            { reason: 'b', fixAction: act('OPEN_OTA') },
          ],
        },
        nextActions: [act('OPEN_ITINERARY')],
        createdAt: '',
      },
      ctx
    );
    const problems = (
      shown.payload as { problems: { fixAction: NextAction }[] }
    ).problems;
    expect(problems.map((p) => p.fixAction.type)).toEqual([
      'OPEN_ITINERARY',
      'SHOW_CAPABILITIES',
    ]);
  });
});
