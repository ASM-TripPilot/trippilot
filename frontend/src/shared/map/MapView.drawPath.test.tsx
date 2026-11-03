import { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Easing } from 'react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';
import { useAnimatedProbe } from '@/test-support/animatedProbe';

import { DrawnPathOverlay } from './DrawnPathOverlay';

/**
 * TRIP-1385 · `drawPathOnMount` — 경로선이 1번 핀에서 마지막 핀까지 그려진다(옵트인).
 * 네이버 오버레이 목은 props 를 그대로 노출해(`map-path`) progress·passedColor 를 렌더 트리에서 읽는다.
 * 실제 그려지는 모양·끊김은 jest 가 못 본다(6-b 실기).
 * TRIP-1736 — progress 는 reanimated animated props 로 흐른다. host `props.progress` 는 첫 렌더 값(0)에 굳으므로
 * 최신 값은 reanimated jest 경로가 갱신하는 `jestAnimatedProps.value.progress` 로 읽는다(`pathProgress`).
 */

const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

/** host props 의 reanimated 최신 progress(`jestAnimatedProps.value`) — 없으면 NaN. */
function animatedProgress(props: Record<string, unknown>): number {
  const live = props.jestAnimatedProps as
    { value?: { progress?: unknown } } | undefined;
  const value = live?.value?.progress;
  return typeof value === 'number' ? value : Number.NaN;
}

const CENTER: MapCenter = { lat: 37.5, lng: 127.0 };
const PINS: MapPin[] = [
  { number: 1, lat: 37.5, lng: 127.0 },
  { number: 2, lat: 37.51, lng: 127.01 },
  { number: 3, lat: 37.52, lng: 127.02 },
];

describe('TRIP-1385 · MapView drawPathOnMount', () => {
  const probe = useAnimatedProbe();

  async function flush(): Promise<void> {
    await act(async () => {});
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  function pathProps(): Record<string, unknown> {
    return screen.getByTestId('map-path').props as Record<string, unknown>;
  }

  /** 지금 progress — 값이 없으면 NaN(어떤 수 단언도 통과하지 않게). */
  function pathProgress(): number {
    return animatedProgress(screen.getByTestId('map-path').props);
  }

  function markerCount(): number {
    return screen.queryAllByTestId('map-marker').length;
  }

  describe('AC · 옵션 켜짐 — 경로선이 progress·passedColor 를 받고 0 에서 시작한다', () => {
    it('켜면 시작 직후 progress 0, 흐르는 동안 0 과 1 사이, 끝나면 1', async () => {
      probe.setReduceMotion(false);
      render(<MapView center={CENTER} pins={PINS} drawPathOnMount />);
      await flush();

      expect(pathProps().passedColor).toBeDefined();
      expect(pathProgress()).toBe(0);

      await advance(300);
      const mid = pathProgress();
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);

      await advance(600);
      expect(pathProgress()).toBe(1);
    });

    it('지연(delayMs)을 주면 그만큼 0 에 머문다', async () => {
      probe.setReduceMotion(false);
      render(
        <MapView
          center={CENTER}
          pins={PINS}
          drawPathOnMount={{ durationMs: 400, delayMs: 500 }}
        />
      );
      await flush();

      await advance(400);
      expect(pathProgress()).toBe(0);

      await advance(800);
      expect(pathProgress()).toBe(1);
    });
  });

  describe('AC · 무회귀 — 옵션 미전달이면 경로선 prop 이 지금과 같다', () => {
    it('progress·passedColor 를 넘기지 않는다', async () => {
      probe.setReduceMotion(false);
      render(<MapView center={CENTER} pins={PINS} />);
      await flush();

      const props = pathProps();
      expect(props.progress).toBeUndefined();
      expect(props.passedColor).toBeUndefined();
      expect(props.color).toBe('#FF385C');
    });

    it('false 도 미전달과 같다', async () => {
      render(<MapView center={CENTER} pins={PINS} drawPathOnMount={false} />);
      await flush();

      expect(pathProps().progress).toBeUndefined();
    });
  });

  describe('AC · 동작 줄이기 — 곧장 완성 경로', () => {
    it('progress 1 이고 핀도 전부 보인다', async () => {
      probe.setReduceMotion(true);
      render(<MapView center={CENTER} pins={PINS} drawPathOnMount />);
      await flush();
      await advance(16); // 한 프레임 — reanimated 는 값을 다음 프레임에 반영한다(그동안 애니메이션이면 1 에 못 닿는다)

      expect(pathProgress()).toBe(1);
      expect(markerCount()).toBe(3);
    });
  });

  describe('핀 — 경로가 닿는 순서로 나타난다', () => {
    it('처음엔 1번만, 경로가 닿을수록 늘어 끝나면 전부', async () => {
      probe.setReduceMotion(false);
      render(<MapView center={CENTER} pins={PINS} drawPathOnMount />);
      await flush();

      expect(markerCount()).toBe(1);
      expect(screen.getByTestId('map-marker-pin-1')).toBeTruthy();

      await advance(350);
      const mid = markerCount();
      expect(mid).toBeGreaterThan(1);
      expect(mid).toBeLessThanOrEqual(3);

      await advance(600);
      expect(markerCount()).toBe(3);
    });

    it('옵션이 없으면 처음부터 전부 보인다', async () => {
      render(<MapView center={CENTER} pins={PINS} />);
      await flush();

      expect(markerCount()).toBe(3);
    });
  });

  describe('범위 밖', () => {
    it('실제 경로(actualRoute)가 켜진 지도에는 걸리지 않는다', async () => {
      probe.setReduceMotion(false);
      render(
        <MapView
          center={CENTER}
          pins={PINS}
          drawPathOnMount
          actualRoute={[
            [
              { lat: 37.5, lng: 127.0 },
              { lat: 37.51, lng: 127.01 },
            ],
          ]}
        />
      );
      await flush();

      expect(pathProps().progress).toBeUndefined();
      expect(markerCount()).toBe(3);
    });
  });
});

