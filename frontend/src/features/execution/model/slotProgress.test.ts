import fc from 'fast-check';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { projectSlotProgress } from './slotProgress';

/**
 * TRIP-395 · slotProgress — 슬롯 상태 사영(완료·진행 중·예정)의 단위·속성 심판.
 *
 * *(개념)* **상태 사영(projection)** = 슬롯 목록을 받아 각 슬롯에 "지금 어떤 단계인가" 라벨을
 * 붙여 돌려주는 순수 함수. 시각을 새로 만들지 않고(재추정 금지 · BR-U4-34), 진행 상태는
 * **방문 기록**(완료된 poiId · 현재 진행 poiId)에서 온다. i01 "기록 없음" 기본 = 기록 0 →
 * 전부 `예정(upcoming)`.
 *
 * 3동작 뼈대: 준비=슬롯 배열 + progress 입력 → 실행=projectSlotProgress → 단언=state 라벨.
 */

/** HH:mm:ss 문자열을 만든다 — 초 단위 정수를 시:분:초로 편성(구조가드가 금하는 시각 산술이
 * 아니라, 테스트 픽스처 생성일 뿐이라 여기선 허용된다 — 소스가 아니다). */
const SECONDS_PER_DAY = 24 * 60 * 60;
const toHms = (n: number): string => {
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};
const hmsArb = fc.integer({ min: 0, max: SECONDS_PER_DAY - 1 }).map(toHms);

const slotArb: fc.Arbitrary<ItineraryDaysItemSlotsItem> = fc.record({
  poiId: fc.string({ minLength: 1 }),
  startAt: hmsArb,
  endAt: hmsArb,
  isFixed: fc.boolean(),
  endsNextDay: fc.boolean(),
  hasViolation: fc.boolean(),
  tags: fc.array(fc.string()),
});

const slot = (
  poiId: string,
  startAt = '09:00:00',
  endAt = '10:00:00'
): ItineraryDaysItemSlotsItem => ({
  poiId,
  startAt,
  endAt,
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [],
});

describe('projectSlotProgress — 상태 사영', () => {
  it('A2-1 기본(기록 없음)이면 전 슬롯이 예정(upcoming)이다', () => {
    // 준비: 슬롯 3개, progress 입력 없음(i01 default = "기록 없음")
    const slots = [slot('a'), slot('b'), slot('c')];

    // 실행
    const projected = projectSlotProgress(slots);

    // 단언: 전부 upcoming, 순서·개수 보존
    expect(projected.map((p) => p.state)).toEqual([
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(projected.map((p) => p.slot.poiId)).toEqual(['a', 'b', 'c']);
  });

  it('A2-2 completedPoiIds에 든 슬롯은 완료(done)다', () => {
    const slots = [slot('a'), slot('b'), slot('c')];

    const projected = projectSlotProgress(slots, {
      completedPoiIds: ['a', 'c'],
    });

    expect(projected.map((p) => p.state)).toEqual(['done', 'upcoming', 'done']);
  });

  it('A2-3 activePoiId 슬롯은 진행 중(active)이다', () => {
    const slots = [slot('a'), slot('b'), slot('c')];

    const projected = projectSlotProgress(slots, { activePoiId: 'b' });

    expect(projected.map((p) => p.state)).toEqual([
      'upcoming',
      'active',
      'upcoming',
    ]);
  });

  it('A2-4 완료가 진행 중보다 우선한다 (같은 poiId가 둘 다면 done)', () => {
    const slots = [slot('a')];

    const projected = projectSlotProgress(slots, {
      completedPoiIds: ['a'],
      activePoiId: 'a',
    });

    expect(projected[0].state).toBe('done');
  });

  it('PBT-U4-F1 시각 무추정 — 임의 slots·progress에서 출력 시각 문자열은 입력 집합의 부분집합이다', () => {
    // 이 속성이 "클라가 도착 시각을 재추정하지 않는다"(BR-U4-34)를 강제한다. 통과만 하므로
    // 항상 참이되, slotProgress가 startAt/endAt에 산술을 넣는 순간 red가 된다.
    const progressArb = fc.record({
      completedPoiIds: fc.option(fc.array(fc.string()), { nil: undefined }),
      activePoiId: fc.option(fc.string(), { nil: undefined }),
    });

    fc.assert(
      fc.property(fc.array(slotArb), progressArb, (slots, progress) => {
        const projected = projectSlotProgress(slots, progress);

        const inputTimes = new Set(slots.flatMap((s) => [s.startAt, s.endAt]));
        const outputTimes = projected.flatMap((p) => [
          p.slot.startAt,
          p.slot.endAt,
        ]);

        for (const t of outputTimes) {
          expect(inputTimes.has(t)).toBe(true);
        }
      })
    );
  });
});
