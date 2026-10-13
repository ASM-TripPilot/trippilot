import fc from 'fast-check';

import type { BaseAssignment } from '@/shared/api/index.schemas';

import { basesChanged } from './basesChanged';

/**
 * TRIP-1082 · 01b "변경 판정" — 거점 편집 화면의 [완료]가 "거점이 실제로 바뀌었나"를 묻는 순수 함수.
 *
 * 왜 필요한가: 지정은 교체(DELETE→자투리 재POST→새 POST)라 **행 id·행 수가 바뀌어도 밤의 숙소는 그대로**일
 * 수 있다(A→B→A, 여러 밤 배정 쪼개기). 반대로 부분 실패는 행이 줄어 **밤이 빈다**. 그래서 행이 아니라
 * "밤 → 숙소" 지도로 비교한다(브리프 §판정).
 *
 * 무엇을 보장하나(속성, 임의 배정·분할·순서에 대해):
 *  - P1 한 배정을 임의 지점에서 같은 숙소 두 행으로 쪼개도 '변경 없음'.
 *  - P2 행 순서를 섞고 id 를 새로 붙여도 '변경 없음'.
 *  - P3 밤 하나의 숙소를 바꾸면 '변경 있음'.
 *  - P4 두 "밤 지도"를 어떻게 행으로 인코딩하든, 결과는 "지도가 다르다"와 같다(전체 오라클).
 *
 * 커버하지 않는 것: 겹치는 배정(서버 OVERLAP 상태) — 그 밤의 숙소가 정의되지 않아 생성기가 만들지 않는다.
 *
 * 3동작: 준비(두 배정 목록) → 실행(basesChanged 1회) → 단언(불린).
 */

// ── 날짜 오라클 (구현과 다른 길 — Date.UTC 로 계산) ─────────────────────────────

/** 2026-09-20 에서 offset 일 뒤의 ISO 날짜. 9월 말 → 10월 경계가 생성기에 들어온다. */
function iso(offset: number): string {
  return new Date(Date.UTC(2026, 8, 20 + offset)).toISOString().slice(0, 10);
}

function row(
  baseAssignmentId: string,
  savedStayId: string,
  dateFrom: string,
  dateTo: string
): BaseAssignment {
  return { baseAssignmentId, savedStayId, dateFrom, dateTo };
}

// ── 예시 ──────────────────────────────────────────────────────────────────────

describe('예시 · 밤 단위로 비교한다', () => {
  it('같은 목록이면 변경 없음', () => {
    const rows = [row('a', 'stay-a', '2026-09-26', '2026-09-28')];

    expect(basesChanged(rows, rows)).toBe(false);
  });

  it('둘 다 비어 있으면 변경 없음', () => {
    expect(basesChanged([], [])).toBe(false);
  });

  it('A 2박 한 행이 A 1박 두 행(새 id)으로 쪼개져도 변경 없음 — 교체의 자투리 재지정', () => {
    const before = [row('a', 'stay-a', '2026-09-26', '2026-09-28')];
    const after = [
      row('new-2', 'stay-a', '2026-09-27', '2026-09-28'),
      row('new-3', 'stay-a', '2026-09-26', '2026-09-27'),
    ];

    expect(basesChanged(before, after)).toBe(false);
  });

  it('한 밤의 숙소가 A → B 면 변경 있음', () => {
    const before = [row('a1', 'stay-a', '2026-09-26', '2026-09-27')];
    const after = [row('new-1', 'stay-b', '2026-09-26', '2026-09-27')];

    expect(basesChanged(before, after)).toBe(true);
  });

  it('부분 실패로 밤이 비면(지우기만 성공) 변경 있음', () => {
    const before = [row('a1', 'stay-a', '2026-09-26', '2026-09-27')];

    expect(basesChanged(before, [])).toBe(true);
  });

  it('월 경계를 넘는 배정도 밤으로 편다 — 9/30–10/2 한 행 = 9/30·10/1 두 행', () => {
    const before = [row('a', 'stay-a', '2026-09-30', '2026-10-02')];
    const after = [
      row('x', 'stay-a', '2026-09-30', '2026-10-01'),
      row('y', 'stay-a', '2026-10-01', '2026-10-02'),
    ];

    expect(basesChanged(before, after)).toBe(false);
  });

  it('월 경계 뒤 밤(10/1)이 사라지면 변경 있음', () => {
    const before = [row('a', 'stay-a', '2026-09-30', '2026-10-02')];
    const after = [row('x', 'stay-a', '2026-09-30', '2026-10-01')];

    expect(basesChanged(before, after)).toBe(true);
  });
});

// ── 속성 ──────────────────────────────────────────────────────────────────────

/** 밤 지도 — 시작 오프셋과 밤마다의 숙소(null = 미정). 겹침이 없음을 구성으로 보장한다. */
interface NightMap {
  start: number;
  slots: (string | null)[];
}

