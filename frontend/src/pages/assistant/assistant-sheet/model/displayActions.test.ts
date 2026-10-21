import fc from 'fast-check';

import { NEXT_ACTION_TYPES, type NextAction } from '../api/assistantContract';
import {
  CAPABILITIES_ACTION,
  displayActions,
  displayMessage,
  noContextActionIcon,
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
            { reason: 'b', fixAction: act('RESTORE_REVISION') },
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

// TRIP-1529 심판 보강(03b W2) — 여행 없음 아이콘 행의 글리프 선택. 모양은 jest 사각이라 선택 규칙을 값으로 잠근다.
describe('noContextActionIcon (TRIP-1529)', () => {
  it('숙소 탐색은 돋보기, 새 여행 만들기는 플러스', () => {
    expect(noContextActionIcon('OPEN_STAY_SEARCH')).toBe('search');
    expect(noContextActionIcon('CREATE_TRIP')).toBe('plus');
  });

  // 발명값: 01b 에 없는 기본값 계약 — 그 밖의 모든 type 은 플러스.
  it.each(
    NEXT_ACTION_TYPES.filter(
      (type) => type !== 'OPEN_STAY_SEARCH' && type !== 'CREATE_TRIP'
    )
  )('그 밖의 type %s 은 기본값 플러스', (type) => {
    expect(noContextActionIcon(type)).toBe('plus');
  });
});
