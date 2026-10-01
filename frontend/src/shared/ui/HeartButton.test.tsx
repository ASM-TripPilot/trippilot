import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { HeartButton } from './HeartButton';

/**
 * TRIP-1125 · 하트 담기 튐(AC-11~AC-13) — **이 버튼을 누른 뒤** 안 담김 → 담김으로 바뀌는 순간만 한 번
 * 튄다. 누름 1회가 튐 1회분이고, 누른 뒤 첫 `saved` 변화가 그 몫을 쓴다(담김이면 튐, 안 담김이면 소멸).
 * 측정 기법은 `GeneratingScreen.test.tsx` 「단계 펄스」 describe 와 같다(JS 드라이버 강제 + 가짜 타이머).
 *
 * 처음부터 담긴 채 마운트·담기 취소(true→false)·동작 줄이기 켬·**누르지 않았는데 저장 목록이 늦게 도착**
 * (false→true)은 튀지 않는다 — 없으면 목록이 도착할 때마다 담긴 하트가 전부 튄다(5-b W3).
 */

const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

const ROOT = 'heart-under-test';
const FILLED = 'heart-under-test-filled';
const OUTLINE = 'heart-under-test-outline';

const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
const reduceMotionDefault = reduceMotionMock.getMockImplementation();

const realTiming = Animated.timing;
const realSpring = Animated.spring;
const realDecay = Animated.decay;

let spies: jest.SpyInstance[] = [];
let animationConfigSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  spies = [
    jest
      .spyOn(NativeAnimatedHelper.default, 'shouldUseNativeDriver')
      .mockReturnValue(false),
  ];
  // 설정 인자는 원본(useNativeDriver: true)대로 기록하되 실제로는 JS 로 돌린다 — `Animated.loop` 은
  // shouldUseNativeDriver 가 아니라 설정의 useNativeDriver 를 보고 네이티브 루프로 넘겨서, 그대로
  // 두면 jest 에서 단일 timing 루프가 한 바퀴만 돈다(기기에선 네이티브가 반복한다).
  animationConfigSpies = [
    jest
      .spyOn(Animated, 'timing')
      .mockImplementation((value, config) =>
        realTiming(value, { ...config, useNativeDriver: false })
      ),
    jest
      .spyOn(Animated, 'spring')
      .mockImplementation((value, config) =>
        realSpring(value, { ...config, useNativeDriver: false })
      ),
    jest
      .spyOn(Animated, 'decay')
      .mockImplementation((value, config) =>
        realDecay(value, { ...config, useNativeDriver: false })
      ),
  ];
});

afterEach(() => {
  jest.useRealTimers();
  [...spies, ...animationConfigSpies].forEach((spy) => spy.mockRestore());
  if (reduceMotionDefault)
    reduceMotionMock.mockImplementation(reduceMotionDefault);
});

function heart(saved: boolean) {
  return (
    <HeartButton
      saved={saved}
      onPress={() => {}}
      testID={ROOT}
      filledTestID={FILLED}
      outlineTestID={OUTLINE}
      className="absolute right-sm top-sm"
    />
  );
}

function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostNodes)];
}

type Face = { opacity: unknown; scales: unknown[] }[];

function readFace(): Face {
  return hostNodes(screen.getByTestId(ROOT)).map((node) => {
    const style = StyleSheet.flatten(node.props.style) ?? {};
    const transforms = (style.transform ?? []) as Record<string, unknown>[];
    return {
      opacity: style.opacity,
      scales: transforms
        .filter((entry) => 'scale' in entry)
        .map((entry) => entry.scale),
    };
  });
}

function sampleFaces(totalMs: number, stepMs = 20): Face[] {
  const faces = [readFace()];
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      jest.advanceTimersByTime(stepMs);
    });
    faces.push(readFace());
  }
  return faces;
}

function distinct(faces: Face[]): number {
  return new Set(faces.map((f) => JSON.stringify(f))).size;
}

