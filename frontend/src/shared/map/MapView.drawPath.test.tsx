import { act, render, screen } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';
import { useAnimatedProbe } from '@/test-support/animatedProbe';

/**
 * TRIP-1385 · `drawPathOnMount` — 경로선이 1번 핀에서 마지막 핀까지 그려진다(옵트인).
 * 네이버 오버레이 목은 props 를 그대로 노출해(`map-path`) progress·passedColor 를 렌더 트리에서 읽는다.
 * 실제 그려지는 모양·끊김은 jest 가 못 본다(6-b 실기).
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

  function markerCount(): number {
    return screen.queryAllByTestId('map-marker').length;
  }

  describe('AC · 옵션 켜짐 — 경로선이 progress·passedColor 를 받고 0 에서 시작한다', () => {
    it('켜면 시작 직후 progress 0, 흐르는 동안 0 과 1 사이, 끝나면 1', async () => {
      probe.setReduceMotion(false);
      render(<MapView center={CENTER} pins={PINS} drawPathOnMount />);
      await flush();

      expect(pathProps().passedColor).toBeDefined();
      expect(pathProps().progress).toBe(0);

      await advance(300);
      const mid = pathProps().progress as number;
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);

      await advance(600);
      expect(pathProps().progress).toBe(1);
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
      expect(pathProps().progress).toBe(0);

      await advance(800);
      expect(pathProps().progress).toBe(1);
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

      expect(pathProps().progress).toBe(1);
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
