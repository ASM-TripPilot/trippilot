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
 * TRIP-1522 사이클 4 · 허브 하단 바 4단계 모프의 **단계 함수**(순수) 계약.
 *
 * 왜 순수 함수로 시험하나: 바의 폭·확대·불투명도는 reanimated 가 만드는 스타일이라 jest 에서 읽으면 첫 렌더 값에 굳는다(02a ★1).
 * 그래서 "시간(ms) → 각 요소의 값" 표를 이 함수 하나로 만들고, 여기서 숫자로 시험한다. 컴포넌트 테스트(LiveBottomBar.test)는
 * 값이 아니라 **눈에 보이는 결과 상태**(시작 5칸·컷 이후 시작 칸 제거·퇴장 끝 5칸·onBack 시점)만 본다.
 *
 * 무엇을 보장하나(영상 실측 §3):
 *  - 입장: ① 0.10s 확대(×1.03) → ② 일정만 남기고 시작 칸 컷 → ③ 0.20s ease-out 폭 330→264(오른쪽 끝 고정)·일정 칸이 3번째→맨 앞
 *    → ④ ③ 끝 약 0.06s 전부터 뒤로 원이 자라고 수정·챗봇·행사가 작고 투명→1배로 왼→오 시차 등장.
 *  - 퇴장: ⓐ 뒤로 원·오른쪽 3칸 즉시(0.05s) 사라짐 → ⓑ 0.29s 펼침 → ⓒ 홈·탐색·기록·마이 왼→오 등장(총 0.40s), 확대 없음.
 *  - 끝값: 최종 구조 폭 264 · 뒤로 58 · 칸 61(일정 칸 중심 106.5 = 66 + 10 + 61/2) · 시작 5칸 폭 330 · 일정 중심 165.
 * 정확한 ms 는 6-b 에서 조정할 수 있으므로 경계는 **허용 범위**로 묶고(영상 오차), 곡선은 ease-out 이라는 것까지만 본다.
 * 실제 화면이 이 값대로 움직이는지는 jest 사각 → 6-b.
 */

const EPS = 1e-9;
const DIRECTIONS: BarMorphDirection[] = ['enter', 'exit'];
/** 1ms 해상도로 0~700ms 를 훑는다 — "처음 ~가 된 시각"을 찾는 용도. */
const GRID = Array.from({ length: 701 }, (_, ms) => ms);

