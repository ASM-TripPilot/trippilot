import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/index.schemas';

import {
  removeSlot,
  removeSlots,
  useItineraryEditStore,
} from './itineraryEditStore';

/**
 * TRIP-302 · h24 편집 스토어 (슬라이스1 · AC3 삭제 · AC4 재정렬 · AC5 · 엣지5).
 *
 * 무엇을 보장하나: 편집 화면 밖에 사는 **편집 드래프트 상자**가
 *  ① 삭제·재정렬을 **입력 배열 → 새 배열** 순수 변환으로 처리하고(AC5),
 *  ② **재정렬은 끌기 결과 순서를 그대로 쓴다 — 시각 고정 슬롯도 재고정하지 않는다**(TRIP-1250.
 *     고정은 시각만 지킨다 INV-U3-03, 서버가 저장 때 지킴. 옛 엣지1 '고정은 원래 자리 고수'는 정본에
 *     없는 확장 해석이라 뒤집혔다),
 *  ③ 편집이 **시드한 GET 원본 배열을 건드리지 않는다**(엣지5 모델 근거 — 서버 캐시 비파괴).
 *
 * > *(개념)* **Zustand 스토어** — 화면 밖에 사는 작은 상태 상자. `getState()`는 지금 값을 렌더
 * > 없이 읽는 문. `배열.slice(a,b)`는 원본을 안 바꾸고 새 배열을 만든다(비파괴).
 *
 * 3동작 뼈대: 준비=reset+시드 → 실행=순수 함수/액션 호출 → 단언=반환/getState() 값.
 *
 * ⚠️ 모듈 싱글턴이라 테스트 사이 값이 샌다 → 매 테스트 전 reset()(tripWizardStore 선례).
 */

type Slot = ItineraryDaysItemSlotsItem;

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

/** 필수 6필드만 채운 슬롯 팩토리 — 나머지는 nullable/빈배열(계약 실측 §5-D). */
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

