import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import { useItineraryEditStore } from './itineraryEditStore';

/**
 * TRIP-302 · h24 편집 스토어 **시각조정 액션**(슬라이스3 · AC-T3·AC-T4·비파괴).
 *
 * 무엇을 보장하나: 편집 드래프트 상자에 새 `adjustSlotTime` 액션이
 *  ① 대상 슬롯의 **startAt·endAt·endsNextDay만** 갱신하고(AC-T3),
 *  ② 슬롯을 이동시키지 않으며(배열 순서 = 슬롯 순서, INV-U3-02 · 02a ★7),
 *  ③ 다른 슬롯·다른 날·시드한 원본 배열을 건드리지 않는다(비파괴 · 엣지5 병렬).
 *
 * `endsNextDay`는 **시트가 유도한 값을 액션이 그대로 싣기만** 한다 — 유도(`end ≤ start`)는
 * 시트 몫이라 여기서 재판정하지 않는다(02a §3·★10). 액션은 `deleteSlot`·`reorderSlots`와
 * 같은 "해당 날에만 얹는 얇은 래퍼"다.
 *
 * > *(개념)* **Zustand 스토어** — 화면 밖에 사는 작은 상태 상자. `getState()`는 지금 값을 렌더
 * > 없이 읽는 문. 배열을 **새로** 만들어 담으면(비파괴) 시드한 원본은 안 바뀐다.
 *
 * 3동작 뼈대: 준비=reset+시드 → 실행=adjustSlotTime 호출 → 단언=getState() 값·원본 불변.
 *
 * ⚠️ 모듈 싱글턴이라 테스트 사이 값이 샌다 → 매 테스트 전 reset()(itineraryEditStore.test 선례).
 */

type Slot = ItineraryDaysItemSlotsItem;

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

/** 필수 6필드만 채운 슬롯 팩토리 — 프로즌 store 테스트와 같은 형태. */
function slot(poiId: string, over: Partial<Slot> = {}): Slot {
  return {
    poiId,
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

function poiIds(slots: Slot[]): string[] {
  return slots.map((s) => s.poiId);
}

beforeEach(() => {
  useItineraryEditStore.getState().reset();
});

describe('SA1 · AC-T3·AC-T4(true) — 대상 슬롯만 3필드 갱신, 순서·이웃·타 일자 불변', () => {
  it('b 의 시각을 바꾸면 b 의 startAt·endAt·endsNextDay 만 변하고 배열은 안 움직인다', () => {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          slot('a'),
          slot('b', { startAt: '13:00:00', endAt: '14:00:00' }),
        ],
      },
      { date: DAY2, slots: [slot('c')] },
    ];
    useItineraryEditStore.getState().seed(days);

    useItineraryEditStore.getState().adjustSlotTime(DAY1, 'b', {
      startAt: '23:15:00',
      endAt: '11:45:00',
      endsNextDay: true,
    });

    const stored = useItineraryEditStore.getState().days;
    const b = stored[0].slots[1];
    // 대상 슬롯 3필드가 갱신된다.
    expect(b.startAt).toBe('23:15:00');
    expect(b.endAt).toBe('11:45:00');
    expect(b.endsNextDay).toBe(true);

    // 배열 순서 불변(INV-U3-02) — 시각을 바꿔도 슬롯은 이동하지 않는다.
    expect(poiIds(stored[0].slots)).toEqual(['a', 'b']);

    // 짝 — 이웃 슬롯 a 와 다른 날 c 는 그대로다.
    expect(stored[0].slots[0].startAt).toBe('09:30:00');
    expect(stored[1].slots[0].poiId).toBe('c');
    expect(stored[1].slots[0].startAt).toBe('09:30:00');
  });
});

describe('SA2 · AC-T4(false)·방어 — false 가 실리고, 없는 poiId 는 무해', () => {
  it('endsNextDay:false 가 그대로 실리고, 미존재 키 호출은 배열을 안 흔든다', () => {
    useItineraryEditStore
      .getState()
      .seed([{ date: DAY1, slots: [slot('a'), slot('b')] }]);

    useItineraryEditStore.getState().adjustSlotTime(DAY1, 'a', {
      startAt: '08:00:00',
      endAt: '09:00:00',
      endsNextDay: false,
    });
    // 짝 — SA1 의 true 와 대비되는 false 가 실린다.
    expect(useItineraryEditStore.getState().days[0].slots[0].endsNextDay).toBe(
      false
    );

    // 없는 poiId 는 아무것도 바꾸지 않는다(removeSlot "없는 키 불변" 선례).
    useItineraryEditStore.getState().adjustSlotTime(DAY1, 'zzz', {
      startAt: '01:00:00',
      endAt: '02:00:00',
      endsNextDay: false,
    });
    expect(poiIds(useItineraryEditStore.getState().days[0].slots)).toEqual([
      'a',
      'b',
    ]);
    expect(useItineraryEditStore.getState().days[0].slots[0].startAt).toBe(
      '08:00:00'
    );
  });
});

describe('SA3 · 비파괴(엣지5 병렬) — 시드한 원본 배열·객체가 불변', () => {
  it('adjustSlotTime 후에도 seed 에 넘긴 원본은 그대로고 드래프트만 바뀐다', () => {
    const originalSlots = [slot('a'), slot('b')];
    const original: ItineraryDaysItem[] = [
      { date: DAY1, slots: originalSlots },
    ];

    useItineraryEditStore.getState().seed(original);
    useItineraryEditStore.getState().adjustSlotTime(DAY1, 'a', {
      startAt: '23:00:00',
      endAt: '10:00:00',
      endsNextDay: true,
    });

    // 원본(= GET 캐시 대역)은 그대로다 — 편집은 로컬 드래프트만 바꾼다.
    expect(originalSlots[0].startAt).toBe('09:30:00');
    expect(originalSlots[0].endsNextDay).toBe(false);
    expect(original[0].slots[0].startAt).toBe('09:30:00');

    // 짝 — 스토어 드래프트는 갱신됐다.
    expect(useItineraryEditStore.getState().days[0].slots[0].startAt).toBe(
      '23:00:00'
    );
  });
});
