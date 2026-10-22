import {
  TOUR_MOTION_MS,
  TOUR_RESET_DELAY_MS,
  tourMotionFrame,
  type TourPiece,
} from './tourMotion';
import { TOUR_PAGES } from './tourPages';

/**
 * TRIP-1596 · 기능 안내 6장 모션의 **값 계약** — 순수 함수 `tourMotionFrame(장, 경과 ms)`.
 *
 * 무엇을 보장하나(AC1·AC2 끝 모양·AC4·AC7):
 *  - 0ms 는 출발 프레임(경로 폭 0·정류장/조각 숨김), 2400ms 는 끝 프레임(S1 정지 화면과 같은 값: 불투명 1·이동 0·확대 1·클립 폭 전체).
 *  - 구간 순서: 경로(0–1000) → 정류장 핀(1000–1400) → 장별 조각(1400 이후)이고, 전부 2400 안에 끝난다.
 *  - 값은 키프레임 사이에서 한 방향으로만 움직이고(튀지 않고) 키프레임 밖에서는 상수다. 끝난 뒤 시간을 더 줘도 같다(반복 없음).
 *  - 조각 값은 불투명도·세로 이동·확대 세 가지뿐이다 — 숫자 카운트업을 끼울 칸이 없다(AC4).
 *
 * 커버하지 않는 것: 이징 곡선의 느낌(키프레임 값과 단조·구간만 본다 — README 판정 4), 이 값이 화면에 연결됐는가(OnboardingTourView.test).
 * 왜 순수 함수 숫자 테스트인가: reanimated 스타일은 jest 에서 첫 렌더 값에 굳어 컴포넌트에서 값을 못 읽는다(barMorph.test 와 같은 분업).
 *
 * 3동작 뼈대: 준비(오라클 표) → 실행(함수에 장·시각을 넣음) → 단언(키프레임 값·단조·순서).
 */

type Prop = 'opacity' | 'translateY' | 'scale';
/** 키프레임 = [ms, 값] 쌍 목록. 첫 시각 전·마지막 시각 후는 상수, 사이는 한 방향 이동. */
type Keyframes = readonly (readonly [number, number])[];
type PieceSpec = Partial<Record<Prop, Keyframes>>;

const NEUTRAL: TourPiece = { opacity: 1, translateY: 0, scale: 1 };

/** 오라클 — 티켓 S2 표(= Figma 타임라인 ms 환산). 구현 수식을 베끼지 않고 키프레임 값만 적는다. */
const STOP: PieceSpec = {
  translateY: [
    [1000, -12],
    [1400, 0],
  ],
  opacity: [
    [1000, 0],
    [1250, 1],
  ],
};

const fade = (
  start: number,
  moveEnd: number,
  fadeEnd: number,
  shift: number
): PieceSpec => ({
  translateY: [
    [start, shift],
    [moveEnd, 0],
  ],
  opacity: [
    [start, 0],
    [fadeEnd, 1],
  ],
});
const opacityOnly = (start: number, end: number): PieceSpec => ({
  opacity: [
    [start, 0],
    [end, 1],
  ],
});

const ITEMS: Record<number, Record<string, PieceSpec>> = {
  1: {
    'heart-fill': {
      opacity: [
        [1400, 0],
        [1500, 1],
      ],
      scale: [
        [1400, 1],
        [1650, 1.2],
        [1900, 1],
      ],
    },
    // 채움이 들어올 때 외곽선은 같이 빠진다 — 끝 모양이 S1 의 분홍 하트 하나가 되게(브리프 §3-7)
    'heart-outline': {
      opacity: [
        [1400, 1],
        [1500, 0],
      ],
    },
  },
  2: { card: fade(1400, 1900, 1800, 8) },
  3: {
    'pin-0': fade(1400, 1650, 1600, -8),
    'pin-1': fade(1550, 1800, 1750, -8),
    'pin-2': fade(1700, 1950, 1900, -8),
    'pin-3': fade(1850, 2100, 2050, -8),
    'label-0': opacityOnly(1650, 1900),
    'label-1': opacityOnly(1800, 2050),
    'label-2': opacityOnly(1950, 2200),
  },
  4: {
    check: {
      opacity: [
        [1400, 0],
        [1550, 1],
      ],
      scale: [
        [1400, 0.6],
        [1600, 1.15],
        [1750, 1],
      ],
    },
    'check-ring': {
      opacity: [
        [1400, 1],
        [1550, 0],
      ],
    },
    push: fade(1800, 2200, 2100, -16),
  },
  5: {
    'stat-0': opacityOnly(1400, 1700),
    'stat-1': opacityOnly(1600, 1900),
    'stat-2': opacityOnly(1800, 2100),
  },
  6: {
    'row-user': fade(1400, 1700, 1700, 8),
    'row-reply': fade(1800, 2100, 2100, 8),
  },
};

