import fc from 'fast-check';

import type { QuickReply, QuickReplyAction } from '../api/assistantContract';
import { splitQuickReplies } from './sheetModel';

/**
 * TRIP-1567 — quick reply 를 "칩 안 추천 질문 / 카드 위에 남는 응답 보기 / 어디에도 안 그림" 으로 가르는 순수 분류.
 * 서버 와이어에는 이 구분이 없다(action 6종뿐) — 클라가 만드는 분류다. 정의는 02a §2-1.
 */

const reply = (
  id: string,
  action: QuickReplyAction,
  label = id
): QuickReply => ({ id, label, action, params: {} });

const ACTIONS: readonly QuickReplyAction[] = [
  'SEND_TEXT',
  'REVIEW',
  'PICK_CANDIDATE',
  'PICK_OPTION',
  'SHOW_CAPABILITIES',
  'RETRY',
];
const SUGGESTION_ACTIONS: readonly QuickReplyAction[] = [
  'SEND_TEXT',
  'REVIEW',
  'SHOW_CAPABILITIES',
];
const CHOICE_ACTIONS: readonly QuickReplyAction[] = ['PICK_OPTION', 'RETRY'];

const ids = (replies: readonly QuickReply[]) => replies.map((r) => r.id);

// 고유 id 로 뽑는다 — 같은 id 가 두 번 나오면 "누가 어디 갔나"를 id 집합으로 비교할 수 없다.
const repliesArb = fc.uniqueArray(
  fc.record({
    id: fc.uuid(),
    label: fc.string({ minLength: 1 }),
    action: fc.constantFrom(...ACTIONS),
    params: fc.constant({} as Record<string, string>),
  }),
  { selector: (r) => r.id, maxLength: 14 }
);

describe('splitQuickReplies (TRIP-1567)', () => {
  it('서버 시작 목록(검토·다음 장소·날씨)은 전부 추천 질문이고 응답 보기는 비어 있다', () => {
    const start = [
      reply('qr-review', 'REVIEW'),
      reply('qr-next', 'SEND_TEXT'),
      reply('qr-weather', 'SEND_TEXT'),
    ];

    const split = splitQuickReplies(start);

    expect(ids(split.suggestions)).toEqual([
      'qr-review',
      'qr-next',
      'qr-weather',
    ]);
    expect(split.choices).toEqual([]);
  });

  it('섞인 목록 · 능력 보기는 추천 질문의 맨 앞, 되묻기 보기·재시도는 줄에 남고, 후보 고르기는 어디에도 없다', () => {
    const mixed = [
      reply('qr-send', 'SEND_TEXT'),
      reply('qr-pick-a', 'PICK_CANDIDATE'),
      reply('qr-opt-a', 'PICK_OPTION'),
      reply('qr-review', 'REVIEW'),
      reply('qr-retry', 'RETRY'),
      reply('qr-cap', 'SHOW_CAPABILITIES'),
      reply('qr-opt-b', 'PICK_OPTION'),
    ];

    const split = splitQuickReplies(mixed);

    expect(ids(split.suggestions)).toEqual(['qr-cap', 'qr-send', 'qr-review']);
    expect(ids(split.choices)).toEqual(['qr-opt-a', 'qr-retry', 'qr-opt-b']);
    expect([...ids(split.suggestions), ...ids(split.choices)]).not.toContain(
      'qr-pick-a'
    );
  });

  it('모르는 action(서버가 새 종류를 보내도)은 어디에도 그리지 않는다', () => {
    const unknown = {
      id: 'qr-new',
      label: '새 종류',
      action: 'NEW_KIND',
      params: {},
    } as unknown as QuickReply;

    const split = splitQuickReplies([unknown, reply('qr-send', 'SEND_TEXT')]);

    expect(ids(split.suggestions)).toEqual(['qr-send']);
    expect(split.choices).toEqual([]);
  });

  it('빈 목록이면 둘 다 비어 있다', () => {
    expect(splitQuickReplies([])).toEqual({ suggestions: [], choices: [] });
  });

  describe('성질 (PBT)', () => {
    it('추천 질문에는 질문형만, 응답 보기에는 PICK_OPTION·RETRY 만 있다', () => {
      fc.assert(
        fc.property(repliesArb, (replies) => {
          const { suggestions, choices } = splitQuickReplies(replies);
          suggestions.forEach((r) =>
            expect(SUGGESTION_ACTIONS).toContain(r.action)
          );
          choices.forEach((r) => expect(CHOICE_ACTIONS).toContain(r.action));
        })
      );
    });

    it('아무것도 잃거나 겹치지 않는다 — 질문형·응답 보기 5종은 정확히 한 곳에, 후보 고르기는 어디에도 없다', () => {
      fc.assert(
        fc.property(repliesArb, (replies) => {
          const { suggestions, choices } = splitQuickReplies(replies);
          const kept = replies
            .filter(
              (r) =>
                SUGGESTION_ACTIONS.includes(r.action) ||
                CHOICE_ACTIONS.includes(r.action)
            )
            .map((r) => r.id);
          const out = [...ids(suggestions), ...ids(choices)];

          expect([...out].sort()).toEqual([...kept].sort());
          expect(new Set(out).size).toBe(out.length);
          const candidates = replies
            .filter((r) => r.action === 'PICK_CANDIDATE')
            .map((r) => r.id);
          candidates.forEach((id) => expect(out).not.toContain(id));
        })
      );
    });

    it('순서 · 능력 보기가 그 외보다 앞이고, 두 그룹 안의 상대 순서와 응답 보기 순서는 입력 그대로다', () => {
      fc.assert(
        fc.property(repliesArb, (replies) => {
          const { suggestions, choices } = splitQuickReplies(replies);

          const firstOther = suggestions.findIndex(
            (r) => r.action !== 'SHOW_CAPABILITIES'
          );
          if (firstOther >= 0) {
            suggestions
              .slice(firstOther)
              .forEach((r) => expect(r.action).not.toBe('SHOW_CAPABILITIES'));
          }
          const inputOrder = (pick: (r: QuickReply) => boolean) =>
            replies.filter(pick).map((r) => r.id);
          expect(
            ids(suggestions.filter((r) => r.action === 'SHOW_CAPABILITIES'))
          ).toEqual(inputOrder((r) => r.action === 'SHOW_CAPABILITIES'));
          expect(
            ids(suggestions.filter((r) => r.action !== 'SHOW_CAPABILITIES'))
          ).toEqual(
            inputOrder(
              (r) =>
                SUGGESTION_ACTIONS.includes(r.action) &&
                r.action !== 'SHOW_CAPABILITIES'
            )
          );
          expect(ids(choices)).toEqual(
            inputOrder((r) => CHOICE_ACTIONS.includes(r.action))
          );
        })
      );
    });

    it('순수하다 — 입력을 바꾸지 않고 입력 배열을 그대로 돌려주지도 않는다', () => {
      fc.assert(
        fc.property(repliesArb, (replies) => {
          const before = JSON.stringify(replies);

          const { suggestions, choices } = splitQuickReplies(replies);

          expect(JSON.stringify(replies)).toBe(before);
          expect(suggestions).not.toBe(replies);
          expect(choices).not.toBe(replies);
        })
      );
    });
  });
});
