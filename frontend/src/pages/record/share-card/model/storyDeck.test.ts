import * as fc from 'fast-check';

import {
  SLIDE_MS,
  deckReducer,
  initDeck,
  isRunning,
  segmentState,
  type DeckEvent,
  type DeckState,
} from './storyDeck';

/**
 * TRIP-1667 · j06 스토리 덱 — "지금 몇 번째 장이고 남은 시간이 얼마인가"를 정하는 순수 리듀서의 계약.
 * 초심자용: 리듀서 = "지금 상태와 사건 하나를 받아 다음 상태를 돌려주는 순수 함수". 시계·타이머를 전혀 모르고, 시간은 `elapse(ms)`
 * (ms 만큼 흘렀다) 라는 사건으로만 들어온다 — 그래서 가짜 시계 없이 예제와 무작위 불변식으로 모든 규칙을 잴 수 있다.
 * 타이머를 실제로 거는 얇은 훅은 `useStoryDeck.test.ts` 가 가짜 시계로 잰다.
 *
 * 무엇을 보장하나(AC 번호는 01 브리프 §7):
 *  - AC-3 자동 넘김: 돌고 있을 때만 `elapse` 가 시간을 깎고, 0 이 되면 다음 장(남은 시간 리셋), **마지막 장에서는 0 에서 멈춘다**(반복 없음).
 *  - AC-4 탭 이동: 좌/우 탭은 ±1 장(첫 장의 왼쪽·마지막 장의 오른쪽은 무동작), 이동하면 남은 시간이 처음부터. 자동 재생 여부·누르는 중인지와 무관하게 늘 동작한다.
 *  - AC-5 길게 누름: 누르는 동안(`pressIn`~`pressOut`) 시간이 안 흐르고, 떼면 **남은 시간부터** 이어간다.
 *  - AC-6 동작 줄이기: `motion` 사건의 `reduce===false` 일 때만 자동 재생(true·null 은 재생 안 함).
 *  - AC-2 구간 상태: 지난 장 done · 지금 장 current · 다음 장 upcoming.
 *
 * 상태 모양(02a §2): `{ index, total, remainingMs, pressed, autoplay }`. 시작은 자동 재생 꺼짐(`autoplay=false`) — `motion` 이 답해 줄 때까지 안 돈다.
 * "바뀔 게 없으면 같은 참조를 돌려준다"(React 가 다시 그리지 않게).
 */

const playing = (total: number, startAt: 'first' | 'last' = 'first') =>
  deckReducer(initDeck(total, startAt), { type: 'motion', reduce: false });
const run = (state: DeckState, ...events: DeckEvent[]) =>
  events.reduce(deckReducer, state);
const elapse = (ms: number): DeckEvent => ({ type: 'elapse', ms });
const tap = (side: 'left' | 'right'): DeckEvent => ({ type: 'tap', side });

describe('초기 상태 · 동작 줄이기(motion)', () => {
  it('DK-1 · 한 장 3.4초, 처음/마지막에서 시작, 시작은 자동 재생 꺼짐(답 오기 전엔 안 돈다)', () => {
    expect(SLIDE_MS).toBe(3400);

    const first = initDeck(4, 'first');
    expect(first).toMatchObject({
      index: 0,
      total: 4,
      remainingMs: SLIDE_MS,
      pressed: false,
      autoplay: false,
    });
    expect(isRunning(first)).toBe(false);
    expect(initDeck(4, 'last').index).toBe(3);
  });

  it('DK-2 · motion: reduce===false 일 때만 자동 재생 · true·null 은 안 돈다 · 같은 답이면 같은 참조', () => {
    const base = initDeck(3, 'first');
    const on = deckReducer(base, { type: 'motion', reduce: false });
    expect(on.autoplay).toBe(true);
    expect(isRunning(on)).toBe(true);

    expect(deckReducer(base, { type: 'motion', reduce: true })).toBe(base);
    expect(deckReducer(base, { type: 'motion', reduce: null })).toBe(base);
    expect(deckReducer(on, { type: 'motion', reduce: false })).toBe(on);
    // 켜졌다가 꺼질 수도 있다(OS 설정이 바뀐 답)
    expect(deckReducer(on, { type: 'motion', reduce: true }).autoplay).toBe(
      false
    );
  });
});

