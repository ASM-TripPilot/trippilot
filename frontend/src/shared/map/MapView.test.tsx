import * as fs from 'fs';
import * as path from 'path';

import { render, screen } from '@testing-library/react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-863 (S1) — 공급자 중립 `MapView`(네이버 네이티브) 코어 교체. 01b AC1~7 통합.
 *
 * 이 파일은 `@/shared/map` 배럴의 실제 `MapView`(구현 전)를 태운다 — 얇은 카카오 목
 * (`kakaoMapViewMock`)이 아니라 코어 진짜 테스트다. 네이버 SDK 는 네이티브 모듈이라
 * `__mocks__/@mj-studio/react-native-naver-map.tsx`(prop-기록형 목)가 자동 적용된다:
 * NaverMapView→testID="map-native", 마커→"map-marker", 경로선→"map-path" 로 렌더하고
 * props 를 그대로 노출해 viewOnly 4토글·onTap 을 관측한다.
 *
 * 구현 전엔 배럴에 `MapView` export 가 없어 `undefined` → render 가 던진다(정상 red).
 */

// no-dynamic-env-var(eslint-plugin-expo) 회피 — 선언과 대입을 분리한다(computed 접근이
// 선언과 한 문장이면 룰에 걸린다, KakaoMapView.viewOnly.test.tsx 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  // 정상 케이스는 키가 있어야 지도가 뜬다(없으면 무조건 map-failure).
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

const CENTER: MapCenter = { lat: 33.4996, lng: 126.5312 };
const PINS: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52 },
  { number: 2, lat: 33.515, lng: 126.526 },
];

const GESTURE_TOGGLES = [
  'isScrollGesturesEnabled',
  'isZoomGesturesEnabled',
  'isRotateGesturesEnabled',
  'isTiltGesturesEnabled',
] as const;

describe('🔴 AC1 — 정상: center + pins 2개 → map-native, 마커 2개, 경로선 1개', () => {
  it('map-root 아래 map-native·마커 pins개·경로선 1개가 그려지고 실패 표면은 없다', () => {
    // Arrange + Act
    render(<MapView center={CENTER} pins={PINS} />);

    // Assert
    expect(screen.getByTestId('map-root')).toBeTruthy();
    expect(screen.getByTestId('map-native')).toBeTruthy();
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(PINS.length);
    expect(screen.queryByTestId('map-path')).not.toBeNull();
    expect(screen.queryByTestId('map-failure')).toBeNull();
  });

  it('center 의 lat/lng 가 뒤바뀌지 않고 네이티브 지도로 전달된다(좌표 스왑 회귀 방지)', () => {
    // 리포에 위/경도 스왑이 tsc 에러 없이 통과하는 함정 선례가 있다(둘 다 number).
    // 목이 initialCamera 를 host View 에 노출하므로 축 매핑을 jest 로 못박는다
    // (zoom 값은 6-b 실기 조정이라 잠그지 않는다 — lat==lat·lng==lng 만).
    render(<MapView center={CENTER} pins={PINS} />);

    const native = screen.getByTestId('map-native');
    const camera = native.props.initialCamera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(CENTER.lat);
    expect(camera.longitude).toBe(CENTER.lng);
  });
});

describe('🔴 AC2 — viewOnly: 켜면 제스처 4토글 전부 false, 안 켜면 전부 false는 아니다', () => {
  it('viewOnly=true → NaverMapView가 4토글을 개별로 전부 false 로 받는다', () => {
    render(<MapView center={CENTER} pins={PINS} viewOnly />);

    const native = screen.getByTestId('map-native');
    for (const toggle of GESTURE_TOGGLES) {
      // 하나라도 빠지면 위반 — 개별 단언으로 어느 토글인지 실패 메시지에 드러나게.
      expect(native.props[toggle]).toBe(false);
    }
  });

  it('viewOnly 미전달 → 4토글이 전부 false 는 아니다(기본은 조작 가능)', () => {
    render(<MapView center={CENTER} pins={PINS} />);

    const native = screen.getByTestId('map-native');
    for (const toggle of GESTURE_TOGGLES) {
      // seed AC2 "true 또는 미전달" — toBe(true)로 과잉 고정하지 않고 not.toBe(false).
      expect(native.props[toggle]).not.toBe(false);
    }
  });
});

describe('🔴 AC3 — connectPins: false면 경로선 없음, 기본이면 경로선 1개', () => {
  it('connectPins={false} → 경로선(map-path) 없음, 단 마커는 그대로', () => {
    render(<MapView center={CENTER} pins={PINS} connectPins={false} />);

    expect(screen.queryByTestId('map-path')).toBeNull();
    // 짝 — 선을 끊었을 뿐 핀을 잃지 않는다.
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(PINS.length);
  });

  it('connectPins 미전달(기본 true) + pins 2개 → 경로선 1개', () => {
    render(<MapView center={CENTER} pins={PINS} />);

    expect(screen.queryAllByTestId('map-path')).toHaveLength(1);
  });
});