function firstAt(
  direction: BarMorphDirection,
  pred: (frame: BarMorphFrame) => boolean
): number {
  const found = GRID.find((ms) => pred(barMorphFrame(direction, ms)));
  if (found === undefined)
    throw new Error(`${direction}: 조건을 만족하는 시각이 없다`);
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

/** 최종(=퇴장 시작) 프레임: 뒤로 58 + 간격 8 + 캡슐 264 · 일정 중심 106.5 · 새 칸 보임 · 시작 칸 없음. */
function expectFinalShape(frame: BarMorphFrame) {
  expect(frame.barScale).toBe(1);
  expect(frame.barLeft).toBe(66); // 뒤로 58 + 간격 8
  expect(frame.barWidth).toBe(264); // 330 − 66
  expect(frame.scheduleCenterX).toBe(106.5); // 66 + 패딩 10 + 칸 61 의 절반
  expect(frame.backSize).toBe(58);
  frame.newCells.forEach((cell) => {
    expect(cell.opacity).toBe(1);
    expect(cell.scale).toBe(1);
  });
  frame.startCells.forEach((cell) => expect(cell.opacity).toBe(0));
}

describe('barMorph · MF1 끝값 — 시작 5칸 ↔ 최종 구조 (AC-5·6·8)', () => {
  it('입장은 시작 5칸(폭 330·일정 3번째)에서 시작해 최종(뒤로 58·간격 8·캡슐 264·일정 맨 앞)에서 끝난다', () => {
    expectStartShape(barMorphFrame('enter', 0));
    expectFinalShape(barMorphFrame('enter', BAR_ENTER_MS));
  });

  it('퇴장은 최종 구조에서 시작해 시작 5칸에서 끝난다 — 입장의 끝과 시작이 그대로 이어진다', () => {
    expectFinalShape(barMorphFrame('exit', 0));
    expectStartShape(barMorphFrame('exit', BAR_EXIT_MS));
  });
});

describe('barMorph · MF2 영상 경계 허용 범위 (AC-4·5·6·7·8, Q7)', () => {
  it('입장: 컷 ≈0.10s · ③ 길이 ≈0.20s · ④ 는 ③ 끝 0.03~0.10s 전에 시작 · ④ 길이 ≈0.2s · 총 ≈0.46s', () => {
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    const shiftStart = firstAt('enter', (f) => f.barLeft > 0);
    const shiftEnd = firstAt('enter', (f) => f.barLeft >= 66 - EPS);
    const appearStart = firstAt('enter', (f) => f.backSize > 0);
    const appearEnd = firstAt('enter', (f) => f.newCells[2].opacity >= 1 - EPS);

    expect(cut).toBeGreaterThanOrEqual(80);
    expect(cut).toBeLessThanOrEqual(130);
    expect(Math.abs(shiftStart - cut)).toBeLessThanOrEqual(20); // ③ 은 컷 직후
    expect(shiftEnd - shiftStart).toBeGreaterThanOrEqual(160);
    expect(shiftEnd - shiftStart).toBeLessThanOrEqual(260);
    expect(shiftEnd - appearStart).toBeGreaterThanOrEqual(30); // ③ 이 끝나기 전에 ④ 가 시작
    expect(shiftEnd - appearStart).toBeLessThanOrEqual(100);
    expect(appearEnd - appearStart).toBeGreaterThanOrEqual(180);
    expect(appearEnd - appearStart).toBeLessThanOrEqual(280);
    expect(BAR_ENTER_MS).toBeGreaterThanOrEqual(380);
    expect(BAR_ENTER_MS).toBeLessThanOrEqual(520);
  });

  it('퇴장: ⓐ ≈0.05s · ⓑ ≈0.29s · ⓒ 는 ⓑ 시작 0.10~0.24s 뒤 · 총 ≈0.40s', () => {
    const backGone = firstAt('exit', (f) => f.backSize === 0);
    const unfoldEnd = firstAt('exit', (f) => f.barLeft <= EPS);
    const startAppear = firstAt('exit', (f) => f.startCells[0].opacity > 0);

    expect(backGone).toBeGreaterThanOrEqual(30);
    expect(backGone).toBeLessThanOrEqual(70);
    expect(unfoldEnd - backGone).toBeGreaterThanOrEqual(230);
    expect(unfoldEnd - backGone).toBeLessThanOrEqual(330);
    expect(startAppear - backGone).toBeGreaterThanOrEqual(100);
    expect(startAppear - backGone).toBeLessThanOrEqual(240);
    expect(BAR_EXIT_MS).toBeGreaterThanOrEqual(340);
    expect(BAR_EXIT_MS).toBeLessThanOrEqual(460);
  });
});

describe('barMorph · MF3 property — 어느 시각에서도 성립하는 성질 (AC-7·8)', () => {
  const time = fc.double({ min: -100, max: 1000, noNaN: true });
  const ordered = fc
    .tuple(time, time)
    .map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));
  const direction = fc.constantFrom(...DIRECTIONS);

  it('오른쪽 끝은 늘 330 에 고정(왼쪽 끝만 접힌다)이고, 모든 값이 범위 안이다', () => {
    fc.assert(
      fc.property(direction, time, (dir, t) => {
        const frame = barMorphFrame(dir, t);
        expect(Math.abs(frame.barLeft + frame.barWidth - 330)).toBeLessThan(
          1e-6
        );
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
        // 바 전체 확대는 입장 ①에만 있다 — 퇴장에는 없다(영상).
        if (dir === 'exit') expect(frame.barScale).toBe(1);
        else {
          expect(frame.barScale).toBeGreaterThanOrEqual(1);
          expect(frame.barScale).toBeLessThanOrEqual(1.035);
        }
      })
    );
  });

  it('입장은 되돌아가지 않는다 — 왼쪽 끝·뒤로 원·새 칸은 늘고, 일정 칸 중심·시작 칸은 준다', () => {
    fc.assert(
      fc.property(ordered, ([t1, t2]) => {
        const a = barMorphFrame('enter', t1);
        const b = barMorphFrame('enter', t2);
        expect(b.barLeft).toBeGreaterThanOrEqual(a.barLeft - EPS);
        expect(b.backSize).toBeGreaterThanOrEqual(a.backSize - EPS);
        expect(b.scheduleCenterX).toBeLessThanOrEqual(a.scheduleCenterX + EPS);
        b.newCells.forEach((cell, i) =>
          expect(cell.opacity).toBeGreaterThanOrEqual(
            a.newCells[i].opacity - EPS
          )
        );
        b.startCells.forEach((cell, i) =>
          expect(cell.opacity).toBeLessThanOrEqual(
            a.startCells[i].opacity + EPS
          )
        );
      })
    );
  });

  it('퇴장도 되돌아가지 않는다 — 입장의 정반대 방향으로만 움직인다', () => {
    fc.assert(
      fc.property(ordered, ([t1, t2]) => {
        const a = barMorphFrame('exit', t1);
        const b = barMorphFrame('exit', t2);
        expect(b.barLeft).toBeLessThanOrEqual(a.barLeft + EPS);
        expect(b.backSize).toBeLessThanOrEqual(a.backSize + EPS);
        expect(b.scheduleCenterX).toBeGreaterThanOrEqual(
          a.scheduleCenterX - EPS
        );
        b.newCells.forEach((cell, i) =>
          expect(cell.opacity).toBeLessThanOrEqual(a.newCells[i].opacity + EPS)
        );
        b.startCells.forEach((cell, i) =>
          expect(cell.opacity).toBeGreaterThanOrEqual(
            a.startCells[i].opacity - EPS
          )
        );
      })
    );
  });

  it('칸은 왼→오 시차로 나타난다 — 입장은 수정 ≥ 챗봇 ≥ 행사, 퇴장은 홈 ≥ 탐색 ≥ 기록 ≥ 마이 (어느 시각에서도)', () => {
    fc.assert(
      fc.property(time, (t) => {
        const entering = barMorphFrame('enter', t).newCells.map(
          (c) => c.opacity
        );
        expect(entering[0]).toBeGreaterThanOrEqual(entering[1] - EPS);
        expect(entering[1]).toBeGreaterThanOrEqual(entering[2] - EPS);
        const leaving = barMorphFrame('exit', t).startCells.map(
          (c) => c.opacity
        );
        expect(leaving[0]).toBeGreaterThanOrEqual(leaving[1] - EPS);
        expect(leaving[1]).toBeGreaterThanOrEqual(leaving[2] - EPS);
        expect(leaving[2]).toBeGreaterThanOrEqual(leaving[3] - EPS);
      })
    );
  });

  it('시차가 실제로 있다 — 한 시각에 첫 칸은 보이고 마지막 칸은 아직 덜 보이는 순간이 있다(전부 같이 나타나는 구현을 거른다)', () => {
    const gapped = (dir: BarMorphDirection) =>
      GRID.some((ms) => {
        const frame = barMorphFrame(dir, ms);
        const list = (dir === 'enter' ? frame.newCells : frame.startCells).map(
          (cell) => cell.opacity
        );
        return list[0] - list[list.length - 1] > 0.05;
      });
    expect(gapped('enter')).toBe(true);
    expect(gapped('exit')).toBe(true);
  });

  it('범위 밖 시각은 클램프된다 — 음수는 시작 프레임, 총 길이를 넘으면 끝 프레임과 같다', () => {
    expect(barMorphFrame('enter', -50)).toEqual(barMorphFrame('enter', 0));
    expect(barMorphFrame('enter', BAR_ENTER_MS + 500)).toEqual(
      barMorphFrame('enter', BAR_ENTER_MS)
    );
    expect(barMorphFrame('exit', -50)).toEqual(barMorphFrame('exit', 0));
    expect(barMorphFrame('exit', BAR_EXIT_MS + 500)).toEqual(
      barMorphFrame('exit', BAR_EXIT_MS)
    );
  });
});

