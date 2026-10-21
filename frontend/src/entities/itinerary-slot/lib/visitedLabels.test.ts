/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
import type { VisitCheck, VisitCheckList } from '@/shared/api/index.schemas';

import { arrivedLabel, visitedLabelByPoiId } from './visitedLabels';

/**
 * TRIP-1419 — 방문 기록의 **실제 도착 시각**(서버 arrivedAt)을 KST 'HH:mm' 으로 읽는 함수 둘.
 * 허브 관람 중·완료 카드와 재계획 진행 화면 완료 행이 같은 값을 쓰려고 page 에서 이 층으로 내렸다.
 *
 * 무엇을 보장하나:
 *  - `arrivedLabel(visit)` — 레코드 한 건의 실측 시각. 완료 여부와 무관하게 arrivedAt 만 본다(관람 중에도 쓴다).
 *    arrivedAt 이 없거나 · 낙관 레코드(`optimistic:` — 시각이 자리표시자)거나 · 파싱이 안 되면 `null`.
 *  - `visitedLabelByPoiId(list, date)` — TRIP-1220 완료 카드용 poi → 시각 맵(page 에서 이관, 동작 그대로).
 *  - 둘 다 기기 시간대와 무관하다(seoulTime — +9h 뒤 UTC 로 읽는다).
 *
 * 기기 시간대는 `__setDeviceTimeZone` 으로 바꾼다(`process.env.TZ =` 는 jest 가 env 사본을 줘서 안 먹는다).
 * 3동작: 준비(방문 레코드) → 실행(함수 호출) → 단언(시각 문자열 · null · 맵).
 */

declare const __setDeviceTimeZone: (tz: string | undefined) => void;

const DAY = '2026-08-20';
/** KST 14:07 — 실제 도착. Z 를 붙여 기기 시간대와 무관한 한 순간으로 못박는다. */
const ARRIVED_1407 = '2026-08-20T05:07:00Z';

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

afterEach(() => {
  __setDeviceTimeZone(undefined);
});

describe('arrivedLabel (TRIP-1419)', () => {
  it('A1 도착했고 아직 완료 전인 방문도 서버 arrivedAt 을 KST HH:mm 으로 낸다', () => {
    const visit = vc({ poiId: 'p1', arrivedAt: ARRIVED_1407 });

    expect(arrivedLabel(visit)).toBe('14:07');
  });

  it('A2 완료한 방문도 같은 값이다 — 완료 여부는 시각을 바꾸지 않는다', () => {
    const visit = vc({
      poiId: 'p1',
      arrivedAt: ARRIVED_1407,
      completedAt: '2026-08-20T05:50:00Z',
    });

    expect(arrivedLabel(visit)).toBe('14:07');
  });

  it('A3 arrivedAt 이 없으면 null — 계획 시각을 대신 내지 않는다', () => {
    const visit = vc({ poiId: 'p1' });

    expect(arrivedLabel(visit)).toBeNull();
  });

  it('A4 낙관 레코드(optimistic:)의 자리표시자 시각은 실제 시각이 아니라 null', () => {
    const visit = vc({
      poiId: 'p1',
      visitCheckId: 'optimistic:p1',
      arrivedAt: '2026-08-20T00:00:00',
    });

    expect(arrivedLabel(visit)).toBeNull();
  });

  it('A5 파싱할 수 없는 arrivedAt 이면 null', () => {
    const visit = vc({ poiId: 'p1', arrivedAt: 'not-a-date' });

    expect(arrivedLabel(visit)).toBeNull();
  });
});

/**
 * TRIP-1220 — 허브 방문 완료 카드의 시각은 기록 j01 과 같은 값(서버 arrivedAt 을 KST 'HH:mm')이다.
 * 실제 시각이 없는 방문은 맵에서 빠져 카드가 "계획" 시각으로 표시한다.
 */
// TRIP-1419 — page(live-itinerary/model/visitedLabels.test.ts)에서 함수와 함께 옮겨 왔다.
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

describe('TRIP-1495 · 같은 장소에 완료 기록이 둘이면 목록 순서와 무관하게 대표 방문(id 사전순 첫째)의 시각이다', () => {
  const v1a = vc({
    poiId: 'p1',
    visitCheckId: 'v1a',
    arrivedAt: '2026-08-20T05:07:00Z', // KST 14:07
    completedAt: '2026-08-20T06:00:00Z',
  });
  const v1b = vc({
    poiId: 'p1',
    visitCheckId: 'v1b',
    arrivedAt: '2026-08-20T05:20:00Z', // KST 14:20
    completedAt: '2026-08-20T06:10:00Z',
  });

  it('X1 [v1b, v1a] 로 와도 [v1a, v1b] 로 와도 14:07(v1a)이다 — [메모]·[사진] 대상(id 사전순 첫째)과 같은 방문', () => {
    expect(visitedLabelByPoiId(list(v1b, v1a), DAY)).toEqual({ p1: '14:07' });
    expect(visitedLabelByPoiId(list(v1a, v1b), DAY)).toEqual({ p1: '14:07' });
  });

  it('X2 대표 방문에 실제 시각이 없으면 다른 방문의 시각으로 대신하지 않는다(키 없음 — 계획 시각 폴백)', () => {
    const noTime = vc({
      poiId: 'p1',
      visitCheckId: 'v1a',
      arrivedAt: null,
      completedAt: '2026-08-20T06:00:00Z',
    });
    expect(visitedLabelByPoiId(list(v1b, noTime), DAY)).toEqual({});
  });

  it('X3 낙관 레코드는 대표가 되지 않는다 — 서버 방문이 시각의 주인이다', () => {
    const optimistic = vc({
      poiId: 'p1',
      visitCheckId: 'optimistic:0',
      arrivedAt: '2026-08-20T00:00:00Z',
      completedAt: '2026-08-20T00:00:00Z',
    });
    expect(visitedLabelByPoiId(list(optimistic, v1b), DAY)).toEqual({
      p1: '14:20',
    });
  });
});

describe.each([
  ['UTC', 5],
  ['America/Los_Angeles', 22],
])(
  'TRIP-1419 AC-5 · 기기 시간대 %s 에서도 서울 벽시계 시각이다',
  (deviceTimeZone, localHour) => {
    beforeEach(() => {
      __setDeviceTimeZone(deviceTimeZone);
    });

    // 앵커 — 전환이 실제로 걸렸는지. 없으면 KST 개발기에서 아래 단언이 공허하게 통과한다.
    it(`기기 시각이 ${deviceTimeZone} 기준으로 읽힌다 (05:07Z → ${localHour}시)`, () => {
      expect(new Date(ARRIVED_1407).getHours()).toBe(localHour);
    });

    it('arrivedLabel 과 visitedLabelByPoiId 가 둘 다 14:07 이다', () => {
      const done = vc({
        poiId: 'p1',
        arrivedAt: ARRIVED_1407,
        completedAt: '2026-08-20T05:50:00Z',
      });

      expect(arrivedLabel(done)).toBe('14:07');
      expect(visitedLabelByPoiId(list(done), DAY)).toEqual({ p1: '14:07' });
    });
  }
);
