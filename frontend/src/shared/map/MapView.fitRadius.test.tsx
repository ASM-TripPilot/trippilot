import { render, screen } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter } from '@/shared/map';

/**
 * TRIP-1043 #044 — `radiusCircle` 을 주면 원 전체가 카드 안에 들어오는 영역(`region`)으로 연다.
 * 줌 14 고정 카메라로는 200pt 카드(세로 ≈1.5km)에 1.1km 원(지름 2.2km) 테두리가 안 들어와, 반경 칩을
 * 바꿔도 사용자 눈엔 원이 안 보였다(04b n=1 FAIL).
 *
 * 3동작: 준비=center·radiusCircle → 실행=MapView 렌더 → 단언=네이티브 지도가 받은 region/camera.
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

type NativeRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const CENTER: MapCenter = { lat: 35.1587, lng: 129.1604 };
/** 위도 1도 ≈ 111,320m — 원의 남·북 끝이 region 안에 드는지 잰다(경도 쪽은 위도 cos 보정). */
const M_PER_DEG_LAT = 111_320;

function nativeProps(): Record<string, unknown> {
  return screen.getByTestId('map-native').props as Record<string, unknown>;
}

function expectCircleInside(radiusM: number): NativeRegion {
  const region = nativeProps().region as NativeRegion | undefined;
  expect(region).toBeDefined();
  if (region === undefined) throw new Error('region 없음');
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng =
    radiusM / (M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180));
  expect(CENTER.lat - dLat).toBeGreaterThanOrEqual(region.latitude);
  expect(CENTER.lat + dLat).toBeLessThanOrEqual(
    region.latitude + region.latitudeDelta
  );
  expect(CENTER.lng - dLng).toBeGreaterThanOrEqual(region.longitude);
  expect(CENTER.lng + dLng).toBeLessThanOrEqual(
    region.longitude + region.longitudeDelta
  );
  // SDK 는 camera 가 같이 가면 region 을 버린다 — 둘 중 하나만.
  expect(nativeProps().camera).toBeUndefined();
  return region;
}

describe('🔴 R1 · radiusCircle → 원 전체를 담는 region 으로 연다', () => {
  it.each([700, 1100, 11_300])(
    '반경 %dm 원의 남북동서 끝이 region 안이다',
    (radiusM) => {
      render(
        <MapView
          center={CENTER}
          viewOnly
          radiusCircle={{ center: CENTER, radiusM }}
        />
      );
      expectCircleInside(radiusM);
    }
  );

  it('반경이 바뀌면 region 폭도 따라 바뀐다(700m < 11.3km)', () => {
    const { rerender } = render(
      <MapView
        center={CENTER}
        radiusCircle={{ center: CENTER, radiusM: 700 }}
      />
    );
    const small = expectCircleInside(700);
    rerender(
      <MapView
        center={CENTER}
        radiusCircle={{ center: CENTER, radiusM: 11_300 }}
      />
    );
    const large = expectCircleInside(11_300);
    expect(large.latitudeDelta).toBeGreaterThan(small.latitudeDelta);
  });
});

describe('🟢 R2 · radiusCircle 미전달이면 기존 center 카메라 그대로(무회귀)', () => {
  it('region 없음 · camera 중심 = center', () => {
    render(<MapView center={CENTER} />);
    expect(nativeProps().region).toBeUndefined();
    const camera = nativeProps().camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(CENTER.lat);
    expect(camera.longitude).toBe(CENTER.lng);
  });
});