const STAYS = ['stay-1', 'stay-2', 'stay-3'] as const;

const nightMapArb: fc.Arbitrary<NightMap> = fc.record({
  start: fc.integer({ min: 0, max: 20 }),
  slots: fc.array(fc.option(fc.constantFrom(...STAYS), { nil: null }), {
    maxLength: 12,
  }),
});

/** 오라클 — 지도를 "밤 ISO=숙소" 문자열 집합으로. 두 지도가 같은지는 이것끼리 비교한다. */
function nightEntries(map: NightMap): string[] {
  return map.slots.flatMap((stay, index) =>
    stay === null ? [] : [`${iso(map.start + index)}=${stay}`]
  );
}

/** 결정론적 섞기(시드 기반 LCG + Fisher–Yates) — 행 순서를 흔든다. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 지도를 행 목록으로 인코딩한다. 같은 숙소가 이어지는 구간을 한 행으로 묶되, `cuts[i]` 가 참인
 * 밤 경계에서는 같은 숙소여도 행을 끊는다(분할). 그 뒤 순서를 섞고 id 를 접두+번호로 새로 붙인다.
 */
function encode(
  map: NightMap,
  cuts: readonly boolean[],
  seed: number,
  idPrefix: string
): BaseAssignment[] {
  const runs: { stay: string; from: number; to: number }[] = [];
  map.slots.forEach((stay, index) => {
    if (stay === null) return;
    const last = runs[runs.length - 1];
    const continues =
      last !== undefined &&
      last.stay === stay &&
      last.to === index &&
      cuts[index] !== true;
    if (continues) {
      last.to = index + 1;
    } else {
      runs.push({ stay, from: index, to: index + 1 });
    }
  });
  return shuffled(runs, seed).map((run, n) =>
    row(
      `${idPrefix}-${n}`,
      run.stay,
      iso(map.start + run.from),
      iso(map.start + run.to)
    )
  );
}

const cutsArb = fc.array(fc.boolean(), { minLength: 12, maxLength: 12 });
const seedArb = fc.integer({ min: 0, max: 0x7fffffff });

describe('속성 · 행 모양과 무관하게 밤의 숙소만 본다 (fast-check)', () => {
  it('P1 같은 숙소 행을 임의 지점에서 쪼개도 변경 없음', () => {
    fc.assert(
      fc.property(nightMapArb, cutsArb, (map, cuts) => {
        const before = encode(map, [], 0, 'b');
        const after = encode(map, cuts, 0, 'a');

        expect(basesChanged(before, after)).toBe(false);
      })
    );
  });

  it('P2 행 순서를 섞고 id 를 새로 붙여도 변경 없음', () => {
    fc.assert(
      fc.property(nightMapArb, seedArb, seedArb, (map, s1, s2) => {
        const before = encode(map, [], s1, 'b');
        const after = encode(map, [], s2, 'a');

        expect(basesChanged(before, after)).toBe(false);
      })
    );
  });

  it('P3 밤 하나의 숙소를 다른 숙소로 바꾸면 변경 있음', () => {
    const withAssigned = nightMapArb.filter((map) =>
      map.slots.some((stay) => stay !== null)
    );
    fc.assert(
      fc.property(
        withAssigned,
        fc.nat(),
        fc.nat(),
        cutsArb,
        seedArb,
        (map, pick, other, cuts, seed) => {
          const assigned = map.slots
            .map((stay, index) => (stay === null ? -1 : index))
            .filter((index) => index >= 0);
          const target = assigned[pick % assigned.length];
          const current = map.slots[target] as string;
          const choices = STAYS.filter((stay) => stay !== current);
          const changed: NightMap = {
            start: map.start,
            slots: map.slots.map((stay, index) =>
              index === target ? choices[other % choices.length] : stay
            ),
          };

          const before = encode(map, [], 0, 'b');
          const after = encode(changed, cuts, seed, 'a');

          expect(basesChanged(before, after)).toBe(true);
        }
      )
    );
  });

  it('P4 어떻게 인코딩하든 결과는 "밤 지도가 다르다"와 같다 (전체 오라클)', () => {
    fc.assert(
      fc.property(
        nightMapArb,
        nightMapArb,
        fc.boolean(),
        cutsArb,
        cutsArb,
        seedArb,
        seedArb,
        (x, y, sameMap, cutsX, cutsY, seedX, seedY) => {
          // 같은 지도 쪽도 충분히 나오게 절반은 y 를 x 로 둔다(무작위 두 지도는 거의 항상 다르다).
          const other = sameMap ? x : y;
          const expected =
            JSON.stringify(nightEntries(x)) !==
            JSON.stringify(nightEntries(other));

          const result = basesChanged(
            encode(x, cutsX, seedX, 'x'),
            encode(other, cutsY, seedY, 'y')
          );

          expect(result).toBe(expected);
        }
      )
    );
  });
});
