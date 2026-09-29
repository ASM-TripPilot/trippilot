import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { GeneratingScreen } from './GeneratingScreen';

/**
 * TRIP-1125 · h07 진행 바(`itinerary-generating-progress`)의 동작 줄이기 계약(AC-9·AC-10, 01b Q2=(b)).
 * 측정 기법은 `GeneratingScreen.pulse.test.tsx` 와 같다(JS 드라이버 강제 + 가짜 타이머).
 *
 * ⚠️ jest 는 `onLayout` 을 부르지 않아 트랙 폭이 0 → translateX 가 항상 0 이다. 폭을 주지 않고
 *   "안 움직인다"를 재면 동작 줄이기를 무시하는 코드도 공허하게 통과한다 — 그래서 layout 이벤트로
 *   폭 300 을 먼저 준다.
 */

const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

const noop = () => {};
const BAR = 'itinerary-generating-progress';
const TRACK_WIDTH = 300;

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

function giveTrackWidth(): void {
  fireEvent(screen.getByTestId(BAR), 'layout', {
    nativeEvent: { layout: { width: TRACK_WIDTH, height: 8 } },
  });
}

function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostNodes)];
}

/**
 * 트랙 안 세그먼트의 폭·translateX. 트랙 바로 아래 자식은 `Animated.View` 합성 노드라 style 에
 * 보간 객체가 들어 있다 — 값이 풀린 **첫 호스트 자손**을 읽는다.
 */
function segment(): { width: number; translateX: number } {
  const [, seg] = hostNodes(screen.getByTestId(BAR));
  if (!seg) throw new Error('진행 바 세그먼트가 없다');
  const style = StyleSheet.flatten(seg.props.style) ?? {};
  const transforms = (style.transform ?? []) as Record<string, unknown>[];
  const translate = transforms.find((entry) => 'translateX' in entry);
  return {
    width: Number(style.width ?? 0),
    translateX: Number(translate?.translateX ?? 0),
  };
}

function sampleSegments(totalMs: number, stepMs = 20): string[] {
  const faces = [JSON.stringify(segment())];
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      jest.advanceTimersByTime(stepMs);
    });
    faces.push(JSON.stringify(segment()));
  }
  return faces;
}

async function renderWithTrack(): Promise<void> {
  render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
  await act(async () => {});
  giveTrackWidth();
}

describe('B-1 · AC-10 — 동작 줄이기가 꺼져 있으면 바가 지금처럼 반복해서 미끄러진다', () => {
  it('세그먼트가 보이고, 시간이 흐르면 움직이며, 한 바퀴를 넘긴 3초 이후에도 움직인다', async () => {
    await renderWithTrack();

    expect(segment().width).toBeGreaterThan(0);

    const faces = sampleSegments(4000);
    expect(new Set(faces).size).toBeGreaterThan(1);
    expect(new Set(faces.slice(3000 / 20)).size).toBeGreaterThan(1);
  });
});

describe('🔴 B-2 · AC-9 · Q2(b) — 동작 줄이기가 켜져 있으면 바가 보이는 채로 한 자리에 멈춘다', () => {
  it('시간이 흘러도 세그먼트가 그대로이고, 트랙 안에 완전히 보인다', async () => {
    reduceMotionMock.mockResolvedValue(true);
    await renderWithTrack();

    const faces = sampleSegments(3000);
    expect(new Set(faces).size).toBe(1);

    // 빈 회색 트랙(세그먼트가 왼쪽 밖에 숨음)이 아니다 — 폭 전체가 트랙 안에 있다.
    const { width, translateX } = segment();
    expect(width).toBeGreaterThan(0);
    expect(translateX).toBeGreaterThanOrEqual(0);
    expect(translateX + width).toBeLessThanOrEqual(TRACK_WIDTH);
  });
});

describe('B-3 · AC-10 — 동작 줄이기 확인이 오기 전에 떠나면 바가 움직이지 않는다', () => {
  it('확인 Promise 가 언마운트 뒤에 풀려도 어떤 애니메이션 값도 움직이지 않는다', async () => {
    const view = render(
      <GeneratingScreen onBackground={noop} onRetry={noop} />
    );
    giveTrackWidth();

    view.unmount();
    // 확인이 RN 의 언마운트 뒤 값 떼어 내기(타이머)보다 늦게 오는 경우 — 먼저 비우면 RN 이 대신 멈춰
    // 줘 뒤늦은 시작이 안 보인다.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    await act(async () => {});

    const values = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
    );
    const before = values.map((value) => value.__getValue());
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(values.map((value) => value.__getValue())).toEqual(before);
  });
});