/** 모든 호스트가 흐려지지도 줄거나 커지지도 않은 제 모양이다. */
function expectAtRest(face: Face): void {
  face.forEach(({ opacity, scales }) => {
    expect([undefined, 1]).toContain(opacity);
    scales.forEach((scale) => expect(scale).toBe(1));
  });
}

function configCount(): number {
  return animationConfigSpies.reduce(
    (sum, spy) => sum + spy.mock.calls.length,
    0
  );
}

async function flush(): Promise<void> {
  await act(async () => {});
}

function press(): void {
  fireEvent.press(screen.getByTestId(ROOT));
}

/** 어떤 표본에서든 scale 이 1 이 아니었다(= 튀었다). */
function popped(faces: Face[]): boolean {
  return faces.some((face) =>
    face.some(({ scales }) => scales.some((scale) => scale !== 1))
  );
}

/**
 * 동작 줄이기 답을 붙잡아 둔다 — 돌려받은 함수로 원하는 때 답한다. 답 오기 전에 상태가 바뀌는 경우를
 * 재려는 것(게이트는 답을 기다리는 동안 정리되면 시작하지 않아야 한다).
 */
function holdReduceMotionAnswer(): (reduce: boolean) => Promise<void> {
  let answer: ((reduce: boolean) => void) | undefined;
  reduceMotionMock.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      })
  );
  return async (reduce) => {
    expect(answer).toBeDefined();
    await act(async () => {
      answer?.(reduce);
    });
  };
}

describe('🔴 H-1 · AC-11·AC-13 — 누른 뒤 안 담김 → 담김으로 바뀌는 순간 하트가 한 번 튄다', () => {
  it('scale 이 1 에서 벗어났다가 2초 안에 1 로 돌아와 멈추고, 설정은 네이티브 드라이버이며 판정 속성은 그대로다', async () => {
    const view = render(heart(false));
    await flush();
    const callsBefore = configCount();

    press();
    view.rerender(heart(true));
    await flush();
    const faces = sampleFaces(3000);

    // 튐 — 어떤 순간 scale 이 1 이 아니다.
    expect(popped(faces)).toBe(true);
    // 1회 — 2초 이후 창은 정지(반복이면 red), 마지막엔 제 모양.
    expect(distinct(faces.slice(2000 / 20))).toBe(1);
    expectAtRest(faces[faces.length - 1]);

    const configs = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[1] as { useNativeDriver?: boolean })
    );
    expect(configs.length).toBeGreaterThan(callsBefore);
    configs.forEach((config) => expect(config.useNativeDriver).toBe(true));

    // AC-13 — 튐을 얹어도 담김 판정은 루트 한 노드에 그대로 있다(HomeScreen.spotSave H-5).
    const root = screen.getByTestId(ROOT);
    expect(root).toBeSelected();
    expect(root.props.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['h-8', 'w-8', 'rounded-pill', 'bg-on-primary'])
    );
    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    expect(screen.queryByTestId(OUTLINE)).toBeNull();
  });
});

