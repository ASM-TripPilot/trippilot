import { act, render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { GeneratingScreen } from './GeneratingScreen';

/**
 * TRIP-1046 · h07 생성 중 3단계 원의 **순차 펄스** 계약(QA #025). 기존 `GeneratingScreen.test.tsx`
 * S1~S6 은 건드리지 않고 이 파일에 따로 둔다 — 여기만 가짜 타이머·JS 드라이버 강제를 쓴다.
 *
 * 무엇을 보장하나:
 *  - 🔴 각 단계 행에 펄스 원(`itinerary-generating-pulse-n`)이 정확히 1개, 세 원은 **같은 얼굴**(⚑C —
 *    체크·반채움·`완료`/`대기` 차등 금지).
 *  - 🔴 원이 실제로 움직이고, 시작이 1→2→3 순서로 어긋난다. 애니메이션 설정은 전부 네이티브 드라이버.
 *  - 🔴 기기 "동작 줄이기"가 켜져 있으면 움직이지 않는 완전히 보이는 원.
 *  - 실패·409 얼굴엔 펄스 원이 없다.
 *
 * ⚠️ jest 의 RN 목은 네이티브 드라이버 애니메이션을 JS 값에 반영하지 않는다(02a ★2 실측) — 그래서
 *   `shouldUseNativeDriver` 를 false 로 스파이해 JS 로 돌리고(★3), 대신 "네이티브로 설정했나"는
 *   `Animated.timing` 등의 설정 인자로 따로 잰다.
 *
 * 3동작 뼈대: 준비 = 가짜 타이머·스파이 → 실행 = 렌더 후 시간 흘리기 → 단언 = 원의 모양이 바뀌었나.
 */

// RN 0.81 내부 경로 — 바뀌면 require 가 throw 해 조용히 green 이 되지 않는다(02a ★3).
const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

const noop = () => {};
const PULSE = /^itinerary-generating-pulse-/;
const LABELS = ['장소 수집', '동선 계산', '시간 배치'] as const;

const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
const reduceMotionDefault = reduceMotionMock.getMockImplementation();

let spies: jest.SpyInstance[] = [];
let animationConfigSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  spies = [
    jest
      .spyOn(NativeAnimatedHelper.default, 'shouldUseNativeDriver')
      .mockReturnValue(false),
  ];
  animationConfigSpies = [
    jest.spyOn(Animated, 'timing'),
    jest.spyOn(Animated, 'spring'),
    jest.spyOn(Animated, 'decay'),
  ];
});

afterEach(() => {
  jest.useRealTimers();
  [...spies, ...animationConfigSpies].forEach((spy) => spy.mockRestore());
  if (reduceMotionDefault)
    reduceMotionMock.mockImplementation(reduceMotionDefault);
});

/** 원 서브트리(자기 자신 포함)의 호스트 노드들. */
function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostNodes)];
}

/** 움직이는 얼굴 — 서브트리 호스트들의 opacity·transform(02a ★6). */
function face(n: number): string {
  const dot = screen.getByTestId(`itinerary-generating-pulse-${n}`);
  return JSON.stringify(
    hostNodes(dot).map((node) => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return { opacity: style.opacity, transform: style.transform };
    })
  );
}

/** 구조 서명 — 호스트 타입·className 재귀(testID·style 제외, 02a ★7). */
function signature(node: ReactTestInstance): unknown {
  if (typeof node.type !== 'string') {
    return node.children
      .filter((child): child is ReactTestInstance => typeof child !== 'string')
      .map(signature);
  }
  return {
    type: node.type,
    className: node.props.className,
    children: node.children.map((child) =>
      typeof child === 'string' ? child : signature(child)
    ),
  };
}