// TRIP-1736 · 경로 그려지기를 reanimated(UI 스레드)로 옮긴 계약 — 오버레이를 직접 그려 렌더 횟수·onReveal 호출을 센다.
// jest 의 "프레임"은 1ms 다(RN jest rAF = setTimeout 0 을 가짜 타이머가 1ms 로 민다). 렌더(커밋)는 act 하나에 뭉치므로
// 1ms 마다 act 를 끊어 센다. 이관 전 실측(같은 장치): 0.9초+0.15초 지연에 커밋 900 · onReveal 5(좌표 5).
describe('TRIP-1736 · DrawnPathOverlay — progress 가 렌더를 일으키지 않는다', () => {
  const probe = useAnimatedProbe();
  const coords = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      latitude: 37.5 + i * 0.01,
      longitude: 127.0,
    }));

  async function stepFrames(ms: number, onFrame?: (t: number) => void) {
    for (let t = 1; t <= ms; t += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      onFrame?.(t);
    }
  }

  function progressNow(): number {
    return animatedProgress(screen.getByTestId('map-path').props);
  }

  function renderOverlay(n: number, onReveal: jest.Mock, onCommit = () => {}) {
    const ui = (count: number) => (
      <Profiler id="path" onRender={onCommit}>
        <DrawnPathOverlay
          coords={coords(count)}
          width={2.75}
          durationMs={900}
          delayMs={150}
          onReveal={onReveal}
        />
      </Profiler>
    );
    const view = render(ui(n));
    return { rerenderWith: (count: number) => view.rerender(ui(count)) };
  }

  it('재생 내내 커밋 0회 — onReveal 만 좌표 수(5)만큼 불리고 끝은 null', async () => {
    probe.setReduceMotion(false);
    const onReveal = jest.fn();
    let commits = 0;
    renderOverlay(5, onReveal, () => {
      commits += 1;
    });
    await act(async () => {});
    const mounted = commits;

    await stepFrames(1150);

    expect(commits - mounted).toBe(0);
    expect(onReveal.mock.calls.map(([count]) => count)).toEqual([
      1,
      2,
      3,
      4,
      null,
    ]);
    expect(progressNow()).toBe(1);
  });

  it('곡선은 지금과 같다 — 0.15초 지연 뒤 0.9초 Easing.inOut(Easing.ease)', async () => {
    probe.setReduceMotion(false);
    renderOverlay(3, jest.fn());
    await act(async () => {});
    // 기대 진행률: 화면 시계가 프레임 반올림으로 앞뒤 몇 ms 어긋나도 되게 ±3ms 창의 양 끝 사이면 통과.
    const curve = (t: number) =>
      Easing.inOut(Easing.ease)(Math.min(1, Math.max(0, (t - 150) / 900)));
    const seen: Record<number, number> = {};
    await stepFrames(1100, (t) => {
      if ([140, 300, 600, 900, 1100].includes(t)) seen[t] = progressNow();
    });

    expect(seen[140]).toBe(0); // 지연 중
    for (const t of [300, 600, 900]) {
      expect(seen[t]).toBeGreaterThanOrEqual(curve(t - 3));
      expect(seen[t]).toBeLessThanOrEqual(curve(t + 3));
    }
    expect(seen[1100]).toBe(1);
  });

  it('동작 줄이기면 첫 프레임에 progress 1 · onReveal(null)', async () => {
    probe.setReduceMotion(true);
    const onReveal = jest.fn();
    renderOverlay(3, onReveal);
    await act(async () => {});
    await stepFrames(16);

    expect(progressNow()).toBe(1);
    // 1(첫 핀만)은 MapView 의 초기값과 같아 무해하다 — 그 밖의 중간 핀 수가 나오면 애니메이션이 돈 것.
    expect(
      onReveal.mock.calls.map(([count]) => count).filter((c) => c !== 1)
    ).toEqual([null]);
  });

  it('재생 중 좌표가 늘면 최신 좌표 수로 핀을 센다(3 → 5)', async () => {
    probe.setReduceMotion(false);
    const onReveal = jest.fn();
    const { rerenderWith } = renderOverlay(3, onReveal);
    await act(async () => {});
    await stepFrames(300); // 진행률 ≈0.08 — 좌표 3·5 어느 쪽이든 아직 1번 핀
    rerenderWith(5);
    await stepFrames(850);

    expect(onReveal.mock.calls.map(([count]) => count)).toEqual([
      1,
      2,
      3,
      4,
      null,
    ]);
  });

  it('마운트 때 한 번만 — 끝난 뒤 좌표가 바뀌어도 다시 돌지 않는다', async () => {
    probe.setReduceMotion(false);
    const onReveal = jest.fn();
    const { rerenderWith } = renderOverlay(3, onReveal);
    await act(async () => {});
    await stepFrames(1100);
    const callsAtEnd = onReveal.mock.calls.length;

    rerenderWith(5);
    await stepFrames(300);

    expect(onReveal.mock.calls.length).toBe(callsAtEnd);
    expect(progressNow()).toBe(1);
  });
});
