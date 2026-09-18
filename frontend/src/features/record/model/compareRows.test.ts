import type {
  ChangeLogEntry,
  TripRecord,
  TripRecordDay,
} from '@/shared/api/generated/schemas';

import { buildCompareRows, type CompareRow } from './compareRows';

/**
 * TRIP-570 · j02 기록 비교 — buildCompareRows: TripRecord 를 화면 행(CompareRow[])으로 조립하는
 * 순수 함수. 계획·실제·변경을 한 리스트로 접되, 미방문 판정은 **서버 unvisitedSlotKeys 직독**이고
 * 변경 행은 changes[] before/after·reason·at 구조를 poiId 기반으로도 잠근다.
 *
 * 무엇을 보장하나:
 *  - AC-4: actual[] 방문 → kind:'actual' 행 + arrivedAt 시각(HH:mm).
 *  - AC-2: planned 중 unvisitedSlotKeys 에 든 슬롯 → kind:'unvisited' 행(서버 목록만 신뢰, 재판정 X).
 *  - AC-3: changes[] → kind:'change' 행 + 전(before)·후(after)·사유(reason)·시각(at).
 *  - [[반쪽 방어]]: days/planned/actual/unvisitedSlotKeys/changes/before/after 중첩 결측에도 안 던짐.
 *  - INV-3: 반환 직렬화에 소요시간 문자열·duration 키 0(거리·시각만).
 *
 * (개념) `timeLabel` 은 ISO 문자열 `slice(11,16)`('14:20') — new Date 없이 잘라 INV-3·타임존 안전
 *   (j01 arrivedAt.slice 선례). placeLabel/before/afterLabel 은 `nameByPoi[poiId] ?? poiId`(best-effort).
 */

const ISO_ARRIVED = '2026-06-11T14:20:00Z';
const ISO_CHANGE = '2026-06-11T15:40:00Z';

function day(over: Partial<TripRecordDay> = {}): TripRecordDay {
  return {
    date: '2026-06-11',
    baseStayId: null,
    baseStayName: null,
    planned: [],
    actual: [],
    unvisitedSlotKeys: [],
    ...over,
  };
}

function record(over: Partial<TripRecord> = {}): TripRecord {
  return { tripId: 'trip-1', days: [], changes: [], ...over };
}

function changeEntry(over: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    actor: 'user-1',
    sourceType: 'PLAN_B',
    reason: '휴무',
    at: ISO_CHANGE,
    before: {
      days: [
        {
          date: '2026-06-11',
          slots: [
            {
              poiId: 'poiA',
              startAt: ISO_CHANGE,
              endAt: ISO_CHANGE,
              isFixed: false,
              endsNextDay: false,
            },
          ],
        },
      ],
    },
    after: {
      days: [
        {
          date: '2026-06-11',
          slots: [
            {
              poiId: 'poiB',
              startAt: ISO_CHANGE,
              endAt: ISO_CHANGE,
              isFixed: false,
              endsNextDay: false,
            },
          ],
        },
      ],
    },
    ...over,
  };
}

/** kind 로 골라내는 헬퍼(유니온 좁히기). */
function pick<K extends CompareRow['kind']>(
  rows: CompareRow[],
  kind: K
): Extract<CompareRow, { kind: K }>[] {
  return rows.filter(
    (r): r is Extract<CompareRow, { kind: K }> => r.kind === kind
  );
}

