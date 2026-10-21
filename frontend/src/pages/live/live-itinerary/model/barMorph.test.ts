import fc from 'fast-check';

import {
  BAR_ENTER_DELAY_MS,
  BAR_ENTER_MS,
  BAR_EXIT_MS,
  barMorphFrame,
  type BarMorphDirection,
  type BarMorphFrame,
} from './barMorph';

/**
 * 허브 하단 바 4단계 모프의 **단계 함수**(시간 → 각 요소의 값, 순수) 계약. reanimated 스타일은 jest 에서 첫 렌더 값에 굳어 모션 값을
 * 컴포넌트에서 못 읽으므로 값은 여기서 숫자로 시험하고, 컴포넌트 테스트는 눈에 보이는 결과 상태만 본다. 영상 실측(입장 ①확대 ②컷 ③폭 ④등장,
 * 퇴장 ⓐ즉시 ⓑ펼침 ⓒ등장)의 ms 는 6-b 에서 조정할 수 있어 **허용 범위**로 묶고, 곡선은 ease-out 이라는 것까지만 본다.
 */

const EPS = 1e-9;
const DIRECTIONS: BarMorphDirection[] = ['enter', 'exit'];
/** 1ms 해상도로 0~700ms 를 훑어 "처음 ~가 된 시각"을 찾는다. */
const GRID = Array.from({ length: 701 }, (_, ms) => ms);

function firstAt(
  direction: BarMorphDirection,
  pred: (frame: BarMorphFrame) => boolean
): number {
  const found = GRID.find((ms) => pred(barMorphFrame(direction, ms)));
  if (found === undefined) throw new Error(`${direction}: 해당 시각 없음`);
  return found;
}

const opacities = (frame: BarMorphFrame): number[] => [
  ...frame.startCells.map((cell) => cell.opacity),
  ...frame.newCells.map((cell) => cell.opacity),
];

/** 시작(=퇴장 끝) 프레임: 폭 330 · 일정 중심 165 · 시작 칸 4개 보임 · 뒤로·새 칸 없음. */
function expectStartShape(frame: BarMorphFrame) {
  expect(frame.barScale).toBe(1);
  expect(frame.barLeft).toBe(0);
  expect(frame.barWidth).toBe(330);
  expect(frame.scheduleCenterX).toBe(165);
  expect(frame.backSize).toBe(0);
  frame.startCells.forEach((cell) => {
    expect(cell.opacity).toBe(1);
    expect(cell.scale).toBe(1);
  });
  frame.newCells.forEach((cell) => expect(cell.opacity).toBe(0));
}

/** 최종(=퇴장 시작) 프레임: 뒤로 58 + 간격 8 + 캡슐 264 · 일정 중심 106.5(= 66 + 패딩 10 + 칸 61/2) · 새 칸 보임 · 시작 칸 없음. */
function expectFinalShape(frame: BarMorphFrame) {
  expect(frame.barScale).toBe(1);
  expect(frame.barLeft).toBe(66);
  expect(frame.barWidth).toBe(264);
  expect(frame.scheduleCenterX).toBe(106.5);
  expect(frame.backSize).toBe(58);
  frame.newCells.forEach((cell) => {
    expect(cell.opacity).toBe(1);
    expect(cell.scale).toBe(1);
  });
  frame.startCells.forEach((cell) => expect(cell.opacity).toBe(0));
}

describe('barMorph · 끝값 (시작 5칸 ↔ 최종 구조)', () => {
  it('입장은 시작 5칸에서 시작해 최종 구조에서 끝나고, 퇴장은 그 거울상이다', () => {
    expectStartShape(barMorphFrame('enter', 0));
    expectFinalShape(barMorphFrame('enter', BAR_ENTER_MS));
    expectFinalShape(barMorphFrame('exit', 0));
    expectStartShape(barMorphFrame('exit', BAR_EXIT_MS));
  });
});

