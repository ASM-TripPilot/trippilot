import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import {
  removeSlot,
  reorderKeepingFixed,
  useItineraryEditStore,
} from './itineraryEditStore';

/**
 * TRIP-302 · h24 편집 스토어 (슬라이스1 · AC3 삭제 · AC4 재정렬 · AC5 · 엣지1 고정잠금 · 엣지5).
 *
 * 무엇을 보장하나: 편집 화면 밖에 사는 **편집 드래프트 상자**가
 *  ① 삭제·재정렬을 **입력 배열 → 새 배열** 순수 변환으로 처리하고(AC5),
 *  ② **고정 슬롯은 재정렬에서 원래 자리를 지키며**(엣지1 — 드래그 제스처는 jest 로 못 태우니
 *     재정렬 수학을 여기서 잠근다, 02a ★1·★2),
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

describe('S2 · reorderKeepingFixed 순수 — 고정은 원래 자리 고수 (AC4 · 엣지1)', () => {
  it('고정이 없으면 reordered 그대로, 있으면 고정을 절대 인덱스에 재고정한다', () => {
    // 고정 없음 → reordered 그대로(배열 순서 = 슬롯 순서, INV-U3-02).
    const plain = [slot('a'), slot('b'), slot('c')];
    expect(
      poiIds(reorderKeepingFixed(plain, [plain[2], plain[0], plain[1]]))
    ).toEqual(['c', 'a', 'b']);

    // 고정 F 가 index 0 — lib 이 F 를 뒤로 민 reordered 를 줘도 F 는 index 0 유지.
    const withHead = [slot('F', { isFixed: true }), slot('a'), slot('b')];
    expect(
      poiIds(
        reorderKeepingFixed(withHead, [withHead[1], withHead[2], withHead[0]])
      )
    ).toEqual(['F', 'a', 'b']);
    // 비고정 순서는 reordered 를 따른다([b, a]).
    expect(
      poiIds(
        reorderKeepingFixed(withHead, [withHead[2], withHead[0], withHead[1]])
      )
    ).toEqual(['F', 'b', 'a']);

    // 고정 F 가 index 2(맨 끝 앵커) — 어떤 reordered 에도 index 2 유지, 비고정만 [b, a].
    const withTail = [slot('a'), slot('b'), slot('F', { isFixed: true })];
    expect(
      poiIds(
        reorderKeepingFixed(withTail, [withTail[2], withTail[1], withTail[0]])
      )
    ).toEqual(['b', 'a', 'F']);
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

describe('S5 · reorderSlots — 활성 날 순서 반영, 고정 재고정 (AC4 · 엣지1)', () => {
  it('lib 이 준 재정렬 data 를 받아 고정은 자리를 지키고 비고정만 다시 쌓는다', () => {
    const F = slot('F', { isFixed: true });
    const a = slot('a');
    const b = slot('b');
    useItineraryEditStore.getState().seed([
      { date: DAY1, slots: [F, a, b] },
      { date: DAY2, slots: [slot('c')] },
    ]);

    // 사용자가 b 를 위로 끌어 lib 이 [b, F, a] 를 넘겼다 — 고정 F 는 index 0 을 지켜야 한다.
    useItineraryEditStore.getState().reorderSlots(DAY1, [b, F, a]);

    const days = useItineraryEditStore.getState().days;
    expect(poiIds(days[0].slots)).toEqual(['F', 'b', 'a']); // 고정 재고정 + 비고정 [b,a]
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