const PAGES = [1, 2, 3, 4, 5, 6] as const;
const GRID = Array.from({ length: 2401 }, (_, ms) => ms);

/** 키프레임 표에서 `ms` 시점의 값 범위를 알려 주는 도우미 — 키프레임 밖은 상수. */
function constantOutside(keys: Keyframes | undefined, fallback: number) {
  if (!keys) return { before: fallback, after: fallback };
  return { before: keys[0][1], after: keys[keys.length - 1][1] };
}

const READ = (piece: TourPiece, prop: Prop): number => piece[prop];

describe('tourMotionFrame · 끝값과 구성 (AC1)', () => {
  it.each(PAGES)(
    'M1 %i장: 2400ms 는 끝 프레임이다 — 경로 폭 전체·정류장 중립·조각은 표의 끝값(S1 정지 화면)',
    (page) => {
      // 준비·실행
      const end = tourMotionFrame(page, TOUR_MOTION_MS);

      // 단언
      expect(end.routeClipWidth).toBe(TOUR_PAGES[page - 1].route.width);
      expect(end.stop).toEqual(NEUTRAL);
      Object.entries(ITEMS[page]).forEach(([key, spec]) => {
        (['opacity', 'translateY', 'scale'] as const).forEach((prop) => {
          const keys = spec[prop];
          const expected = keys ? keys[keys.length - 1][1] : NEUTRAL[prop];
          expect(READ(end.items[key], prop)).toBeCloseTo(expected, 6);
        });
      });
    }
  );

  it.each(PAGES)(
    'M2 %i장: 0ms 는 출발 프레임이다 — 경로 폭 0·정류장 숨김(위 12)·조각은 표의 출발값',
    (page) => {
      // 준비·실행
      const start = tourMotionFrame(page, 0);

      // 단언 — 경로는 1px 이 아니라 0 에서 시작한다(1px 이면 2~6장 왼쪽에 점이 남는다, 브리프 §3-3)
      expect(start.routeClipWidth).toBe(0);
      expect(start.stop).toEqual({ opacity: 0, translateY: -12, scale: 1 });
      Object.entries(ITEMS[page]).forEach(([key, spec]) => {
        (['opacity', 'translateY', 'scale'] as const).forEach((prop) => {
          const keys = spec[prop];
          const expected = keys ? keys[0][1] : NEUTRAL[prop];
          expect(READ(start.items[key], prop)).toBeCloseTo(expected, 6);
        });
      });
    }
  );

  it.each(PAGES)(
    'M3 %i장: 움직이는 조각의 이름 목록이 표와 같다(표에 없는 조각이 몰래 움직이지 않는다)',
    (page) => {
      // 준비·실행
      const keys = Object.keys(tourMotionFrame(page, 0).items).sort();

      // 단언
      expect(keys).toEqual(Object.keys(ITEMS[page]).sort());
    }
  );

  it('M4 조각 값은 불투명도·세로 이동·확대 세 칸뿐이다 — 숫자 카운트업을 끼울 칸이 없다 (AC4)', () => {
    PAGES.forEach((page) => {
      const frame = tourMotionFrame(page, 1700);
      [frame.stop, ...Object.values(frame.items)].forEach((piece) =>
        expect(Object.keys(piece).sort()).toEqual([
          'opacity',
          'scale',
          'translateY',
        ])
      );
    });
  });
});

