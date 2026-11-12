import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/index.schemas';

import { useItineraryEditStore } from './itineraryEditStore';

/**
 * TRIP-302 · h24 편집 스토어 **시각조정 액션**(슬라이스3 · AC-T3·AC-T4·비파괴).
 *
 * 무엇을 보장하나: 편집 드래프트 상자에 새 `adjustSlotTime` 액션이
 *  ① 대상 슬롯의 **startAt·endAt·endsNextDay만** 갱신하고(AC-T3),
 *  ② 이웃을 넘지 않으면 슬롯을 이동시키지 않고(배열 순서 = 슬롯 순서, INV-U3-02 · 02a ★7),
 *     **이웃을 넘으면 그 날만 시작 시각 순으로 다시 세운다**(TRIP-1674 — 서버는 시각 순이 아니면 422 →
 *     "판정 보류"라 FE 가 먼저 맞춘다. 규칙의 정본은 `sortSlotsByStartAt.test.ts`, 여기는 스토어가 그 함수를
 *     "그 날 · 대상이 있을 때만 · 비파괴로" 부르는지만 본다),
 *  ③ 다른 날·시드한 원본 배열을 건드리지 않는다(비파괴 · 엣지5 병렬).
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
    alternatives: [],
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

describe('SA1 · AC-T3·AC-T4(true) — 대상 슬롯만 3필드 갱신, 이웃을 넘지 않으면 순서·이웃·타 일자 불변', () => {
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

    // 배열 순서 불변(INV-U3-02) — b 는 원래 맨 뒤고 23:15 로 옮겨도 이웃(a 09:30)을 넘지 않는다.
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

    // 짝 — 스토어 드래프트는 갱신됐다. a(09:30→23:00)는 b(09:30)를 넘어 뒤로 가므로 자리가 아니라 poiId 로 찾는다.
    const draftA = useItineraryEditStore
      .getState()
      .days[0].slots.find((s) => s.poiId === 'a');
    expect(draftA?.startAt).toBe('23:00:00');
  });
});

/**
 * TRIP-1674 — 시각 변경 뒤 재정렬의 스토어 배선. 정렬 규칙 자체(안정·초·자정 넘김·null)는 순수 함수 테스트가
 * 정본이고, 여기는 "그 날 전체 · 다른 날 비접촉 · 대상이 없으면 안 건드림 · 이전 상태 배열 비파괴"를 본다.
 * 각 케이스는 입력을 일부러 **잘못 정렬하면 결과가 달라지는** 모양으로 골랐다(SA5·SA11 은 정렬이 없던 때에도 맞는
 * 입력이라 구현 뒤에도 green 이어야 하는 과정 방어선이고, SA9 는 1일차 정렬 단언이 red 를 만든다).
 */
const T = (startAt: string, endAt: string, endsNextDay = false) => ({
  startAt,
  endAt,
  endsNextDay,
});

function seedDay1(slots: Slot[]): void {
  useItineraryEditStore.getState().seed([{ date: DAY1, slots }]);
}
const day1Ids = (): string[] =>
  poiIds(useItineraryEditStore.getState().days[0].slots);

describe('SA4 · C1·C6 — 이웃을 넘는 시각은 그 날을 시각 순으로 다시 세우고, 이전 상태 배열은 안 건드린다', () => {
  it('a 를 b·c 뒤 15:00 으로 옮기면 [b,c,a] 이고 a 는 새 3필드·dirty true 다', () => {
    seedDay1([
      slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
      slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
      slot('c', { startAt: '13:00:00', endAt: '14:00:00' }),
    ]);
    const before = useItineraryEditStore.getState().days[0].slots;
    const beforeIds = poiIds(before);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'a', T('15:00:00', '16:00:00'));

    expect(day1Ids()).toEqual(['b', 'c', 'a']);
    const a = useItineraryEditStore.getState().days[0].slots[2];
    expect([a.startAt, a.endAt, a.endsNextDay]).toEqual([
      '15:00:00',
      '16:00:00',
      false,
    ]);
    expect(useItineraryEditStore.getState().dirty).toBe(true);
    // 이전 상태 배열을 제자리에서 정렬하지 않는다(새 배열) — 구독자가 쥔 옛 배열이 흔들리지 않게.
    expect(poiIds(before)).toEqual(beforeIds);
  });
});