describe('elapse — 자동 넘김(AC-3)', () => {
  it('DK-3 · 돌고 있지 않으면(자동 재생 꺼짐·누르는 중) 시간은 흐르지 않는다 — 같은 참조', () => {
    const off = initDeck(3, 'first'); // 자동 재생 꺼짐
    expect(deckReducer(off, elapse(1000))).toBe(off);

    const held = run(playing(3), { type: 'pressIn' });
    expect(deckReducer(held, elapse(1000))).toBe(held);
  });

  it('DK-3b · 흐른 시간이 0 이하(기기 시계가 뒤로 감)면 아무것도 안 바뀐다 — 같은 참조', () => {
    // 훅은 Date.now() - startedAt 을 그대로 ms 로 보낸다 — 시계가 뒤로 가면 음수가 온다. 받아들이면 남은 시간이 3400 을 넘는다.
    const state = playing(3);

    expect(deckReducer(state, elapse(0))).toBe(state);
    expect(deckReducer(state, elapse(-500))).toBe(state);
  });

  it('DK-4 · 일부만 흐르면 남은 시간만 줄고 장은 그대로', () => {
    const next = deckReducer(playing(3), elapse(1000));

    expect(next).toMatchObject({ index: 0, remainingMs: SLIDE_MS - 1000 });
  });

  it('DK-5 · 남은 시간이 0 이 되면 다음 장 + 남은 시간 리셋 · 훨씬 많이 흘러도 한 장만 넘어간다(몰아넘김 없음)', () => {
    const exact = deckReducer(playing(4), elapse(SLIDE_MS));
    expect(exact).toMatchObject({ index: 1, remainingMs: SLIDE_MS });

    const over = deckReducer(playing(4), elapse(SLIDE_MS * 3));
    expect(over).toMatchObject({ index: 1, remainingMs: SLIDE_MS });
  });

  it('DK-6 · 마지막 장에서는 0 에서 멈춘다(반복 없음) — 이후 elapse 는 같은 참조', () => {
    const last = playing(3, 'last');
    const stopped = deckReducer(last, elapse(SLIDE_MS));

    expect(stopped).toMatchObject({ index: 2, remainingMs: 0 });
    expect(isRunning(stopped)).toBe(false);
    expect(deckReducer(stopped, elapse(5000))).toBe(stopped);
  });

  it('DK-7 · 한 장짜리 덱은 장이 넘어갈 데가 없다 — 시간이 다 되면 멈춘다', () => {
    const one = deckReducer(playing(1), elapse(SLIDE_MS));

    expect(one).toMatchObject({ index: 0, remainingMs: 0 });
    expect(isRunning(one)).toBe(false);
  });
});

describe('pressIn / pressOut — 길게 누르면 멈춤(AC-5)', () => {
  it('DK-8 · 누르면 멈추고 떼면 "남은 시간부터" 이어간다(시간이 리셋되지 않는다)', () => {
    const started = deckReducer(playing(3), elapse(1000)); // 남은 2400

    const held = deckReducer(started, { type: 'pressIn' });
    expect(held.pressed).toBe(true);
    expect(isRunning(held)).toBe(false);

    const released = deckReducer(held, { type: 'pressOut' });
    expect(released.pressed).toBe(false);
    expect(released).toMatchObject({ index: 0, remainingMs: SLIDE_MS - 1000 });
    expect(isRunning(released)).toBe(true);
  });

  it('DK-9 · 이미 누른 상태의 pressIn · 안 누른 상태의 pressOut 은 같은 참조', () => {
    const idle = playing(3);
    expect(deckReducer(idle, { type: 'pressOut' })).toBe(idle);

    const held = deckReducer(idle, { type: 'pressIn' });
    expect(deckReducer(held, { type: 'pressIn' })).toBe(held);
  });

  it('DK-10 · 자동 재생이 꺼진 덱(동작 줄이기)도 누름/뗌은 그냥 상태만 바꾼다 — 장·시간은 그대로', () => {
    const off = initDeck(3, 'first');

    const after = run(off, { type: 'pressIn' }, { type: 'pressOut' });

    expect(after).toEqual(off);
  });
});

