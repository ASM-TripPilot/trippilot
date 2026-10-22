import fc from 'fast-check';

import type {
  AssistantMessage,
  MessageKind,
  NextAction,
  QuickReply,
  QuickReplyAction,
} from '../api/assistantContract';
import { assistantSample } from '../api/assistantSamples';
import {
  candidateConsumedActions,
  candidateTarget,
  slotFaceLine,
} from './cardModel';

/**
 * TRIP-1320 · PBT-U8-8(FE 몫) — 카드 렌더 모델은 서버 문자열을 이어 붙이기만 한다.
 * 소요시간 문구를 스스로 만들지 않고(INV-3), 시각·거리 문자열은 그대로 실린다(INV-2).
 */

const clean = fc.string().filter((s) => !/분|소요|duration/i.test(s));

describe('slotFaceLine (TRIP-1320)', () => {
  it('시각·이름·거리를 그대로 싣고 소요시간 문구를 만들지 않는다', () => {
    fc.assert(
      fc.property(
        clean,
        clean,
        fc.option(clean, { nil: null }),
        (startAt, name, distanceRange) => {
          const line = slotFaceLine({ startAt, name, distanceRange });
          expect(line).not.toMatch(/분|소요|duration/i);
          expect(line).toContain(startAt);
          expect(line).toContain(name);
          if (distanceRange) expect(line).toContain(distanceRange);
        }
      )
    );
  });

  it('b02 모양 — "14:00 책방카페 · 이동 630m", 거리 없으면 거리 줄 없음', () => {
    expect(
      slotFaceLine({
        startAt: '14:00',
        name: '책방카페',
        distanceRange: '630m',
      })
    ).toBe('14:00 책방카페 · 이동 630m');
    expect(slotFaceLine({ startAt: '14:00', name: '책방카페' })).toBe(
      '14:00 책방카페'
    );
  });
});

// TRIP-1564 — 후보 카드 한 장이 눌렸을 때의 뜻(고르기 > 장소 보기 > 없음)과, 그 카드가 대신하는 빨간 행.
// 판정 범위는 인자로 받은 메시지 하나뿐이다(대화 전체를 뒤지지 않는다).

const pick = (
  id: string,
  poiId?: string,
  action: QuickReplyAction = 'PICK_CANDIDATE'
): QuickReply => ({
  id,
  label: id,
  action,
  params: poiId === undefined ? {} : { poiId },
});
const nav = (
  type: string,
  poiId?: string,
  label = `${type}-${poiId}`
): NextAction => ({
  type,
  label,
  params: poiId === undefined ? {} : { poiId },
});
function candidates(
  poiIds: string[],
  parts: {
    quickReplies?: QuickReply[] | null;
    nextActions?: NextAction[];
    kind?: MessageKind;
  } = {}
): AssistantMessage {
  return {
    id: 'm1',
    role: 'ASSISTANT',
    kind: parts.kind ?? 'CANDIDATES',
    payload: {
      candidates: poiIds.map((poiId) => ({
        poiId,
        name: `이름-${poiId}`,
        reason: '이유',
      })),
    },
    nextActions: parts.nextActions ?? [],
    quickReplies: parts.quickReplies,
    createdAt: '',
  };
}