describe('barMorph · 영상 경계 허용 범위와 단계 순서', () => {
  it('입장: 컷 ≈0.10s · ③ ≈0.20s · ④ 는 ③ 끝 0.03~0.10s 전에 시작 · ④ ≈0.2s · 총 ≈0.46s, 순서는 컷 → ③ 절반 → ④ 시작', () => {
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    const shiftStart = firstAt('enter', (f) => f.barLeft > 0);
    const halfShift = firstAt('enter', (f) => f.barLeft >= 33);
    const shiftEnd = firstAt('enter', (f) => f.barLeft >= 66 - EPS);
    const appearStart = firstAt('enter', (f) => f.backSize > 0);
    const appearEnd = firstAt('enter', (f) => f.newCells[2].opacity >= 1 - EPS);

    expect(cut).toBeGreaterThanOrEqual(80);
    expect(cut).toBeLessThanOrEqual(130);
    expect(Math.abs(shiftStart - cut)).toBeLessThanOrEqual(20);
    expect(shiftEnd - shiftStart).toBeGreaterThanOrEqual(160);
    expect(shiftEnd - shiftStart).toBeLessThanOrEqual(260);
    expect(shiftEnd - appearStart).toBeGreaterThanOrEqual(30);
    expect(shiftEnd - appearStart).toBeLessThanOrEqual(100);
    expect(appearEnd - appearStart).toBeGreaterThanOrEqual(180);
    expect(appearEnd - appearStart).toBeLessThanOrEqual(280);
    expect(BAR_ENTER_MS).toBeGreaterThanOrEqual(380);
    expect(BAR_ENTER_MS).toBeLessThanOrEqual(520);
    expect(cut).toBeLessThan(halfShift);
    expect(halfShift).toBeLessThan(appearStart);
  });

  it('퇴장: ⓐ ≈0.05s · ⓑ ≈0.29s · ⓒ 는 ⓑ 시작 0.10~0.24s 뒤 · 총 ≈0.40s — "사라질 땐 즉시, 나타날 땐 서서히"(ⓐ < ④, ⓑ > ③)', () => {
    const backGone = firstAt('exit', (f) => f.backSize === 0);
    const unfoldEnd = firstAt('exit', (f) => f.barLeft <= EPS);
    const startAppear = firstAt('exit', (f) => f.startCells[0].opacity > 0);
    const enterShift =
      firstAt('enter', (f) => f.barLeft >= 66 - EPS) -
      firstAt('enter', (f) => f.barLeft > 0);
    const enterAppear =
      firstAt('enter', (f) => f.newCells[2].opacity >= 1 - EPS) -
      firstAt('enter', (f) => f.backSize > 0);

    expect(backGone).toBeGreaterThanOrEqual(30);
    expect(backGone).toBeLessThanOrEqual(70);
    expect(unfoldEnd - backGone).toBeGreaterThanOrEqual(230);
    expect(unfoldEnd - backGone).toBeLessThanOrEqual(330);
    expect(startAppear - backGone).toBeGreaterThanOrEqual(100);
    expect(startAppear - backGone).toBeLessThanOrEqual(240);
    expect(BAR_EXIT_MS).toBeGreaterThanOrEqual(340);
    expect(BAR_EXIT_MS).toBeLessThanOrEqual(460);
    expect(unfoldEnd - backGone).toBeGreaterThan(enterShift);
    expect(backGone).toBeLessThan(enterAppear);
  });

  it('ease-out — ③ 과 ⓑ 의 구간 중간에서 이미 60% 넘게 움직였다(선형이면 50%)', () => {
    expect(barMorphFrame('enter', 200).barLeft / 66).toBeGreaterThan(0.6);
    expect(1 - barMorphFrame('exit', 195).barLeft / 66).toBeGreaterThan(0.6);
  });

  it('② 는 서서히가 아니라 컷이고(도중값 구간 ≤ 35ms), ① 은 컷 직전까지 ×1.02~1.04 로 커졌다 컷 뒤 1 로 돌아온다', () => {
    const middle = GRID.filter((ms) => {
      const o = barMorphFrame('enter', ms).startCells[0].opacity;
      return o > 0.1 && o < 0.9;
    });
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    const peak = Math.max(
      ...GRID.filter((ms) => ms < cut).map(
        (ms) => barMorphFrame('enter', ms).barScale
      )
    );

    expect(middle.length).toBeLessThanOrEqual(35);
    expect(peak).toBeGreaterThanOrEqual(1.02);
    expect(peak).toBeLessThanOrEqual(1.04);
    for (const ms of [cut, cut + 50, BAR_ENTER_MS])
      expect(barMorphFrame('enter', ms).barScale).toBe(1);
  });
});