describe('CR-1 · AC-4 실제 행 — actual 방문이 [실제]+arrivedAt 시각으로', () => {
  it('actual 방문이 kind:actual 행이 되고 timeLabel 은 arrivedAt HH:mm 이다', () => {
    const rec = record({
      days: [
        day({
          planned: [
            {
              slotKey: '2026-06-11#poi1',
              date: '2026-06-11',
              poiId: 'poi1',
              orderIndex: 0,
              startAt: ISO_ARRIVED,
              endAt: ISO_ARRIVED,
              endsNextDay: false,
            },
          ],
          actual: [
            {
              visitCheckId: 'v1',
              slotKey: '2026-06-11#poi1',
              poiId: 'poi1',
              arrivedAt: ISO_ARRIVED,
              completedAt: null,
              skippedAt: null,
              spontaneous: false,
              photoCount: 0,
              hasMemo: false,
              updatedAt: ISO_ARRIVED,
            },
          ],
        }),
      ],
    });

    const actuals = pick(buildCompareRows(rec), 'actual');
    expect(actuals).toHaveLength(1);
    expect(actuals[0]).toMatchObject({
      kind: 'actual',
      poiId: 'poi1',
      placeLabel: 'poi1', // 이름 맵 없으면 poiId 폴백
      timeLabel: '14:20',
    });
  });

  it('nameByPoi 를 주면 placeLabel 이 그 이름으로 해소된다(짝)', () => {
    const rec = record({
      days: [
        day({
          actual: [
            {
              visitCheckId: 'v1',
              slotKey: '2026-06-11#poi1',
              poiId: 'poi1',
              arrivedAt: ISO_ARRIVED,
              completedAt: null,
              skippedAt: null,
              spontaneous: false,
              photoCount: 0,
              hasMemo: false,
              updatedAt: ISO_ARRIVED,
            },
          ],
        }),
      ],
    });

    const actuals = pick(
      buildCompareRows(rec, { poi1: '광안리 해변' }),
      'actual'
    );
    expect(actuals[0]?.placeLabel).toBe('광안리 해변');
  });
});

describe('CR-2 · AC-2 미방문 파생 — unvisitedSlotKeys 직독(재판정 X)', () => {
  it('unvisitedSlotKeys 에 든 planned 슬롯이 kind:unvisited 행이 된다', () => {
    const rec = record({
      days: [
        day({
          planned: [
            {
              slotKey: '2026-06-11#poi1',
              date: '2026-06-11',
              poiId: 'poi1',
              orderIndex: 0,
              startAt: ISO_ARRIVED,
              endAt: ISO_ARRIVED,
              endsNextDay: false,
            },
            {
              slotKey: '2026-06-11#poi2',
              date: '2026-06-11',
              poiId: 'poi2',
              orderIndex: 1,
              startAt: ISO_ARRIVED,
              endAt: ISO_ARRIVED,
              endsNextDay: false,
            },
          ],
          unvisitedSlotKeys: ['2026-06-11#poi2'],
        }),
      ],
    });

    const unvisited = pick(buildCompareRows(rec), 'unvisited');
    expect(unvisited).toHaveLength(1);
    expect(unvisited[0]).toMatchObject({ kind: 'unvisited', poiId: 'poi2' });
  });

  it('CR-2b · 클라 계산이면 미방문일 슬롯도 서버 목록에 없으면 unvisited 행 0(재판정 금지)', () => {
    // planned 에 poi2 가 있고 actual 에 poi2 방문이 없다 — 클라가 재도출하면 "미방문"이지만
    // 서버 unvisitedSlotKeys 가 비어 있으므로 unvisited 행을 만들지 않는다(BR-U5-28 서버 소유).
    const rec = record({
      days: [
        day({
          planned: [
            {
              slotKey: '2026-06-11#poi2',
              date: '2026-06-11',
              poiId: 'poi2',
              orderIndex: 0,
              startAt: ISO_ARRIVED,
              endAt: ISO_ARRIVED,
              endsNextDay: false,
            },
          ],
          actual: [],
          unvisitedSlotKeys: [],
        }),
      ],
    });

    expect(pick(buildCompareRows(rec), 'unvisited')).toHaveLength(0);
  });
});

