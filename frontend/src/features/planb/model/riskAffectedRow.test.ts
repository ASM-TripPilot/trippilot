/**
 * @jest-environment node
 */
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { riskAffectedRow } from './riskAffectedRow';

/**
 * TRIP-749 · AC-6 — 트리거 slotKey → i03 시트 "영향 장소" 행 조인(순수 함수).
 *
 * 트리거 계약(`Trigger`)에는 `slotKey`("{date}#{poiId}")만 있고 순번·카테고리·영업시간이 없다.
 * 그래서 일정(days)에서 그 슬롯을 찾아 세 칸 `{시각} | {장소명} | {N번째 · 카테고리 · 영업시간}` 을 만든다.
 *
 * 무엇을 보장하나:
 *  - 🔴 시각은 계획값 `startAt` 을 자른 것(`17:00:00`→`17:00`, INV-2 · BR-U4-35 — 산술 0).
 *  - 🔴 메타는 빈 조각(null·undefined·'')을 빼고 ` · ` 로 잇는다. 영업시간은 746 포맷터를 거친다
 *    (`'24시간 개방'` 원문 통과, `'10:00 - 18:00'`→`10:00–18:00 영업`).
 *  - 🔴 찾는 날짜는 **slotKey 안의 날짜**다 — 사용자가 다른 날을 보고 있어도 영향 장소가 맞게 뜬다(Q3).
 *  - 🔴 못 찾으면 null(행 통째 생략 — 빈 상자 금지 G6). 반환에 duration 없음(INV-3).
 *
 * node-safe 잠금: `@jest-environment node` — 순수 함수가 RN 을 실수로 import 하면 node 에서 크래시.
 * 3동작 뼈대: 준비=일정 days + slotKey → 실행=riskAffectedRow(...) → 단언=행 또는 null.
 */

const DAY = '2026-06-11';

const slot = (
  poiId: string,
  nameKo: string | null | undefined,
  startAt: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId,
  startAt,
  endAt: '23:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo,
  tags: [],
  ...over,
});

/** 그 날 5곳 — 해운대가 5번째(Figma i03 영향 행). */
const fiveDay = (haeundae: Partial<ItineraryDaysItemSlotsItem> = {}) => ({
  date: DAY,
  slots: [
    slot('gamcheon', '감천문화마을', '09:30:00'),
    slot('gwangalli', '광안리 해변', '11:00:00'),
    slot('museum', '부산시립미술관', '13:00:00'),
    slot('jeonpo', '전포 카페거리', '15:00:00'),
    slot('haeundae', '해운대 해변', '17:00:00', {
      category: '해변',
      openingHours: '24시간 개방',
      ...haeundae,
    }),
  ],
});
const KEY = `${DAY}#haeundae`;

describe('🔴 riskAffectedRow (i03 영향 장소 조인)', () => {
  it('J1 해운대 5번째 → { 17:00 · 해운대 해변 · "5번째 · 해변 · 24시간 개방" }', () => {
    expect(riskAffectedRow([fiveDay()], KEY)).toEqual({
      time: '17:00',
      name: '해운대 해변',
      meta: '5번째 · 해변 · 24시간 개방',
    });
  });

  it.each([
    ['category null', { category: null }, '5번째 · 24시간 개방'],
    ['category 빈 문자열', { category: '' }, '5번째 · 24시간 개방'],
    ['영업시간 null', { openingHours: null }, '5번째 · 해변'],
    [
      '영업시간 HH:mm 범위',
      { openingHours: '10:00 - 18:00' },
      '5번째 · 해변 · 10:00–18:00 영업',
    ],
    ['둘 다 없음', { category: null, openingHours: null }, '5번째'],
  ] as const)(
    'J2 %s → 메타 "%s" 에서 빈 조각이 빠진다',
    (_name, over, meta) => {
      expect(riskAffectedRow([fiveDay(over)], KEY)?.meta).toBe(meta);
    }
  );

  it('J3 같은 poiId 가 두 날에 있으면 slotKey 의 날짜 쪽 슬롯을 고른다(선택 날짜 아님, Q3)', () => {
    const days = [
      { date: '2026-06-10', slots: [slot('p1', '첫날 장소', '09:00:00')] },
      {
        date: '2026-06-11',
        slots: [slot('p1', '둘째 날 장소', '10:00:00', { category: '카페' })],
      },
    ];

    expect(riskAffectedRow(days, '2026-06-11#p1')).toEqual({
      time: '10:00',
      name: '둘째 날 장소',
      meta: '1번째 · 카페',
    });
  });

  it.each([
    ['slotKey null(날짜 전체 영향)', null, fiveDay()],
    ['slotKey undefined', undefined, fiveDay()],
    ['# 없음', 'no-hash', fiveDay()],
    ['# 두 개', `${DAY}#haeundae#x`, fiveDay()],
    ['일정에 없는 날짜', '2026-06-30#haeundae', fiveDay()],
    ['그 날에 없는 poiId', `${DAY}#nowhere`, fiveDay()],
    ['nameKo null', KEY, fiveDay({ nameKo: null })],
    ['nameKo 없음', KEY, fiveDay({ nameKo: undefined })],
  ] as const)('J4 %s → null(행 생략)', (_name, key, day) => {
    expect(riskAffectedRow([day], key)).toBeNull();
  });

  it('J5 반환은 time·name·meta 세 키뿐이고 소요시간(분)이 없다(INV-3)', () => {
    const row = riskAffectedRow([fiveDay()], KEY);

    expect(Object.keys(row ?? {}).sort()).toEqual(['meta', 'name', 'time']);
    expect(JSON.stringify(row)).not.toContain('분');
  });
});
