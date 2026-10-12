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
          const enterEv = events.find(
            (ev) =>
              ev.type === 'enter' &&
              ev.slotKey === e.slotKey &&
              ev.at === e.occurredAt
          );
          expect(enterEv).toBeDefined(); // ②
          const nextExit = events.find(
            (ev) =>
              ev.type === 'exit' &&
              ev.slotKey === e.slotKey &&
              ev.at >= e.occurredAt
          );
          if (nextExit) {
            expect(nextExit.at - e.occurredAt).toBeGreaterThanOrEqual(
              cfg.arriveDwellMs
            ); // ①
          }
        }
      }),
      { numRuns: 1000 }
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