describe('SA5 · C2 — 같은 시각이 되면 배열 순서를 유지한다(안정)', () => {
  it.each([
    ['뒤 슬롯이 앞 슬롯과 같은 시각이 됨', 'b', '09:00:00', ['a', 'b']],
    ['앞 슬롯이 뒤 슬롯과 같은 시각이 됨', 'a', '10:00:00', ['a', 'b']],
  ])('%s → 서로 자리를 안 바꾼다', (_name, target, startAt, expected) => {
    seedDay1([
      slot('a', { startAt: '09:00:00', endAt: '09:50:00' }),
      slot('b', { startAt: '10:00:00', endAt: '10:50:00' }),
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, target, T(startAt, '10:55:00'));

    expect(day1Ids()).toEqual(expected);
  });
});

describe('SA6 · C3 — 초 단위까지 구분한다', () => {
  it('b 를 09:30:00 으로 옮기면 09:30:30 인 a 보다 앞이다', () => {
    seedDay1([
      slot('a', { startAt: '09:30:30', endAt: '10:00:00' }),
      slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'b', T('09:30:00', '10:30:00'));

    expect(day1Ids()).toEqual(['b', 'a']);
  });
});

describe('SA7 · C4 — 자정을 넘기는 슬롯은 시작 시각 기준으로 뒤쪽에 선다', () => {
  it('b 를 23:15–00:45(다음 날 끝)로 옮기면 [a,c,b] 다(끝 시각 00:45 로 앞에 가지 않는다)', () => {
    seedDay1([
      slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
      slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
      slot('c', { startAt: '13:00:00', endAt: '14:00:00' }),
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'b', T('23:15:00', '00:45:00', true));

    expect(day1Ids()).toEqual(['a', 'c', 'b']);
  });
});

describe('SA8 · C5 — startAt 이 null 인 미지정 슬롯은 제자리다', () => {
  it('[a,미지정 n,c] 에서 a 를 15:00 으로 옮기면 [c,n,a] — n 의 자리(1)는 그대로', () => {
    seedDay1([
      slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
      // 서버 계약은 non-nullable 이라 로컬 미지정은 캐스트로 심는다(unspecified 테스트 선례).
      slot('n', { startAt: null as unknown as string }),
      slot('c', { startAt: '13:00:00', endAt: '14:00:00' }),
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'a', T('15:00:00', '16:00:00'));

    expect(day1Ids()).toEqual(['c', 'n', 'a']);
  });
});

describe('SA9 · C6 — 다른 날은 건드리지 않는다', () => {
  it('2일차가 어긋난 채여도 1일차만 조정하면 2일차 순서는 그대로다', () => {
    useItineraryEditStore.getState().seed([
      {
        date: DAY1,
        slots: [
          slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
          slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
        ],
      },
      {
        date: DAY2,
        slots: [
          slot('d', { startAt: '15:00:00', endAt: '16:00:00' }),
          slot('e', { startAt: '09:00:00', endAt: '10:00:00' }),
        ],
      },
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'a', T('13:00:00', '14:00:00'));

    const { days } = useItineraryEditStore.getState();
    expect(poiIds(days[0].slots)).toEqual(['b', 'a']);
    // 짝 — 정렬이 1일차에서만 일어났다는 앵커. 2일차는 d(15:00) 가 e(09:00) 앞에 그대로 남는다.
    expect(poiIds(days[1].slots)).toEqual(['d', 'e']);
  });
});

describe('SA10 · C1 — 정렬은 그 날 전체다(이미 어긋나 있던 슬롯도 함께)', () => {
  it('[c 13:00, a 09:00, b 11:00] 에서 b 를 11:30 으로 바꾸면 [a,b,c] 다', () => {
    seedDay1([
      slot('c', { startAt: '13:00:00', endAt: '14:00:00' }),
      slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
      slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'b', T('11:30:00', '12:30:00'));

    expect(day1Ids()).toEqual(['a', 'b', 'c']);
  });
});

describe('SA11 · C9 — 없는 poiId 는 어긋난 날이어도 정렬하지 않는다', () => {
  it('[b 11:00, a 09:00] 에서 없는 키로 부르면 순서가 그대로다', () => {
    seedDay1([
      slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
      slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
    ]);

    useItineraryEditStore
      .getState()
      .adjustSlotTime(DAY1, 'zzz', T('01:00:00', '02:00:00'));

    expect(day1Ids()).toEqual(['b', 'a']);
  });
});

/**
 * TRIP-1812 · 같은 날 같은 장소 — 시각 조정은 **그 자리만** 바꾼다(옛 구현은 같은 poiId 전부). 재정렬 규칙은 그대로다.
 * 3동작: 준비(같은 장소가 낀·붙은 날 시드) → 실행(adjustSlotTime + ordinal) → 단언(그날 [장소, 시작, 끝] 전부).
 */
describe('SA12 · TRIP-1812 — ordinal 자리만 바뀌고, 재정렬은 그대로다', () => {
  const at = (poiId: string, startAt: string, endAt: string): Slot =>
    slot(poiId, { startAt, endAt });
  const state = () => useItineraryEditStore.getState();
  const rows = () =>
    state().days[0].slots.map((s) => [s.poiId, s.startAt, s.endAt]);
  /** [p1 09, p2 12, p1 14, p1 16] — 가운데 p1(ordinal 1)을 겨눈다. 첫 일치·마지막 일치 구현이 둘 다 틀린다. */
  const woven = () => [
    at('p1', '09:00:00', '10:00:00'),
    at('p2', '12:00:00', '13:00:00'),
    at('p1', '14:00:00', '15:00:00'),
    at('p1', '16:00:00', '17:00:00'),
  ];

  it('이웃을 안 넘으면 ordinal 1 자리만 바뀐다 — 첫째·셋째·순서 불변', () => {
    seedDay1(woven());

    state().adjustSlotTime(DAY1, 'p1', T('14:30:00', '15:30:00'), 1);

    expect(rows()).toEqual([
      ['p1', '09:00:00', '10:00:00'],
      ['p2', '12:00:00', '13:00:00'],
      ['p1', '14:30:00', '15:30:00'],
      ['p1', '16:00:00', '17:00:00'],
    ]);
  });

  it('이웃을 넘으면 그 자리 값이 바뀐 뒤 시각 순으로 다시 선다 — 나머지 시각은 그대로', () => {
    seedDay1(woven());

    state().adjustSlotTime(DAY1, 'p1', T('10:30:00', '11:30:00'), 1);

    expect(rows()).toEqual([
      ['p1', '09:00:00', '10:00:00'],
      ['p1', '10:30:00', '11:30:00'],
      ['p2', '12:00:00', '13:00:00'],
      ['p1', '16:00:00', '17:00:00'],
    ]);
  });

  it('붙어 있는 같은 장소도 뒤 카드만 바뀐다', () => {
    seedDay1([
      at('p1', '09:00:00', '10:00:00'),
      at('p1', '11:00:00', '12:00:00'),
      at('p2', '14:00:00', '15:00:00'),
    ]);

    state().adjustSlotTime(DAY1, 'p1', T('12:00:00', '13:00:00'), 1);

    expect(rows()).toEqual([
      ['p1', '09:00:00', '10:00:00'],
      ['p1', '12:00:00', '13:00:00'],
      ['p2', '14:00:00', '15:00:00'],
    ]);
  });

  it('ordinal 을 안 주면 첫 카드만 바뀐다 — 같은 장소가 함께 바뀌지 않는다', () => {
    seedDay1(woven());

    state().adjustSlotTime(DAY1, 'p1', T('08:00:00', '08:30:00'));

    expect(rows()).toEqual([
      ['p1', '08:00:00', '08:30:00'],
      ['p2', '12:00:00', '13:00:00'],
      ['p1', '14:00:00', '15:00:00'],
      ['p1', '16:00:00', '17:00:00'],
    ]);
  });

  it('D1 · 자기 값 그대로 [적용]이면 아무것도 안 변한다 — 이력·dirty 0', () => {
    seedDay1(woven());
    const before = state().days;

    state().adjustSlotTime(DAY1, 'p1', T('14:00:00', '15:00:00'), 1);

    expect(state().days).toBe(before);
    expect(state().history).toHaveLength(0);
    expect(state().dirty).toBe(false);
  });

  it('없는 ordinal 은 없는 poiId 와 같다 — 어긋난 날이어도 정렬하지 않고 이력도 없다', () => {
    seedDay1([
      at('p1', '14:00:00', '15:00:00'),
      at('p2', '09:00:00', '10:00:00'),
    ]);
    const before = state().days;

    state().adjustSlotTime(DAY1, 'p1', T('01:00:00', '02:00:00'), 5);

    expect(state().days).toBe(before);
    expect(state().history).toHaveLength(0);
  });
});
