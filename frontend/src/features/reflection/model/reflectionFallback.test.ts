import fc from 'fast-check';

import type {
  Reflection,
  ReflectionCard,
} from '@/shared/api/generated/schemas';

import { resolveDisplayNarrative } from './reflectionFallback';

/**
 * TRIP-571 → TRIP-945 · 표시본 결정 단일 지점 — 계약이 문장(narrative)에서 카드(card)로 바뀌었다.
 *
 * 무엇을 보장하나:
 *  - **PBT-U5-F1(속성)**: 어떤 회고 응답이 와도 표시본 문자열이 비어 있지 않다(trim 후에도).
 *  - **BR-U5-32/35(케이스)**: 폴백 3단 우선순위 — ① 서버가 고른 `card.subtitle` → ② 비었거나 결측이면
 *    `editedCard?.subtitle` → `draftCard?.subtitle` → ③ 그마저 없으면 stats 로 조립한 BASIC 문장.
 *
 * 3동작: 준비=임의/특정 응답 → 실행=resolveDisplayNarrative(res) → 단언=표시본 문자열.
 */

const NORMAL = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

const maybeText = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant(undefined),
  fc.constant(NORMAL),
  fc.string()
);

/** 카드 한 장 — subtitle 을 포함한 필드가 빠지거나 비는 조합까지 만든다. */
const cardArb = fc.record(
  {
    templateId: fc.constant('backend.rule.daily.v1'),
    format: fc.constant('CARD'),
    title: maybeText,
    subtitle: maybeText,
    payload: fc.constant('{}'),
  },
  { requiredKeys: [] }
);

const maybeCard = fc.oneof(fc.constant(undefined), fc.constant(null), cardArb);

const statsArb = fc.oneof(
  fc.constant(undefined),
  fc.record({
    visitCount: fc.nat({ max: 20 }),
    distanceKm: fc.double({ min: 0, max: 100, noNaN: true }),
    distanceSource: fc.constantFrom('ROUTE', 'VISIT_LINE'),
    photoCount: fc.nat({ max: 20 }),
  })
);

const reflectionArb = fc.oneof(
  fc.constant(undefined),
  fc.record(
    {
      dayDate: fc.constant('2026-06-11'),
      card: maybeCard,
      draftCard: maybeCard,
      editedCard: maybeCard,
      source: fc.constantFrom('AI', 'RULE', 'BASIC'),
      stats: statsArb,
      generatedAt: fc.constant('2026-06-11T09:00:00Z'),
      updatedAt: fc.constant('2026-06-11T10:00:00Z'),
    },
    { requiredKeys: [] }
  )
);

function card(subtitle: string): ReflectionCard {
  return {
    templateId: 'backend.rule.daily.v1',
    format: 'CARD',
    title: '광안리해수욕장 외 3곳',
    subtitle,
    payload: '{}',
  };
}

function reflection(over: Partial<Reflection>): Reflection {
  return {
    dayDate: '2026-06-11',
    card: card('서버가 고른 카드 문장입니다.'),
    draftCard: card('생성된 초안입니다.'),
    editedCard: null,
    source: 'RULE',
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    generatedAt: '2026-06-11T09:00:00Z',
    updatedAt: '2026-06-11T10:00:00Z',
    ...over,
  };
}

describe('PBT-U5-F1 · resolveDisplayNarrative — 표시본은 항상 비어 있지 않다', () => {
  it('임의의 회고 응답(카드 결측·null·빈 subtitle 조합)에도 trim 후 길이가 0보다 크다', () => {
    fc.assert(
      fc.property(reflectionArb, (res) => {
        const display = resolveDisplayNarrative(
          res as unknown as Reflection | undefined
        );
        expect(typeof display).toBe('string');
        expect(display.trim().length).toBeGreaterThan(0);
      })
    );
  });
});

describe('AC-2 · 폴백 3단 우선순위 (BR-U5-32/35)', () => {
  it('① 서버 card.subtitle 이 비어 있지 않으면 그대로 쓴다(edited/draft 를 다시 고르지 않는다)', () => {
    const display = resolveDisplayNarrative(
      reflection({
        card: card('서버 카드'),
        editedCard: card('고친 문장'),
        draftCard: card('초안 문장'),
      })
    );
    expect(display).toBe('서버 카드');
  });

  it('② card.subtitle 이 빈 문자열이면 editedCard.subtitle 을 쓴다', () => {
    const display = resolveDisplayNarrative(
      reflection({
        card: card(''),
        editedCard: card('내가 고친 회고'),
        draftCard: card('초안'),
      })
    );
    expect(display).toBe('내가 고친 회고');
  });

  it('③ card.subtitle 이 공백뿐이고 editedCard 가 null 이면 draftCard.subtitle 을 쓴다', () => {
    const display = resolveDisplayNarrative(
      reflection({
        card: card('   '),
        editedCard: null,
        draftCard: card('생성된 초안'),
      })
    );
    expect(display).toBe('생성된 초안');
  });

  it('③ card 자체가 빠진 응답(계약 위반)이어도 draftCard.subtitle 을 쓴다', () => {
    const res = reflection({ draftCard: card('생성된 초안') });
    delete (res as Partial<Reflection>).card;

    expect(resolveDisplayNarrative(res)).toBe('생성된 초안');
  });

  it('④ 세 카드의 subtitle 이 전부 비면 stats 로 조립한 BASIC 문장(비지 않음)', () => {
    const display = resolveDisplayNarrative(
      reflection({
        card: card(''),
        editedCard: card(''),
        draftCard: card(''),
      })
    );
    expect(display.trim().length).toBeGreaterThan(0);
  });

  it('⑤ 응답 자체가 undefined 여도 BASIC 문장으로 비지 않는다', () => {
    expect(resolveDisplayNarrative(undefined).trim().length).toBeGreaterThan(0);
  });
});
