import { TOUR_PAGES } from './tourPages';

/**
 * 기능 안내 6장 모션의 값 표(TRIP-1596 · S2) — 순수 함수 `tourMotionFrame(장, 경과 ms)` 하나가 "그 시각에 어떤 조각이 어떤 값인가"를 답한다.
 * 값은 Figma 타임라인(2.4초, manual keyframe)을 ms 로 옮긴 것이다. 화면은 장마다 시계 하나(0→2400)를 돌리고 이 함수가 읽는다(`barMorph.ts` 와 같은 분업).
 * 끝 프레임(2400ms)은 S1 정지 화면과 같은 값이다 — 불투명 1·이동 0·확대 1·경로 폭 전체(`heart-outline`·`check-ring` 만 투명).
 */

export const TOUR_MOTION_MS = 2400;
/** 장을 떠난 뒤 시작 프레임으로 되돌리기까지의 지연 — `다음` 슬라이드(~0.3초)가 끝난 뒤여야 떠나는 장이 빈 무대로 안 보이고, 재방문 땐 이미 되돌아가 있다. */
export const TOUR_RESET_DELAY_MS = 550;

export interface TourPiece {
  opacity: number;
  translateY: number;
  scale: number;
}
export interface TourMotionFrame {
  /** 점선이 드러난 폭 — 0 → 그 장 `route.width`. */
  routeClipWidth: number;
  /** 정류장 핀(6장은 도착 핀). */
  stop: TourPiece;
  /** 장별 조각 — 키는 `ITEMS` 표 그대로. */
  items: Record<string, TourPiece>;
}

/** 키프레임 = `[ms, 값]` 쌍. 첫 시각 전·마지막 시각 후는 상수, 사이는 한 방향으로 움직인다. */
type Keyframes = readonly (readonly [number, number])[];
interface PieceSpec {
  opacity?: Keyframes;
  translateY?: Keyframes;
  scale?: Keyframes;
}

const ROUTE_END_MS = 1000;

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

// 아래 세 도우미는 "처음 값 → 0(또는 1)" 흔한 모양을 표로 펴 준다 — 값 자체는 Figma 표 그대로다.
const slideFade = (
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
const fadeIn = (start: number, end: number): PieceSpec => ({
  opacity: [
    [start, 0],
    [end, 1],
  ],
});
const fadeOut = (start: number, end: number): PieceSpec => ({
  opacity: [
    [start, 1],
    [end, 0],
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
    // 채움이 들어올 때 외곽선이 같이 빠진다 — 끝 모양이 S1 의 분홍 하트 하나가 되게.
    'heart-outline': fadeOut(1400, 1500),
  },
  2: { card: slideFade(1400, 1900, 1800, 8) },
  3: {
    'pin-0': slideFade(1400, 1650, 1600, -8),
    'pin-1': slideFade(1550, 1800, 1750, -8),
    'pin-2': slideFade(1700, 1950, 1900, -8),
    'pin-3': slideFade(1850, 2100, 2050, -8),
    'label-0': fadeIn(1650, 1900),
    'label-1': fadeIn(1800, 2050),
    'label-2': fadeIn(1950, 2200),
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
    'check-ring': fadeOut(1400, 1550),
    push: slideFade(1800, 2200, 2100, -16),
  },
  // 5장 숫자는 카운트업 없이 투명도만(AC4).
  5: {
    'stat-0': fadeIn(1400, 1700),
    'stat-1': fadeIn(1600, 1900),
    'stat-2': fadeIn(1800, 2100),
  },
  6: {
    'row-user': slideFade(1400, 1700, 1700, 8),
    'row-reply': slideFade(1800, 2100, 2100, 8),
  },
};

// 곡선: 각 속성의 첫 구간은 ease-out(1-(1-x)²), 되돌아오는 둘째 구간(하트·체크의 1.2·1.15 → 1)은 ease-in-out. Figma 곡선과 눈으로 구분 불가한 근사.
function easeOut(x: number): number {
  'worklet';
  return 1 - (1 - x) * (1 - x);
}
function easeInOut(x: number): number {
  'worklet';
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
}

function track(
  ms: number,
  keys: Keyframes | undefined,
  neutral: number
): number {
  'worklet';
  if (!keys) return neutral;
  if (ms <= keys[0][0]) return keys[0][1];
  for (let i = 0; i + 1 < keys.length; i += 1) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (ms < t1) {
      const x = (ms - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (i === 0 ? easeOut(x) : easeInOut(x));
    }
  }
  return keys[keys.length - 1][1];
}

function piece(spec: PieceSpec, ms: number): TourPiece {
  'worklet';
  return {
    opacity: track(ms, spec.opacity, 1),
    translateY: track(ms, spec.translateY, 0),
    scale: track(ms, spec.scale, 1),
  };
}

/** `elapsedMs` 는 0~2400 으로 클램프 — 음수는 출발, 2400 초과는 끝(반복 없음). UI 스레드에서도 불리므로 worklet. */
export function tourMotionFrame(
  page: number,
  elapsedMs: number
): TourMotionFrame {
  'worklet';
  const ms = Math.min(TOUR_MOTION_MS, Math.max(0, elapsedMs));
  const specs = ITEMS[page];
  const items: Record<string, TourPiece> = {};
  Object.keys(specs).forEach((key) => {
    items[key] = piece(specs[key], ms);
  });
  return {
    routeClipWidth: track(
      ms,
      [
        [0, 0],
        [ROUTE_END_MS, TOUR_PAGES[page - 1].route.width],
      ],
      0
    ),
    stop: piece(STOP, ms),
    items,
  };
}
