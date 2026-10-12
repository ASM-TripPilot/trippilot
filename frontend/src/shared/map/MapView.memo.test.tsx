import { fireEvent, render, screen } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

import { buildFitRegion } from './fitRegion';

/**
 * TRIP-1349 — MapView 는 memo 다. 같은 props 로 부모가 다시 그려도 본문이 다시 돌지 않고(렌더 횟수는
 * `fitPins` 때만 불리는 buildFitRegion 호출 수로 센다), props 가 바뀌면 그대로 갱신되며,
 * 마커 규약(collapsable={false} · key={pin-N-state} 가 만드는 testID)은 유지된다 (traps-map).
 */
jest.mock('./fitRegion', () => {
  const actual = jest.requireActual('./fitRegion');
  return { ...actual, buildFitRegion: jest.fn(actual.buildFitRegion) };
});

const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];
beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
  (buildFitRegion as jest.Mock).mockClear();
});
afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env[CLIENT_ID_KEY];
  else process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
});

const CENTER: MapCenter = { lat: 33.4996, lng: 126.5312 };
const PINS: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52 },
  { number: 2, lat: 33.515, lng: 126.526 },
];
const renders = (): number => (buildFitRegion as jest.Mock).mock.calls.length;

describe('TRIP-1349 · MapView memo', () => {
  it('MM1 · props 참조가 같으면 부모가 다시 그려도 본문이 돌지 않는다', () => {
    const ui = <MapView center={CENTER} pins={PINS} fitPins />;
    const { rerender } = render(ui);
    const first = renders();
    expect(first).toBeGreaterThan(0);
    rerender(<MapView center={CENTER} pins={PINS} fitPins />);
    expect(renders()).toBe(first);
  });

  it('MM2 · pins 가 바뀌면 마커가 갱신된다(번호 규약 유지)', () => {
    const { rerender } = render(<MapView center={CENTER} pins={PINS} />);
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    rerender(
      <MapView
        center={CENTER}
        pins={[...PINS, { number: 3, lat: 33.52, lng: 126.53 }]}
      />
    );
    expect(screen.getAllByTestId('map-marker')).toHaveLength(3);
    expect(screen.getByTestId('map-marker-pin-3')).toBeTruthy();
    expect(screen.getByTestId('map-marker-pin-3').props.collapsable).toBe(
      false
    );
  });

  it('MM3 · center 가 바뀌면 카메라가 갱신된다', () => {
    const { rerender } = render(<MapView center={CENTER} pins={PINS} />);
    rerender(<MapView center={{ lat: 37.5, lng: 127.0 }} pins={PINS} />);
    const camera = screen.getByTestId('map-native').props.camera as {
      latitude: number;
      longitude: number;
    };
    expect([camera.latitude, camera.longitude]).toEqual([37.5, 127.0]);
  });

  it('MM4 · onPinTap 이 바뀌면 새 콜백이 불린다(옛 콜백 고착 금지)', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(
      <MapView center={CENTER} pins={PINS} onPinTap={first} />
    );
    rerender(<MapView center={CENTER} pins={PINS} onPinTap={second} />);
    fireEvent(screen.getAllByTestId('map-marker')[1], 'tap');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);
  });
});
