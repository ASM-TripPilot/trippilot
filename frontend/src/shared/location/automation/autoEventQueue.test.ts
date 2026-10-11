import fc from 'fast-check';

import {
  applyBatchResults,
  buildBatch,
  dropStale,
  enqueue,
  serializeIntervalReport,
  toQueueItem,
  type AutoQueueItem,
  type BatchOutcome,
} from './autoEventQueue';

/**
 * TRIP-1335 · PBT-U10-F4·F6 (BR-U10-20·22 · business-logic-model §6 · §12.1 초안).
 *
 * 3동작 뼈대: 준비=큐·이벤트 → 실행=적재/폐기/배치 조립/결과 반영 → 단언=남은 항목·본문 키.
 * 범위 판정(OUT_OF_WINDOW)은 서버 몫 — 기기는 여행지 날짜가 바뀌면 버리기만 한다(BR-U10-21·22).
 */

const COORD_KEYS =
  /^(lat|lng|lon|latitude|longitude|coords?|position|location)$/i;

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

const item = (over: Partial<AutoQueueItem> = {}): AutoQueueItem => ({
  eventId: 'e1',
  kind: 'ARRIVE',
  slotKey: '2026-08-20#p1',
  poiId: 'p1',
  occurredAt: '2026-08-20T01:00:00.000Z',
  localDate: '2026-08-20',
  ...over,
});

const arbDate = fc.constantFrom('2026-08-19', '2026-08-20', '2026-08-21');
const arbItem: fc.Arbitrary<AutoQueueItem> = fc.record({
  eventId: fc.constantFrom('e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'),
  kind: fc.constantFrom('ARRIVE' as const, 'COMPLETE' as const),
  slotKey: fc.string({ minLength: 1, maxLength: 12 }),
  poiId: fc.uuid(),
  occurredAt: fc.constant('2026-08-20T01:00:00.000Z'),
  localDate: arbDate,
});

describe('autoEventQueue — 예시', () => {
  it('Q1 judge emit → 큐 항목: 시각 ISO · 여행지(KST) 날짜 · COMPLETE 만 completionSource', () => {
    const at = Date.UTC(2026, 7, 19, 16, 30); // KST 08-20 01:30
    expect(
      toQueueItem(
        { kind: 'ARRIVE', slotKey: 's', occurredAt: at },
        { poiId: 'p', eventId: 'x' }
      )
    ).toEqual({
      eventId: 'x',
      kind: 'ARRIVE',
      slotKey: 's',
      poiId: 'p',
      occurredAt: '2026-08-19T16:30:00.000Z',
      localDate: '2026-08-20',
    });
    expect(
      toQueueItem(
        {
          kind: 'COMPLETE',
          slotKey: 's',
          occurredAt: at,
          completionSource: 'AUTO_NEXT_ARRIVAL',
        },
        { poiId: 'p', eventId: 'y' }
      ).completionSource
    ).toBe('AUTO_NEXT_ARRIVAL');
  });

  it('Q2 배치는 순서대로 최대 50개, §12.1 키만 싣는다', () => {
    const q = Array.from({ length: 60 }, (_, i) => item({ eventId: `e${i}` }));
    const batch = buildBatch(q);
    expect(batch.events).toHaveLength(50);
    expect(batch.events[0]).toEqual({
      eventId: 'e0',
      kind: 'ARRIVE',
      slotKey: '2026-08-20#p1',
      poiId: 'p1',
      occurredAt: '2026-08-20T01:00:00.000Z',
    });
  });

  it('Q3 결과 반영: 항목별 결과가 온 것은 제거, 결과 없는 것은 남긴다(재시도)', () => {
    const q = [
      item({ eventId: 'a' }),
      item({ eventId: 'b' }),
      item({ eventId: 'c' }),
    ];
    const out = applyBatchResults(q, [
      { eventId: 'a', outcome: 'APPLIED' },
      { eventId: 'b', outcome: 'ALREADY_RECORDED' },
    ]);
    expect(out.queue.map((i) => i.eventId)).toEqual(['c']);
    expect(out.consentRejected).toBe(false);
  });

  it('Q4 REJECTED_CONSENT 하나라도 오면 큐 전체 삭제 + 강등 신호(BR-U10-45)', () => {
    const q = [item({ eventId: 'a' }), item({ eventId: 'b' })];
    const out = applyBatchResults(q, [
      { eventId: 'a', outcome: 'REJECTED_CONSENT' },
    ]);
    expect(out.queue).toEqual([]);
    expect(out.consentRejected).toBe(true);
  });

  it('Q5 구간 보고 직렬화에 좌표가 없다', () => {
    const body = serializeIntervalReport({
      intervalId: 'i',
      kind: 'GEOFENCE_ARMED',
      phase: 'END',
      at: '2026-08-20T01:00:00.000Z',
      endReason: 'PERMISSION_DOWNGRADE',
      regionCount: 3,
    });
    expect(collectKeys(body).filter((k) => COORD_KEYS.test(k))).toEqual([]);
    expect(body).toEqual({
      intervalId: 'i',
      kind: 'GEOFENCE_ARMED',
      phase: 'END',
      at: '2026-08-20T01:00:00.000Z',
      endReason: 'PERMISSION_DOWNGRADE',
      regionCount: 3,
    });
  });
});