describe('barMorph · property — 어느 시각에서도 성립하는 성질', () => {
  const time = fc.double({ min: -100, max: 1000, noNaN: true });
  const ordered = fc
    .tuple(time, time)
    .map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));

  it('모든 값이 범위 안이고, 바 전체 확대는 입장 ① 에만 있다', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DIRECTIONS), time, (dir, t) => {
        const frame = barMorphFrame(dir, t);
        expect(frame.barLeft).toBeGreaterThanOrEqual(0);
        expect(frame.barLeft).toBeLessThanOrEqual(66 + 1e-6);
        expect(frame.backSize).toBeGreaterThanOrEqual(0);
        expect(frame.backSize).toBeLessThanOrEqual(58 + 1e-6);
        opacities(frame).forEach((value) => {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        });
        [...frame.startCells, ...frame.newCells].forEach((cell) => {
          expect(cell.scale).toBeGreaterThanOrEqual(0.4 - 1e-9);
          expect(cell.scale).toBeLessThanOrEqual(1.05);
        });
        if (dir === 'exit') expect(frame.barScale).toBe(1);
        else expect(frame.barScale).toBeLessThanOrEqual(1.035);
      })
    );
  });

  it('입장은 되돌아가지 않고(왼쪽 끝·뒤로 원·새 칸은 늘고 일정 중심·시작 칸은 준다) 퇴장은 그 정반대다', () => {
    fc.assert(
      fc.property(ordered, ([t1, t2]) => {
        const ea = barMorphFrame('enter', t1);
        const eb = barMorphFrame('enter', t2);
        expect(eb.barLeft).toBeGreaterThanOrEqual(ea.barLeft - EPS);
        expect(eb.backSize).toBeGreaterThanOrEqual(ea.backSize - EPS);
        expect(eb.scheduleCenterX).toBeLessThanOrEqual(
          ea.scheduleCenterX + EPS
        );
        eb.newCells.forEach((c, i) =>
          expect(c.opacity).toBeGreaterThanOrEqual(ea.newCells[i].opacity - EPS)
        );
        eb.startCells.forEach((c, i) =>
          expect(c.opacity).toBeLessThanOrEqual(ea.startCells[i].opacity + EPS)
        );
        const xa = barMorphFrame('exit', t1);
        const xb = barMorphFrame('exit', t2);
        expect(xb.barLeft).toBeLessThanOrEqual(xa.barLeft + EPS);
        expect(xb.backSize).toBeLessThanOrEqual(xa.backSize + EPS);
        expect(xb.scheduleCenterX).toBeGreaterThanOrEqual(
          xa.scheduleCenterX - EPS
        );
        xb.newCells.forEach((c, i) =>
          expect(c.opacity).toBeLessThanOrEqual(xa.newCells[i].opacity + EPS)
        );
        xb.startCells.forEach((c, i) =>
          expect(c.opacity).toBeGreaterThanOrEqual(
            xa.startCells[i].opacity - EPS
          )
        );
      })
    );
  });

  it('칸은 왼→오 시차로 나타난다 — 어느 시각에서도 앞 칸 ≥ 뒤 칸이고, 실제로 어긋나는 순간이 있다', () => {
    fc.assert(
      fc.property(time, (t) => {
        const entering = barMorphFrame('enter', t).newCells.map(
          (c) => c.opacity
        );
        const leaving = barMorphFrame('exit', t).startCells.map(
          (c) => c.opacity
        );
        for (let i = 1; i < entering.length; i += 1)
          expect(entering[i - 1]).toBeGreaterThanOrEqual(entering[i] - EPS);
        for (let i = 1; i < leaving.length; i += 1)
          expect(leaving[i - 1]).toBeGreaterThanOrEqual(leaving[i] - EPS);
      })
    );
    const gapped = (dir: BarMorphDirection) =>
      GRID.some((ms) => {
        const f = barMorphFrame(dir, ms);
        const list = (dir === 'enter' ? f.newCells : f.startCells).map(
          (c) => c.opacity
        );
        return list[0] - list[list.length - 1] > 0.05;
      });
    expect(gapped('enter')).toBe(true);
    expect(gapped('exit')).toBe(true);
  });
});

// ── 바 폭이 330 이 아닌 기기 ────────────────────────────────────────────────────────────────────────────────────────────
// 바 폭 = 화면 폭 − 60 이라 390 기기(330)가 아니면(402 → 342 · 안드로이드 360 → 300 · 430 → 370) 시작 5칸에서 일정 칸이 놓인 자리와 최종에서 놓일
// 자리가 330 기준 값표와 달라 컷·교체 순간 아이콘이 튄다. `barMorphFrame(direction, ms, barWidth = 330)` — 뒤로 58·간격 8·패딩 10 은 고정,
// 알약 폭·일정 중심은 바 폭에서 파생. 오라클은 구현 수식이 아니라 기하(패딩 10 · 칸들이 알약 안쪽을 똑같이 나눔)에서 직접 구한다.
const PAD = 10;
const BACK_AND_GAP = 58 + 8;
const startCenter = (w: number) => PAD + ((w - 2 * PAD) / 5) * 2.5;
const finalCenter = (w: number) =>
  BACK_AND_GAP + PAD + (w - BACK_AND_GAP - 2 * PAD) / 8;