describe('candidateTarget (후보 카드 누름의 뜻)', () => {
  it('고르기(PICK_CANDIDATE)가 그 후보 것이면 PICK 이고 그 quick reply 를 그대로 돌려준다', () => {
    const reply = pick('qr-a', 'a');
    const message = candidates(['a'], { quickReplies: [reply] });
    expect(candidateTarget(message, 'a')).toEqual({ kind: 'PICK', reply });
    expect((candidateTarget(message, 'a') as { reply: QuickReply }).reply).toBe(
      reply
    );
  });

  it('고르기가 없고 같은 poiId 의 OPEN_PLACE 가 있으면 OPEN 이고 그 행동을 그대로 돌려준다', () => {
    const action = nav('OPEN_PLACE', 'a');
    const message = candidates(['a'], {
      nextActions: [nav('OPEN_PLACE', 'b'), action],
    });
    const target = candidateTarget(message, 'a');
    expect(target.kind).toBe('OPEN');
    expect((target as { action: NextAction }).action).toBe(action);
  });

  it('둘 다 있으면 고르기가 이긴다', () => {
    const message = candidates(['a'], {
      quickReplies: [pick('qr-a', 'a')],
      nextActions: [nav('OPEN_PLACE', 'a')],
    });
    expect(candidateTarget(message, 'a').kind).toBe('PICK');
  });

  it('둘 다 없으면 정확히 NONE — 따라붙는 키가 없다', () => {
    expect(candidateTarget(candidates(['a']), 'a')).toEqual({ kind: 'NONE' });
  });

  it('닮은 것은 세지 않는다: 다른 poiId 의 고르기 · 다른 종류의 quick reply · 다른 type 행동 · poiId 없는 OPEN_PLACE', () => {
    const message = candidates(['a'], {
      quickReplies: [
        pick('qr-b', 'b'),
        pick('qr-opt', 'a', 'PICK_OPTION'),
        pick('qr-text', 'a', 'SEND_TEXT'),
        pick('qr-none'),
      ],
      nextActions: [
        nav('OPEN_ITINERARY', 'a'),
        nav('OPEN_PLACE'),
        nav('OPEN_PLACE', 'b'),
      ],
    });
    expect(candidateTarget(message, 'a')).toEqual({ kind: 'NONE' });
  });

  it('같은 종류가 여럿이면 첫 번째를 돌려준다', () => {
    const firstReply = pick('qr-1', 'a');
    const firstAction = nav('OPEN_PLACE', 'a', '첫째');
    const picked = candidates(['a'], {
      quickReplies: [firstReply, pick('qr-2', 'a')],
    });
    const opened = candidates(['a'], {
      nextActions: [firstAction, nav('OPEN_PLACE', 'a', '둘째')],
    });
    expect((candidateTarget(picked, 'a') as { reply: QuickReply }).reply).toBe(
      firstReply
    );
    expect(
      (candidateTarget(opened, 'a') as { action: NextAction }).action
    ).toBe(firstAction);
  });

  it('quickReplies 가 null 이거나 없어도 던지지 않는다', () => {
    const action = nav('OPEN_PLACE', 'a');
    expect(
      candidateTarget(
        candidates(['a'], { quickReplies: null, nextActions: [action] }),
        'a'
      ).kind
    ).toBe('OPEN');
    expect(
      candidateTarget(candidates(['a'], { quickReplies: null }), 'a').kind
    ).toBe('NONE');
    expect(candidateTarget(candidates(['a']), 'a').kind).toBe('NONE');
  });

  it('기존 candidates 샘플(고르기만 있음)은 두 후보 모두 PICK — 지금 동작 그대로', () => {
    const message = assistantSample('candidates', { id: 'c1' });
    expect(candidateTarget(message, 'poi-bookcafe').kind).toBe('PICK');
    expect(candidateTarget(message, 'poi-garden').kind).toBe('PICK');
    expect(candidateConsumedActions(message)).toEqual([]);
    expect(message.nextActions.map((a) => a.type)).toEqual(['OPEN_ITINERARY']);
  });
});

describe('candidateConsumedActions (OPEN 카드가 대신하는 빨간 행)', () => {
  it('OPEN 카드의 같은 poiId OPEN_PLACE 만 — 중복도 둘 다. PICK 카드의 행 · 카드에 없는 poiId · 다른 type 은 아니다', () => {
    const open1 = nav('OPEN_PLACE', 'a', '가');
    const open2 = nav('OPEN_PLACE', 'a', '가(중복)');
    const message = candidates(['a', 'b'], {
      quickReplies: [pick('qr-b', 'b')],
      nextActions: [
        open1,
        nav('OPEN_PLACE', 'b'),
        open2,
        nav('OPEN_PLACE', 'z'),
        nav('OPEN_ITINERARY', 'a'),
      ],
    });
    const consumed = candidateConsumedActions(message);
    expect(consumed).toEqual([open1, open2]);
    expect(consumed[0]).toBe(open1);
    expect(consumed[1]).toBe(open2);
  });

  it('후보 카드 메시지(CANDIDATES)가 아니거나 후보 목록이 없으면 아무것도 소비하지 않는다', () => {
    const open = [nav('OPEN_PLACE', 'a')];
    expect(
      candidateConsumedActions(
        candidates(['a'], { kind: 'INFO', nextActions: open })
      )
    ).toEqual([]);
    expect(
      candidateConsumedActions(
        candidates(['a'], { kind: 'TEXT', nextActions: open })
      )
    ).toEqual([]);
    expect(
      candidateConsumedActions({
        ...candidates(['a'], { nextActions: open }),
        payload: null,
      })
    ).toEqual([]);
  });
});

