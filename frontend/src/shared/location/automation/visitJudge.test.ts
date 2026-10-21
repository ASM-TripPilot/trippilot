import fc from 'fast-check';

import { AUTOMATION_CONFIG } from './config';
import {
  initialJudgeState,
  judge,
  type JudgeEmit,
  type JudgeEvent,
  type JudgeState,
} from './visitJudge';

/**
 * TRIP-1334 · PBT-U10-F3 (BR-U10-12·14~19 · business-logic-model §5.1~5.3) — 슬롯 판정 리듀서.
 *
 * 3동작 뼈대: 준비=초기 상태(계획 순번)+이벤트 열 → 실행=judge 를 차례로 → 단언=emit 열.
 * 시각은 epoch ms. 이벤트 시각이 곧 판정 시각(now)이다 — wake 만 따로 now 를 준다.
 */

const MIN = 60_000;
const T0 = Date.UTC(2026, 7, 20, 1, 0, 0);
const cfg = AUTOMATION_CONFIG;
const ORDER = ['A', 'B', 'C'];

function run(
  events: JudgeEvent[],
  state: JudgeState = initialJudgeState(ORDER)
) {
  const emits: JudgeEmit[] = [];
  let s = state;
  for (const e of events) {
    const out = judge(s, e, e.at, cfg);
    s = out.state;
    emits.push(...out.emit);
  }
  return { state: s, emits };
}

const good = (at: number): JudgeEvent => ({
  type: 'sample',
  at,
  accuracyM: 20,
});
const enter = (
  slotKey: string,
  at: number,
  distanceM?: number
): JudgeEvent => ({
  type: 'enter',
  slotKey,
  at,
  distanceM,
});
const exit = (slotKey: string, at: number): JudgeEvent => ({
  type: 'exit',
  slotKey,
  at,
});
const wake = (at: number): JudgeEvent => ({ type: 'wake', at });

describe('visitJudge — 예시', () => {
  it('VJ1 진입 후 3분 이탈 없음 + 근거 표본 → 도착, 시각은 진입 시각으로 소급', () => {
    const { emits } = run([enter('A', T0), good(T0 + MIN), wake(T0 + 7 * MIN)]);
    expect(emits).toEqual([{ kind: 'ARRIVE', slotKey: 'A', occurredAt: T0 }]);
  });

  it('VJ2 3분 안에 이탈하면 아무것도 없다(지나가기)', () => {
    const { emits } = run([
      enter('A', T0),
      good(T0 + MIN),
      exit('A', T0 + 2 * MIN),
      wake(T0 + 20 * MIN),
    ]);
    expect(emits).toEqual([]);
  });

  it('VJ3 10분 이상 머문 뒤 이탈, 3분 재진입 없음 → 완료(이탈 시각)', () => {
    const { emits } = run([
      enter('A', T0),
      good(T0 + MIN),
      wake(T0 + 4 * MIN),
      exit('A', T0 + 30 * MIN),
      wake(T0 + 40 * MIN),
    ]);
    expect(emits).toEqual([
      { kind: 'ARRIVE', slotKey: 'A', occurredAt: T0 },
      {
        kind: 'COMPLETE',
        slotKey: 'A',
        occurredAt: T0 + 30 * MIN,
        completionSource: 'AUTO_GEOFENCE_EXIT',
      },
    ]);
  });

  it('VJ4 3분 안 재진입은 이탈 취소', () => {
    const { emits } = run([
      enter('A', T0),
      good(T0 + MIN),
      wake(T0 + 4 * MIN),
      exit('A', T0 + 30 * MIN),
      enter('A', T0 + 31 * MIN),
      wake(T0 + 40 * MIN),
    ]);
    expect(emits.map((e) => e.kind)).toEqual(['ARRIVE']);
  });

  it('VJ5 10분 미만 체류 후 이탈은 자동 완료하지 않는다(수동 폴백)', () => {
    const { emits } = run([
      enter('A', T0),
      good(T0 + MIN),
      wake(T0 + 4 * MIN),
      exit('A', T0 + 6 * MIN),
      wake(T0 + 20 * MIN),
    ]);
    expect(emits.map((e) => e.kind)).toEqual(['ARRIVE']);
  });

  it('VJ6 정확도 100m 초과 표본만 있으면 보류(기록 없음)', () => {
    const { emits } = run([
      enter('A', T0),
      { type: 'sample', at: T0 + MIN, accuracyM: 150 },
      wake(T0 + 10 * MIN),
    ]);
    expect(emits).toEqual([]);
  });

  it('VJ7 보조 규칙: 다음 슬롯 도착 확정 시 직전 슬롯(도착 후 10분↑ 미완료)을 다음 진입 시각으로 완료', () => {
    const { emits } = run([
      enter('A', T0),
      good(T0 + MIN),
      wake(T0 + 4 * MIN),
      // A 이탈을 OS 가 놓쳤다
      enter('B', T0 + 40 * MIN),
      good(T0 + 41 * MIN),
      wake(T0 + 45 * MIN),
    ]);
    expect(emits).toEqual([
      { kind: 'ARRIVE', slotKey: 'A', occurredAt: T0 },
      { kind: 'ARRIVE', slotKey: 'B', occurredAt: T0 + 40 * MIN },
      {
        kind: 'COMPLETE',
        slotKey: 'A',
        occurredAt: T0 + 40 * MIN,
        completionSource: 'AUTO_NEXT_ARRIVAL',
      },
    ]);
  });

  it('VJ8 겹치는 리전: 같은 창의 진입 둘 중 중심이 가까운 하나만 도착', () => {
    const { emits } = run([
      enter('A', T0, 120),
      enter('B', T0, 30),
      good(T0 + MIN),
      wake(T0 + 5 * MIN),
    ]);
    expect(emits).toEqual([{ kind: 'ARRIVE', slotKey: 'B', occurredAt: T0 }]);
  });

  it('VJ9 서버에 수동 도착이 있으면(external arrived) 이탈로 자동 완료할 수 있다(§5.2)', () => {
    const { emits } = run([
      { type: 'external', slotKey: 'A', status: 'arrived', at: T0 },
      good(T0 + MIN),
      exit('A', T0 + 20 * MIN),
      wake(T0 + 25 * MIN),
    ]);
    expect(emits).toEqual([
      {
        kind: 'COMPLETE',
        slotKey: 'A',
        occurredAt: T0 + 20 * MIN,
        completionSource: 'AUTO_GEOFENCE_EXIT',
      },
    ]);
  });

  it('VJ10 서버에 완료·건너뜀·되돌림이 있으면 그 슬롯은 아무것도 내지 않는다', () => {
    for (const status of ['completed', 'skipped', 'suppressed'] as const) {
      const { emits } = run([
        { type: 'external', slotKey: 'A', status, at: T0 },
        enter('A', T0 + MIN),
        good(T0 + 2 * MIN),
        wake(T0 + 10 * MIN),
      ]);
      expect(emits).toEqual([]);
    }
  });
});