describe('🔴 AC4 — 핀 탭: 마커 index 0 의 onTap → onPinTap(0) (index 0 통과)', () => {
  it('첫 마커의 onTap 을 발화하면 onPinTap 이 0 으로 호출된다', () => {
    const onPinTap = jest.fn();
    render(<MapView center={CENTER} pins={PINS} onPinTap={onPinTap} />);

    // Act — index 0 을 반드시 발화(!index falsy 회귀 방지).
    const markers = screen.getAllByTestId('map-marker');
    (markers[0].props as { onTap: () => void }).onTap();

    // Assert
    expect(onPinTap).toHaveBeenCalledWith(0);
    expect(onPinTap).toHaveBeenCalledTimes(1);
  });

  it('핀 번호가 결번이어도 배열 index 로 호출된다(핀 번호 아님) — 핀 결번 역참조', () => {
    // 핀 결번 역참조: `pins` 배열의 위치(index)와 표시 번호(number)는 다른 축이다.
    // 번호 2 가 결번인 [1,3] 에서 두 번째 마커(배열 index 1 = 번호 3)를 탭하면,
    // 올바른 구현은 배열 index 1 을 준다. `pin.number - 1`(=2) 이나 `0` 하드코딩
    // 뮤턴트는 여기서 red — TimelineScreen 이 잘못된 슬롯을 참조하는 것을 막는다.
    const onPinTap = jest.fn();
    const gapPins: MapPin[] = [
      { number: 1, lat: 33.51, lng: 126.52 },
      { number: 3, lat: 33.52, lng: 126.53 },
    ];
    render(<MapView center={CENTER} pins={gapPins} onPinTap={onPinTap} />);

    // Act — 배열 index 1(번호 3) 마커의 onTap 발화.
    const markers = screen.getAllByTestId('map-marker');
    (markers[1].props as { onTap: () => void }).onTap();

    // Assert — 배열 index 1 이어야 한다(번호 3 도, number-1=2 도 아님).
    expect(onPinTap).toHaveBeenCalledWith(1);
    expect(onPinTap).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC5 — 실패: 클라이언트 ID 부재 → map-failure 보이고 map-native 없음(INV-4)', () => {
  it('env 키 부재 → map-failure + 안내문, map-native 는 없다(부재 짝)', () => {
    delete process.env[CLIENT_ID_KEY];

    render(<MapView center={CENTER} pins={PINS} />);

    expect(screen.getByTestId('map-failure')).toBeTruthy();
    // RNTL 문자열 매처는 완전일치라 부분포함엔 정규식이 필수(02a §6 실검증).
    expect(screen.getByText(/지도를 불러오지 못했어요/)).toBeTruthy();
    // vacuous 방지 — 실패 표면만 있고 지도가 살아 있으면 거짓 통과.
    expect(screen.queryByTestId('map-native')).toBeNull();
  });

  it('onLoadFailed 제공 시 그것도 호출되고 map-failure 도 함께 뜬다(배타 아님)', () => {
    delete process.env[CLIENT_ID_KEY];
    const onLoadFailed = jest.fn();

    render(<MapView center={CENTER} pins={PINS} onLoadFailed={onLoadFailed} />);

    expect(onLoadFailed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('map-failure')).toBeTruthy();
    expect(screen.queryByTestId('map-native')).toBeNull();
  });
});

describe('🔴 AC6 — INV-3: MapView 타입·소스에 duration 필드 없음', () => {
  it('MapView.tsx(+types.ts) 소스에 duration 식별자 0건', () => {
    const mapDir = __dirname; // src/shared/map
    const mapViewPath = path.join(mapDir, 'MapView.tsx');

    // 앵커 — 구현 전엔 파일이 없어 red(빈 파일 가짜통과 차단).
    expect(fs.existsSync(mapViewPath)).toBe(true);

    const candidates = ['MapView.tsx', 'types.ts']
      .map((f) => path.join(mapDir, f))
      .filter((p) => fs.existsSync(p));

    for (const p of candidates) {
      const src = fs.readFileSync(p, 'utf8');
      // 단어경계 \b — 네이버 정식 prop `animationDuration` 오탐 방지, 필드 `duration:` 검출.
      expect(/\bduration\b/i.test(src)).toBe(false);
    }
  });
});

describe('🔴 AC-보강 — maxLevel → NaverMapView minZoom 으로 전달(축 반대, 01 §새 계약)', () => {
  it('maxLevel 전달 시 map-native 가 minZoom prop 을 받는다(값은 6-b, 전달 여부만)', () => {
    render(<MapView center={CENTER} pins={PINS} maxLevel={5} />);

    // 값 하드코딩 금지 — 정확한 변환값은 실기(6-b) 조정 대상.
    expect(screen.getByTestId('map-native').props.minZoom).toBeDefined();
  });

  it('maxLevel 미전달 시 minZoom 없음(짝 — maxLevel 이 minZoom 을 몬다)', () => {
    render(<MapView center={CENTER} pins={PINS} />);

    expect(screen.getByTestId('map-native').props.minZoom).toBeUndefined();
  });
});