describe('CR-3 · AC-3 변경 행 — 전·후·사유·시각(BR-U5-30)', () => {
  it('changes[] 항목이 kind:change 행이 되고 before/after·reason·at 을 담는다', () => {
    const rec = record({ changes: [changeEntry()] });

    const changes = pick(buildCompareRows(rec), 'change');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'change',
      beforeLabel: 'poiA', // 이름 맵 없으면 poiId 폴백
      afterLabel: 'poiB',
      reason: '휴무',
      timeLabel: '15:40',
      sourceType: 'PLAN_B',
    });
  });

  it('nameByPoi 로 전·후 장소명이 해소된다(짝)', () => {
    const rec = record({ changes: [changeEntry()] });
    const changes = pick(
      buildCompareRows(rec, { poiA: '△△ 카페', poiB: '◇◇ 실내카페' }),
      'change'
    );
    expect(changes[0]).toMatchObject({
      beforeLabel: '△△ 카페',
      afterLabel: '◇◇ 실내카페',
    });
  });

  it('reason 이 null 이어도 변경 행은 만들어진다(reason 은 nullable)', () => {
    const rec = record({ changes: [changeEntry({ reason: null })] });
    const changes = pick(buildCompareRows(rec), 'change');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.reason).toBeNull();
  });
});

describe('CR-4 · [[반쪽 방어]] 중첩 결측 — 상위만 방어 금지', () => {
  const brokenCases: [string, unknown][] = [
    ['days 자체 null', record({ days: null as unknown as TripRecordDay[] })],
    [
      'day.planned/actual/unvisitedSlotKeys 각각 null',
      record({
        days: [
          {
            date: '2026-06-11',
            baseStayName: null,
            planned: null as unknown as [],
            actual: null as unknown as [],
            unvisitedSlotKeys: null as unknown as string[],
          } as unknown as TripRecordDay,
        ],
      }),
    ],
    ['changes null', record({ changes: null as unknown as ChangeLogEntry[] })],
    [
      'change.before/after null',
      record({
        changes: [
          changeEntry({
            before: null as unknown as ChangeLogEntry['before'],
            after: null as unknown as ChangeLogEntry['after'],
          }),
        ],
      }),
    ],
  ];

  it.each(brokenCases)('%s 에도 던지지 않는다', (_label, rec) => {
    expect(() => buildCompareRows(rec as TripRecord)).not.toThrow();
  });

  it('스냅숏 결측 change 는 안정 폴백 라벨로 행을 유지한다', () => {
    const rec = record({
      changes: [
        changeEntry({
          before: null as unknown as ChangeLogEntry['before'],
          after: null as unknown as ChangeLogEntry['after'],
        }),
      ],
    });
    const changes = pick(buildCompareRows(rec), 'change');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.beforeLabel).toBe('이전 장소');
    expect(changes[0]?.afterLabel).toBe('변경된 장소');
  });
});

describe('CR-5 · INV-3 직렬화 — 반환에 소요시간·duration 0', () => {
  it('전체 조립 결과 직렬화에 소요시간 문자열이 없고 duration 키가 없다', () => {
    const rec = record({
      days: [
        day({
          actual: [
            {
              visitCheckId: 'v1',
              slotKey: '2026-06-11#poi1',
              poiId: 'poi1',
              arrivedAt: ISO_ARRIVED,
              completedAt: null,
              skippedAt: null,
              spontaneous: false,
              photoCount: 0,
              hasMemo: false,
              updatedAt: ISO_ARRIVED,
            },
          ],
          planned: [
            {
              slotKey: '2026-06-11#poi2',
              date: '2026-06-11',
              poiId: 'poi2',
              orderIndex: 0,
              startAt: ISO_ARRIVED,
              endAt: ISO_ARRIVED,
              endsNextDay: false,
            },
          ],
          unvisitedSlotKeys: ['2026-06-11#poi2'],
        }),
      ],
      changes: [changeEntry()],
    });

    const rows = buildCompareRows(rec, {
      poi1: '광안리 해변',
      poiA: '△△ 카페',
    });
    const serialized = JSON.stringify(rows);

    // 소요시간 표기 0(시각 '14:20'·'15:40' 은 `:` 라 안 걸린다).
    expect(serialized).not.toMatch(/(소요|\d+\s*분|\d+\s*시간)/);
    // duration 키 0(INV-3 — DTO·VM 어디에도 duration 자리 없음).
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('duration');
    }
  });
});