describe('tap — 좌/우 탭 이동(AC-4)', () => {
  it('DK-11 · 오른쪽은 다음 장, 왼쪽은 이전 장 · 이동하면 남은 시간이 처음부터', () => {
    const mid = deckReducer(playing(4), elapse(2000)); // 장 0, 남은 1400

    const right = deckReducer(mid, tap('right'));
    expect(right).toMatchObject({ index: 1, remainingMs: SLIDE_MS });

    const left = deckReducer(deckReducer(right, elapse(500)), tap('left'));
    expect(left).toMatchObject({ index: 0, remainingMs: SLIDE_MS });
  });

  it('DK-12 · 첫 장의 왼쪽·마지막 장의 오른쪽은 아무 일도 없다 — 같은 참조(남은 시간도 안 리셋)', () => {
    const first = deckReducer(playing(3), elapse(1000));
    expect(deckReducer(first, tap('left'))).toBe(first);

    const last = deckReducer(playing(3, 'last'), elapse(SLIDE_MS)); // 정지(0)
    expect(deckReducer(last, tap('right'))).toBe(last);
    // 한 장짜리는 양쪽 다
    const one = initDeck(1, 'first');
    expect(deckReducer(one, tap('left'))).toBe(one);
    expect(deckReducer(one, tap('right'))).toBe(one);
  });

  it('DK-13 · 탭은 자동 재생이 꺼져 있어도(동작 줄이기) 동작한다 — 탭 이동은 동작 줄이기와 무관', () => {
    const off = initDeck(3, 'first');

    const moved = deckReducer(off, tap('right'));

    expect(moved.index).toBe(1);
    expect(moved.autoplay).toBe(false);
  });

  it('DK-14 · 짧은 탭은 onPress 가 onPressOut 보다 먼저 올 수 있다 — 누른 채로 탭해도 이동하고, 이후 pressOut 은 새 장의 시간을 깎지 않는다', () => {
    const pressed = deckReducer(playing(3), { type: 'pressIn' });

    const tapped = deckReducer(pressed, tap('right'));
    expect(tapped).toMatchObject({
      index: 1,
      remainingMs: SLIDE_MS,
      pressed: true, // 손가락은 아직 닿아 있다
    });

    const released = deckReducer(tapped, { type: 'pressOut' });
    expect(released).toMatchObject({
      index: 1,
      remainingMs: SLIDE_MS,
      pressed: false,
    });
  });

  it('DK-15 · 마지막 장에서 멈춘 뒤 왼쪽으로 돌아가면 그 장의 시간이 다시 돈다', () => {
    const stopped = deckReducer(playing(3, 'last'), elapse(SLIDE_MS));

    const back = deckReducer(stopped, tap('left'));

    expect(back).toMatchObject({ index: 1, remainingMs: SLIDE_MS });
    expect(isRunning(back)).toBe(true);
  });
});

describe('segmentState — 진행 바 구간(AC-2)', () => {
  it('DK-16 · 지난 장 done · 지금 장 current · 다음 장 upcoming', () => {
    const state = run(initDeck(4, 'first'), tap('right'), tap('right')); // index 2

    expect([0, 1, 2, 3].map((i) => segmentState(state, i))).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
    ]);
  });
});

// ── 불변식(속성 테스트) ────────────────────────────────────────────────────────────
// 초심자용: 속성 테스트 = 사건을 무작위로 수십 번 섞어 넣어도 "항상 참이어야 하는 규칙"이 깨지지 않는지 본다.
// 경계(한 장짜리·마지막 장에서 멈춘 뒤·누른 채 탭)는 무작위 운에 맡기지 않고 examples 로 박는다.