describe('barMorph · MF4 ② 는 서서히가 아니라 컷, ① 은 ×1.03 (AC-3·4)', () => {
  it('시작 칸 불투명도가 1 에서 0 으로 가는 도중값(0.1~0.9)이 보이는 구간은 35ms 이하다', () => {
    const middle = GRID.filter((ms) => {
      const o = barMorphFrame('enter', ms).startCells[0].opacity;
      return o > 0.1 && o < 0.9;
    });
    expect(middle.length).toBeLessThanOrEqual(35);
    // ① 동안은 5칸이 온전하다.
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    for (let ms = 0; ms < cut - 5; ms += 5)
      expect(barMorphFrame('enter', ms).startCells[0].opacity).toBe(1);
  });

  it('컷 직전까지 바 전체가 ×1.02~1.04 까지 커지고, 컷 이후에는 1 로 돌아온다', () => {
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    const peak = Math.max(
      ...GRID.filter((ms) => ms < cut).map(
        (ms) => barMorphFrame('enter', ms).barScale
      )
    );
    expect(peak).toBeGreaterThanOrEqual(1.02);
    expect(peak).toBeLessThanOrEqual(1.04);
    for (const ms of [cut, cut + 50, BAR_ENTER_MS])
      expect(barMorphFrame('enter', ms).barScale).toBe(1);
  });
});

