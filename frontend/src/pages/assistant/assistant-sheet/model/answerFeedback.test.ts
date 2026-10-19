import fc from 'fast-check';

import type { FeedbackRating } from '../api/assistantContract';
import {
  canSubmitComment,
  normalizeComment,
  toggleRating,
} from './answerFeedback';

/**
 * US-ASSIST-09 답 평가 — 엄지 토글 판정과 의견 정규화(서버 규칙의 UX 사본). 서버는 남기기·바꾸기(PUT)와
 * 취소(DELETE)만 안다 — "같은 엄지를 다시 누르면 취소"는 앱이 고른다(BR-U8-60).
 */

const ratingArb = fc.constantFrom<FeedbackRating>('UP', 'DOWN');
const currentArb = fc.option(ratingArb, { nil: null });

describe('toggleRating (엄지 토글)', () => {
  it('평가가 없으면 누른 쪽을 남기고, 같은 쪽이면 취소, 반대쪽이면 바꾼다', () => {
    expect(toggleRating(null, 'UP')).toBe('UP');
    expect(toggleRating(null, 'DOWN')).toBe('DOWN');
    expect(toggleRating('UP', 'UP')).toBeNull();
    expect(toggleRating('DOWN', 'DOWN')).toBeNull();
    expect(toggleRating('UP', 'DOWN')).toBe('DOWN');
    expect(toggleRating('DOWN', 'UP')).toBe('UP');
  });

  it('PBT · 누르면 늘 바뀐다 — 결과는 누른 쪽 아니면 취소(null)이고 지금 값과 같은 적이 없다', () => {
    fc.assert(
      fc.property(currentArb, ratingArb, (current, pressed) => {
        const next = toggleRating(current, pressed);
        expect(next).not.toBe(current);
        expect([pressed, null]).toContain(next);
      }),
      {
        examples: [
          [null, 'UP'],
          ['UP', 'UP'],
          ['DOWN', 'UP'],
          ['DOWN', 'DOWN'],
        ],
      }
    );
  });
});

describe('normalizeComment (서버 정규화의 UX 사본)', () => {
  it('앞뒤 공백을 떼고, 남는 게 없으면 null', () => {
    expect(normalizeComment('  동선이 너무 길어요 ')).toBe(
      '동선이 너무 길어요'
    );
    expect(normalizeComment('\n\t멀어요\n')).toBe('멀어요');
    expect(normalizeComment('   ')).toBeNull();
    expect(normalizeComment('')).toBeNull();
  });

  it('PBT · 결과는 null 이거나 앞뒤 공백 없는 비지 않은 원문 조각이고, 두 번 해도 같다', () => {
    const textArb = fc.string({
      unit: fc.constantFrom(' ', '\t', '\n', 'a', '가', '.'),
    });
    fc.assert(
      fc.property(textArb, (text) => {
        const out = normalizeComment(text);
        if (out === null) {
          expect(text.trim()).toBe('');
          return;
        }
        expect(out.length).toBeGreaterThan(0);
        expect(out).toBe(out.trim());
        expect(text).toContain(out);
        expect(normalizeComment(out)).toBe(out);
      }),
      { examples: [['  가  '], ['   '], [''], ['a']] }
    );
  });
});

describe('canSubmitComment (직접 적기 [보내기])', () => {
  it('의견도 이유도 없으면 못 보내고, 하나라도 있으면 보낸다', () => {
    expect(canSubmitComment({ reason: null, comment: '   ' })).toBe(false);
    expect(canSubmitComment({ reason: null, comment: '' })).toBe(false);
    expect(canSubmitComment({ reason: 'WRONG', comment: '' })).toBe(true);
    expect(canSubmitComment({ reason: null, comment: '멀어요' })).toBe(true);
  });
});
