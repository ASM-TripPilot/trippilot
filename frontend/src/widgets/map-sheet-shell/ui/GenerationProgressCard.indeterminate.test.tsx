import { act, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { GenerationProgressCard } from './GenerationProgressCard';
import type { GenerationProgressCell } from './GenerationProgressCard';

/**
 * TRIP-1205 · i05 재계획 로딩 — 진행 카드 active 칸의 인디터미닛 막대.
 * 측정 기법은 `shared/ui/Skeleton.test.tsx` 와 같다(네이티브 드라이버 애니메이션을 JS 로 돌려 값을 뜬다).
 *
 * ⚠️ 원리적 사각: 막대가 실제로 좌→우로 흐르는 모습·꼬리/머리 색은 jest 가 못 본다(6-b 육안).
 */

const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

const BAR = 'generation-progress-indeterminate';
const CELLS: GenerationProgressCell[] = [
  { status: 'done', label: '방문한 곳 그대로' },
  { status: 'active', label: '17시 이후 다시 짜는 중' },
];

const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
const reduceMotionDefault = reduceMotionMock.getMockImplementation();
const realTiming = Animated.timing;

let driverSpy: jest.SpyInstance;
let timingSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  driverSpy = jest
    .spyOn(NativeAnimatedHelper.default, 'shouldUseNativeDriver')
    .mockReturnValue(false);
  // 설정 인자는 원본대로 기록하되 실제로는 JS 로 돌린다(Skeleton.test 와 같은 이유).
  timingSpy = jest
    .spyOn(Animated, 'timing')
    .mockImplementation((value, config) =>
      realTiming(value, { ...config, useNativeDriver: false })
    );
});

afterEach(() => {
  jest.useRealTimers();
  driverSpy.mockRestore();
  timingSpy.mockRestore();
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

function face(): string {
  return JSON.stringify(
    hostNodes(screen.getByTestId(BAR)).map(
      (node) => StyleSheet.flatten(node.props.style)?.transform
    )
  );
}

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

async function renderCard(cells: GenerationProgressCell[] = CELLS) {
  const view = render(
    <GenerationProgressCard cells={cells} onBack={jest.fn()} />
  );
  await act(async () => {});
  return view;
}

describe('🔴 IB-1 — active 칸에만 인디터미닛 막대가 있고 반복해서 흐른다', () => {
  it('active 트랙 안에 막대가 1개, done 트랙에는 없다', async () => {
    await renderCard();

    expect(screen.getAllByTestId(BAR)).toHaveLength(1);
    const track2 = screen.getByTestId('generation-gauge-track-2');
    expect(hostNodes(track2).some((n) => n.props.testID === BAR)).toBe(true);
    const track1 = screen.getByTestId('generation-gauge-track-1');
    expect(hostNodes(track1).some((n) => n.props.testID === BAR)).toBe(false);
  });

  it('시간이 흐르면 위치가 바뀌고 한 바퀴를 넘긴 뒤에도 계속 바뀐다(loop)', async () => {
    await renderCard();

    const faces = sampleFaces(6000);

    expect(new Set(faces).size).toBeGreaterThan(1);
    expect(new Set(faces.slice(4000 / 20)).size).toBeGreaterThan(1);
  });

  it('timing 설정이 있고 전부 useNativeDriver: true 다', async () => {
    await renderCard();
    sampleFaces(500);

    const configs = timingSpy.mock.calls.map(
      (call) => call[1] as { useNativeDriver?: boolean }
    );
    expect(configs.length).toBeGreaterThan(0);
    configs.forEach((c) => expect(c.useNativeDriver).toBe(true));
  });

  it('active 칸이 없으면 막대도 없다(h07 완성 상태)', async () => {
    await renderCard([{ status: 'done', label: '1일차 완성' }]);

    expect(screen.queryByTestId(BAR)).toBeNull();
  });
});

describe('🔴 IB-2 — 동작 줄이기면 정지, 사라지면 멈춘다', () => {
  it('동작 줄이기가 켜져 있으면 막대는 있되 위치가 변하지 않는다', async () => {
    reduceMotionMock.mockResolvedValue(true);
    await renderCard();

    expect(screen.getByTestId(BAR)).toBeOnTheScreen();
    expect(new Set(sampleFaces(3000)).size).toBe(1);
  });

  it('언마운트 뒤에는 시간이 흘러도 애니메이션 값이 더 바뀌지 않는다', async () => {
    const view = await renderCard();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    const values = timingSpy.mock.calls.map(
      (c) => c[0] as { __getValue: () => number }
    );
    expect(values.length).toBeGreaterThan(0);

    view.unmount();
    const before = values.map((v) => v.__getValue());
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(values.map((v) => v.__getValue())).toEqual(before);
  });
});

describe('🔴 IB-3 — 퍼센트·남은 시간 표기가 없다(INV-3)', () => {
  it('카드 텍스트에 % 나 분·초 표기가 없다', async () => {
    await renderCard();

    const texts = screen.root
      .findAll(
        (n) => typeof n.type === 'string' && (n.type as string) === 'Text'
      )
      .map((n) => String(n.props.children));
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((t) => {
      expect(t).not.toMatch(/%|\d+\s*초|\d+\s*분|남은/);
    });
  });
});