describe('tourMotionFrame · 키프레임 사이의 움직임 (AC1)', () => {
  /** 한 조각 한 속성이 표대로 움직이는지 — 키프레임 값·밖은 상수·사이는 한 방향·구간 안은 끝값이 아니다. */
  function expectFollows(
    read: (ms: number) => number,
    keys: Keyframes | undefined,
    neutral: number,
    label: string
  ) {
    const { before, after } = constantOutside(keys, neutral);
    if (!keys) {
      GRID.filter((ms) => ms % 25 === 0).forEach((ms) =>
        expect([label, ms, read(ms)]).toEqual([label, ms, neutral])
      );
      return;
    }
    keys.forEach(([ms, value]) =>
      expect([label, ms, read(ms)]).toEqual([
        label,
        ms,
        expect.closeTo(value, 6),
      ])
    );
    for (let ms = 0; ms <= keys[0][0]; ms += 25)
      expect(read(ms)).toBeCloseTo(before, 6);
    for (let ms = keys[keys.length - 1][0]; ms <= 2400; ms += 25)
      expect(read(ms)).toBeCloseTo(after, 6);
    for (let i = 0; i + 1 < keys.length; i += 1) {
      const [t0, v0] = keys[i];
      const [t1, v1] = keys[i + 1];
      const lo = Math.min(v0, v1);
      const hi = Math.max(v0, v1);
      let prev = read(t0);
      for (let ms = t0; ms <= t1; ms += 5) {
        const now = read(ms);
        // 한 방향(감소면 ≤, 증가면 ≥) · 두 키프레임 값 밖으로 튀지 않음
        if (v1 >= v0) expect(now).toBeGreaterThanOrEqual(prev - 1e-9);
        else expect(now).toBeLessThanOrEqual(prev + 1e-9);
        expect(now).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(now).toBeLessThanOrEqual(hi + 1e-9);
        prev = now;
      }
      // 구간 한가운데는 아직 끝값이 아니다(계단식으로 한 번에 넘어가는 구현을 거른다)
      const mid = read((t0 + t1) / 2);
      expect(Math.abs(mid - v0)).toBeGreaterThan(1e-6);
      expect(Math.abs(mid - v1)).toBeGreaterThan(1e-6);
    }
  }

  it.each(PAGES)(
    'M5 %i장: 경로 폭은 0–1000ms 에 0 에서 전체까지 한 방향으로 자란다',
    (page) => {
      const width = TOUR_PAGES[page - 1].route.width;
      expectFollows(
        (ms) => tourMotionFrame(page, ms).routeClipWidth,
        [
          [0, 0],
          [1000, width],
        ],
        width,
        `route-${page}`
      );
    }
  );

  it.each(PAGES)(
    'M6 %i장: 정류장/도착 핀은 1000–1400ms 에 위 12 에서 제자리로, 1000–1250ms 에 투명에서 불투명으로',
    (page) => {
      (['opacity', 'translateY', 'scale'] as const).forEach((prop) =>
        expectFollows(
          (ms) => READ(tourMotionFrame(page, ms).stop, prop),
          STOP[prop],
          NEUTRAL[prop],
          `stop-${page}-${prop}`
        )
      );
    }
  );

  it.each(PAGES)(
    'M7 %i장: 장별 조각이 표의 구간·값대로 움직인다(시작·끝·되돌림 정점·단조)',
    (page) => {
      Object.entries(ITEMS[page]).forEach(([key, spec]) =>
        (['opacity', 'translateY', 'scale'] as const).forEach((prop) =>
          expectFollows(
            (ms) => READ(tourMotionFrame(page, ms).items[key], prop),
            spec[prop],
            NEUTRAL[prop],
            `${page}-${key}-${prop}`
          )
        )
      );
    }
  );
});