describe('autoEventQueue (PBT-U10-F4)', () => {
  it('F4 날짜 전환 후 남은 항목은 전부 당일 · 버린 수 + 남은 수 = 원래 수', () => {
    fc.assert(
      fc.property(
        fc.array(arbItem, { maxLength: 30 }),
        arbDate,
        (items, today) => {
          const queue = items.reduce<AutoQueueItem[]>(
            (q, i) => enqueue(q, i),
            []
          );
          const { queue: kept, dropped } = dropStale(queue, today);
          expect(kept.every((i) => i.localDate === today)).toBe(true);
          expect(kept.length + dropped).toBe(queue.length);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('F4 같은 eventId 는 두 번 적재되지 않는다(먼저 들어온 것 유지)', () => {
    fc.assert(
      fc.property(fc.array(arbItem, { maxLength: 30 }), (items) => {
        const queue = items.reduce<AutoQueueItem[]>(
          (q, i) => enqueue(q, i),
          []
        );
        const ids = queue.map((i) => i.eventId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const q of queue) {
          expect(q).toEqual(items.find((i) => i.eventId === q.eventId));
        }
      }),
      { numRuns: 500 }
    );
  });

  it('F4 결과 반영 후 남은 항목 ⊆ 결과를 못 받은 항목', () => {
    const outcome = fc.constantFrom<BatchOutcome>(
      'APPLIED',
      'ALREADY_RECORDED',
      'CONFLICT',
      'SUPPRESSED',
      'OUT_OF_WINDOW'
    );
    fc.assert(
      fc.property(
        fc.array(arbItem, { maxLength: 20 }),
        fc.array(
          fc.record({
            eventId: fc.constantFrom('e1', 'e2', 'e3', 'e9'),
            outcome,
          })
        ),
        (items, results) => {
          const queue = items.reduce<AutoQueueItem[]>(
            (q, i) => enqueue(q, i),
            []
          );
          const out = applyBatchResults(queue, results);
          const answered = new Set<string>(results.map((r) => r.eventId));
          expect(out.queue.every((i) => !answered.has(i.eventId))).toBe(true);
          expect(
            out.queue.length +
              queue.filter((i) => answered.has(i.eventId)).length
          ).toBe(queue.length);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('autoEventQueue 직렬화 (PBT-U10-F6 — 좌표 0)', () => {
  it('F6 임의 항목(좌표 같은 잉여 필드가 섞여도)의 배치 본문에 좌표 키가 없다', () => {
    fc.assert(
      fc.property(
        fc.array(
          arbItem.map((i) => ({
            ...i,
            lat: 35.1,
            lng: 129.1,
            coords: { latitude: 1 },
          })),
          { maxLength: 10 }
        ),
        (items) => {
          const body = buildBatch(items as AutoQueueItem[]);
          expect(collectKeys(body).filter((k) => COORD_KEYS.test(k))).toEqual(
            []
          );
          // localDate 는 기기 내부용 — 서버로 나가지 않는다
          expect(collectKeys(body)).not.toContain('localDate');
        }
      ),
      { numRuns: 300 }
    );
  });
});