// 성질 — 입력: 후보 0~4개(poiId 는 a~c 에서 뽑아 중복·불일치를 일부러 만든다) + 임의 quick reply + 임의 행동
const poiArb = fc.constantFrom('a', 'b', 'c');
const optionalPoi = fc.option(fc.constantFrom('a', 'b', 'c', 'd'), {
  nil: undefined,
});
const replyArb = fc.record({
  action: fc.constantFrom<QuickReplyAction>(
    'SEND_TEXT',
    'REVIEW',
    'PICK_CANDIDATE',
    'PICK_OPTION',
    'SHOW_CAPABILITIES',
    'RETRY'
  ),
  poiId: optionalPoi,
});
const actionArb = fc.record({
  type: fc.constantFrom(
    'OPEN_PLACE',
    'OPEN_ITINERARY',
    'FOO',
    'SHOW_CAPABILITIES'
  ),
  poiId: optionalPoi,
});
const messageArb = fc
  .record({
    kind: fc.constantFrom<MessageKind>(
      'CANDIDATES',
      'CANDIDATES',
      'INFO',
      'TEXT'
    ),
    cards: fc.array(poiArb, { maxLength: 4 }),
    replies: fc.option(fc.array(replyArb, { maxLength: 4 }), { nil: null }),
    actions: fc.array(actionArb, { maxLength: 5 }),
  })
  .map(({ kind, cards, replies, actions }) =>
    candidates(cards, {
      kind,
      quickReplies:
        replies === null
          ? null
          : replies.map((r, i) => pick(`qr-${i}`, r.poiId, r.action)),
      nextActions: actions.map((a, i) => nav(a.type, a.poiId, `act-${i}`)),
    })
  );

describe('후보 카드 판정 성질 (fast-check)', () => {
  it('완전·배타 — 카드마다 뜻이 정확히 하나이고 PICK > OPEN > NONE 이다', () => {
    fc.assert(
      fc.property(messageArb, poiArb, (message, poiId) => {
        const hasPick = (message.quickReplies ?? []).some(
          (r) => r.action === 'PICK_CANDIDATE' && r.params.poiId === poiId
        );
        const hasOpen = message.nextActions.some(
          (a) => a.type === 'OPEN_PLACE' && a.params.poiId === poiId
        );
        const target = candidateTarget(message, poiId);
        expect(target.kind).toBe(hasPick ? 'PICK' : hasOpen ? 'OPEN' : 'NONE');
        if (target.kind === 'NONE')
          expect(Object.keys(target)).toEqual(['kind']);
      })
    );
  });

  it('숨김 정합 — 소비 행동은 OPEN 카드의 같은 poiId OPEN_PLACE 정확히 그것들이고 순서·참조가 nextActions 그대로', () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        const cardIds = new Set(
          (
            message.payload as { candidates: { poiId: string }[] }
          ).candidates.map((c) => c.poiId)
        );
        const picked = new Set(
          (message.quickReplies ?? [])
            .filter((r) => r.action === 'PICK_CANDIDATE')
            .map((r) => r.params.poiId)
        );
        const expected =
          message.kind !== 'CANDIDATES'
            ? []
            : message.nextActions.filter(
                (a) =>
                  a.type === 'OPEN_PLACE' &&
                  cardIds.has(a.params.poiId) &&
                  !picked.has(a.params.poiId)
              );
        const consumed = candidateConsumedActions(message);
        expect(consumed).toEqual(expected);
        consumed.forEach((action, i) => expect(action).toBe(expected[i]));
      })
    );
  });

  it('버튼 줄에 중복이 없다 — OPEN 카드의 장소 행은 남지 않고, PICK 카드의 장소 행은 남는다', () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        if (message.kind !== 'CANDIDATES') return;
        const consumed = candidateConsumedActions(message);
        const remaining = message.nextActions.filter(
          (a) => !consumed.includes(a)
        );
        const cards = (message.payload as { candidates: { poiId: string }[] })
          .candidates;
        cards.forEach(({ poiId }) => {
          const kind = candidateTarget(message, poiId).kind;
          const stillThere = remaining.filter(
            (a) => a.type === 'OPEN_PLACE' && a.params.poiId === poiId
          );
          const all = message.nextActions.filter(
            (a) => a.type === 'OPEN_PLACE' && a.params.poiId === poiId
          );
          if (kind === 'OPEN') expect(stillThere).toEqual([]);
          else expect(stillThere).toEqual(all);
        });
      })
    );
  });

  it('순수·비변형 — 같은 입력은 같은 결과이고 입력 메시지는 그대로다', () => {
    fc.assert(
      fc.property(messageArb, poiArb, (message, poiId) => {
        const before = JSON.stringify(message);
        const first = candidateTarget(message, poiId);
        const second = candidateTarget(message, poiId);
        const consumedFirst = candidateConsumedActions(message);
        const consumedSecond = candidateConsumedActions(message);
        expect(second).toEqual(first);
        expect(consumedSecond).toEqual(consumedFirst);
        expect(JSON.stringify(message)).toBe(before);
      })
    );
  });
});
