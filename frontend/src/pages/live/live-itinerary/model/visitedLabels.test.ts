import type { VisitCheck, VisitCheckList } from '@/shared/api/index.schemas';

import { visitedLabelByPoiId } from './visitedLabels';

/**
 * TRIP-1220 — 허브 방문 완료 카드의 시각은 기록 j01 과 같은 값(서버 arrivedAt 을 KST 'HH:mm')이다.
 * 실제 시각이 없는 방문은 맵에서 빠져 카드가 "계획" 시각으로 표시한다.
 */
const DAY = '2026-08-20';
const vc = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'poiId'>
): VisitCheck => ({
  visitCheckId: `v-${over.poiId}`,
  slotKey: `${DAY}#${over.poiId}`,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T13:00:05Z',
  ...over,
});
const list = (...visits: VisitCheck[]): VisitCheckList => ({ visits });

describe('visitedLabelByPoiId (TRIP-1220)', () => {
  it('완료한 방문의 arrivedAt(UTC)을 KST HH:mm 으로 — 기록 j01 의 seoulTime 과 같은 값', () => {
    const result = visitedLabelByPoiId(
      list(
        vc({
          poiId: 'p1',
          arrivedAt: '2026-08-19T22:04:00Z',
          completedAt: '2026-08-19T23:00:00Z',
        })
      ),
      DAY
    );

    expect(result).toEqual({ p1: '07:04' });
  });

  it('실제 시각이 없으면 키가 없다 — 카드가 계획 시각으로 폴백한다', () => {
    const result = visitedLabelByPoiId(
      list(vc({ poiId: 'p1', completedAt: '2026-08-20T01:00:00Z' })),
      DAY
    );

    expect(result).toEqual({});
  });

  it('완료 전(도착만)·건너뜀·즉석·다른 날 레코드는 담지 않는다', () => {
    const result = visitedLabelByPoiId(
      list(
        vc({ poiId: 'p1', arrivedAt: '2026-08-20T01:00:00Z' }),
        vc({
          poiId: 'p2',
          arrivedAt: '2026-08-20T01:00:00Z',
          completedAt: '2026-08-20T02:00:00Z',
          skippedAt: '2026-08-20T02:00:00Z',
        }),
        vc({
          poiId: 'p3',
          slotKey: null,
          arrivedAt: '2026-08-20T01:00:00Z',
          completedAt: '2026-08-20T02:00:00Z',
        }),
        vc({
          poiId: 'p4',
          slotKey: '2026-08-21#p4',
          arrivedAt: '2026-08-20T01:00:00Z',
          completedAt: '2026-08-20T02:00:00Z',
        })
      ),
      DAY
    );

    expect(result).toEqual({});
  });
});