describe('tourMotionFrame · 순서와 길이 (AC1)', () => {
  /** 처음으로 "출발 프레임과 달라진" 시각(1ms 해상도). */
  function firstMoveOf(
    page: number,
    pick: (frame: ReturnType<typeof tourMotionFrame>) => number[]
  ): number {
    const start = pick(tourMotionFrame(page, 0));
    const found = GRID.find((ms) =>
      pick(tourMotionFrame(page, ms)).some(
        (value, index) => Math.abs(value - start[index]) > 1e-9
      )
    );
    if (found === undefined) throw new Error(`${page}장: 움직임 없음`);
    return found;
  }
  const lastMoveOf = (
    page: number,
    pick: (frame: ReturnType<typeof tourMotionFrame>) => number[]
  ): number => {
    const end = pick(tourMotionFrame(page, 2400));
    let last = -1;
    GRID.forEach((ms) => {
      if (
        pick(tourMotionFrame(page, ms)).some(
          (value, index) => Math.abs(value - end[index]) > 1e-9
        )
      )
        last = ms;
    });
    return last + 1; // 마지막으로 끝값과 달랐던 시각의 다음 ms = 끝난 시각
  };
  const routeOf = (f: ReturnType<typeof tourMotionFrame>) => [f.routeClipWidth];
  const stopOf = (f: ReturnType<typeof tourMotionFrame>) => [
    f.stop.opacity,
    f.stop.translateY,
    f.stop.scale,
  ];
  const itemsOf = (f: ReturnType<typeof tourMotionFrame>) =>
    Object.keys(f.items)
      .sort()
      .flatMap((key) => [
        f.items[key].opacity,
        f.items[key].translateY,
        f.items[key].scale,
      ]);

  it.each(PAGES)(
    'M8 %i장: 경로가 끝난 뒤에 핀이 움직이기 시작하고, 핀이 시작한 뒤에 장별 조각이 시작한다',
    (page) => {
      const routeDone = lastMoveOf(page, routeOf);
      const stopStart = firstMoveOf(page, stopOf);
      const itemsStart = firstMoveOf(page, itemsOf);

      expect(routeDone).toBeLessThanOrEqual(stopStart); // 경로 끝 ≤ 핀 시작 (1000 ≤ 1001)
      expect(stopStart).toBeLessThanOrEqual(itemsStart); // 핀 시작 ≤ 조각 시작 (1001 ≤ 1401)
    }
  );

  it.each(PAGES)(
    'M9 %i장: 모든 것이 2400ms 안에 끝난다 — 2400 이후 어떤 시각을 넣어도 끝 프레임과 같다 (AC7 반복 없음)',
    (page) => {
      const end = tourMotionFrame(page, TOUR_MOTION_MS);

      [2401, 3000, 10_000, 3_600_000].forEach((ms) =>
        expect(tourMotionFrame(page, ms)).toEqual(end)
      );
      // 가장 늦게 끝나는 조각도 2400 이전이다(4장 푸시 카드 2200)
      expect(lastMoveOf(page, itemsOf)).toBeLessThanOrEqual(2400);
    }
  );

  it.each(PAGES)(
    'M10 %i장: 음수 시각은 출발 프레임으로 취급한다(시계가 되감겨도 범위를 벗어나지 않는다)',
    (page) => {
      expect(tourMotionFrame(page, -50)).toEqual(tourMotionFrame(page, 0));
    }
  );

  it('M11 같은 입력은 늘 같은 출력이다(순수) · 길이 상수는 2400', () => {
    expect(TOUR_MOTION_MS).toBe(2400);
    expect(tourMotionFrame(3, 1234)).toEqual(tourMotionFrame(3, 1234));
  });
});

describe('tourMotionFrame · 실행 환경 계약', () => {
  it('M12 worklet 이다 — 진입 함수와, 그 함수가 부르는 도우미(__closure 로 잡힌 함수 전부)까지 지시어가 있어야 한다. 빠지면 앱이 죽는데 jest 는 모른다', () => {
    // 실검증(02a §5): jest-expo 의 babel 이 reanimated 플러그인을 돌려 'worklet' 함수에 해시를 붙이고, 그 함수가 부르는 함수는
    // `__closure`(캡처 목록)에 값으로 담는다. 도우미에 지시어가 없으면 캡처는 되지만 `__workletHash` 가 없다.
    type Worklet = {
      __workletHash?: unknown;
      __closure?: Record<string, unknown>;
    };
    const seen = new Set<unknown>();
    const missing: string[] = [];
    const walk = (fn: Worklet, name: string): void => {
      if (seen.has(fn)) return;
      seen.add(fn);
      if (typeof fn.__workletHash !== 'number') missing.push(name);
      Object.entries(fn.__closure ?? {}).forEach(([key, value]) => {
        if (typeof value === 'function') walk(value as Worklet, key);
      });
    };

    walk(tourMotionFrame as unknown as Worklet, 'tourMotionFrame');

    expect(missing).toEqual([]);
    // 앵커 — 도우미를 실제로 따라갔다(진입 함수 하나만 보고 끝난 것이 아님): 진입 함수 + 도우미 둘 이상
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('M13 떠난 장을 시작 프레임으로 되돌리는 지연은 0.5~0.6초다 (슬라이드가 끝난 뒤, 재방문 번쩍임 방지)', () => {
    expect(TOUR_RESET_DELAY_MS).toBeGreaterThanOrEqual(500);
    expect(TOUR_RESET_DELAY_MS).toBeLessThanOrEqual(600);
  });
});