describe('barMorph · MF5 단계 순서와 비대칭 (AC-7, Q7)', () => {
  it('입장 순서: ② 컷 → ③ 왼쪽 끝 50% → ④ 뒤로 원 보이기 시작 → 새 칸 첫 번째 절반', () => {
    const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
    const halfShift = firstAt('enter', (f) => f.barLeft >= 33);
    const backAppears = firstAt('enter', (f) => f.backSize > 0);
    const firstCellHalf = firstAt('enter', (f) => f.newCells[0].opacity >= 0.5);

    expect(cut).toBeLessThan(halfShift);
    expect(halfShift).toBeLessThan(backAppears);
    expect(backAppears).toBeLessThan(firstCellHalf);
  });

  it('비대칭: 퇴장 펼침(ⓑ)이 입장 접힘(③)보다 길고, 사라짐(ⓐ)이 나타남(④)보다 짧다 — "사라질 땐 즉시, 나타날 땐 서서히"', () => {
    const enterShift =
      firstAt('enter', (f) => f.barLeft >= 66 - EPS) -
      firstAt('enter', (f) => f.barLeft > 0);
    const exitUnfold =
      firstAt('exit', (f) => f.barLeft <= EPS) -
      firstAt('exit', (f) => f.backSize === 0);
    expect(exitUnfold).toBeGreaterThan(enterShift);

    const enterAppear =
      firstAt('enter', (f) => f.newCells[2].opacity >= 1 - EPS) -
      firstAt('enter', (f) => f.backSize > 0);
    const exitVanish = firstAt('exit', (f) => f.backSize === 0);
    expect(exitVanish).toBeLessThan(enterAppear);
  });
});

describe('barMorph · MF6 ease-out — 빠르게 시작해 감속한다 (AC-5)', () => {
  it('③ 과 ⓑ 의 구간 중간에서 이미 60% 넘게 움직였다(선형이면 50%)', () => {
    const shiftStart = firstAt('enter', (f) => f.barLeft > 0) - 1;
    const shiftEnd = firstAt('enter', (f) => f.barLeft >= 66 - EPS);
    const midEnter = barMorphFrame('enter', (shiftStart + shiftEnd) / 2);
    expect(midEnter.barLeft / 66).toBeGreaterThan(0.6);

    const unfoldStart = firstAt('exit', (f) => f.backSize === 0);
    const unfoldEnd = firstAt('exit', (f) => f.barLeft <= EPS);
    const midExit = barMorphFrame('exit', (unfoldStart + unfoldEnd) / 2);
    expect(1 - midExit.barLeft / 66).toBeGreaterThan(0.6);
  });
});