// ── PBT ─────────────────────────────────────────────────────────────

const arbEvents: fc.Arbitrary<JudgeEvent[]> = fc
  .array(
    fc.record({
      dt: fc.integer({ min: 0, max: 15 * MIN }),
      kind: fc.constantFrom('enter', 'exit', 'sample', 'wake', 'sample'),
      slot: fc.constantFrom(...ORDER),
      acc: fc.integer({ min: 5, max: 300 }),
      dist: fc.option(fc.integer({ min: 0, max: 150 }), { nil: undefined }),
    }),
    { maxLength: 40 }
  )
  .map((rows) => {
    let t = T0;
    return rows.map((r): JudgeEvent => {
      t += r.dt;
      if (r.kind === 'enter') return enter(r.slot, t, r.dist);
      if (r.kind === 'exit') return exit(r.slot, t);
      if (r.kind === 'sample')
        return { type: 'sample', at: t, accuracyM: r.acc };
      return wake(t);
    });
  });

describe('visitJudge (PBT-U10-F3)', () => {
  it('① 3분 미만 체류는 도착을 내지 않는다 · ② 도착 시각 = 진입 시각', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const { emits } = run(events);
        for (const e of emits.filter((x) => x.kind === 'ARRIVE')) {
          const enterIdx = events.findIndex(
            (ev) =>
              ev.type === 'enter' &&
              ev.slotKey === e.slotKey &&
              ev.at === e.occurredAt
          );
          expect(enterIdx).toBeGreaterThanOrEqual(0); // ②
          // 도착 "이후"에 일어난 exit 만 본다(배열 순서) — 시각이 같아도(dt=0) enter 보다 앞선 exit 는 체류를 끊지 않는다.
          const nextExit = events
            .slice(enterIdx + 1)
            .find((ev) => ev.type === 'exit' && ev.slotKey === e.slotKey);
          if (nextExit) {
            expect(nextExit.at - e.occurredAt).toBeGreaterThanOrEqual(
              cfg.arriveDwellMs
            ); // ①
          }
        }
      }),
      {
        numRuns: 1000,
        // CI 에서 무작위로 터진 반례(seed -1626418428)를 고정한다 — 같은 시각(dt=0)에 exit 가 enter 보다
        // 배열 앞에 오는 열. 도착 "이후"의 exit 가 아니라 "앞선" exit 를 집으면 체류 0분으로 잘못 읽힌다.
        examples: [
          [
            [
              exit('A', T0),
              enter('A', T0),
              { type: 'sample', at: T0, accuracyM: 5 },
              enter('A', T0 + 3 * MIN),
            ],
          ],
        ],
      }
    );
  });

  it('③ 완료 시각 ≥ 도착 시각 + 10분 (또는 완료 없음)', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const { emits } = run(events);
        for (const c of emits.filter((x) => x.kind === 'COMPLETE')) {
          const a = emits.find(
            (x) => x.kind === 'ARRIVE' && x.slotKey === c.slotKey
          );
          expect(a).toBeDefined();
          expect(c.occurredAt - a!.occurredAt).toBeGreaterThanOrEqual(
            cfg.minStayForCompleteMs
          );
        }
      }),
      { numRuns: 1000 }
    );
  });

  it('④ 정확도 > 100m 표본만 있으면 아무것도 내지 않는다', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const bad = events.map((e) =>
          e.type === 'sample'
            ? { ...e, accuracyM: cfg.maxAccuracyM + 1 + (e.accuracyM % 50) }
            : e
        );
        expect(run(bad).emits).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });

  it('⑤ 같은 시퀀스 → 같은 출력(결정론) · 슬롯당 도착·완료 각 1회 이하', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const a = run(events);
        const b = run(events);
        expect(b).toEqual(a);
        for (const kind of ['ARRIVE', 'COMPLETE'] as const) {
          const keys = a.emits
            .filter((e) => e.kind === kind)
            .map((e) => e.slotKey);
          expect(new Set(keys).size).toBe(keys.length);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('INV-3 emit 에 체류 시간·소요시간·속도 필드가 없다', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        for (const e of run(events).emits) {
          for (const k of Object.keys(e)) {
            expect([
              'kind',
              'slotKey',
              'occurredAt',
              'completionSource',
            ]).toContain(k);
          }
        }
      }),
      { numRuns: 300 }
    );
  });
});