describe('H-2~H-4 · AC-12 — 바뀌는 순간이 아니면 튀지 않는다', () => {
  it('처음부터 담긴 채로 마운트하면 튀지 않고 제 모양이다', async () => {
    render(heart(true));
    await flush();

    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });

  it('눌러서 담김 → 안 담김(담기 취소)으로 바뀌면 튀지 않는다', async () => {
    const view = render(heart(true));
    await flush();

    press();
    view.rerender(heart(false));
    await flush();

    expect(screen.getByTestId(OUTLINE)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });

  it('동작 줄이기가 켜져 있으면 눌러서 안 담김 → 담김이어도 튀지 않고 바로 제 모양이다', async () => {
    reduceMotionMock.mockResolvedValue(true);
    const view = render(heart(false));
    await flush();

    press();
    view.rerender(heart(true));
    await flush();

    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });
});

describe('🔴 H-5~H-7 · AC-12 (5-b W3) — 튐은 누름 1회당 최대 1회, 누르지 않은 변화로는 튀지 않는다', () => {
  it('H-5 누르지 않았는데 안 담김 → 담김(저장 목록 늦게 도착·로그인 뒤 도착)이면 튀지 않는다', async () => {
    const view = render(heart(false));
    await flush();

    view.rerender(heart(true));
    await flush();

    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });

  it('H-6 누른 뒤 담김 반영이 늦어도 1회 튀고, 그 뒤 누름 없는 안 담김 → 담김에는 다시 튀지 않는다', async () => {
    const view = render(heart(false));
    await flush();

    // 누른 직후엔 아직 안 담김(서버 응답 대기·실패로 그대로) — 누름 몫이 남아 있다.
    press();
    view.rerender(heart(false));
    await flush();
    expect(popped(sampleFaces(500))).toBe(false);

    // 담김이 늦게 도착 — 누름 몫으로 1회 튄다.
    view.rerender(heart(true));
    await flush();
    const first = sampleFaces(3000);
    expect(popped(first)).toBe(true);
    expectAtRest(first[first.length - 1]);

    // 몫을 썼다 — 이후 데이터만으로 오가는 변화(롤백 → 목록 재도착)에는 안 튄다.
    view.rerender(heart(false));
    await flush();
    view.rerender(heart(true));
    await flush();
    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const again = sampleFaces(3000);
    expect(distinct(again)).toBe(1);
    expectAtRest(again[0]);
  });

  it('H-7 담긴 하트를 눌러 취소하면 누름 몫이 소멸해, 이후 누름 없는 안 담김 → 담김에는 튀지 않는다', async () => {
    const view = render(heart(true));
    await flush();

    press();
    view.rerender(heart(false));
    await flush();

    view.rerender(heart(true));
    await flush();

    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });
});

describe('🔴 H-8·H-9 (5-b W1·W2) — 튐이 시작 전·도중에 되돌려지면 안 담김 하트는 제 크기로 남는다', () => {
  it('H-8 동작 줄이기 답이 오기 전에 담김 → 안 담김(낙관 저장 롤백·빠른 취소)이면 답이 와도 튀지 않는다', async () => {
    const answerReduceMotion = holdReduceMotionAnswer();
    const view = render(heart(false));

    press();
    view.rerender(heart(true));
    // 답을 기다리는 사이 되돌려진다.
    view.rerender(heart(false));
    await answerReduceMotion(false);

    expect(screen.getByTestId(OUTLINE)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });

  it('H-9 튀는 도중 담김 → 안 담김(저장 실패 롤백)이면 커진 채로 남지 않고 곧바로 제 크기다', async () => {
    const view = render(heart(false));
    await flush();

    press();
    view.rerender(heart(true));
    await flush();
    const midPop = sampleFaces(60);
    // 짝 — 정말 튀는 도중에 되돌렸다(아니면 아래 "제 크기"가 공허하게 통과한다).
    expect(popped(midPop.slice(-1))).toBe(true);

    view.rerender(heart(false));
    await flush();

    expect(screen.getByTestId(OUTLINE)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });
});

describe('🔴 H-10·H-11 (5-b W7) — 담기·취소를 한 번 더 반복해도 계약이 그대로다', () => {
  it('H-10 담긴 채 마운트 → 눌러 취소 → 다시 눌러 담으면 한 번 튄다', async () => {
    const view = render(heart(true));
    await flush();

    press();
    view.rerender(heart(false));
    await flush();

    press();
    view.rerender(heart(true));
    await flush();

    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(popped(faces)).toBe(true);
    expectAtRest(faces[faces.length - 1]);
  });

  it('H-11 눌러 담고(튐) → 눌러 취소 → 누름 없이 담김이 다시 도착하면 더 튀지 않는다', async () => {
    const view = render(heart(false));
    await flush();

    press();
    view.rerender(heart(true));
    await flush();
    // 짝 — 첫 담기는 정말 튀었다.
    expect(popped(sampleFaces(3000))).toBe(true);

    press();
    view.rerender(heart(false));
    await flush();

    view.rerender(heart(true));
    await flush();

    expect(screen.getByTestId(FILLED)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectAtRest(faces[0]);
  });
});
