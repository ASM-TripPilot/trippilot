import { act, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { VisitRecordCard } from './VisitRecordCard';

/**
 * TRIP-1125 · j01 방문 완료 체크 등장(AC-14·AC-15) — 같은 `visitCheckId` 카드가 진행 중 → 완료로
 * **바뀌는 순간만** 체크가 한 번 나타난다. 리스트 key 가 visitCheckId 라 완료 때 카드는 재마운트되지
 * 않는다(낙관 완료) — 그래서 재렌더로 전이를 흉내 낸다.
 * 측정 기법은 `GeneratingScreen.test.tsx` 「단계 펄스」 describe 와 같다(JS 드라이버 강제 + 가짜 타이머).
 *
 * 하트와 달리 "누른 뒤에만"을 묻지 않는다 — 진행 중 → 완료로 가는 길은 사용자의 [완료] 하나뿐이다.
 */

const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

type Card = React.ComponentProps<typeof VisitRecordCard>['card'];

const ARRIVED = '2026-08-31T14:20:00';
const COMPLETED = '2026-08-31T15:05:00';
const DONE = 'record-visit-check-done-v1';
const ACTIVE = 'record-visit-check-active-v1';

const card = (completedAt: string | null): Card => ({
  visitCheckId: 'v1',
  poiId: 'p1',
  nameKo: '광안리',
  slotKey: null,
  arrivedAt: ARRIVED,
  completedAt,
  skippedAt: null,
  arrivedLabel: '14:20',
});

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

type Face = { opacity: unknown; scales: unknown[] }[];

function readFace(): Face {
  return hostNodes(screen.getByTestId(DONE)).map((node) => {
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

/** 완전히 보인다 — 흐리지도 줄거나 커지지도 않았다. */
function expectFullyVisible(face: Face): void {
  face.forEach(({ opacity, scales }) => {
    expect([undefined, 1]).toContain(opacity);
    scales.forEach((scale) => expect(scale).toBe(1));
  });
}

async function flush(): Promise<void> {
  await act(async () => {});
}

describe('🔴 C-1 · AC-14 — 진행 중 → 완료로 바뀌는 순간 체크가 한 번 나타난다', () => {
  it('완료 체크의 모양이 변했다가 2초 안에 완전히 보이는 상태로 멈추고, 설정은 네이티브 드라이버다', async () => {
    const view = render(<VisitRecordCard card={card(null)} />);
    await flush();
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();

    view.rerender(<VisitRecordCard card={card(COMPLETED)} />);
    await flush();

    expect(screen.getByTestId(DONE)).toBeOnTheScreen();
    expect(screen.queryByTestId(ACTIVE)).toBeNull();

    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBeGreaterThan(1);
    // 1회 — 2초 이후 창은 정지(반복이면 red), 마지막엔 완전히 보인다.
    expect(distinct(faces.slice(2000 / 20))).toBe(1);
    expectFullyVisible(faces[faces.length - 1]);

    const configs = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[1] as { useNativeDriver?: boolean })
    );
    expect(configs.length).toBeGreaterThan(0);
    configs.forEach((config) => expect(config.useNativeDriver).toBe(true));
  });
});

describe('C-2·C-3 · AC-15 — 바뀌는 순간이 아니면 애니메이션 없이 완전히 보인다', () => {
  it('처음부터 완료 상태로 마운트하면(j01 진입·일차 전환·스크롤 재마운트) 체크가 그대로 보인다', async () => {
    render(<VisitRecordCard card={card(COMPLETED)} />);
    await flush();

    expect(screen.getByTestId(DONE)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectFullyVisible(faces[0]);
  });

  it('동작 줄이기가 켜져 있으면 진행 중 → 완료여도 애니메이션 없이 바로 완전히 보인다', async () => {
    reduceMotionMock.mockResolvedValue(true);
    const view = render(<VisitRecordCard card={card(null)} />);
    await flush();

    view.rerender(<VisitRecordCard card={card(COMPLETED)} />);
    await flush();

    expect(screen.getByTestId(DONE)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectFullyVisible(faces[0]);
  });
});

/** 동작 줄이기 답을 붙잡아 둔다 — 돌려받은 함수로 원하는 때 답한다. */
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

describe('🔴 C-4·C-5 (5-b W1·W2) — 등장이 시작 전·도중에 끊기면 체크 크기가 남지 않는다', () => {
  it('C-4 동작 줄이기 답이 오기 전에 카드가 사라지면(일차 전환·화면 이탈) 답이 와도 등장 애니메이션이 돌지 않는다', async () => {
    const answerReduceMotion = holdReduceMotionAnswer();
    const view = render(<VisitRecordCard card={card(null)} />);

    view.rerender(<VisitRecordCard card={card(COMPLETED)} />);
    // 등장에 쓰일 값 — 화면이 사라지면 노드로는 못 읽으니 애니메이션 설정에 넘어간 값을 직접 본다.
    const configured = animationConfigSpies.flatMap((spy) =>
      spy.mock.calls.map((call) => call[0] as unknown)
    );
    expect(configured.length).toBeGreaterThan(0);
    const checkScale = configured[configured.length - 1] as {
      __getValue: () => number;
    };

    view.unmount();
    // RN 이 언마운트 뒤 타이머로 값을 떼어 내며 멈춰 주는 창(02a ★17)을 지나 답한다.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    await answerReduceMotion(false);

    const values: number[] = [];
    for (let t = 0; t < 3000; t += 20) {
      act(() => {
        jest.advanceTimersByTime(20);
      });
      values.push(checkScale.__getValue());
    }
    expect(new Set(values)).toEqual(new Set([1]));
  });

  it('C-5 등장 도중 완료가 되돌려졌다가(낙관 완료 실패) 다시 완료되면 중간 크기로 남지 않는다', async () => {
    const view = render(<VisitRecordCard card={card(null)} />);
    await flush();

    view.rerender(<VisitRecordCard card={card(COMPLETED)} />);
    await flush();
    const midPop = sampleFaces(40);
    // 짝 — 정말 등장 도중에 되돌렸다.
    expect(
      midPop[midPop.length - 1].some(({ scales }) =>
        scales.some((scale) => scale !== 1)
      )
    ).toBe(true);

    view.rerender(<VisitRecordCard card={card(null)} />);
    await flush();
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();

    // 다시 완료 — 이번엔 동작 줄이기라 애니메이션이 값을 1 로 되돌려 주지 않는다.
    reduceMotionMock.mockResolvedValue(true);
    view.rerender(<VisitRecordCard card={card(COMPLETED)} />);
    await flush();

    expect(screen.getByTestId(DONE)).toBeOnTheScreen();
    const faces = sampleFaces(3000);
    expect(distinct(faces)).toBe(1);
    expectFullyVisible(faces[0]);
  });
});