// ── TRIP-1517 · 진입 직전 근거 창 ───────────────────────────────────
// 진입 직전 PRE(60초) 안의 정확 표본도 그 진입의 근거다. 표본과 진입이 같은 순간 들어와
// 처리 순서가 갈려도 결과가 같아야 한다(경합 제거). 정지해 있으면 새 표본이 안 오므로 이 기억이 유일한 근거다.

const PRE = cfg.preEnterSampleMs;
const bad = (at: number): JudgeEvent => ({
  type: 'sample',
  at,
  accuracyM: cfg.maxAccuracyM + 50,
});
const ARRIVE_A = [{ kind: 'ARRIVE', slotKey: 'A', occurredAt: T0 }];

describe('visitJudge — 진입 직전 근거 창 (TRIP-1517)', () => {
  it('VJ11 진입 직전 창 안의 정확 표본 + 이후 표본 없음 → 3분 뒤 wake 에서 도착(진입 시각)', () => {
    const { emits } = run([
      good(T0 - 30_000),
      enter('A', T0),
      wake(T0 + 4 * MIN),
    ]);
    expect(emits).toEqual(ARRIVE_A);
  });

  it('VJ12 경계는 포함: 정확히 PRE 전은 인정, 1ms 더 옛은 불인정', () => {
    const at = (sampleAt: number) =>
      run([good(sampleAt), enter('A', T0), wake(T0 + 4 * MIN)]).emits;
    expect(at(T0 - PRE)).toEqual(ARRIVE_A);
    expect(at(T0 - PRE - 1)).toEqual([]);
  });

  it('VJ13 창 밖(더 이전) 표본만 → 근거 없음, 보류(기존 규칙)', () => {
    const { emits } = run([
      good(T0 - 2 * MIN),
      enter('A', T0),
      wake(T0 + 4 * MIN),
    ]);
    expect(emits).toEqual([]);
  });

  it('VJ14 창 안이어도 정확도 100m 초과 표본은 근거가 아니다', () => {
    const { emits } = run([
      bad(T0 - 10_000),
      enter('A', T0),
      wake(T0 + 4 * MIN),
    ]);
    expect(emits).toEqual([]);
  });

  it('VJ15 나중에 온 부정확 표본이 앞선 정확 표본의 기억을 지우지 않는다', () => {
    const { emits } = run([
      good(T0 - 30_000),
      bad(T0 - 10_000),
      enter('A', T0),
      wake(T0 + 4 * MIN),
    ]);
    expect(emits).toEqual(ARRIVE_A);
  });

  it('VJ16 더 옛 정확 표본이 늦게 처리돼도 "가장 최근 시각" 이 남는다', () => {
    const { emits } = run([
      good(T0 - 10_000),
      good(T0 - 100_000),
      enter('A', T0),
      wake(T0 + 4 * MIN),
    ]);
    expect(emits).toEqual(ARRIVE_A);
  });

  it('VJ17 한 표본이 겹친 두 슬롯의 근거가 되고, 중심이 가까운 하나만 도착한다(BR-U10-19)', () => {
    const { emits } = run([
      good(T0 - 30_000),
      enter('A', T0, 120),
      enter('B', T0, 30),
      wake(T0 + 5 * MIN),
    ]);
    expect(emits).toEqual([{ kind: 'ARRIVE', slotKey: 'B', occurredAt: T0 }]);
  });

  it('VJ18 옛 표본은 "이번 진입" 기준으로 창 밖이면 인정하지 않는다(이탈 후 재진입)', () => {
    const { emits } = run([
      good(T0 - 30_000),
      enter('A', T0),
      exit('A', T0 + MIN),
      enter('A', T0 + 10 * MIN),
      wake(T0 + 14 * MIN),
    ]);
    expect(emits).toEqual([]);
  });

  it('VJ19 진입이 먼저 처리되고 옛 시각 표본이 늦게 도착해도 같은 결과(순서 무관)', () => {
    const { emits } = run([
      enter('A', T0),
      good(T0 - 30_000),
      wake(T0 + 4 * MIN),
    ]);
    expect(emits).toEqual(ARRIVE_A);
  });

  it('VJ20 옛 저장 상태(새 필드 없음)도 깨지지 않고 같은 규칙으로 올라간다', () => {
    // initialJudgeState 는 구현이 새 필드를 채울 수 있어 "옛 모양"이 아니다 — 필드를 안 적은 리터럴을 쓴다.
    const legacy = (): JudgeState => ({
      order: ORDER,
      slots: Object.fromEntries(
        ORDER.map((k) => [k, { phase: 'IDLE' as const, goodSample: false }])
      ),
    });
    expect(run([enter('A', T0), wake(T0 + 4 * MIN)], legacy()).emits).toEqual(
      []
    );
    expect(
      run([good(T0 - 30_000), enter('A', T0), wake(T0 + 4 * MIN)], legacy())
        .emits
    ).toEqual(ARRIVE_A);
  });

  // 5-b 경고 · 포그라운드 wake 가 근거 표본보다 먼저 와 슬롯을 보류(HELD)로 굳혀도, 늦게 배달된 진입 근거 표본이
  // 그 보류를 풀어야 한다(경로 기록은 표본을 최대 2분 모아 보낸다 — deferredUpdatesIntervalMs).
  it('VJ22 보류(HELD) 뒤 늦게 온 진입 근거 표본이 도착을 되살린다(진입 시각)', () => {
    const { emits } = run([
      enter('A', T0),
      wake(T0 + 4 * MIN),
      good(T0 + MIN),
      wake(T0 + 6 * MIN),
    ]);
    expect(emits).toEqual(ARRIVE_A);
  });

  it('VJ23 보류를 되살리는 것은 진입 근거 창 안의 표본뿐 — 더 옛 표본은 여전히 보류', () => {
    const { emits, state } = run([
      enter('A', T0),
      wake(T0 + 4 * MIN),
      good(T0 - PRE - 1),
      wake(T0 + 6 * MIN),
    ]);
    expect(emits).toEqual([]);
    expect(state.slots.A.phase).toBe('HELD');
  });

  it('VJ21 기본 창은 60초(설정값, 시드 결정)', () => {
    expect(cfg.preEnterSampleMs).toBe(60_000);
  });
});