const sideArb = fc.constantFrom<'left' | 'right'>('left', 'right');
const eventArb: fc.Arbitrary<DeckEvent> = fc.oneof(
  fc.constantFrom<DeckEvent>(
    { type: 'pressIn' },
    { type: 'pressOut' },
    { type: 'motion', reduce: false },
    { type: 'motion', reduce: false },
    { type: 'motion', reduce: true },
    { type: 'motion', reduce: null }
  ),
  sideArb.map<DeckEvent>((side) => ({ type: 'tap', side })),
  fc.integer({ min: 1, max: 8000 }).map<DeckEvent>((ms) => elapse(ms))
);
const totalArb = fc.integer({ min: 1, max: 9 });
const startArb = fc.constantFrom<'first' | 'last'>('first', 'last');
const eventsArb = fc.array(eventArb, { maxLength: 40 });

const reach = (total: number, startAt: 'first' | 'last', events: DeckEvent[]) =>
  run(initDeck(total, startAt), ...events);

const PINNED: [number, 'first' | 'last', DeckEvent[]][] = [
  [1, 'first', [{ type: 'motion', reduce: false }, elapse(3400), tap('right')]],
  [
    2,
    'last',
    [
      { type: 'motion', reduce: false },
      elapse(3400),
      tap('right'),
      tap('left'),
    ],
  ],
  [
    3,
    'first',
    [
      { type: 'motion', reduce: false },
      { type: 'pressIn' },
      tap('right'),
      { type: 'pressOut' },
    ],
  ],
  [3, 'first', [{ type: 'motion', reduce: false }, elapse(8000), elapse(8000)]],
];

