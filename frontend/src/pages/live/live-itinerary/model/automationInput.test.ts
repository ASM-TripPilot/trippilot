import type { VisitCheck } from '@/shared/api/index.schemas';

import { automationVisitRefs } from './automationInput';

/** TRIP-1339 · 실적 → 판정 문맥 매핑(서버 우선). */
const v = (over: Partial<VisitCheck>): VisitCheck => ({
  visitCheckId: 'v',
  slotKey: 'd#p',
  poiId: 'p',
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T01:00:00Z',
  ...over,
});

describe('automationVisitRefs', () => {
  it('AI1 건너뜀 > 완료 > 도착 > 빈 행(되돌림) 순으로 접고, 즉석 방문은 뺀다', () => {
    expect(
      automationVisitRefs([
        v({ slotKey: 'a', skippedAt: '2026-08-20T01:00:00Z' }),
        v({
          slotKey: 'b',
          arrivedAt: '2026-08-20T01:00:00Z',
          completedAt: '2026-08-20T02:00:00Z',
        }),
        v({ slotKey: 'c', arrivedAt: '2026-08-20T01:00:00Z' }),
        v({ slotKey: 'd' }),
        v({
          slotKey: null,
          arrivedAt: '2026-08-20T01:00:00Z',
          spontaneous: true,
        }),
      ]).map((r) => [r.slotKey, r.status])
    ).toEqual([
      ['a', 'skipped'],
      ['b', 'completed'],
      ['c', 'arrived'],
      ['d', 'suppressed'],
    ]);
  });
});
