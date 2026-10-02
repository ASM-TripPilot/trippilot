import fc from 'fast-check';

import { orderByArrival } from './visitOrder';

/**
 * TRIP-1069 · AC-20·AC-21 · 결정 2(a) — 방문 카드 표시 순서.
 *
 * 무엇을 보장하나:
 *  - 도착 시각이 이른 카드가 앞이다. 서버는 늦은 순(내림차순)으로 주므로 화면이 다시 세운다.
 *  - 도착 없는 카드(도착 전 건너뜀)는 전부 끝이다.
 *  - 비교는 **순간(epoch)** 이다. 문자열 사전식으로 비교하면 `'…00.500Z' < '…00Z'`
 *    (`.` 이 `Z` 보다 앞 글자)라 소수 자리가 섞일 때 순서가 뒤집힌다.
 *  - 같은 값끼리는 들어온 순서를 지키고(안정 정렬), 입력 배열은 건드리지 않는다.
 */

type Visit = { visitCheckId: string; arrivedAt: string | null };

const ids = (visits: Visit[]) => visits.map((v) => v.visitCheckId);

describe('AC-20 · 도착 오름차순, 도착 없는 카드는 끝', () => {
  it('서버가 [13:44, 13:42, 도착 없음] 으로 주면 [13:42, 13:44, 도착 없음] 이다', () => {
    const input: Visit[] = [
      { visitCheckId: 'v2', arrivedAt: '2026-08-20T13:44:00Z' },
      { visitCheckId: 'v1', arrivedAt: '2026-08-20T13:42:00Z' },
      { visitCheckId: 'v3', arrivedAt: null },
    ];

    expect(ids(orderByArrival(input))).toEqual(['v1', 'v2', 'v3']);
  });

  it('AC-21 소수 자리가 섞여도 순간으로 비교한다(00.500Z 는 00Z 보다 뒤)', () => {
    const input: Visit[] = [
      { visitCheckId: 'vb', arrivedAt: '2026-08-20T13:42:00.500Z' },
      { visitCheckId: 'va', arrivedAt: '2026-08-20T13:42:00Z' },
    ];

    expect(ids(orderByArrival(input))).toEqual(['va', 'vb']);
  });
});

/** 같은 순간을 서버가 낼 수 있는 여러 모양으로 적는다 — 파싱하면 모두 같은 epoch 다. */
function formatInstant(epochMs: number, form: number): string {
  const iso = new Date(epochMs).toISOString(); // 'YYYY-MM-DDTHH:mm:ss.sssZ'
  const whole = iso.slice(0, 19);
  const millis = iso.slice(20, 23);
  if (millis === '000') {
    return form % 2 === 0 ? `${whole}Z` : `${whole}.000Z`;
  }
  return form % 2 === 0 ? `${whole}.${millis}Z` : `${whole}.${millis}000Z`;
}

const BASE = Date.parse('2026-08-20T13:42:00Z');

/** 몇 초 안에 몰린 도착(동률 다수) + 도착 없음이 섞인 목록. id 는 입력 위치로 고유하게 붙인다. */
const visitsArb = fc
  .array(
    fc.option(
      fc.record({
        offsetMs: fc.oneof(
          fc.constantFrom(0, 500, 1000, 2000),
          fc.integer({ min: 0, max: 3000 })
        ),
        form: fc.integer({ min: 0, max: 1 }),
      }),
      { nil: null, freq: 4 }
    ),
    { maxLength: 12 }
  )
  .map((cells) =>
    cells.map((cell, index): Visit => ({
      visitCheckId: `v${index}`,
      arrivedAt:
        cell === null ? null : formatInstant(BASE + cell.offsetMs, cell.form),
    }))
  );

describe('AC-21 · PBT — 순열·도착 없음 끝·순간 비내림·안정·입력 불변', () => {
  it('임의 목록에서 다섯 성질이 모두 성립한다', () => {
    fc.assert(
      fc.property(visitsArb, (input) => {
        const snapshot = input.map((v) => ({ ...v }));

        const out = orderByArrival(input);

        // ① 순열 — 빠지거나 늘어난 카드가 없다.
        expect([...ids(out)].sort()).toEqual([...ids(input)].sort());

        // ② 도착 없는 카드는 도착 있는 카드 앞에 오지 않는다.
        const firstNull = out.findIndex((v) => v.arrivedAt === null);
        if (firstNull !== -1) {
          expect(out.slice(firstNull).every((v) => v.arrivedAt === null)).toBe(
            true
          );
        }

        // ③ 도착 있는 카드끼리 순간이 줄어드는 쌍이 없다.
        const arrived = out.filter((v) => v.arrivedAt !== null);
        for (let i = 1; i < arrived.length; i += 1) {
          expect(Date.parse(arrived[i]!.arrivedAt!)).toBeGreaterThanOrEqual(
            Date.parse(arrived[i - 1]!.arrivedAt!)
          );
        }

        // ④ 같은 순간끼리·도착 없음끼리는 입력 순서를 지킨다(id 숫자 = 입력 위치).
        const position = (v: Visit) => Number(v.visitCheckId.slice(1));
        const sameKey = (a: Visit, b: Visit) =>
          a.arrivedAt === null
            ? b.arrivedAt === null
            : b.arrivedAt !== null &&
              Date.parse(a.arrivedAt) === Date.parse(b.arrivedAt);
        for (let i = 1; i < out.length; i += 1) {
          if (sameKey(out[i - 1]!, out[i]!)) {
            expect(position(out[i]!)).toBeGreaterThan(position(out[i - 1]!));
          }
        }

        // ⑤ 입력 배열은 그대로다.
        expect(input).toEqual(snapshot);
      })
    );
  });
});
