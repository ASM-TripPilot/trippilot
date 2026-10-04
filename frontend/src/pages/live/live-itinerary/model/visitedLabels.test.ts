import type { VisitCheck, VisitCheckList } from '@/shared/api/index.schemas';

import { doneVisitCheckIdByPoiId, visitedLabelByPoiId } from './visitedLabels';

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

  it('낙관 레코드(optimistic:)의 자리표시자 시각은 실제 시각이 아니라 담지 않는다', () => {
    const result = visitedLabelByPoiId(
      list(
        vc({
          poiId: 'p1',
          visitCheckId: 'optimistic:p1',
          arrivedAt: '2026-08-20T00:00:00',
          completedAt: '2026-08-20T00:00:00',
        })
      ),
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

/**
 * TRIP-1203 — 허브 방문 완료 카드의 [사진]·[메모]가 POST/PUT 할 방문 id. 페이지가 이 맵에 든 poi 의 완료 카드에만
 * 버튼을 세운다(AC-1). 시각 라벨과 같은 필터에서 arrivedAt 조건만 빠진다 — 시각이 없는 완료 방문에도 기록은 남긴다.
 * 낙관 레코드(`optimistic:`) id 로 보내면 서버가 404 이므로 담지 않는다. 같은 poi 가 둘이면 id 사전순 첫째
 * (deriveVisitProgress 와 같은 규칙 — 서버 목록 순서는 계약이 아니다).
 * 3동작: 준비(방문 목록) → 실행(함수 호출) → 단언(poi → 방문 id 맵 전체를 toEqual).
 */
describe('doneVisitCheckIdByPoiId (TRIP-1203)', () => {
  it('DV1 그 날짜에 완료한 계획 방문의 id 를 poi 별로 — 도착 시각이 없는 완료도 담는다', () => {
    const result = doneVisitCheckIdByPoiId(
      list(
        vc({
          poiId: 'p1',
          arrivedAt: '2026-08-19T22:04:00Z',
          completedAt: '2026-08-19T23:00:00Z',
        }),
        vc({ poiId: 'p2', completedAt: '2026-08-20T01:00:00Z' })
      ),
      DAY
    );

    expect(result).toEqual({ p1: 'v-p1', p2: 'v-p2' });
  });

  it('DV2 낙관 레코드·건너뜀·도착만·즉석·다른 날·깨진 키는 담지 않는다', () => {
    const result = doneVisitCheckIdByPoiId(
      list(
        vc({
          poiId: 'p1',
          visitCheckId: 'optimistic:p1',
          arrivedAt: '2026-08-20T00:00:00',
          completedAt: '2026-08-20T00:00:00',
        }),
        vc({
          poiId: 'p2',
          arrivedAt: '2026-08-20T01:00:00Z',
          completedAt: '2026-08-20T02:00:00Z',
          skippedAt: '2026-08-20T02:00:00Z',
        }),
        vc({ poiId: 'p3', arrivedAt: '2026-08-20T01:00:00Z' }),
        vc({
          poiId: 'p4',
          slotKey: null,
          completedAt: '2026-08-20T02:00:00Z',
        }),
        vc({
          poiId: 'p5',
          slotKey: '2026-08-21#p5',
          completedAt: '2026-08-20T02:00:00Z',
        }),
        vc({
          poiId: 'p6',
          slotKey: 'broken-key',
          completedAt: '2026-08-20T02:00:00Z',
        })
      ),
      DAY
    );

    expect(result).toEqual({});
  });

  it('DV3 같은 poi 의 완료 방문이 둘이면 입력 순서와 무관하게 id 사전순 첫째', () => {
    const a = vc({
      poiId: 'p1',
      visitCheckId: 'v-a',
      completedAt: '2026-08-20T02:00:00Z',
    });
    const b = vc({
      poiId: 'p1',
      visitCheckId: 'v-b',
      completedAt: '2026-08-20T03:00:00Z',
    });

    expect(doneVisitCheckIdByPoiId(list(b, a), DAY)).toEqual({ p1: 'v-a' });
    expect(doneVisitCheckIdByPoiId(list(a, b), DAY)).toEqual({ p1: 'v-a' });
  });
});
