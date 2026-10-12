import { render, screen } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-1342 · 실제 경로 레이어(BR-U10-37·41 · US-PLANB-13). 옵트인 `actualRoute={segments}`:
 *  - 세그먼트마다 점선 폴리라인 1개 — 세그먼트끼리 잇지 않는다(공백 = 실제로 가지 않은 직선이 생기지 않게).
 *  - 실제 경로가 켜지면 계획 연결선은 muted-soft 얇게(흰 외곽선 없음)로 낮춘다.
 *  - 미전달이면 지금 그대로(무회귀 — 기존 MapView 테스트 전부).
 * 선 모양·대비·실제 공백은 시뮬레이터 육안(6-b). 목은 prop 기록형이라 prop 전달까지만 본다.
 *
 * 3동작 뼈대: 준비=핀·세그먼트 → 실행=MapView 렌더 → 단언=오버레이 개수·prop.
 */
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL: string | undefined;
ORIGINAL = process.env[CLIENT_ID_KEY];
beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[CLIENT_ID_KEY];
  else process.env[CLIENT_ID_KEY] = ORIGINAL;
});

const CENTER: MapCenter = { lat: 37.57, lng: 126.98 };
const PINS: MapPin[] = [
  { number: 1, lat: 37.57, lng: 126.98 },
  { number: 2, lat: 37.58, lng: 126.99 },
];
const SEG_A: MapCenter[] = [
  { lat: 37.57, lng: 126.98 },
  { lat: 37.571, lng: 126.981 },
];
const SEG_B: MapCenter[] = [
  { lat: 37.578, lng: 126.988 },
  { lat: 37.58, lng: 126.99 },
  { lat: 37.581, lng: 126.991 },
];

describe('MapView actualRoute (TRIP-1342)', () => {
  it('AR1 세그먼트 2개 → 실제 경로 오버레이 2개, 각자 자기 점만(둘을 잇는 선 없음)', () => {
    render(
      <MapView center={CENTER} pins={PINS} actualRoute={[SEG_A, SEG_B]} />
    );
    const segs = screen.getAllByTestId('map-route-segment');
    expect(segs).toHaveLength(2);
    expect(segs[0].props.coords).toEqual([
      { latitude: 37.57, longitude: 126.98 },
      { latitude: 37.571, longitude: 126.981 },
    ]);
    expect(segs[1].props.coords).toHaveLength(3);
  });

  it('AR2 실제 경로는 빨강 점선 · 흰 외곽선 없음', () => {
    render(<MapView center={CENTER} actualRoute={[SEG_A]} />);
    const seg = screen.getByTestId('map-route-segment');
    expect(seg.props.color).toBe('#FF385C');
    expect(Array.isArray(seg.props.pattern)).toBe(true);
    expect(seg.props.pattern.length).toBeGreaterThanOrEqual(2);
    expect(seg.props.outlineWidth).toBeUndefined();
  });

  it('AR3 실제 경로가 켜지면 계획 연결선은 muted-soft 로 낮아지고 외곽선이 없다', () => {
    render(<MapView center={CENTER} pins={PINS} actualRoute={[SEG_A]} />);
    const plan = screen.getByTestId('map-path');
    expect(plan.props.color).toBe('#9AA1AB');
    expect(plan.props.outlineWidth ?? 0).toBe(0);
    expect(plan.props.width).toBeLessThan(2.75);
  });

  it('AR4 미전달이면 지금 그대로(빨강 2.75 + 흰 외곽선, 실제 경로 0)', () => {
    render(<MapView center={CENTER} pins={PINS} />);
    expect(screen.queryAllByTestId('map-route-segment')).toHaveLength(0);
    const plan = screen.getByTestId('map-path');
    expect(plan.props.color).toBe('#FF385C');
    expect(plan.props.width).toBe(2.75);
    expect(plan.props.outlineColor).toBe('#FFFFFF');
  });

  it('AR5 점이 2개 미만인 세그먼트는 그리지 않는다(SDK 는 coords ≥ 2 를 요구한다)', () => {
    render(<MapView center={CENTER} actualRoute={[[SEG_A[0]], SEG_B]} />);
    expect(screen.getAllByTestId('map-route-segment')).toHaveLength(1);
  });

  it('AR6 빈 배열이면 실제 경로 0 · 계획 선은 낮추지 않는다', () => {
    render(<MapView center={CENTER} pins={PINS} actualRoute={[]} />);
    expect(screen.queryAllByTestId('map-route-segment')).toHaveLength(0);
    expect(screen.getByTestId('map-path').props.color).toBe('#FF385C');
  });
});