// ── 5-b 후 보강(사이클 4) — 바 폭이 330 이 아닌 기기 (경고-1) ───────────────────────────────────────────────────────
// 바의 실제 폭 = 화면 폭 − 좌우 30×2 라 390 기기(330)가 아니면(iPhone 17 Pro 402 → 342 · 안드로이드 360 → 300 · 430 → 370) 시작 5칸에서
// 일정 칸이 놓인 자리와 최종 구조에서 놓일 자리가 값표(330 기준)와 달라 컷(100ms)·교체(50ms) 순간 일정 아이콘이 옆으로 튄다.
// 계약: `barMorphFrame(direction, elapsedMs, barWidth = 330)`. 뒤로 58 · 간격 8 · 캡슐 안쪽 패딩 10 은 폭과 무관한 고정값이고, 알약
// 폭(= 바 폭 − 왼쪽 끝)·일정 칸 중심은 **바 폭에서 파생**된다(시작 5등분의 3번째 · 최종 4등분의 첫째). 나머지 필드는 폭과 무관.
// 오라클은 구현 수식이 아니라 **기하**(패딩 10 · 칸들이 알약 안쪽을 똑같이 나눔)에서 이 파일이 직접 구한다.
const PAD = 10;
const BACK_AND_GAP = 58 + 8;
const startCenter = (barWidth: number) =>
  PAD + ((barWidth - 2 * PAD) / 5) * 2.5; // 5등분의 3번째 칸 중심
const finalCenter = (barWidth: number) =>
  BACK_AND_GAP + PAD + (barWidth - BACK_AND_GAP - 2 * PAD) / 8; // 4등분의 첫째 칸 중심
/** 폭 300(안드로이드 360)·330(390)·342(402 — iPhone 17 Pro)·360·370(430)·430(490 급 큰 기기). */
const BAR_WIDTHS = [300, 330, 342, 360, 370, 430];

describe('barMorph · MF7 끝값이 바 폭에 맞는다 (경고-1 · AC-5·6)', () => {
  it.each(BAR_WIDTHS)(
    '바 폭 %d: 입장 시작은 알약 폭 = 바 폭 · 일정 중심 = 5등분 3번째, 끝은 캡슐 = 바 폭 − 66 · 칸 폭 = (캡슐 − 20)/4 · 일정 중심 = 4등분 첫째',
    (width) => {
      const start = barMorphFrame('enter', 0, width);
      expect(start.barLeft).toBe(0);
      expect(start.barWidth).toBe(width);
      expect(start.scheduleCenterX).toBeCloseTo(startCenter(width), 9);

      const end = barMorphFrame('enter', BAR_ENTER_MS, width);
      expect(end.barLeft).toBe(66); // 뒤로 58 + 간격 8 — 폭과 무관
      expect(end.backSize).toBe(58);
      expect(end.barWidth).toBe(width - 66); // 캡슐 = 바 폭 − 66
      expect((end.barWidth - 2 * PAD) / 4).toBeCloseTo((width - 86) / 4, 9); // 칸 폭
      expect(end.scheduleCenterX).toBeCloseTo(finalCenter(width), 9);

      // 퇴장은 거울상 — 시작 모양이 최종, 끝 모양이 시작 5칸.
      expect(barMorphFrame('exit', 0, width).scheduleCenterX).toBeCloseTo(
        finalCenter(width),
        9
      );
      expect(
        barMorphFrame('exit', BAR_EXIT_MS, width).scheduleCenterX
      ).toBeCloseTo(startCenter(width), 9);
      expect(barMorphFrame('exit', BAR_EXIT_MS, width).barWidth).toBe(width);
    }
  );

  it('폭을 안 주면 390 기기(330) 값이다 — 사이클 4 의 기존 계약(165 · 106.5 · 264)이 그대로다', () => {
    expect(startCenter(330)).toBe(165);
    expect(finalCenter(330)).toBe(106.5);
    for (const ms of [0, 50, 100, 150, 250, 350, 460]) {
      expect(barMorphFrame('enter', ms)).toEqual(
        barMorphFrame('enter', ms, 330)
      );
      expect(barMorphFrame('exit', ms)).toEqual(barMorphFrame('exit', ms, 330));
    }
  });

  it('폭과 무관한 필드(바 확대 · 왼쪽 끝 · 뒤로 원 · 칸의 불투명도·확대)는 폭이 달라도 같다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DIRECTIONS),
        fc.double({ min: -50, max: 700, noNaN: true }),
        fc.double({ min: 280, max: 460, noNaN: true }),
        (dir, t, width) => {
          const wide = barMorphFrame(dir, t, width);
          const base = barMorphFrame(dir, t, 330);
          expect(wide.barScale).toBe(base.barScale);
          expect(wide.barLeft).toBe(base.barLeft);
          expect(wide.backSize).toBe(base.backSize);
          expect(wide.startCells).toEqual(base.startCells);
          expect(wide.newCells).toEqual(base.newCells);
        }
      )
    );
  });
});

