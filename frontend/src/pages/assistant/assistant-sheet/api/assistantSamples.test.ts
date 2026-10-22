import fc from 'fast-check';

import { NEXT_ACTION_TYPES } from './assistantContract';
import {
  assistantSample,
  sampleActionLogs,
  sampleLongConversation,
  sampleTranscript,
  type AssistantScenario,
} from './assistantSamples';

/**
 * TRIP-1319 — 가짜 서버가 내는 모든 샘플이 계약을 지키는가.
 * PBT-U8-8(FE 몫): 어떤 샘플에도 소요시간 필드·문구가 없다(INV-3).
 * INV-U8-03 · BR-U8-06: 도우미 메시지는 next action ≥1, 전부 closed-set.
 */

const SCENARIOS: AssistantScenario[] = [
  'greeting',
  'review',
  'candidates',
  'proposal',
  'proposal-violation',
  'scope',
  'refusal',
  'fallback-error',
  'fallback-solver',
  'stay',
  'next-slot',
  'weather',
  'no-context',
  'capabilities',
  'unknown',
];

const DURATION = /duration|소요|\d+\s*분/i;

const scenarioArb = fc.constantFrom(...SCENARIOS);
const tripArb = fc.option(fc.uuid(), { nil: null });

describe('도우미 샘플 계약 (TRIP-1319)', () => {
  it('PBT-U8-8 · 어떤 시나리오·여행 조합에도 소요시간 필드·문구가 없다', () => {
    fc.assert(
      fc.property(scenarioArb, tripArb, (scenario, tripId) => {
        const transcript = sampleTranscript(scenario, tripId);
        expect(JSON.stringify(transcript)).not.toMatch(DURATION);
      }),
      {
        examples: SCENARIOS.map(
          (scenario): [AssistantScenario, string | null] => [scenario, null]
        ),
      }
    );
    expect(JSON.stringify(sampleActionLogs())).not.toMatch(DURATION);
  });

  it('INV-U8-03 · 도우미 메시지는 next action 1개 이상이고 전부 closed-set 이다', () => {
    fc.assert(
      fc.property(scenarioArb, fc.string({ minLength: 1 }), (scenario, id) => {
        const message = assistantSample(scenario, { id });
        expect(message.role).toBe('ASSISTANT');
        expect(message.nextActions.length).toBeGreaterThanOrEqual(1);
        message.nextActions.forEach((action) =>
          expect(NEXT_ACTION_TYPES).toContain(action.type)
        );
      })
    );
  });

  it('BR-U8-31 · 위반 있는 제안 샘플은 violations 가 비어 있지 않다', () => {
    expect(
      assistantSample('proposal-violation', { id: 'x' }).proposal?.violations
        .length
    ).toBeGreaterThan(0);
    expect(
      assistantSample('proposal', { id: 'x' }).proposal?.violations
    ).toEqual([]);
  });
});

describe('긴 대화 샘플 (이전 대화 더 보기)', () => {
  it('오래된 것 먼저 long-1…long-N, 홀수는 사용자 짝수는 도우미, 시각은 엄격 증가', () => {
    // Arrange · Act
    const messages = sampleLongConversation(75);

    // Assert
    expect(messages.map((m) => m.id)).toEqual(
      Array.from({ length: 75 }, (_, i) => `long-${i + 1}`)
    );
    messages.forEach((message, index) =>
      expect(message.role).toBe(index % 2 === 0 ? 'USER' : 'ASSISTANT')
    );
    const times = messages.map((m) => Date.parse(m.createdAt));
    times.slice(1).forEach((time, i) => expect(time).toBeGreaterThan(times[i]));
  });

  it('개수 인자를 따른다', () => {
    expect(sampleLongConversation(31)).toHaveLength(31);
  });
});