describe('S1 · removeSlot 순수 — 첫 일치만 제거, 원본 비파괴 (AC3 근거)', () => {
  it('일치 슬롯을 빼고, 없는 키는 불변, 중복은 첫 일치만 뺀다', () => {
    const slots = [slot('a'), slot('b'), slot('c')];

    // 일치 제거.
    expect(poiIds(removeSlot(slots, 'b'))).toEqual(['a', 'c']);

    // 없는 키 → 불변(새 배열).
    expect(poiIds(removeSlot(slots, 'x'))).toEqual(['a', 'b', 'c']);
    // 짝 — 원본은 slice 로 안 바뀐다(비파괴).
    expect(poiIds(slots)).toEqual(['a', 'b', 'c']);

    // 중복 b 두 개 → **첫 일치 하나만** 제거(wizard findIndex 선례).
    expect(poiIds(removeSlot([slot('a'), slot('b'), slot('b')], 'b'))).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('S2 · reorderSlots — 고정 슬롯도 끌기 결과 자리로 간다 (TRIP-1250 · INV-U3-03)', () => {
  it.each([
    // 고정 F 가 맨 앞 — b 를 F 앞으로 끌면 F 는 2번째로 밀린다(옛 규칙은 F 를 index 0 으로 되돌렸다).
    {
      name: '맨 앞 고정 F 앞으로 끼우기',
      seeded: ['F', 'a', 'b'],
      dragged: ['b', 'F', 'a'],
    },
    // 고정 F 가 맨 끝 — 끌기 결과가 F 를 앞으로 올리면 그 자리 그대로.
    {
      name: '맨 끝 고정 F 가 앞으로',
      seeded: ['a', 'b', 'F'],
      dragged: ['F', 'b', 'a'],
    },
  ])('$name — 저장 드래프트 순서 = 끌기 결과', ({ seeded, dragged }) => {
    const pool = seeded.map((id) => slot(id, { isFixed: id === 'F' }));
    const byId = (id: string): Slot => pool.find((s) => s.poiId === id) as Slot;
    useItineraryEditStore.getState().seed([{ date: DAY1, slots: pool }]);

    useItineraryEditStore.getState().reorderSlots(DAY1, dragged.map(byId));

    const stored = useItineraryEditStore.getState().days[0].slots;
    expect(poiIds(stored)).toEqual(dragged);
    // 고정은 시각 플래그로 남는다 — 자리만 바뀌었다.
    expect(stored.find((s) => s.poiId === 'F')?.isFixed).toBe(true);
  });
});

describe('S3 · seed — GET 결과로 편집 드래프트를 채운다 (AC5 · AC1)', () => {
  it('시드한 days 가 스토어에 그대로 담긴다', () => {
    const days: ItineraryDaysItem[] = [
      { date: DAY1, slots: [slot('a'), slot('b')] },
      { date: DAY2, slots: [slot('c')] },
    ];

    useItineraryEditStore.getState().seed(days);

    const stored = useItineraryEditStore.getState().days;
    expect(stored.map((d) => d.date)).toEqual([DAY1, DAY2]);
    expect(poiIds(stored[0].slots)).toEqual(['a', 'b']);
    expect(poiIds(stored[1].slots)).toEqual(['c']);
  });
});

describe('S4 · deleteSlot — 해당 날에서만 제거, 카운트 갱신 (AC3)', () => {
  it('day1 의 b 를 빼면 day1 만 줄고 day2 는 그대로다', () => {
    useItineraryEditStore.getState().seed([
      { date: DAY1, slots: [slot('a'), slot('b')] },
      { date: DAY2, slots: [slot('c')] },
    ]);

    useItineraryEditStore.getState().deleteSlot(DAY1, 'b');

    const days = useItineraryEditStore.getState().days;
    expect(poiIds(days[0].slots)).toEqual(['a']); // day1: 2 → 1(카운트 갱신)
    expect(poiIds(days[1].slots)).toEqual(['c']); // day2 불변
  });
});

describe('S5 · reorderSlots — 활성 날에만 순서 반영 (AC4 · TRIP-1250)', () => {
  it('lib 이 준 재정렬 data 를 그 순서 그대로 활성 날에만 넣는다', () => {
    const F = slot('F', { isFixed: true });
    const a = slot('a');
    const b = slot('b');
    useItineraryEditStore.getState().seed([
      { date: DAY1, slots: [F, a, b] },
      { date: DAY2, slots: [slot('c')] },
    ]);

    // 사용자가 b 를 고정 F 앞으로 끌어 lib 이 [b, F, a] 를 넘겼다 — 그대로 반영된다.
    useItineraryEditStore.getState().reorderSlots(DAY1, [b, F, a]);

    const days = useItineraryEditStore.getState().days;
    expect(poiIds(days[0].slots)).toEqual(['b', 'F', 'a']); // 끌기 결과 그대로
    expect(poiIds(days[1].slots)).toEqual(['c']); // day2 불변
  });
});

describe('S6 · 편집이 시드 원본을 건드리지 않는다 (엣지5 — 서버 캐시 비파괴)', () => {
  it('삭제·재정렬 후에도 seed 에 넘긴 원본 배열·객체가 불변이다', () => {
    const originalSlots = [slot('a'), slot('b')];
    const original: ItineraryDaysItem[] = [
      { date: DAY1, slots: originalSlots },
    ];

    useItineraryEditStore.getState().seed(original);
    useItineraryEditStore.getState().deleteSlot(DAY1, 'a');
    useItineraryEditStore.getState().reorderSlots(DAY1, [slot('b')]);

    // 원본(= GET 캐시 대역)은 그대로다 — 편집은 로컬 드래프트만 바꾼다.
    expect(poiIds(originalSlots)).toEqual(['a', 'b']);
    expect(poiIds(original[0].slots)).toEqual(['a', 'b']);
    // 짝 — 스토어의 드래프트는 갱신됐다.
    expect(poiIds(useItineraryEditStore.getState().days[0].slots)).toEqual([
      'b',
    ]);
  });
});

/**
 * TRIP-1498 (a) · S7 — 편집 초안에 "사용자가 바꿨다(dirty)" 표시와 "추가한 장소 끼우기".
 *
 * 무엇을 보장하나:
 *  - `dirty` 는 처음 false 이고, 삭제·재정렬·시각 조정이 true 로 올린다(제자리에 놓은 끌기는 올리지 않는다 — TRIP-1792 U5).
 *  - `seed`(서버 값으로 초안을 새로 채움)와 `reset` 은 false 로 내린다.
 *  - `insertSlot` 은 그 날의 지정 자리(없으면 말미)에만 끼우고 dirty 를 건드리지 않는다.
 *    장소 추가 화면이 "편집기에 저장 안 한 변경이 있을 때 추가분을 초안에 같은 자리로 넣는" 데 쓴다.
 *
 * 3동작 뼈대: 준비=reset+시드 → 실행=액션 호출 → 단언=getState() 의 dirty·days.
 */
describe('S7 · dirty 표시와 insertSlot (TRIP-1498 a)', () => {
  function seeded(): void {
    useItineraryEditStore.getState().seed([
      { date: DAY1, slots: [slot('a'), slot('b')] },
      { date: DAY2, slots: [slot('c')] },
    ]);
  }

  it('S7a · 처음엔 dirty 가 false 고, 시드해도 false 다', () => {
    expect(useItineraryEditStore.getState().dirty).toBe(false);

    seeded();

    expect(useItineraryEditStore.getState().dirty).toBe(false);
  });

  it.each([
    ['삭제', () => useItineraryEditStore.getState().deleteSlot(DAY1, 'a')],
    [
      '재정렬',
      () =>
        useItineraryEditStore
          .getState()
          .reorderSlots(DAY1, [slot('b'), slot('a')]),
    ],
    // 제자리 끌기(같은 순서 그대로)는 TRIP-1792 에서 이 표를 떠났다 — 값이 안 바뀐 액션은 dirty 도 이력도 안 건드린다(U5).
    [
      '시각 조정',
      () =>
        useItineraryEditStore.getState().adjustSlotTime(DAY1, 'a', {
          startAt: '15:00:00',
          endAt: '16:00:00',
          endsNextDay: false,
        }),
    ],
  ])('S7b · %s 하면 dirty 가 true 가 된다', (_name, act) => {
    seeded();
    // 앵커 — 하기 전엔 false.
    expect(useItineraryEditStore.getState().dirty).toBe(false);

    act();

    expect(useItineraryEditStore.getState().dirty).toBe(true);
  });

  it('S7c · dirty 인 뒤 seed 하면 서버 값으로 채워지고 dirty 가 내려간다', () => {
    seeded();
    useItineraryEditStore.getState().deleteSlot(DAY1, 'a');
    expect(useItineraryEditStore.getState().dirty).toBe(true);

    useItineraryEditStore
      .getState()
      .seed([{ date: DAY1, slots: [slot('x'), slot('y')] }]);

    expect(useItineraryEditStore.getState().dirty).toBe(false);
    expect(poiIds(useItineraryEditStore.getState().days[0].slots)).toEqual([
      'x',
      'y',
    ]);
  });

  it('S7d · dirty 인 뒤 reset 하면 dirty 가 내려간다', () => {
    seeded();
    useItineraryEditStore.getState().deleteSlot(DAY1, 'a');
    expect(useItineraryEditStore.getState().dirty).toBe(true);

    useItineraryEditStore.getState().reset();

    expect(useItineraryEditStore.getState().dirty).toBe(false);
  });

  it.each([
    ['중간 자리(1)', 1, ['a', 'x', 'b']],
    ['말미를 넘는 index(9)는 말미', 9, ['a', 'b', 'x']],
    ['index 를 안 주면 말미', undefined, ['a', 'b', 'x']],
  ] as const)('S7e · insertSlot — %s', (_name, index, expected) => {
    seeded();

    useItineraryEditStore.getState().insertSlot(DAY1, slot('x'), index);

    const days = useItineraryEditStore.getState().days;
    expect(poiIds(days[0].slots)).toEqual(expected);
    // 다른 날은 불변.
    expect(poiIds(days[1].slots)).toEqual(['c']);
  });

  it('S7f · insertSlot 은 dirty 를 바꾸지 않고, 없는 날짜는 아무 일도 없다', () => {
    seeded();

    // false 에서 호출 → false 유지.
    useItineraryEditStore.getState().insertSlot(DAY1, slot('x'), 1);
    expect(useItineraryEditStore.getState().dirty).toBe(false);

    // true 에서 호출 → true 유지.
    useItineraryEditStore.getState().deleteSlot(DAY2, 'c');
    useItineraryEditStore.getState().insertSlot(DAY1, slot('y'), 0);
    expect(useItineraryEditStore.getState().dirty).toBe(true);

    // 없는 날짜 → days 불변.
    const before = useItineraryEditStore
      .getState()
      .days.map((d) => poiIds(d.slots));
    useItineraryEditStore.getState().insertSlot('2099-01-01', slot('z'), 0);
    expect(
      useItineraryEditStore.getState().days.map((d) => poiIds(d.slots))
    ).toEqual(before);
  });
});

// TRIP-1791 · 여러 곳 골라 한 번에 빼기 — 순수 헬퍼 `removeSlots` 와 액션 `deleteSlots`.
// 3동작 뼈대: 준비=슬롯/시드 → 실행=헬퍼·액션 호출 → 단언=남은 poiId·dirty·구독 통지 수.
describe('M1 · removeSlots 순수 — 고른 poiId 를 전부 뺀다, 원본 비파괴', () => {
  it('같은 poiId 가 둘이어도 전부 빼고, 없는 키는 무해하고, 순서를 지킨다', () => {
    const slots = [slot('a'), slot('b'), slot('c'), slot('b')];

    const result = removeSlots(slots, ['b', 'x']);

    // 체크가 poiId 단위라 화면에 보이던 중복 카드도 함께 빠진다(removeSlot 의 "첫 일치만"과 다른 점).
    expect(poiIds(result)).toEqual(['a', 'c']);
    // 짝 — 원본은 안 바뀌고, 결과는 새 배열이다.
    expect(poiIds(slots)).toEqual(['a', 'b', 'c', 'b']);
    expect(result).not.toBe(slots);
  });

  it('고정 슬롯은 같은 장소를 골라도 남는다 — 체크가 잠겨 있어 화면에 안 고른 카드다 (TRIP-1812 5-b W2)', () => {
    const fixed = slot('a', { isFixed: true });

    const result = removeSlots([fixed, slot('b'), slot('a')], ['a']);

    expect(result).toEqual([fixed, slot('b')]);
  });

  it('빈 poiIds 는 같은 내용의 새 배열이다', () => {
    const slots = [slot('a'), slot('b')];

    const result = removeSlots(slots, []);

    expect(poiIds(result)).toEqual(['a', 'b']);
    expect(result).not.toBe(slots);
  });
});

describe('M2 · deleteSlots 액션 — 해당 날만, 한 번의 set, dirty (TRIP-1791 AC-8)', () => {
  function seededTwoDays(): void {
    useItineraryEditStore.getState().seed([
      { date: DAY1, slots: [slot('a'), slot('b'), slot('c')] },
      { date: DAY2, slots: [slot('b'), slot('d')] },
    ]);
  }

  it('DAY1 에서 a·c 를 빼면 DAY1 만 줄고, 같은 poiId b 가 있는 DAY2 는 그대로이며 dirty 가 선다', () => {
    seededTwoDays();
    // 앵커 — 시드 직후엔 안 건드렸다.
    expect(useItineraryEditStore.getState().dirty).toBe(false);

    useItineraryEditStore.getState().deleteSlots(DAY1, ['a', 'c']);

    const { days, dirty } = useItineraryEditStore.getState();
    expect(poiIds(days[0].slots)).toEqual(['b']);
    expect(poiIds(days[1].slots)).toEqual(['b', 'd']);
    expect(dirty).toBe(true);
  });

  it('여러 곳을 한 번에 빼도 구독자는 한 번만 통지받는다 — 되돌리기 한 단계의 근거 (deleteSlot 반복은 N번)', () => {
    seededTwoDays();
    const listener = jest.fn();
    const unsubscribe = useItineraryEditStore.subscribe(listener);

    useItineraryEditStore.getState().deleteSlots(DAY1, ['a', 'c']);
    expect(listener).toHaveBeenCalledTimes(1);

    // 짝 — 한 곳씩 빼면 그만큼 통지된다(위 1회가 우연이 아니라는 대조).
    seededTwoDays();
    listener.mockClear();
    useItineraryEditStore.getState().deleteSlot(DAY1, 'a');
    useItineraryEditStore.getState().deleteSlot(DAY1, 'c');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('시드에 쓴 입력 배열은 안 바뀌고, 없는 날짜·없는 poiId 는 무해하다', () => {
    const day1Slots = [slot('a'), slot('b')];
    useItineraryEditStore.getState().seed([{ date: DAY1, slots: day1Slots }]);

    useItineraryEditStore.getState().deleteSlots(DAY1, ['a']);
    expect(poiIds(day1Slots)).toEqual(['a', 'b']);

    const before = poiIds(useItineraryEditStore.getState().days[0].slots);
    useItineraryEditStore.getState().deleteSlots('2099-01-01', ['b']);
    useItineraryEditStore.getState().deleteSlots(DAY1, ['nope']);
    expect(poiIds(useItineraryEditStore.getState().days[0].slots)).toEqual(
      before
    );
  });
});

/**
 * TRIP-1792 · 저장 전 되돌리기 — 스토어의 이력 규칙 (D1~D4, AC-1~3·6·8·9·11).
 *
 * 무엇을 보장하나: 편집 액션(삭제·묶음 삭제·재정렬·시각 조정)이 **직전 상태 한 장**을 이력에 쌓고,
 * `undo` 가 그 한 장을 `days`·`dirty` 와 함께 되돌리며 되돌린 날짜를 알려준다. 값이 안 바뀐 호출은 안 쌓고,
 * `insertSlot`·`seed`·`reset` 은 이력을 비운다. 낡은 안내 바 보호는 길이가 아니라 **단조 증가 id** 로 한다.
 *
 * > *(개념)* **이력(history) 스택** — 편집할 때마다 "하기 전 모습"을 한 장씩 위에 쌓아 두고, 되돌리기는 맨 위 한 장을
 * > 꺼내 현재로 되돌리는 방식. `undo(expectId)` 는 "맨 위 장의 번호가 expectId 일 때만" 꺼낸다(번호는 한 번 쓰면 다시 안 쓴다).
 *
 * 3동작 뼈대: 준비=reset+시드 → 실행=액션·undo 호출 → 단언=getState() 의 days·dirty·history.
 * 이력의 모양은 `history: {id, date, days, dirty}[]`(맨 끝 = 맨 위)다 — 길이로 쌓임을, 끝 항목의 id 로 낡은 바 가드를 잰다.
 */
describe('U · 되돌리기 이력 (TRIP-1792)', () => {
  /** 시각이 다른 3곳 + 2일차 1곳 — 시각 조정이 순서를 바꿀 수 있게 서로 떨어뜨린다. */
  function seeded(): void {
    useItineraryEditStore.getState().seed([
      {
        date: DAY1,
        slots: [
          slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
          slot('b', { startAt: '11:00:00', endAt: '12:00:00' }),
          slot('c', { startAt: '13:00:00', endAt: '14:00:00' }),
        ],
      },
      { date: DAY2, slots: [slot('d'), slot('e')] },
    ]);
  }
  const st = () => useItineraryEditStore.getState();
  const order = (date: string): string[] =>
    poiIds(st().days.find((d) => d.date === date)?.slots ?? []);
  const depth = (): number => st().history.length;
  const topId = (): number | undefined => st().history[depth() - 1]?.id;

  it('U1 · 끌어서 삭제 한 번 → undo 하면 같은 자리로 돌아오고 날짜를 알려준다 · 구독자는 한 번만 통지받는다 (AC-1)', () => {
    seeded();
    expect(depth()).toBe(0); // 앵커 — 편집 전엔 쌓인 게 없다
    st().deleteSlot(DAY1, 'b');
    expect(order(DAY1)).toEqual(['a', 'c']);
    expect(depth()).toBe(1);

    const listener = jest.fn();
    const unsubscribe = useItineraryEditStore.subscribe(listener);
    const date = st().undo();
    unsubscribe();

    expect(date).toBe(DAY1);
    expect(order(DAY1)).toEqual(['a', 'b', 'c']); // b 가 원래 가운데 자리로
    expect(depth()).toBe(0);
    // days·dirty·history 가 한 번의 set 으로 같이 바뀐다 — 중간 상태(days 만 돌아온 렌더)가 없다.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('U2 · 삭제 → 순서 바꾸기 → undo 두 번 → 처음 상태, 중간에는 삭제만 남은 상태다 (AC-2)', () => {
    seeded();
    const first = st().days;
    st().deleteSlot(DAY1, 'b');
    st().reorderSlots(DAY1, [
      st().days[0].slots[1], // c
      st().days[0].slots[0], // a
    ]);
    expect(order(DAY1)).toEqual(['c', 'a']);
    expect(depth()).toBe(2);

    st().undo();
    expect(order(DAY1)).toEqual(['a', 'c']); // 순서 바꾸기만 걷혔다
    expect(st().dirty).toBe(true); // 삭제는 아직 남아 있다
    st().undo();

    expect(st().days).toEqual(first); // 값이 처음과 같다
    expect(depth()).toBe(0);
  });

  it('U3 · 여러 곳 빼기(deleteSlots) 한 번은 한 단계다 — undo 한 번에 두 곳이 돌아온다 (AC-3)', () => {
    seeded();
    st().deleteSlots(DAY1, ['a', 'c']);
    expect(order(DAY1)).toEqual(['b']);
    expect(depth()).toBe(1);

    st().undo();

    expect(order(DAY1)).toEqual(['a', 'b', 'c']);
    expect(depth()).toBe(0);
  });

  it('U4 · 시각 조정도 쌓인다 — 순서가 재정렬됐어도 undo 가 옛 시각과 옛 순서를 돌려준다', () => {
    seeded();
    st().adjustSlotTime(DAY1, 'a', {
      startAt: '15:00:00',
      endAt: '16:00:00',
      endsNextDay: false,
    });
    expect(order(DAY1)).toEqual(['b', 'c', 'a']); // 시작 시각 순으로 다시 세워졌다
    expect(depth()).toBe(1);

    st().undo();

    expect(order(DAY1)).toEqual(['a', 'b', 'c']);
    expect(st().days[0].slots[0].startAt).toBe('09:00:00');
    expect(st().days[0].slots[0].endAt).toBe('10:00:00');
  });

  // 5-b W1 보강 — 시작은 그대로 두고 끝만(또는 자정 넘김만) 바꾼 편집도 "바뀐 것"이다.
  // 비교에서 endAt·endsNextDay 를 빼면 이 편집이 무변화로 취급돼 dirty 가 안 오르고 재시드로 사라진다.
  it.each([
    [
      '끝 시각만',
      { startAt: '09:00:00', endAt: '10:30:00', endsNextDay: false },
    ],
    [
      '자정 넘김만',
      { startAt: '09:00:00', endAt: '10:00:00', endsNextDay: true },
    ],
  ])('U4b · %s 바꾼 시각 조정도 쌓이고 dirty 가 오른다', (_label, patch) => {
    seeded();
    st().adjustSlotTime(DAY1, 'a', patch);
    expect(depth()).toBe(1);
    expect(st().dirty).toBe(true);
  });

  it.each([
    ['없는 poiId 삭제', () => st().deleteSlot(DAY1, 'nope')],
    ['없는 날짜 삭제', () => st().deleteSlot('2099-01-01', 'a')],
    ['빈 목록 묶음 삭제', () => st().deleteSlots(DAY1, [])],
    ['없는 poiId 묶음 삭제', () => st().deleteSlots(DAY1, ['nope', 'zzz'])],
    [
      '제자리에 놓은 끌기(같은 순서·새 객체)',
      () =>
        st().reorderSlots(
          DAY1,
          st().days[0].slots.map((s) => ({ ...s }))
        ),
    ],
    [
      '같은 시각으로 다시 적용',
      () =>
        st().adjustSlotTime(DAY1, 'b', {
          startAt: '11:00:00',
          endAt: '12:00:00',
          endsNextDay: false,
        }),
    ],
    [
      '없는 poiId 시각 조정',
      () =>
        st().adjustSlotTime(DAY1, 'nope', {
          startAt: '15:00:00',
          endAt: '16:00:00',
          endsNextDay: false,
        }),
    ],
  ])(
    'U5 · 값이 안 바뀌는 호출은 안 쌓고 dirty 도 안 올린다 — %s (D2)',
    (_n, act) => {
      seeded();

      act();

      expect(depth()).toBe(0);
      expect(st().dirty).toBe(false);
      expect(st().undo()).toBeNull();
      // 짝 — 진짜 변경은 쌓인다(위 0 이 "이력이 아예 안 쌓이는 구현" 때문이 아니라는 증거).
      st().deleteSlot(DAY1, 'a');
      expect(depth()).toBe(1);
    }
  );

  it('U6 · 처음 상태까지 되돌리면 dirty 도 false, 중간에서는 true 다 — 스냅샷에 dirty 가 들어 있다 (AC-6 · D4)', () => {
    seeded();
    st().deleteSlot(DAY1, 'a'); // 스냅샷: dirty false
    st().deleteSlot(DAY1, 'b'); // 스냅샷: dirty true
    expect(st().dirty).toBe(true);

    st().undo();
    expect(st().dirty).toBe(true); // 아직 a 삭제가 남아 있다
    st().undo();
    expect(st().dirty).toBe(false); // 처음 상태 = 저장할 것 없음
    expect(order(DAY1)).toEqual(['a', 'b', 'c']);
  });

  it('U7 · insertSlot(장소 추가)은 이력을 비우고 dirty 는 그대로 둔다 — 그 전 편집은 되돌릴 수 없다 (AC-8 · D1)', () => {
    seeded();
    st().deleteSlot(DAY1, 'a');
    expect(depth()).toBe(1);

    st().insertSlot(DAY1, slot('x', { startAt: '10:00:00' }), 1);

    expect(depth()).toBe(0);
    expect(st().dirty).toBe(true); // 저장 안 한 삭제는 여전히 저장 대상
    expect(order(DAY1)).toEqual(['b', 'x', 'c']);
    // 되돌릴 게 없다 — 서버가 이미 저장한 x 를 지우는 스냅샷으로 가는 길이 닫혔다.
    expect(st().undo()).toBeNull();
    expect(order(DAY1)).toEqual(['b', 'x', 'c']);
    // 짝 — 그 뒤의 새 편집은 다시 쌓인다.
    st().deleteSlot(DAY1, 'x');
    expect(depth()).toBe(1);
    st().undo();
    expect(order(DAY1)).toEqual(['b', 'x', 'c']);
  });

  it('U8 · seed·reset 은 이력을 비운다 — 저장 직후·편집기 재진입 뒤에 옛 편집이 되살아나지 않고, 번호는 비우지 않는다 (AC-8 · D2)', () => {
    seeded();
    st().deleteSlot(DAY1, 'a');
    expect(depth()).toBe(1);
    const idBeforeSeed = topId() as number;

    seeded(); // 서버 값으로 다시 채움(자기 저장 성공 · 조회 도착)

    expect(depth()).toBe(0);
    expect(st().undo()).toBeNull();

    st().deleteSlot(DAY1, 'a');
    expect(depth()).toBe(1);
    // 번호는 seed 로 되감기지 않는다 — 저장 전에 띄운 안내 바(옛 번호)가 저장 뒤 새 편집과 번호가 겹쳐 그 편집을 되돌리면 안 된다.
    expect(topId()).toBeGreaterThan(idBeforeSeed);
    expect(st().undo(idBeforeSeed)).toBeNull();
    const idBeforeReset = topId() as number;

    st().reset();
    expect(depth()).toBe(0);
    expect(st().undo()).toBeNull();
    // reset(편집기 언마운트)도 마찬가지 — 화면을 떠나도 안내 바는 최대 6초 남아 다음 편집기의 번호와 겹칠 수 있다.
    seeded();
    st().deleteSlot(DAY1, 'a');
    expect(topId()).toBeGreaterThan(idBeforeReset);
  });

  it('U9 · 낡은 id 로는 되돌리지 않는다 — 길이가 같아도 번호가 다르면 no-op, 번호는 재사용되지 않는다 (AC-11)', () => {
    seeded();
    st().deleteSlot(DAY1, 'b');
    const barId = topId() as number; // 안내 바가 쥐는 번호
    expect(typeof barId).toBe('number');

    st().undo(); // 머리 아이콘으로 먼저 되돌림 → 길이 0
    st().reorderSlots(DAY1, [
      st().days[0].slots[2],
      st().days[0].slots[0],
      st().days[0].slots[1],
    ]); // 다른 편집 → 길이는 다시 1
    expect(depth()).toBe(1);
    expect(topId()).toBeGreaterThan(barId); // 한 번 쓴 번호는 다시 안 쓴다

    expect(st().undo(barId)).toBeNull(); // 낡은 바 — 아무것도 안 한다
    expect(order(DAY1)).toEqual(['c', 'a', 'b']);
    expect(depth()).toBe(1);
    // 짝 — 맨 위 번호로 부르면 되돌린다. 번호를 안 주면(머리 아이콘) 무조건 맨 위.
    expect(st().undo(topId())).toBe(DAY1);
    expect(order(DAY1)).toEqual(['a', 'b', 'c']);
  });

  it('U10 · undo 는 그 편집이 일어난 날짜를 돌려준다 — 다른 날 편집이 섞여도 한 번에 한 날만 되돌린다 (AC-9 · D3)', () => {
    seeded();
    st().deleteSlot(DAY1, 'a');
    st().deleteSlot(DAY2, 'e');
    expect(order(DAY2)).toEqual(['d']);

    expect(st().undo()).toBe(DAY2);
    expect(order(DAY2)).toEqual(['d', 'e']);
    expect(order(DAY1)).toEqual(['b', 'c']); // 1일차 삭제는 아직 그대로
    expect(st().undo()).toBe(DAY1);
    expect(order(DAY1)).toEqual(['a', 'b', 'c']);
  });

  it('U11 · 이력이 빈 undo 는 아무 일도 하지 않고 null 이다 (AC-5 근거)', () => {
    seeded();
    const before = st().days;

    expect(st().undo()).toBeNull();
    expect(st().undo(1)).toBeNull();

    expect(st().days).toBe(before);
    expect(st().dirty).toBe(false);
  });
});

/**
 * TRIP-1793 · 다른 날로 옮기기 — 스토어 `moveSlot(fromDate, toDate, poiId, patch)` (Seed D4·D6, AC-1·3·5·7·8·9·11).
 *
 * 무엇을 보장하나: 장소 하나를 출발 날에서 빼 대상 날에 **한 번의 set** 으로 넣고(통지 1회 = 이력 1장 = 되돌리기 1단계),
 * 대상 날을 시작 시각 순으로 다시 세우며(서버가 순서 어긋남을 422 로 거절), 옮긴 슬롯에 `movedFromDate`(옮김 표식)를 단다.
 * 아무 일도 안 하는 호출(같은 날·없는 날·없는 장소·대상 날에 이미 같은 장소)은 상태·이력·통지가 전혀 안 변한다.
 *
 * > *(개념)* **옮김 표식(`movedFromDate`)** — 서버 데이터가 아니라 편집 초안 안의 꼬리표(포스트잇). 슬롯 안에 두기 때문에
 * > 되돌리기 이력(= days 통째 스냅샷)과 함께 되돌아가고, 저장 뒤 `seed` 가 서버 슬롯으로 덮으면 사라진다.
 *
 * 3동작 뼈대: 준비=reset+시드 → 실행=moveSlot(+undo/seed 등) → 단언=getState() 의 days·dirty·history·통지 횟수.
 */
describe('MV · moveSlot — 다른 날로 옮기기 (TRIP-1793)', () => {
  const DAY3 = '2026-06-12';
  const st = () => useItineraryEditStore.getState();
  const order = (date: string): string[] =>
    poiIds(st().days.find((d) => d.date === date)?.slots ?? []);
  const slotOf = (date: string, poiId: string): Slot | undefined =>
    st()
      .days.find((d) => d.date === date)
      ?.slots.find((s) => s.poiId === poiId);
  /** 옮김 표식 읽기 — 타입 선언이 아직 없어도 읽히게 단언으로 읽는다. */
  const movedOf = (s: Slot | undefined): string | undefined =>
    (s as (Slot & { movedFromDate?: string }) | undefined)?.movedFromDate;
  const allSlots = (): Slot[] => st().days.flatMap((d) => d.slots);

  const T = (startAt: string, endAt: string) => ({
    startAt,
    endAt,
    endsNextDay: false,
  });
  const P15 = T('15:00:00', '16:00:00');

  /** 입력 배열을 바깥에서 쥐고 있어야 "시드 원본 비파괴"를 잴 수 있다. */
  function seededThree() {
    const input = {
      d1: [
        slot('a', { startAt: '09:00:00', endAt: '10:00:00' }),
        slot('b', {
          startAt: '11:00:00',
          endAt: '12:00:00',
          nameKo: '이름-b',
          tags: ['바다'],
        }),
        slot('c', { startAt: '13:00:00', endAt: '14:00:00' }),
      ],
      d2: [
        slot('d', { startAt: '10:00:00', endAt: '11:00:00' }),
        slot('e', { startAt: '12:00:00', endAt: '13:00:00' }),
      ],
      d3: [slot('f', { startAt: '09:00:00', endAt: '10:00:00' })],
    };
    st().seed([
      { date: DAY1, slots: input.d1 },
      { date: DAY2, slots: input.d2 },
      { date: DAY3, slots: input.d3 },
    ]);
    return input;
  }

  it('MV1 · 1일차 b 를 2일차로 옮기면 1일차에서 빠지고 2일차 마지막에 고른 시각으로 들어간다 · 이력 1장 · 통지 1회 · 입력 비파괴 (AC-1·3·11)', () => {
    const input = seededThree();
    expect(st().history).toHaveLength(0); // 앵커 — 옮기기 전엔 이력 없음
    expect(st().dirty).toBe(false);
    const listener = jest.fn();
    const unsubscribe = useItineraryEditStore.subscribe(listener);

    st().moveSlot(DAY1, DAY2, 'b', P15);
    unsubscribe();

    expect(order(DAY1)).toEqual(['a', 'c']);
    expect(order(DAY2)).toEqual(['d', 'e', 'b']); // 2일차 마지막
    expect(order(DAY3)).toEqual(['f']); // 다른 날 무변화
    const moved = slotOf(DAY2, 'b') as Slot;
    expect([moved.startAt, moved.endAt, moved.endsNextDay]).toEqual([
      '15:00:00',
      '16:00:00',
      false,
    ]);
    expect(moved.nameKo).toBe('이름-b'); // 다른 필드는 그대로 따라온다
    expect(moved.tags).toEqual(['바다']);
    expect(movedOf(moved)).toBe(DAY1);
    expect(
      allSlots()
        .filter((s) => s.poiId !== 'b')
        .map(movedOf)
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(st().dirty).toBe(true);
    expect(st().history).toHaveLength(1);
    expect(st().history[0].date).toBe(DAY1); // 되돌리면 출발 날로 따라가게
    // days·dirty·history 가 한 번의 set 으로 같이 바뀐다 — deleteSlot+insertSlot 조합이면 2회.
    expect(listener).toHaveBeenCalledTimes(1);
    // 시드에 쓴 입력 배열·원본 슬롯 객체는 안 바뀐다.
    expect(poiIds(input.d1)).toEqual(['a', 'b', 'c']);
    expect(poiIds(input.d2)).toEqual(['d', 'e']);
    expect(movedOf(input.d1[1])).toBeUndefined();
    expect(input.d1[1].startAt).toBe('11:00:00');
  });

  it.each([
    {
      name: '대상 날 맨 앞(08:00)',
      start: ['08:00:00', '09:00:00'],
      want: ['b', 'd', 'e'],
    },
    {
      name: '대상 날 가운데(11:00)',
      start: ['11:00:00', '11:30:00'],
      want: ['d', 'b', 'e'],
    },
    {
      name: '대상 날 맨 뒤(15:00)',
      start: ['15:00:00', '16:00:00'],
      want: ['d', 'e', 'b'],
    },
  ])(
    'MV2 · $name 시각을 고르면 대상 날이 시작 시각 순으로 다시 서 있다 (AC-8)',
    ({ start, want }) => {
      seededThree();

      st().moveSlot(DAY1, DAY2, 'b', T(start[0], start[1]));

      expect(order(DAY2)).toEqual(want);
    }
  );

  describe.each([
    { name: '같은 날로', args: [DAY1, DAY1, 'b'] as const, dup: false },
    {
      name: '없는 출발 날에서',
      args: ['2099-01-01', DAY2, 'b'] as const,
      dup: false,
    },
    {
      name: '없는 대상 날로',
      args: [DAY1, '2099-01-01', 'b'] as const,
      dup: false,
    },
    {
      name: '출발 날에 없는 장소를',
      args: [DAY1, DAY2, 'zzz'] as const,
      dup: false,
    },
    {
      name: '대상 날에 이미 같은 장소가 있는데',
      args: [DAY1, DAY2, 'b'] as const,
      dup: true,
    },
  ])('MV3 · $name 옮기면', ({ args, dup }) => {
    it('아무 일도 안 한다 — days 같은 참조 · 이력 그대로(안 쌓임·안 비워짐) · dirty 그대로 · 통지 0 (AC-9)', () => {
      seededThree();
      if (dup) {
        st().seed([
          { date: DAY1, slots: [slot('a'), slot('b')] },
          { date: DAY2, slots: [slot('b'), slot('d')] },
        ]);
      }
      // 먼저 이력 1장을 쌓아 둔다 — "이력을 비우는" 구현(insertSlot 류)을 잡으려는 앵커.
      st().deleteSlot(DAY2, dup ? 'd' : 'e');
      expect(st().history).toHaveLength(1);
      const before = st().days;
      const listener = jest.fn();
      const unsubscribe = useItineraryEditStore.subscribe(listener);

      st().moveSlot(args[0], args[1], args[2], P15);
      unsubscribe();

      expect(st().days).toBe(before);
      expect(st().history).toHaveLength(1);
      expect(st().dirty).toBe(true); // 삭제가 올려 둔 값 그대로
      expect(listener).not.toHaveBeenCalled();
    });
  });

  it('MV4 · 옮기기는 정확히 한 단계다 — undo 한 번에 옮기기 직전 값으로 돌아오고 출발 날을 알려주며 표식도 사라진다 (AC-3)', () => {
    seededThree();
    st().deleteSlot(DAY2, 'e'); // 앞선 편집 1장
    const beforeMove = st().days;
    const depthBefore = st().history.length;

    st().moveSlot(DAY1, DAY2, 'b', P15);
    expect(st().history).toHaveLength(depthBefore + 1);
    expect(movedOf(slotOf(DAY2, 'b'))).toBe(DAY1);

    const date = st().undo();

    expect(date).toBe(DAY1);
    expect(st().days).toEqual(beforeMove); // 값이 옮기기 직전과 같다 — 원래 자리(1일차 가운데)·원래 시각
    expect(order(DAY1)).toEqual(['a', 'b', 'c']);
    expect(slotOf(DAY1, 'b')?.startAt).toBe('11:00:00');
    expect(
      allSlots()
        .map(movedOf)
        .filter((v) => v !== undefined)
    ).toEqual([]);
    expect(st().history).toHaveLength(depthBefore);
    expect(st().dirty).toBe(true); // 삭제는 아직 남아 있다
    st().undo();
    expect(order(DAY2)).toEqual(['d', 'e']); // 두 번째 undo 로 삭제도 걷힌다
    expect(st().dirty).toBe(false);
  });

  it('MV5 · 표식 규칙 — 처음 옮길 때 출발 날을 적고, 또 옮겨도 최초 출발 날을 유지하고, 원래 날로 돌아오면 지운다 (AC-7)', () => {
    seededThree();

    st().moveSlot(DAY1, DAY2, 'b', P15);
    expect(movedOf(slotOf(DAY2, 'b'))).toBe(DAY1);

    st().moveSlot(DAY2, DAY3, 'b', T('12:00:00', '13:00:00'));
    expect(order(DAY2)).toEqual(['d', 'e']);
    expect(order(DAY3)).toEqual(['f', 'b']);
    expect(movedOf(slotOf(DAY3, 'b'))).toBe(DAY1); // DAY2 로 덮어쓰지 않는다

    st().moveSlot(DAY3, DAY1, 'b', T('11:00:00', '12:00:00'));
    expect(order(DAY1)).toEqual(['a', 'b', 'c']); // 시각 순 제자리
    expect(movedOf(slotOf(DAY1, 'b'))).toBeUndefined(); // 원래 날로 돌아왔으니 표식 없음
    expect(st().history).toHaveLength(3);
  });

  it('MV6 · 다른 편집(시각 조정·순서 바꾸기·다른 곳 빼기)을 해도 옮김 표식은 유지된다 (AC-7)', () => {
    seededThree();
    st().moveSlot(DAY1, DAY2, 'b', P15);

    st().adjustSlotTime(DAY2, 'b', T('09:00:00', '09:30:00'));
    expect(order(DAY2)).toEqual(['b', 'd', 'e']); // 시각 순으로 다시 섰다
    expect(movedOf(slotOf(DAY2, 'b'))).toBe(DAY1);

    st().reorderSlots(DAY2, [...(st().days[1].slots as Slot[])].reverse());
    expect(order(DAY2)).toEqual(['e', 'd', 'b']);
    expect(movedOf(slotOf(DAY2, 'b'))).toBe(DAY1);

    st().deleteSlots(DAY2, ['e']);
    expect(movedOf(slotOf(DAY2, 'b'))).toBe(DAY1);
  });

  it('MV7 · 저장 성공으로 서버 응답을 다시 시드하면 표식이 사라지고 이력·dirty 도 비워진다 (AC-7)', () => {
    seededThree();
    st().moveSlot(DAY1, DAY2, 'b', P15);
    expect(movedOf(slotOf(DAY2, 'b'))).toBe(DAY1); // 앵커 — 시드 전엔 있다

    // 서버 응답 모양: 같은 자리에 b 가 있되 표식은 없다.
    st().seed([
      { date: DAY1, slots: [slot('a'), slot('c')] },
      { date: DAY2, slots: [slot('d'), slot('e'), slot('b', P15)] },
      { date: DAY3, slots: [slot('f')] },
    ]);

    expect(
      allSlots()
        .map(movedOf)
        .filter((v) => v !== undefined)
    ).toEqual([]);
    expect(st().history).toHaveLength(0);
    expect(st().dirty).toBe(false);
  });
});

/**
 * TRIP-1795 · 이 여행에서만 장소 이름·분류 고치기 — 스토어 `renameSlot(date, poiId, patch)` (Seed AC-9·AC-14).
 *
 * 무엇을 보장하나: 슬롯의 표시 이름·표시 분류(`displayName`·`displayCategory`)를 **두 칸 통째로** 바꾼다.
 * 값이 실제로 바뀌면 `dirty` + 이력 1장(↶ 1번에 복귀) + 통지 1회, 같은 값이면 state·이력·통지가 그대로다.
 * 장소 원본(`nameKo`·`category`)은 절대 안 바뀌고 다른 슬롯·다른 날도 안 바뀐다.
 *
 * > *(개념)* **정규화** — 사용자가 원본과 똑같은 이름을 입력하면 "덮어쓰기"를 만들지 않는다(null 로 저장). 그래야
 * > `원래대로` 버튼을 "덮어쓴 게 있나"로 켜고 끌 수 있다. 이름은 앞뒤 공백을 자르고 공백뿐이면 null.
 * > *(개념)* `undefined` 와 `null` 은 둘 다 "덮어쓰기 없음"이다 — 서버가 키를 빼든 null 을 주든 같은 값으로 본다.
 *
 * 3동작 뼈대: 준비=reset+시드(원본 이름·분류 있는 슬롯) → 실행=renameSlot(+undo) → 단언=getState() 의 days·dirty·history·통지 횟수.
 */
describe('RN · renameSlot — 표시 이름·분류 덮어쓰기 (TRIP-1795)', () => {
  const st = () => useItineraryEditStore.getState();
  const slotOf = (date: string, poiId: string): Slot =>
    st()
      .days.find((d) => d.date === date)!
      .slots.find((s) => s.poiId === poiId)!;
  const NONE = { displayName: null, displayCategory: null } as const;

  function seeded(): { d1: Slot[]; d2: Slot[] } {
    const input = {
      d1: [
        slot('a', { nameKo: '웨이브온', category: '맛집' }),
        slot('b', { nameKo: '광안리', category: '자연' }),
      ],
      // 같은 poiId 'a' 가 2일차에도 있다 — 고친 날만 바뀌어야 한다.
      d2: [slot('a', { nameKo: '웨이브온', category: '맛집' })],
    };
    st().seed([
      { date: DAY1, slots: input.d1 },
      { date: DAY2, slots: input.d2 },
    ]);
    return input;
  }

  it('RN1 · 이름·분류를 바꾸면 그 슬롯만 바뀌고 dirty·이력 1장·통지 1회, 원본 칸·이웃·다른 날은 그대로, ↶ 1번에 복귀한다', () => {
    seeded();
    expect(st().history).toHaveLength(0); // 앵커 — 고치기 전엔 이력 없음
    expect(st().dirty).toBe(false);
    const before = st().days;
    const listener = jest.fn();
    const unsubscribe = useItineraryEditStore.subscribe(listener);

    st().renameSlot(DAY1, 'a', {
      displayName: '우리 아지트',
      displayCategory: '카페',
    });
    unsubscribe();

    const a = slotOf(DAY1, 'a');
    expect(a.displayName).toBe('우리 아지트');
    expect(a.displayCategory).toBe('카페');
    expect(a.nameKo).toBe('웨이브온'); // 장소 원본은 안 바뀐다(INV-1)
    expect(a.category).toBe('맛집');
    expect(slotOf(DAY1, 'b').displayName ?? null).toBeNull(); // 이웃 불변
    expect(slotOf(DAY2, 'a').displayName ?? null).toBeNull(); // 같은 poiId 다른 날 불변
    expect(st().dirty).toBe(true);
    expect(st().history).toHaveLength(1);
    expect(st().history[0].date).toBe(DAY1);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(st().undo()).toBe(DAY1);
    expect(st().days).toBe(before);
    expect(slotOf(DAY1, 'a').displayName ?? null).toBeNull();
    expect(st().dirty).toBe(false);
  });

  it('RN2 · 같은 값 재적용·undefined↔null 만 다른 입력은 state 참조·이력·통지가 전혀 안 바뀐다 (sameSlots 가 두 칸을 ?? null 로 비교)', () => {
    st().seed([
      {
        date: DAY1,
        slots: [
          slot('a', {
            nameKo: '웨이브온',
            category: '맛집',
            displayName: '우리 아지트',
            displayCategory: '카페',
          }),
          // 서버가 null 을 명시한 슬롯과 키가 없는 슬롯 — 둘 다 "덮어쓰기 없음".
          slot('b', {
            nameKo: '광안리',
            category: '자연',
            displayName: null,
            displayCategory: null,
          }),
          slot('c', { nameKo: '해운대', category: '자연' }),
        ],
      },
    ]);
    const before = st().days;
    const listener = jest.fn();
    const unsubscribe = useItineraryEditStore.subscribe(listener);

    st().renameSlot(DAY1, 'a', {
      displayName: '우리 아지트',
      displayCategory: '카페',
    }); // 같은 값
    st().renameSlot(DAY1, 'b', NONE); // null → null
    st().renameSlot(DAY1, 'c', NONE); // undefined → null
    unsubscribe();

    expect(st().days).toBe(before);
    expect(st().history).toHaveLength(0);
    expect(st().dirty).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('RN3 · 정규화 — 이름이 원본과 같으면(앞뒤 공백 포함) null, 분류가 원본과 같으면 null, 이미 덮어쓴 슬롯에 원본값을 적용하면 해제로 이력 1장', () => {
    seeded();

    // 이름만 원본과 같음 + 분류는 진짜 바뀜 → 이름은 null·분류는 저장.
    st().renameSlot(DAY1, 'a', {
      displayName: ' 웨이브온 ',
      displayCategory: '카페',
    });
    expect(slotOf(DAY1, 'a').displayName ?? null).toBeNull();
    expect(slotOf(DAY1, 'a').displayCategory).toBe('카페');
    expect(st().history).toHaveLength(1);

    // 분류가 원본(맛집)과 같고 이름이 바뀜 → 분류는 null.
    st().renameSlot(DAY1, 'b', {
      displayName: '내 바다',
      displayCategory: '자연',
    });
    expect(slotOf(DAY1, 'b').displayName).toBe('내 바다');
    expect(slotOf(DAY1, 'b').displayCategory ?? null).toBeNull();
    expect(st().history).toHaveLength(2);

    // 이미 덮어쓴 a 에 원본값(이름·분류)을 적용 = 두 칸 해제 → 값이 바뀐 것이니 이력 1장.
    st().renameSlot(DAY1, 'a', {
      displayName: '웨이브온',
      displayCategory: '맛집',
    });
    expect(slotOf(DAY1, 'a').displayName ?? null).toBeNull();
    expect(slotOf(DAY1, 'a').displayCategory ?? null).toBeNull();
    expect(st().history).toHaveLength(3);
  });

  it('RN4 · 이름은 앞뒤 공백을 잘라 저장하고, 공백뿐인 이름은 null 이다', () => {
    seeded();

    st().renameSlot(DAY1, 'a', {
      displayName: '  우리 아지트  ',
      displayCategory: null,
    });
    expect(slotOf(DAY1, 'a').displayName).toBe('우리 아지트');

    st().renameSlot(DAY1, 'a', { displayName: '   ', displayCategory: null });
    expect(slotOf(DAY1, 'a').displayName ?? null).toBeNull();
  });

  it('RN5 · 분류만 바꿔도 dirty·이력 1장 · 원래대로(두 칸 null)는 덮어쓴 슬롯에서만 이력이 쌓이고 덮어쓴 게 없으면 무변화', () => {
    seeded();

    st().renameSlot(DAY1, 'a', { displayName: null, displayCategory: '야경' });
    expect(slotOf(DAY1, 'a').displayCategory).toBe('야경');
    expect(st().dirty).toBe(true);
    expect(st().history).toHaveLength(1);

    st().renameSlot(DAY1, 'a', NONE); // 원래대로
    expect(slotOf(DAY1, 'a').displayCategory ?? null).toBeNull();
    expect(st().history).toHaveLength(2);

    st().renameSlot(DAY1, 'a', NONE); // 덮어쓴 게 없는 슬롯에 원래대로
    expect(st().history).toHaveLength(2);
  });

  it('RN6 · 없는 날짜·없는 poiId 는 아무것도 안 한다 · 같은 poiId 가 여러 날에 있어도 지정한 날만 바뀐다', () => {
    seeded();
    const before = st().days;

    st().renameSlot('2099-01-01', 'a', {
      displayName: '유령',
      displayCategory: null,
    });
    st().renameSlot(DAY1, 'zzz', {
      displayName: '유령',
      displayCategory: null,
    });
    expect(st().days).toBe(before);
    expect(st().history).toHaveLength(0);

    st().renameSlot(DAY2, 'a', {
      displayName: '이튿날 이름',
      displayCategory: null,
    });
    expect(slotOf(DAY2, 'a').displayName).toBe('이튿날 이름');
    expect(slotOf(DAY1, 'a').displayName ?? null).toBeNull();
  });

  it('RN7 · seed 는 서버가 준 두 칸을 보존하고 입력 배열을 안 바꾼다 · moveSlot 으로 다른 날로 옮겨도 두 칸이 따라간다', () => {
    const input = [
      slot('a', {
        nameKo: '웨이브온',
        category: '맛집',
        displayName: '우리 아지트',
        displayCategory: '카페',
      }),
    ];
    const snapshot = JSON.stringify(input);
    st().seed([
      { date: DAY1, slots: input },
      { date: DAY2, slots: [] },
    ]);

    expect(slotOf(DAY1, 'a').displayName).toBe('우리 아지트');
    expect(slotOf(DAY1, 'a').displayCategory).toBe('카페');

    st().renameSlot(DAY1, 'a', {
      displayName: '바뀐 이름',
      displayCategory: '카페',
    });
    expect(JSON.stringify(input)).toBe(snapshot); // 시드 원본 비파괴

    st().moveSlot(DAY1, DAY2, 'a', {
      startAt: '15:00:00',
      endAt: '16:00:00',
      endsNextDay: false,
    });
    expect(slotOf(DAY2, 'a').displayName).toBe('바뀐 이름');
    expect(slotOf(DAY2, 'a').displayCategory).toBe('카페');
  });
});

/**
 * TRIP-1812 · 같은 날 같은 장소 — 끝 인자 `ordinal`(앞선 같은 장소 수)로 **눌린 그 카드**만 다룬다.
 * 인자를 안 주면 0 이라 같은 장소가 없는 일정은 지금과 같다(위 S·MV·RN 이 그 그물이다, AC-6).
 * 시각 조정은 `itineraryEditStore.adjustTime.test.ts` SA12.
 *
 * 3동작: 준비(같은 장소가 낀·붙은 날 시드) → 실행(액션 + ordinal) → 단언(남은 시각·표시 이름·다른 날·이력).
 */
describe('SP · 같은 장소의 ordinal 자리 (TRIP-1812)', () => {
  const st = () => useItineraryEditStore.getState();
  const at = (poiId: string, startAt: string, over: Partial<Slot> = {}): Slot =>
    slot(poiId, { startAt, ...over });
  const starts = (slots: Slot[]): string[] => slots.map((s) => s.startAt);
  const day = (date: string): Slot[] =>
    st().days.find((d) => d.date === date)?.slots ?? [];
  /** [p1 09, p2 12, p1 14, p1 16] — 가운데 p1(ordinal 1)이 첫 일치·마지막 일치 어느 쪽도 아니다. */
  const woven = () => [
    at('p1', '09:00:00'),
    at('p2', '12:00:00'),
    at('p1', '14:00:00'),
    at('p1', '16:00:00'),
  ];
  const adjacent = () => [
    at('p1', '09:00:00'),
    at('p1', '11:00:00'),
    at('p2', '14:00:00'),
  ];
  const P = { startAt: '15:00:00', endAt: '16:00:00', endsNextDay: false };

  it('SP1 · removeSlot 은 ordinal 자리만 뺀다 — 없는 ordinal 은 값이 같은 새 배열, 원본은 안 바뀐다', () => {
    const slots = woven();

    expect(starts(removeSlot(slots, 'p1', 1))).toEqual([
      '09:00:00',
      '12:00:00',
      '16:00:00',
    ]);
    expect(starts(removeSlot(slots, 'p1', 2))).toEqual([
      '09:00:00',
      '12:00:00',
      '14:00:00',
    ]);
    expect(starts(removeSlot(slots, 'p1', 0))).toEqual([
      '12:00:00',
      '14:00:00',
      '16:00:00',
    ]);
    expect(starts(removeSlot(adjacent(), 'p1', 1))).toEqual([
      '09:00:00',
      '14:00:00',
    ]);

    const missing = removeSlot(slots, 'p1', 3);
    expect(missing).not.toBe(slots);
    expect(missing).toEqual(slots);
    expect(slots).toHaveLength(4);
  });

  it('SP2 · deleteSlot(AC-3) — 그 날 ordinal 자리만 빠지고 되돌리기 1단계로 돌아온다, 없는 ordinal 은 state 그대로', () => {
    st().seed([
      { date: DAY1, slots: woven() },
      { date: DAY2, slots: [at('p1', '10:00:00')] },
    ]);
    const before = st().days;

    st().deleteSlot(DAY1, 'p1', 5);
    expect(st().days).toBe(before);
    expect(st().history).toHaveLength(0);

    st().deleteSlot(DAY1, 'p1', 1);
    expect(starts(day(DAY1))).toEqual(['09:00:00', '12:00:00', '16:00:00']);
    expect(starts(day(DAY2))).toEqual(['10:00:00']);
    expect(st().dirty).toBe(true);
    expect(st().history).toHaveLength(1);

    expect(st().undo()).toBe(DAY1);
    expect(starts(day(DAY1))).toEqual([
      '09:00:00',
      '12:00:00',
      '14:00:00',
      '16:00:00',
    ]);
    expect(st().history).toHaveLength(0);
  });

  it('SP3 · moveSlot(AC-4) — ordinal 자리의 슬롯이 옮겨 가고 첫째는 남는다, 없는 ordinal 은 state 그대로', () => {
    st().seed([
      {
        date: DAY1,
        slots: [
          at('p1', '09:00:00', { displayName: '첫째' }),
          at('p2', '12:00:00'),
          at('p1', '14:00:00', { displayName: '둘째' }),
        ],
      },
      { date: DAY2, slots: [at('x', '10:00:00')] },
    ]);
    const before = st().days;

    st().moveSlot(DAY1, DAY2, 'p1', P, 5);
    expect(st().days).toBe(before);

    st().moveSlot(DAY1, DAY2, 'p1', P, 1);
    expect(day(DAY1).map((s) => s.displayName ?? s.poiId)).toEqual([
      '첫째',
      'p2',
    ]);
    expect(day(DAY2).map((s) => [s.displayName ?? s.poiId, s.startAt])).toEqual(
      [
        ['x', '10:00:00'],
        ['둘째', '15:00:00'],
      ]
    );
    expect(st().history).toHaveLength(1);
  });

  it('SP3b · moveSlot 은 ordinal 을 안 주면 첫째가 옮겨 간다 — 시드의 뒤 카드는 남는다', () => {
    st().seed([
      {
        date: DAY1,
        slots: [
          at('p1', '09:00:00', { displayName: '첫째' }),
          at('p1', '14:00:00', { displayName: '둘째' }),
        ],
      },
      { date: DAY2, slots: [] },
    ]);

    st().moveSlot(DAY1, DAY2, 'p1', P);

    expect(day(DAY1).map((s) => s.displayName)).toEqual(['둘째']);
    expect(day(DAY2).map((s) => s.displayName)).toEqual(['첫째']);
  });

  it('SP4 · renameSlot(AC-4) — ordinal 자리만 표시 이름이 바뀐다, 없는 ordinal 은 state 그대로', () => {
    st().seed([{ date: DAY1, slots: woven() }]);
    const before = st().days;
    const PATCH = { displayName: '뒤 카드', displayCategory: null };

    st().renameSlot(DAY1, 'p1', PATCH, 5);
    expect(st().days).toBe(before);

    st().renameSlot(DAY1, 'p1', PATCH, 1);
    expect(day(DAY1).map((s) => s.displayName ?? null)).toEqual([
      null,
      null,
      '뒤 카드',
      null,
    ]);
    expect(st().history).toHaveLength(1);
  });

  it('SP5 · deleteSlots(AC-11) 는 장소 단위 그대로다 — ["p1","p1"] 을 받아도 p1 전부가 빠지고 이력 1장', () => {
    st().seed([{ date: DAY1, slots: woven() }]);

    st().deleteSlots(DAY1, ['p1', 'p1', 'p1']);

    expect(day(DAY1).map((s) => s.poiId)).toEqual(['p2']);
    expect(st().history).toHaveLength(1);
  });
});