describe('barMorph · MF8 컷·교체 순간 일정 칸이 튀지 않는다 — 어느 바 폭에서도 (경고-1 · AC-4·5·8)', () => {
  const width = fc.double({ min: 280, max: 460, noNaN: true });
  const cut = firstAt('enter', (f) => f.startCells[0].opacity === 0);
  const swap = firstAt('exit', (f) => f.backSize === 0); // 퇴장 ⓐ 끝 = 구조 교체 시각

  it('property: 오른쪽 끝은 늘 바 폭이고, 일정 중심은 항상 [최종, 시작] 사이이며 입장에선 줄고 퇴장에선 는다', () => {
    fc.assert(
      fc.property(
        width,
        fc.double({ min: -50, max: 700, noNaN: true }),
        fc.double({ min: -50, max: 700, noNaN: true }),
        (w, a, b) => {
          const [t1, t2] = a <= b ? [a, b] : [b, a];
          const lo = finalCenter(w);
          const hi = startCenter(w);
          for (const dir of DIRECTIONS) {
            const f1 = barMorphFrame(dir, t1, w);
            const f2 = barMorphFrame(dir, t2, w);
            expect(Math.abs(f1.barLeft + f1.barWidth - w)).toBeLessThan(1e-6);
            for (const f of [f1, f2]) {
              expect(f.scheduleCenterX).toBeGreaterThanOrEqual(lo - 1e-6);
              expect(f.scheduleCenterX).toBeLessThanOrEqual(hi + 1e-6);
            }
            if (dir === 'enter')
              expect(f2.scheduleCenterX).toBeLessThanOrEqual(
                f1.scheduleCenterX + 1e-9
              );
            else
              expect(f2.scheduleCenterX).toBeGreaterThanOrEqual(
                f1.scheduleCenterX - 1e-9
              );
          }
        }
      )
    );
  });

  it('property (a): 입장 컷 직전까지는 시작 5칸의 자리(= 레이아웃이 놓는 자리)에 정확히 있고, 컷을 사이에 두고 값이 불연속이 아니다', () => {
    fc.assert(
      fc.property(width, (w) => {
        const span = startCenter(w) - finalCenter(w);
        // 컷 전: 시작 5칸의 3번째 자리에서 움직이지 않는다(번쩍임의 뿌리 — 값표가 다른 폭 기준이면 여기서 어긋난다).
        for (const ms of [0, 40, cut - 0.5]) {
          expect(barMorphFrame('enter', ms, w).scheduleCenterX).toBeCloseTo(
            startCenter(w),
            9
          );
        }
        // 컷 앞뒤 0.02ms: ③ 곡선의 최대 기울기(= 2/200 per ms)로 허용되는 변화량 이내.
        const before = barMorphFrame('enter', cut - 0.01, w).scheduleCenterX;
        const after = barMorphFrame('enter', cut + 0.01, w).scheduleCenterX;
        expect(Math.abs(after - before)).toBeLessThanOrEqual(
          span * 0.01 * 0.02 + 1e-9
        );
      })
    );
  });

  it('property (b): 퇴장 구조 교체(ⓐ 끝) 앞뒤도 연속이고, 교체 전까지는 최종 구조의 자리(4등분 첫째)에 있다', () => {
    fc.assert(
      fc.property(width, (w) => {
        const span = startCenter(w) - finalCenter(w);
        for (const ms of [0, 25, swap - 0.5]) {
          expect(barMorphFrame('exit', ms, w).scheduleCenterX).toBeCloseTo(
            finalCenter(w),
            9
          );
        }
        const before = barMorphFrame('exit', swap - 0.01, w).scheduleCenterX;
        const after = barMorphFrame('exit', swap + 0.01, w).scheduleCenterX;
        expect(Math.abs(after - before)).toBeLessThanOrEqual(
          span * 0.01 * 0.02 + 1e-9
        );
      })
    );
  });

  it.each([342, 370, 430])(
    '예제 (a)(b): 바 폭 %d 에서 컷·교체 직전과 직후(±0.01ms)의 일정 중심 차이가 0.05pt 미만이고, 컷 직전은 알약 한가운데(바 폭/2)다 — 330 기준 값표를 쓰면 시작 자리가 달라 어긋난다',
    (w) => {
      const beforeCut = barMorphFrame('enter', cut - 0.01, w).scheduleCenterX;
      const afterCut = barMorphFrame('enter', cut + 0.01, w).scheduleCenterX;
      expect(Math.abs(afterCut - beforeCut)).toBeLessThan(0.05);
      expect(beforeCut).toBeCloseTo(w / 2, 6); // 5칸 알약 가운데 칸 = 알약 한가운데
      const beforeSwap = barMorphFrame('exit', swap - 0.01, w).scheduleCenterX;
      const afterSwap = barMorphFrame('exit', swap + 0.01, w).scheduleCenterX;
      expect(Math.abs(afterSwap - beforeSwap)).toBeLessThan(0.05);
      expect(beforeSwap).toBeCloseTo(finalCenter(w), 6);
    }
  );
});