/** 20ms 씩 `totalMs` 동안 세 원의 얼굴을 뜬다. [0] = 흘리기 전. */
function sampleFaces(totalMs = 3000, stepMs = 20): string[][] {
  const perDot: string[][] = [[face(1)], [face(2)], [face(3)]];
  for (let t = 0; t < totalMs; t += stepMs) {
    act(() => {
      jest.advanceTimersByTime(stepMs);
    });
    [1, 2, 3].forEach((n, i) => perDot[i].push(face(n)));
  }
  return perDot;
}

/** 마운트 후 isReduceMotionEnabled 의 Promise 를 비운다(02a ★4). */
async function renderProgress(): Promise<void> {
  render(<GeneratingScreen onBackground={noop} onRetry={noop} />);
  await act(async () => {});
}

describe('🔴 P-1 · AC-1 — 단계 행마다 펄스 원 1개, 세 원은 같은 얼굴(⚑C)', () => {
  it('각 단계 행 안에 itinerary-generating-pulse-n 이 정확히 1개씩, 모두 3개다', async () => {
    await renderProgress();

    [1, 2, 3].forEach((n) => {
      const step = screen.getByTestId(`itinerary-generating-step-${n}`);
      const dots = within(step).getAllByTestId(PULSE);
      expect(dots).toHaveLength(1);
      expect(dots[0].props.testID).toBe(`itinerary-generating-pulse-${n}`);
    });
    expect(screen.getAllByTestId(PULSE)).toHaveLength(3);
  });

  it('세 원의 구조(타입·className)가 같고, 행 안 글자는 라벨뿐이다(완료·대기 없음)', async () => {
    await renderProgress();

    const [s1, s2, s3] = [1, 2, 3].map((n) =>
      signature(screen.getByTestId(`itinerary-generating-pulse-${n}`))
    );
    expect(s2).toEqual(s1);
    expect(s3).toEqual(s1);

    LABELS.forEach((label, i) => {
      const step = screen.getByTestId(`itinerary-generating-step-${i + 1}`);
      const texts = within(step)
        .queryAllByText(/.+/)
        .map((node) => node.props.children);
      expect(texts).toEqual([label]);
    });
    expect(screen.queryAllByText(/완료|대기/)).toHaveLength(0);
  });
});

describe('🔴 P-2 · AC-2 — 원이 움직이고, 1→2→3 순서로 번지며, 네이티브 드라이버다', () => {
  it('시간이 흐르면 세 원 모두 모양(opacity/transform)이 바뀐다', async () => {
    await renderProgress();

    const perDot = sampleFaces();

    perDot.forEach((faces) => expect(new Set(faces).size).toBeGreaterThan(1));
  });

  it('처음 움직이기 시작하는 순서가 1번 → 2번 → 3번이다(시작이 어긋난다)', async () => {
    await renderProgress();

    const perDot = sampleFaces();
    const firstMove = perDot.map((faces) =>
      faces.findIndex((f) => f !== faces[0])
    );

    firstMove.forEach((index) => expect(index).not.toBe(-1));
    expect(firstMove[0]).toBeLessThan(firstMove[1]);
    expect(firstMove[1]).toBeLessThan(firstMove[2]);
  });

  it('한 번 깜빡이고 멈추지 않는다 — 3~4초 구간에서도 세 원 모두 모양이 바뀐다(반복)', async () => {
    await renderProgress();

    // 한 바퀴(약 1.2초)+어긋남(0.6초)을 넘긴 뒤의 창만 본다 — loop 없이 한 번만 펄스하면 여기선 정지.
    const perDot = sampleFaces(4000);
    const lateWindow = perDot.map((faces) => faces.slice(3000 / 20));

    lateWindow.forEach((faces) =>
      expect(new Set(faces).size).toBeGreaterThan(1)
    );
  });

  it('Animated.timing/spring/decay 설정이 전부 useNativeDriver: true 다', async () => {
    await renderProgress();
    sampleFaces(1500);

    const configs = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[1] as { useNativeDriver?: boolean })
    );
    // 진행 바 1개 + 펄스 1개 이상.
    expect(configs.length).toBeGreaterThan(1);
    configs.forEach((config) => expect(config.useNativeDriver).toBe(true));
  });
});