describe('barMorph · 바 폭이 달라도', () => {
  it.each([300, 342, 430])(
    '바 폭 %d: 끝값이 폭에 맞는다 — 시작 알약 = 폭 · 일정 = 5등분 3번째, 끝 캡슐 = 폭 − 66 · 일정 = 4등분 첫째, 퇴장은 거울상',
    (w) => {
      const start = barMorphFrame('enter', 0, w);
      expect(start.barWidth).toBe(w);
      expect(start.scheduleCenterX).toBeCloseTo(startCenter(w), 9);
      const end = barMorphFrame('enter', BAR_ENTER_MS, w);
      expect(end.barLeft).toBe(66);
      expect(end.barWidth).toBe(w - 66);
      expect(end.scheduleCenterX).toBeCloseTo(finalCenter(w), 9);
      expect(barMorphFrame('exit', 0, w).scheduleCenterX).toBeCloseTo(
        finalCenter(w),
        9
      );
      expect(barMorphFrame('exit', BAR_EXIT_MS, w).scheduleCenterX).toBeCloseTo(
        startCenter(w),
        9
      );
    }
  );

  it('property: 오른쪽 끝은 늘 바 폭이고, 일정 중심은 [최종, 시작] 사이에서 입장엔 줄고 퇴장엔 늘며, 컷·교체 직전까지는 제 구조의 자리에 정확히 있고 그 앞뒤로 튀지 않는다', () => {
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    const swap = firstAt('exit', (f) => f.backSize === 0);
    fc.assert(
      fc.property(
        fc.double({ min: 280, max: 460, noNaN: true }),
        fc.double({ min: 0, max: 700, noNaN: true }),
        fc.double({ min: 0, max: 700, noNaN: true }),
        (w, a, b) => {
          const [t1, t2] = a <= b ? [a, b] : [b, a];
          const span = startCenter(w) - finalCenter(w);
          for (const dir of DIRECTIONS) {
            const f1 = barMorphFrame(dir, t1, w);
            const f2 = barMorphFrame(dir, t2, w);
            expect(Math.abs(f1.barLeft + f1.barWidth - w)).toBeLessThan(1e-6);
            for (const f of [f1, f2]) {
              expect(f.scheduleCenterX).toBeGreaterThanOrEqual(
                finalCenter(w) - 1e-6
              );
              expect(f.scheduleCenterX).toBeLessThanOrEqual(
                startCenter(w) + 1e-6
              );
            }
            const delta = f2.scheduleCenterX - f1.scheduleCenterX;
            if (dir === 'enter') expect(delta).toBeLessThanOrEqual(1e-9);
            else expect(delta).toBeGreaterThanOrEqual(-1e-9);
          }
          // 컷(퇴장은 교체) 직전까지 제 구조의 자리 + 앞뒤 ±0.01ms 차이는 곡선 최대 기울기 이내.
          expect(
            barMorphFrame('enter', cut - 0.5, w).scheduleCenterX
          ).toBeCloseTo(startCenter(w), 9);
          expect(
            barMorphFrame('exit', swap - 0.5, w).scheduleCenterX
          ).toBeCloseTo(finalCenter(w), 9);
          for (const [dir, at] of [
            ['enter', cut],
            ['exit', swap],
          ] as const) {
            const before = barMorphFrame(dir, at - 0.01, w).scheduleCenterX;
            const after = barMorphFrame(dir, at + 0.01, w).scheduleCenterX;
            expect(Math.abs(after - before)).toBeLessThanOrEqual(
              span * 0.0003 + 1e-9
            );
          }
        }
      )
    );
  });
});

describe('barMorph · 입장 시작 지연 상수', () => {
  // 허브가 열린 직후(시트·지도·목록 첫 렌더 ≈250ms)와 모프(0.46s)가 겹치면 프레임이 끊긴다. 컴포넌트 테스트가 이 상수로 시계를 맞추므로
  // 값이 없으면(undefined → NaN) 지연 테스트가 공허하게 통과한다 — 여기서 먼저 잡는다.
  it('BAR_ENTER_DELAY_MS 는 시트 마운트 애니메이션을 비켜 가되 모션을 너무 늦추지 않는 정수 ms 다', () => {
    expect(Number.isInteger(BAR_ENTER_DELAY_MS)).toBe(true);
    expect(BAR_ENTER_DELAY_MS).toBeGreaterThanOrEqual(250);
    expect(BAR_ENTER_DELAY_MS).toBeLessThanOrEqual(600);
  });
});