// ── 6-b 후 보강 3 — 입장 시작 지연 상수 ─────────────────────────────────────────────────────────────────────────────
// 허브가 열린 직후(시트가 올라오고 지도·목록이 처음 그려지는 ≈250ms)와 4단계 모프(0.46s)가 겹치면 프레임이 끊긴다(실기 93·42·158ms).
// 계약: 모프는 마운트 후 `BAR_ENTER_DELAY_MS` 가 지나고 `InteractionManager.runAfterInteractions` 가 끝난 뒤 중 늦은 쪽에서 시작한다.
// `barMorphFrame` 은 지연과 무관(입력 경과 ms 는 시작 시점 기준)하다. 이 상수는 지연을 쓰는 컴포넌트 테스트가 시계를 맞추는 기준이라
// 값이 없거나 이상하면(`undefined` → 시계 계산이 NaN 이 되어 지연 테스트가 공허하게 통과) 여기서 먼저 잡는다.
describe('barMorph · MF9 입장 시작 지연 상수 (6-b 후)', () => {
  it('BAR_ENTER_DELAY_MS 는 시트 마운트 애니메이션(≈250ms)을 비켜 가되 모션을 너무 늦추지 않는 유한 정수 ms 다 (기본 300)', () => {
    expect(Number.isInteger(BAR_ENTER_DELAY_MS)).toBe(true);
    expect(BAR_ENTER_DELAY_MS).toBeGreaterThanOrEqual(250);
    expect(BAR_ENTER_DELAY_MS).toBeLessThanOrEqual(600);
  });

  it('단계 함수는 지연과 무관하다 — 경과 0 은 시작 프레임이고 지연만큼 지나도(입력이 시작 시점 기준) 같은 곡선이다', () => {
    expect(barMorphFrame('enter', 0).startCells[0].opacity).toBe(1);
    expect(barMorphFrame('enter', 0).barLeft).toBe(0);
  });
});
