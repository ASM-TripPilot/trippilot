import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/index.schemas';

import { removeSlot, useItineraryEditStore } from './itineraryEditStore';

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