describe('visitJudge (PBT-U10-F3) — TRIP-1517', () => {
  it('⑥ 표본·진입 처리 순서를 바꿔도 결과가 같고, 그 결과는 "정확 + 창 안" 모델과 같다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2 * PRE, max: 0 }), // 표본이 진입보다 앞선 정도
        fc.integer({ min: 5, max: 300 }), // 표본 정확도(m)
        fc.integer({ min: 3 * MIN, max: 13 * MIN }), // 진입 뒤 wake 까지
        (d, acc, after) => {
          const sample: JudgeEvent = {
            type: 'sample',
            at: T0 + d,
            accuracyM: acc,
          };
          const tail = wake(T0 + after);
          const a = run([sample, enter('A', T0), tail]);
          const b = run([enter('A', T0), sample, tail]);

          const arrives = acc <= cfg.maxAccuracyM && d >= -PRE;
          for (const r of [a, b]) {
            expect(r.emits).toEqual(arrives ? ARRIVE_A : []);
            expect(r.state.slots.A.phase).toBe(arrives ? 'ARRIVED' : 'HELD');
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('⑦ 도착은 반드시 진입 직전 창(또는 이후)의 정확 표본이 받쳐 준다', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        for (const e of run(events).emits.filter((x) => x.kind === 'ARRIVE')) {
          const backed = events.some(
            (ev) =>
              ev.type === 'sample' &&
              ev.accuracyM <= cfg.maxAccuracyM &&
              ev.at >= e.occurredAt - PRE
          );
          expect(backed).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });
});