describe('불변식(PBT)', () => {
  it('PBT-1 · 어떤 사건 열에도: 장 번호는 0..total-1 · 남은 시간은 0..3400 · 구간 상태는 정확히 지금 장 하나', () => {
    fc.assert(
      fc.property(totalArb, startArb, eventsArb, (total, startAt, events) => {
        const s = reach(total, startAt, events);

        expect(s.index).toBeGreaterThanOrEqual(0);
        expect(s.index).toBeLessThan(total);
        expect(s.total).toBe(total);
        expect(s.remainingMs).toBeGreaterThanOrEqual(0);
        expect(s.remainingMs).toBeLessThanOrEqual(SLIDE_MS);
        const states = Array.from({ length: total }, (_, i) =>
          segmentState(s, i)
        );
        expect(states.filter((x) => x === 'current')).toHaveLength(1);
        expect(states[s.index]).toBe('current');
        states.forEach((x, i) => {
          if (i < s.index) expect(x).toBe('done');
          if (i > s.index) expect(x).toBe('upcoming');
        });
      }),
      { examples: PINNED }
    );
  });

  it('PBT-2 · isRunning 의 정의: 자동 재생 ∧ 안 누름 ∧ 남은 시간 > 0 — 돌고 있지 않을 때의 elapse 는 같은 참조', () => {
    fc.assert(
      fc.property(
        totalArb,
        startArb,
        eventsArb,
        fc.integer({ min: 1, max: 8000 }),
        (total, startAt, events, ms) => {
          const s = reach(total, startAt, events);
          expect(isRunning(s)).toBe(
            s.autoplay && !s.pressed && s.remainingMs > 0
          );
          if (!isRunning(s)) expect(deckReducer(s, elapse(ms))).toBe(s);
        }
      ),
      {
        examples: PINNED.map(
          ([t, st, ev]) =>
            [t, st, ev, 500] as [number, 'first' | 'last', DeckEvent[], number]
        ),
      }
    );
  });

  it('PBT-3 · 탭이 없으면 장은 앞으로만, 사건 하나에 많아야 한 장 — 자동으로 뒤로 가거나 건너뛰지 않는다', () => {
    const noTap = fc.array(
      eventArb.filter((e) => e.type !== 'tap'),
      { maxLength: 40 }
    );
    fc.assert(
      fc.property(totalArb, startArb, noTap, (total, startAt, events) => {
        let s = initDeck(total, startAt);
        for (const event of events) {
          const next = deckReducer(s, event);
          expect(next.index - s.index).toBeGreaterThanOrEqual(0);
          expect(next.index - s.index).toBeLessThanOrEqual(1);
          s = next;
        }
      }),
      {
        examples: PINNED.map(
          ([t, st, ev]) =>
            [t, st, ev.filter((e) => e.type !== 'tap')] as [
              number,
              'first' | 'last',
              DeckEvent[],
            ]
        ),
      }
    );
  });

  it('PBT-4 · 탭: 많아야 ±1 장 · 움직이지 않는 건 경계뿐 · 움직이면 남은 시간 처음부터 · 누름/자동 재생 상태는 그대로 · 장 번호는 누름/자동 재생 여부와 무관', () => {
    fc.assert(
      fc.property(
        totalArb,
        startArb,
        eventsArb,
        sideArb,
        (total, startAt, events, side) => {
          const s = reach(total, startAt, events);
          const next = deckReducer(s, { type: 'tap', side });
          const target = s.index + (side === 'right' ? 1 : -1);
          const inRange = target >= 0 && target < total;

          if (inRange) {
            expect(next.index).toBe(target);
            expect(next.remainingMs).toBe(SLIDE_MS);
          } else {
            expect(next).toBe(s);
          }
          expect(next.pressed).toBe(s.pressed);
          expect(next.autoplay).toBe(s.autoplay);
          // 같은 장 번호에서 누름/자동 재생이 달라도 이동 결과는 같다
          const other = { ...s, pressed: !s.pressed, autoplay: !s.autoplay };
          expect(deckReducer(other, { type: 'tap', side }).index).toBe(
            next.index
          );
        }
      ),
      {
        examples: [
          [1, 'first', [], 'left'],
          [1, 'first', [], 'right'],
          [
            3,
            'last',
            [{ type: 'motion', reduce: false }, elapse(3400)],
            'right',
          ],
          [3, 'first', [{ type: 'pressIn' }], 'right'],
        ],
      }
    );
  });

  it('PBT-5 · 누르는 동안은 얼마를 흘려도(elapse) 장·남은 시간이 그대로, 떼면 누르기 전과 같은 상태로 돌아온다', () => {
    fc.assert(
      fc.property(
        totalArb,
        startArb,
        eventsArb,
        fc.array(fc.integer({ min: 1, max: 8000 }), { maxLength: 6 }),
        (total, startAt, events, elapses) => {
          const before = reach(total, startAt, events);
          fc.pre(!before.pressed);

          const after = run(
            before,
            { type: 'pressIn' },
            ...elapses.map(elapse),
            { type: 'pressOut' }
          );

          expect(after).toEqual(before);
        }
      ),
      {
        examples: [
          [
            3,
            'first',
            [{ type: 'motion', reduce: false }, elapse(1000)],
            [9000],
          ],
          [2, 'last', [{ type: 'motion', reduce: false }, elapse(3400)], [100]],
        ],
      }
    );
  });

  it('PBT-6 · 돌고 있는 덱에서 ms 가 남은 시간보다 작게 흐르면 정확히 ms 만큼만 줄어든다(시간이 새거나 불어나지 않는다)', () => {
    fc.assert(
      fc.property(
        totalArb,
        startArb,
        eventsArb,
        fc.integer({ min: 1, max: SLIDE_MS - 1 }),
        (total, startAt, events, ms) => {
          const s = reach(total, startAt, events);
          fc.pre(isRunning(s) && ms < s.remainingMs);

          const next = deckReducer(s, elapse(ms));

          expect(next.index).toBe(s.index);
          expect(next.remainingMs).toBe(s.remainingMs - ms);
        }
      ),
      {
        examples: [
          [3, 'first', [{ type: 'motion', reduce: false }], 1],
          [3, 'first', [{ type: 'motion', reduce: false }], SLIDE_MS - 1],
        ],
      }
    );
  });
});
