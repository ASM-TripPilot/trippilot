import { render, screen } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-1022 #040 — `MapView` 옵트인 `fitPins`: 켜고 핀이 2개 이상이면 모든 핀이 한 화면에 들어오는
 * 영역(`region`)으로 네이버 지도를 연다.
 *
 * 실 `MapView` 를 태운다 — 네이버 SDK 는 `__mocks__/@mj-studio/react-native-naver-map.tsx`(prop
 * 기록형 목)로 자동 대체돼 `map-native` 의 props 로 `region`·`camera` 를 읽는다.
 *
 * 무엇을 보장하나(01 AC-B1~B3):
 *  - 🔴 F1 `fitPins` + 핀 ≥2 → `region` 을 주고 `camera`·`initialCamera` 는 **안 준다**. SDK 는
 *    `region={!camera && !initialCamera ? region : undefined}` 라 camera 가 같이 가면 region 을 버린다.
 *  - 🔴 F2 값이 같은 새 핀 배열로 다시 그려도 `region` 은 같은 객체다(값 memo — 매 렌더 새 객체면
 *    SDK 가 매번 재이동해 사용자 조작을 되돌린다, 기존 camera memo 와 같은 이유).
 *  - 🟢 F5 (5-c 보강, 03b 참고-1) F2 의 짝 — 핀 **값이 바뀌면** region 도 새로 계산돼 새 핀을 담는다
 *    (memo 가 첫 마운트 값에 얼어붙지 않는다).
 *  - 🟢 F3 `fitPins` 미전달 → 지금과 같다(region 없음, camera = center).
 *  - 🟢 F4 `fitPins` 여도 핀 1개면 region 없이 기존 카메라(줌 값은 6-b 조정 대상이라 적지 않고
 *    `fitPins` 없이 그린 카메라와 같음으로 잰다).
 *
 * 3동작 뼈대: 준비=center·핀·fitPins → 실행=MapView 렌더 → 단언=네이티브 지도가 받은 prop.
 */

// no-dynamic-env-var 회피 — 선언과 대입을 분리한다(MapView.test.tsx 선례).
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

const CENTER: MapCenter = { lat: 37.5796, lng: 126.977 };
// 필수 방문지 3곳 — 첫 핀만 비추던 #040 의 모양(서로 수 km 떨어짐).
const PINS: MapPin[] = [
  { number: 1, lat: 37.5796, lng: 126.977 },
  { number: 2, lat: 37.5512, lng: 126.9882 },
  { number: 3, lat: 37.5704, lng: 127.0092 },
];

function nativeProps(): Record<string, unknown> {
  return screen.getByTestId('map-native').props as Record<string, unknown>;
}

describe('🔴 F1 · AC-B1 — fitPins + 핀 ≥2 → region 을 주고 camera 는 주지 않는다', () => {
  it('region 이 모든 핀을 담고, camera·initialCamera 는 undefined 다', () => {
    render(<MapView center={CENTER} pins={PINS} fitPins />);

    const region = nativeProps().region as NativeRegion | undefined;
    expect(region).toBeDefined();
    if (region === undefined) return;

    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
    PINS.forEach(({ lat, lng }) => {
      expect(lat).toBeGreaterThanOrEqual(region.latitude);
      expect(lat).toBeLessThanOrEqual(region.latitude + region.latitudeDelta);
      expect(lng).toBeGreaterThanOrEqual(region.longitude);
      expect(lng).toBeLessThanOrEqual(region.longitude + region.longitudeDelta);
    });

    // ★ 둘 중 하나만 산다 — camera 가 같이 가면 SDK 가 region 을 버린다(목은 둘 다 기록해 공허 통과).
    expect(nativeProps().camera).toBeUndefined();
    expect(nativeProps().initialCamera).toBeUndefined();
  });
});

describe('🔴 F2 · AC-B1 — region 은 값으로 memo 된다(같은 값의 새 배열이면 같은 객체)', () => {
  it('값이 같은 새 핀 배열로 다시 그려도 region 객체가 바뀌지 않는다', () => {
    const { rerender } = render(
      <MapView center={CENTER} pins={PINS} fitPins />
    );
    const first = nativeProps().region;
    expect(first).toBeDefined();

    // 소비처는 렌더마다 핀 배열을 새로 만든다 — 값은 같고 참조만 다르다.
    rerender(
      <MapView
        center={{ ...CENTER }}
        pins={PINS.map((pin) => ({ ...pin }))}
        fitPins
      />
    );

    expect(nativeProps().region).toBe(first);
  });
});

describe('🟢 F5 · AC-B1 — 핀 값이 바뀌면 region 도 새로 계산된다 (F2 의 짝 · 5-c 보강)', () => {
  it('핀 하나를 멀리 옮겨 다시 그리면 region 이 새 객체가 되고 옮긴 핀을 담는다', () => {
    const { rerender } = render(
      <MapView center={CENTER} pins={PINS} fitPins />
    );
    const first = nativeProps().region as NativeRegion | undefined;
    expect(first).toBeDefined();

    // 3번 핀을 부산으로 — 옛 region(서울 도심 몇 km) 밖이다.
    const busan = { lat: 35.1587, lng: 129.1604 };
    rerender(
      <MapView
        center={CENTER}
        pins={[PINS[0], PINS[1], { number: 3, ...busan }]}
        fitPins
      />
    );

    const next = nativeProps().region as NativeRegion | undefined;
    expect(next).not.toBe(first);
    expect(next).toBeDefined();
    if (next === undefined) return;
    expect(busan.lat).toBeGreaterThanOrEqual(next.latitude);
    expect(busan.lat).toBeLessThanOrEqual(next.latitude + next.latitudeDelta);
    expect(busan.lng).toBeGreaterThanOrEqual(next.longitude);
    expect(busan.lng).toBeLessThanOrEqual(next.longitude + next.longitudeDelta);
  });
});

describe('F3 · AC-B2 — fitPins 미전달이면 지금과 같다 (무회귀 · 선제 green)', () => {
  it('핀이 2개 이상이어도 region 은 없고 camera 는 center 를 비춘다', () => {
    render(<MapView center={CENTER} pins={PINS} />);

    expect(nativeProps().region).toBeUndefined();
    const camera = nativeProps().camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(CENTER.lat);
    expect(camera.longitude).toBe(CENTER.lng);
  });
});

describe('F4 · AC-B3 — fitPins 여도 핀 1개면 기존 카메라 (무회귀 · 선제 green)', () => {
  it('region 은 없고, camera 가 fitPins 없이 그린 카메라와 같다', () => {
    const one: MapPin[] = [PINS[0]];

    const plain = render(<MapView center={CENTER} pins={one} />);
    const expected = nativeProps().camera;
    plain.unmount();

    render(<MapView center={CENTER} pins={one} fitPins />);

    expect(nativeProps().region).toBeUndefined();
    expect(nativeProps().camera).toEqual(expected);
  });
});
