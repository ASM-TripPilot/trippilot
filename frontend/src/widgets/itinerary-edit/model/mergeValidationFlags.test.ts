import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import { mergeValidationFlags } from './mergeValidationFlags';

/**
 * TRIP-443 · AC-3(BR-U4-45) — 복구 방어 순수 머지. 서버 재검증 결과에서 **위반 플래그만** 취하고
 * 편집 본문(poiId·startAt·endAt·슬롯 순서·isFixed)은 로컬 편집값을 유지하는지 잠근다.
 *
 * 무엇을 보장하나: 외부 API 복구 후 자동 재검증이 돌아도 사용자의 손편집이 서버 recalc로 덮이지
 * 않는다 — `hasViolation`/`violationReason`만 (date,poiId) 일치로 병합, 나머지는 로컬 권위.
 *
 * *(개념)* **순수함수** — 같은 입력이면 같은 출력, 바깥 상태를 안 건드림. 렌더·훅 없이 값만 잰다.
 * 3동작 뼈대: 준비=local/server days 조립 → 실행=`mergeValidationFlags` → 단언=반환 days 값.
 *
 * ★ red 뮤테이션(02a ★3): 머지가 startAt/순서/poiId를 서버값으로 덮거나 배열을 통째 교체하면
 *   M2·M3가 red. 스텁 `return localDays`는 M1(서버 위반 미반영)에서 이미 red.
 */

type Slot = ItineraryDaysItemSlotsItem;

const DAY1 = '2026-06-11';
const DAY2 = '2026-06-12';

/** 필수 6필드만 채운 슬롯 팩토리(itineraryEditStore.test.ts 선례). */
function slot(poiId: string, over: Partial<Slot> = {}): Slot {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

function day(date: string, slots: Slot[]): ItineraryDaysItem {
  return { date, slots };
}

function poiIds(slots: Slot[]): string[] {
  return slots.map((s) => s.poiId);
}

describe('M1 · 서버 위반 플래그가 이긴다 (AC-2 계약의 순수 근거)', () => {
  it('서버 hasViolation=true 를 로컬에 얹고, 후속 응답이 false 면 소멸시킨다', () => {
    const local = [day(DAY1, [slot('a', { hasViolation: false })])];

    // 서버가 a 를 위반 플래그
    const flagged = mergeValidationFlags(local, [
      day(DAY1, [
        slot('a', {
          hasViolation: true,
          violationReason: '숙소 체크인 충돌',
        }),
      ]),
    ]);
    expect(flagged[0].slots[0].hasViolation).toBe(true);
    expect(flagged[0].slots[0].violationReason).toBe('숙소 체크인 충돌');

    // 후속 응답이 위반을 지우면 배지도 사라진다(클라 로컬 재계산 아님).
    const localFlagged = [
      day(DAY1, [slot('a', { hasViolation: true, violationReason: 'x' })]),
    ];
    const cleared = mergeValidationFlags(localFlagged, [
      day(DAY1, [slot('a', { hasViolation: false })]),
    ]);
    expect(cleared[0].slots[0].hasViolation).toBe(false);
    expect(cleared[0].slots[0].violationReason ?? null).toBeNull();
  });
});

describe('M2 · 로컬 본문 유지 — 시각·poiId 는 서버값으로 안 덮인다 (★red 뮤테이션)', () => {
  it('local startAt/endAt/poiId 가 그대로 남는다(서버가 다른 값을 줘도)', () => {
    const local = [
      day(DAY1, [slot('a', { startAt: '09:00:00', endAt: '10:00:00' })]),
    ];
    const server = [
      day(DAY1, [
        slot('a', {
          startAt: '14:00:00',
          endAt: '15:30:00',
          hasViolation: true,
        }),
      ]),
    ];

    const merged = mergeValidationFlags(local, server);

    // 본문은 로컬 — 서버 시각이 새어 들어오면 red(머지가 startAt 을 덮은 것).
    expect(merged[0].slots[0].startAt).toBe('09:00:00');
    expect(merged[0].slots[0].endAt).toBe('10:00:00');
    expect(merged[0].slots[0].poiId).toBe('a');
    // 위반만 서버에서 옴(짝).
    expect(merged[0].slots[0].hasViolation).toBe(true);
  });
});

describe('M3 · 슬롯 순서 유지 — 서버 순서/배열 통째 교체 금지 (★red 뮤테이션)', () => {
  it('로컬 순서 [a,b] 가 서버 순서 [b,a] 로 뒤집히지 않는다', () => {
    const local = [day(DAY1, [slot('a'), slot('b')])];
    const server = [
      day(DAY1, [
        slot('b', { hasViolation: true }),
        slot('a', { hasViolation: false }),
      ]),
    ];

    const merged = mergeValidationFlags(local, server);

    // 순서는 로컬 — 서버 순서를 취하거나 배열을 통째 교체하면 ['b','a'] 가 되어 red.
    expect(poiIds(merged[0].slots)).toEqual(['a', 'b']);
    // 위반은 poiId 로 정확히 매칭돼 b 에 붙는다(순서가 아니라 키 매칭).
    expect(merged[0].slots[0].hasViolation).toBe(false); // a
    expect(merged[0].slots[1].hasViolation).toBe(true); // b
  });
});

describe('M4 · isFixed 유지 — 로컬 고정 표식이 서버값으로 안 덮인다', () => {
  it('local isFixed=true 가 서버 false 에도 유지된다', () => {
    const local = [day(DAY1, [slot('a', { isFixed: true })])];
    const server = [
      day(DAY1, [slot('a', { isFixed: false, hasViolation: true })]),
    ];

    const merged = mergeValidationFlags(local, server);

    expect(merged[0].slots[0].isFixed).toBe(true);
  });
});

describe('M5 · 매칭 없음 — 서버 잉여 슬롯은 버리고, 서버 침묵은 위반 없음', () => {
  it('서버에만 있는 슬롯은 결과에 안 들어오고, 로컬에만 있는 슬롯은 hasViolation=false', () => {
    const local = [
      day(DAY1, [slot('a', { hasViolation: true, violationReason: 'stale' })]),
    ];
    // 서버가 a 를 안 주고 엉뚱한 z 만 준다(형/순서는 로컬이 권위).
    const server = [day(DAY1, [slot('z', { hasViolation: true })])];

    const merged = mergeValidationFlags(local, server);

    // 로컬 형 유지 — z 는 안 들어온다.
    expect(poiIds(merged[0].slots)).toEqual(['a']);
    // 서버가 a 를 언급 안 함 = 위반 없음(과거 로컬 stale 플래그를 걷어낸다).
    expect(merged[0].slots[0].hasViolation).toBe(false);
    expect(merged[0].slots[0].violationReason ?? null).toBeNull();
  });
});

describe('M6 · date 가 매칭 키의 일부 — 다른 날 플래그가 안 샌다', () => {
  it('같은 poiId 라도 day1/day2 를 date 로 갈라 각자 서버 플래그를 받는다', () => {
    const local = [day(DAY1, [slot('a')]), day(DAY2, [slot('a')])];
    const server = [
      day(DAY1, [slot('a', { hasViolation: true })]),
      day(DAY2, [slot('a', { hasViolation: false })]),
    ];

    const merged = mergeValidationFlags(local, server);

    expect(merged[0].slots[0].hasViolation).toBe(true); // day1 a
    expect(merged[1].slots[0].hasViolation).toBe(false); // day2 a
  });
});
