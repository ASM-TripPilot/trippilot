import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { MapPin } from '@/shared/map';

import { MapSheetShell } from './MapSheetShell';

/**
 * TRIP-1076 (3) · AC-3 — 셸이 "핀 전부 맞추기"(`fitPins`)를 자기 지도까지 흘린다(옵셔널 additive).
 *
 * 무엇을 보장하나:
 *  - 🔴 FS1 `fitPins` 를 주면 셸이 소유한 `<MapView>` 가 핀 전부를 담는 `region` 으로 열리고 `camera` 는 없다.
 *    결과 화면(h07·h08·h11·h14·h16)이 이 prop 하나로 옵트인한다.
 *  - 🟢 FS2 미전달이면 지금과 같다 — `region` 없이 `camera`(center) 경로(다른 셸 소비처 무회귀).
 *
 * 실 MapView 를 태운다 — 네이버 목(`__mocks__/@mj-studio/react-native-naver-map.tsx`)의 `map-native` 에
 * region·camera 가 그대로 실린다. 키가 없으면 MapView 가 실패 표면으로 떨어지므로 키를 넣고 돈다.
 * ⚠️ 실제 카메라 이동·시트가 가리는 영역은 jest 사각(6-b 실기 — Seed Q3: 시트 인셋 미반영).
 *
 * 3동작 뼈대: 준비=키 + 핀 3개 → 실행=셸 렌더(fitPins 유무) → 단언=map-native 의 region/camera.
 */

jest.mock('@gorhom/bottom-sheet');

// no-dynamic-env-var 회피 — 선언과 대입을 분리(MapView.test 선례).
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

const CENTER = { lat: 35.1532, lng: 129.1186 };
// 광안리·황령산·해운대 — 서로 수 km 떨어진 결과 동선 3곳.
const PINS: MapPin[] = [
  { number: 1, lat: 35.1532, lng: 129.1186 },
  { number: 2, lat: 35.1573, lng: 129.0819 },
  { number: 3, lat: 35.1587, lng: 129.1604 },
];

function renderShell(fitPins?: boolean) {
  render(
    <MapSheetShell
      center={CENTER}
      pins={PINS}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      fitPins={fitPins}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
}

function nativeProps(): Record<string, unknown> {
  return screen.getByTestId('map-native').props as Record<string, unknown>;
}

describe('TRIP-1076 · 셸 핀 맞추기 통과 (AC-3)', () => {
  it('🔴 FS1 fitPins 를 주면 셸 지도가 세 핀을 모두 담는 region 으로 열리고 camera 는 없다', () => {
    renderShell(true);

    const region = nativeProps().region as NativeRegion | undefined;
    expect(region).toBeDefined();
    if (region === undefined) return;
    PINS.forEach(({ lat, lng }) => {
      expect(lat).toBeGreaterThanOrEqual(region.latitude);
      expect(lat).toBeLessThanOrEqual(region.latitude + region.latitudeDelta);
      expect(lng).toBeGreaterThanOrEqual(region.longitude);
      expect(lng).toBeLessThanOrEqual(region.longitude + region.longitudeDelta);
    });
    // ★ 택일 — camera 가 같이 가면 SDK 가 region 을 버린다(목은 둘 다 기록해 공허 통과할 수 있다).
    expect(nativeProps().camera).toBeUndefined();
  });

  it('🟢 FS2 미전달이면 region 없이 camera(center) 로 연다 (기존 셸 소비처 무회귀)', () => {
    renderShell();

    expect(nativeProps().region).toBeUndefined();
    expect(nativeProps().camera).toBeDefined();
  });
});