describe('P-2d · AC-2 — 화면이 사라지면 펄스도 멈춘다(정리)', () => {
  it('언마운트 뒤에는 시간이 흘러도 어떤 애니메이션 값도 더 바뀌지 않는다', async () => {
    const view = render(
      <GeneratingScreen onBackground={noop} onRetry={noop} />
    );
    await act(async () => {});
    // 1번 원만 출발하고 2·3번은 아직 어긋남 대기 중인 시점에 떠난다.
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // 애니메이션을 건 값들 — timing/spring/decay 의 첫 인자(진행 바 + 펄스).
    const values = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
    );
    // 짝 — 진행 바 1개 + 펄스 값들이 실제로 잡혔다(비면 아래 "안 바뀐다"가 공허 통과).
    expect(values.length).toBeGreaterThan(1);

    view.unmount();
    const before = values.map((value) => value.__getValue());
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(values.map((value) => value.__getValue())).toEqual(before);
  });
});

describe('P-2e · AC-2 — 동작 줄이기 확인이 오기 전에 떠나면 펄스를 시작하지 않는다', () => {
  it('확인 Promise 가 언마운트 뒤에 풀려도 어떤 애니메이션 값도 움직이지 않는다', async () => {
    const view = render(
      <GeneratingScreen onBackground={noop} onRetry={noop} />
    );
    const values = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[0] as { __getValue: () => number })
    );
    expect(values.length).toBeGreaterThan(1);

    // Promise 를 비우기 **전에** 떠난다 — 그 뒤 풀리는 확인이 시작을 부르면 안 된다.
    view.unmount();
    const before = values.map((value) => value.__getValue());
    await act(async () => {});
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(values.map((value) => value.__getValue())).toEqual(before);
  });
});

describe('🔴 P-4 · AC-4 — 동작 줄이기가 켜져 있으면 펄스를 멈춘 완전한 원', () => {
  it('시간이 흘러도 세 원이 그대로이고, 같은 모양이며, 흐려지거나 줄지 않았다', async () => {
    reduceMotionMock.mockResolvedValue(true);
    await renderProgress();

    // 짝 — 원이 실제로 있다(없으면 아래 "안 움직인다"가 공허하게 통과).
    expect(screen.getAllByTestId(PULSE)).toHaveLength(3);

    const perDot = sampleFaces();
    perDot.forEach((faces) => expect(new Set(faces).size).toBe(1));
    expect(perDot[1][0]).toBe(perDot[0][0]);
    expect(perDot[2][0]).toBe(perDot[0][0]);

    [1, 2, 3].forEach((n) => {
      hostNodes(screen.getByTestId(`itinerary-generating-pulse-${n}`)).forEach(
        (node) => {
          const style = StyleSheet.flatten(node.props.style) ?? {};
          expect([undefined, 1]).toContain(style.opacity);
          const transforms = (style.transform ?? []) as Record<
            string,
            unknown
          >[];
          transforms.forEach((entry) => {
            if ('scale' in entry) expect(entry.scale).toBe(1);
          });
        }
      );
    });
  });
});

describe('P-6 · AC-6 — 실패·409 얼굴엔 펄스 원이 없다', () => {
  it('failed 면 실패 표면만 있고 펄스 원은 0개다', async () => {
    render(<GeneratingScreen onBackground={noop} onRetry={noop} failed />);
    await act(async () => {});

    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
  });

  it('busy(다른 여행 생성 중)면 안내만 있고 펄스 원은 0개다', async () => {
    render(
      <GeneratingScreen
        onBackground={noop}
        onRetry={noop}
        busy={{ cancelable: true, onCancelAndRetry: noop, onWait: noop }}
      />
    );
    await act(async () => {});

    expect(screen.getByTestId('itinerary-generation-busy')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
  });
});
