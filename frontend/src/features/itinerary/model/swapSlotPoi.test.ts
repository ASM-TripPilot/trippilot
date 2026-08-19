import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import { buildEditItineraryRequest } from './buildEditItineraryRequest';
import { swapSlotPoi } from './swapSlotPoi';

/**
 * AC1 (BR-U3-23 · BR-U2-04) 코어 — 슬롯 하나의 POI 치환.
 *
 * 무엇을 보장하나: 후보를 고르면 현재 일정 `days` 전체에서 `(date, poiId)`로 대상 슬롯을
 * 찾아 **그 슬롯의 poiId만** 바꾸고 나머지는 한 톨도 안 건드린 새 `days`를 돌려준다. 이 결과를
 * `buildEditItineraryRequest`(기존)로 조립한 것이 곧 PUT 전체 교체 바디다 — 그래서 마지막
 * 케이스에서 두 순수함수를 이어 태워 "요청 바디가 계약대로다"까지 확인한다.
 *
 * 3동작 뼈대: 준비=일정 days → 실행=swapSlotPoi → 단언=바뀐 것/안 바뀐 것.
 */

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

/** day1=[a, b](둘 다 비고정, 시각에 초 포함) · day2=[c](endsNextDay:true — 자정 넘김 보존 확인용). */
function fixture(): ItineraryDaysItem[] {
  return [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
    {
      date: DAY2,
      slots: [
        {
          poiId: 'c',
          startAt: '22:00:00',
          endAt: '01:00:00',
          isFixed: false,
          endsNextDay: true,
          hasViolation: false,
          tags: [],
        },
      ],
    },
  ];
}

describe('🔴 swapSlotPoi — 대상 슬롯의 poiId만 바꾼다 (AC1)', () => {
  it('C1 · 대상 슬롯의 poiId만 새 후보로 바뀌고 시각·이웃·타 일자는 불변이다', () => {
    const days = fixture();

    const out = swapSlotPoi(days, { date: DAY1, poiId: 'a' }, 'x');

    // 대상 슬롯: poiId 만 바뀌고 시각 3필드·고정 여부는 그대로(BR-U3-26 — 재검증 전 시각은 원본).
    expect(out[0].slots[0].poiId).toBe('x');
    expect(out[0].slots[0].startAt).toBe('09:30:00');
    expect(out[0].slots[0].endAt).toBe('11:00:00');
    expect(out[0].slots[0].endsNextDay).toBe(false);
    expect(out[0].slots[0].isFixed).toBe(false);
    // 이웃 슬롯·다른 날은 손대지 않는다.
    expect(out[0].slots[1].poiId).toBe('b');
    expect(out[1].slots[0].poiId).toBe('c');
    expect(out[1].slots[0].endsNextDay).toBe(true);
  });

  it('C2 · 비파괴 — 입력 days 를 바꾸지 않는다 (시드 원본 보호)', () => {
    const days = fixture();

    swapSlotPoi(days, { date: DAY1, poiId: 'a' }, 'x');

    // removeSlot·adjustSlotTime 과 같은 비파괴 계약(엣지5) — 원본은 그대로 'a'.
    expect(days[0].slots[0].poiId).toBe('a');
  });

  it('C3 · 전체 days 를 돌려준다 (전체 교체용, 일자 순서 보존 INV-U3-02)', () => {
    const days = fixture();

    const out = swapSlotPoi(days, { date: DAY1, poiId: 'a' }, 'x');

    expect(out.map((d) => d.date)).toEqual([DAY1, DAY2]);
  });

  it('C4 · 없는 (date, poiId) 는 무해 — 아무 것도 안 바뀐다', () => {
    const days = fixture();

    const out = swapSlotPoi(days, { date: DAY1, poiId: 'zzz' }, 'x');

    expect(out).toEqual(days); // 값 동일
    const allPoiIds = out.flatMap((d) => d.slots.map((s) => s.poiId));
    expect(allPoiIds).not.toContain('x');
  });

  it('C5 · 같은 날 같은 poiId 가 둘이면 첫 슬롯만 바꾼다 (findIndex 첫 일치, removeSlot 선례)', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'a',
            startAt: '09:00:00',
            endAt: '10:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            tags: [],
          },
          {
            poiId: 'a',
            startAt: '15:00:00',
            endAt: '16:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            tags: [],
          },
        ],
      },
    ];

    const out = swapSlotPoi(days, { date: DAY1, poiId: 'a' }, 'x');

    // 슬롯 특정 불가(같은 날 같은 장소 둘)는 서버 409 몫 — 클라는 첫 일치만 안전하게 바꾼다.
    expect(out[0].slots[0].poiId).toBe('x');
    expect(out[0].slots[1].poiId).toBe('a');
  });

  it('C6 · 치환 → buildEditItineraryRequest 왕복 = AC1 요청 바디 계약', () => {
    const days = fixture();

    const body = buildEditItineraryRequest(
      swapSlotPoi(days, { date: DAY1, poiId: 'a' }, 'x')
    );

    // 전체 교체 — 두 일자 전부.
    expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
    // a → x 치환이 실린다.
    expect(body.days[0].slots[0].poiId).toBe('x');
    // 옛 시각은 초까지 보존(표시용 절단 아님).
    expect(body.days[0].slots[0].startAt).toBe('09:30:00');
    // 슬롯은 5필드뿐 — 읽기전용·제외목록(excludePoiIds 등) 필드 없음(BR-U3-24 데이터 확인).
    expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
      ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
    );
    // endsNextDay 실어나르기(HC4 자정 넘김 소실 방지).
    expect(body.days[1].slots[0].endsNextDay).toBe(true);
    // INV-1(데이터) — 바디의 모든 poiId 는 원본 ∪ 고른 후보 안에 있다(응답 밖 임의 POI 0).
    const bodyPoiIds = body.days.flatMap((d) => d.slots.map((s) => s.poiId));
    const allowed = new Set(['b', 'c', 'x']); // a 는 x 로 바뀜
    for (const id of bodyPoiIds) {
      expect(allowed.has(id)).toBe(true);
    }
  });
});
