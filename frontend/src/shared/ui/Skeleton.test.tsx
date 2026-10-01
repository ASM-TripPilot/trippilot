import { act, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { Skeleton } from './Skeleton';

/**
 * TRIP-1125 · 공용 스켈레톤 부품의 펄스 계약(AC-1~AC-4).
 *
 * 측정 기법은 `features/itinerary/ui/GeneratingScreen.pulse.test.tsx` 와 같다 — jest 의 RN 목은
 * 네이티브 드라이버 애니메이션을 JS 값에 반영하지 않으므로 `shouldUseNativeDriver` 를 false 로
 * 스파이해 JS 로 돌리고, "네이티브로 설정했나"는 `Animated.timing` 등의 설정 인자로 따로 잰다.
 */

// RN 0.81 내부 경로 — 바뀌면 require 가 throw 해 조용히 green 이 되지 않는다.
const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

const TEST_ID = 'skeleton-under-test';
const TOKENS = ['h-[178px]', 'w-full', 'rounded-card', 'bg-surface-strong'];

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

function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostNodes)];
}

/** 움직이는 얼굴 — testID 서브트리 호스트들의 opacity·transform. */
function face(): string {
  return JSON.stringify(
    hostNodes(screen.getByTestId(TEST_ID)).map((node) => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return { opacity: style.opacity, transform: style.transform };
    })
  );
}

/** 20ms 씩 `totalMs` 동안 얼굴을 뜬다. [0] = 흘리기 전. */
function sampleFaces(totalMs: number, stepMs = 20): string[] {
  const faces = [face()];
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      jest.advanceTimersByTime(stepMs);
    });
    faces.push(face());
  }
  return faces;
}

function animatedValues(): { __getValue: () => number }[] {
  return animationConfigSpies.flatMap((spy) =>
    spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
  );
}

function classNamesInSubtree(node: ReactTestInstance): string[] {
  return hostNodes(node).flatMap((host) =>
    typeof host.props.className === 'string'
      ? host.props.className.split(/\s+/)
      : []
  );
}

/** 렌더 후 isReduceMotionEnabled 의 Promise 를 비운다. */
async function renderSkeleton(): Promise<ReturnType<typeof render>> {
  const view = render(
    <Skeleton testID={TEST_ID} className={TOKENS.join(' ')} />
  );
  await act(async () => {});
  return view;
}

describe('🔴 S-1·S-2 · AC-1 — 동작 줄이기가 꺼져 있으면 숨 쉬듯 반복해서 깜빡인다', () => {
  it('시간이 흐르면 투명도가 바뀌고, 한 바퀴를 넘긴 6초 이후에도 계속 바뀐다(반복)', async () => {
    await renderSkeleton();

    const faces = sampleFaces(8000);

    expect(new Set(faces).size).toBeGreaterThan(1);
    // loop 없이 한 번만 깜빡이면 이 창은 정지다(가정: 한 바퀴 ≤ 6초).
    const lateWindow = faces.slice(6000 / 20);
    expect(new Set(lateWindow).size).toBeGreaterThan(1);
  });

  it('Animated.timing/spring/decay 설정이 1개 이상이고 전부 useNativeDriver: true 다', async () => {
    await renderSkeleton();
    sampleFaces(1500);

    const configs = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[1] as { useNativeDriver?: boolean })
    );
    expect(configs.length).toBeGreaterThan(0);
    configs.forEach((config) => expect(config.useNativeDriver).toBe(true));
  });
});

describe('🔴 S-3 · AC-2 — 동작 줄이기가 켜져 있으면 완전히 보이는 정지 상자다', () => {
  it('시간이 흘러도 모양이 그대로이고, 흐려지지 않았다(opacity 1 또는 미지정)', async () => {
    reduceMotionMock.mockResolvedValue(true);
    await renderSkeleton();

    // 짝 — 상자가 실제로 있다(없으면 아래 "안 바뀐다"가 공허하게 통과).
    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();

    const faces = sampleFaces(3000);
    expect(new Set(faces).size).toBe(1);

    hostNodes(screen.getByTestId(TEST_ID)).forEach((node) => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      expect([undefined, 1]).toContain(style.opacity);
    });
  });
});

describe('🔴 S-4·S-5 · AC-3 — 화면에서 사라지면 멈추고, 확인 전에 사라지면 시작하지 않는다', () => {
  it('언마운트 뒤에는 시간이 흘러도 애니메이션 값이 더 바뀌지 않는다', async () => {
    const view = await renderSkeleton();
    act(() => {
      jest.advanceTimersByTime(300);
    });

    const values = animatedValues();
    // 짝 — 펄스 값이 실제로 잡혔다(비면 아래 "안 바뀐다"가 공허 통과).
    expect(values.length).toBeGreaterThan(0);

    view.unmount();
    const before = values.map((value) => value.__getValue());
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(values.map((value) => value.__getValue())).toEqual(before);
  });

  it('동작 줄이기 확인 Promise 가 언마운트 뒤에 풀려도 어떤 애니메이션 값도 움직이지 않는다', async () => {
    const view = render(
      <Skeleton testID={TEST_ID} className={TOKENS.join(' ')} />
    );

    // Promise 를 비우기 **전에** 떠난다 — 그 뒤 풀리는 확인이 시작을 부르면 안 된다.
    view.unmount();
    // RN 은 언마운트 직후 타이머로 값을 떼어 내며 돌던 애니메이션을 멈춘다. 확인이 그보다 늦게 오는
    // 경우를 재야 뒤늦은 시작이 보인다(먼저 비우면 RN 이 대신 멈춰 줘 공허 통과 — 02a ★9 실측).
    act(() => {
      jest.advanceTimersByTime(100);
    });
    await act(async () => {});

    // 확인 뒤에야 애니메이션을 만드는 구현이면 값이 0개일 수 있다 — 그래도 옳다(02a ★9).
    const values = animatedValues();
    const before = values.map((value) => value.__getValue());
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(values.map((value) => value.__getValue())).toEqual(before);
  });
});

describe('🔴 S-6 · AC-4 — testID·className·style 을 그대로 얹는다', () => {
  it('testID 는 한 번만, style 의 폭·높이는 그 노드에서 읽히고, className 토큰은 서브트리에 남는다', async () => {
    render(
      <Skeleton
        testID={TEST_ID}
        className={TOKENS.join(' ')}
        style={{ width: 160, height: 120 }}
      />
    );
    await act(async () => {});

    // 자식에 testID 를 복제하면 개수가 늘어난다(MustVisitPickerScreen countTestId 계약).
    expect(screen.getAllByTestId(TEST_ID)).toHaveLength(1);
    // ExploreLandingScreen.regionFilter 의 toHaveStyle({ width: 160 }) 계약.
    expect(screen.getByTestId(TEST_ID)).toHaveStyle({
      width: 160,
      height: 120,
    });
    // StaySearchScreen.states 의 hasTokenInSubtree(…, 'bg-surface-strong') 계약.
    expect(classNamesInSubtree(screen.getByTestId(TEST_ID))).toEqual(
      expect.arrayContaining(TOKENS)
    );
  });
});
