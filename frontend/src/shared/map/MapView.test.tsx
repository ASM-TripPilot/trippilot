import {
  act,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppState } from 'react-native';

import { MapView } from '@/shared/map';
import type { MapCenter, MapPin } from '@/shared/map';

/**
 * TRIP-863 (S1) — 공급자 중립 `MapView`(네이버 네이티브) 코어 교체. 01b AC1~7 통합.
 *
 * 이 파일은 `@/shared/map` 배럴의 실제 `MapView`(구현 전)를 태운다 — 얇은 카카오 목
 * (`mapViewMock`)이 아니라 코어 진짜 테스트다. 네이버 SDK 는 네이티브 모듈이라
 * `__mocks__/@mj-studio/react-native-naver-map.tsx`(prop-기록형 목)가 자동 적용된다:
 * NaverMapView→testID="map-native", 마커→"map-marker", 경로선→"map-path" 로 렌더하고
 * props 를 그대로 노출해 viewOnly 4토글·onTap 을 관측한다.
 *
 * 구현 전엔 배럴에 `MapView` export 가 없어 `undefined` → render 가 던진다(정상 red).
 */

// no-dynamic-env-var(eslint-plugin-expo) 회피 — 선언과 대입을 분리한다(computed 접근이
// 선언과 한 문장이면 룰에 걸린다, 옛 KakaoMapView.viewOnly.test.tsx 선례).
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
    // 제어형 `camera` prop 을 host View 에 노출하므로 축 매핑을 jest 로 못박는다
    // (zoom 값은 6-b 실기 조정이라 잠그지 않는다 — lat==lat·lng==lng 만).
    render(<MapView center={CENTER} pins={PINS} />);

    const native = screen.getByTestId('map-native');
    const camera = native.props.camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(CENTER.lat);
    expect(camera.longitude).toBe(CENTER.lng);
  });
});

// TRIP-876 커스텀 핀(번호 SVG·caption·anchor)은 jest-cut 에서 지웠다 — 마커 생김새라 실화면 QA 몫(itinerary-view.md). 번호 렌더는 AC-3(b) 짝이 본다.

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

describe('🔴 AC-보강 — onCameraIdle: NaverMapView 의 idle 좌표를 {lat,lng} 로 감싸 콜백(TRIP-866 S4 신규 계약)', () => {
  it('onCameraIdle 전달 시 map-native 가 그 콜백을 받고, 발화하면 {lat,lng} 로 변환돼 올라온다', () => {
    // 초심자용 — onCameraIdle 은 "지도가 움직이다 멈췄을 때" 네이버 지도가 그때 중심 좌표를
    // {latitude,longitude} 로 알려주는 콜백이다. MapView 는 그걸 리포 순서 {lat,lng} 로 감싸
    // 부모에게 올린다(축 변환). 목이 prop 을 그대로 노출하므로 테스트가 직접 발화한다.
    const onCameraIdle = jest.fn();
    render(<MapView center={CENTER} pins={PINS} onCameraIdle={onCameraIdle} />);

    const native = screen.getByTestId('map-native');
    // 배선 앵커 — 콜백이 네이티브 지도까지 닿아 있다. 없으면 아래 발화가 TypeError 로 죽어
    // "무엇이 없는가"가 안 읽힌다.
    expect(native.props.onCameraIdle).toBeDefined();

    // Act — 네이버가 주는 형태({latitude,longitude})로 발화. lat≠lng 로 축 스왑/직통을 잡는다.
    (
      native.props as {
        onCameraIdle: (p: { latitude: number; longitude: number }) => void;
      }
    ).onCameraIdle({ latitude: 33.5, longitude: 126.5 });

    // Assert — {lat,lng} 로 변환(네이버 {latitude,longitude} 순서 그대로 넘기면 red).
    expect(onCameraIdle).toHaveBeenCalledTimes(1);
    expect(onCameraIdle).toHaveBeenCalledWith({ lat: 33.5, lng: 126.5 });
  });
});

describe('TRIP-748 — onTapMap: 지도 빈 곳 탭을 부모에 알린다(허브 알약 숨김 입구, 옵트인)', () => {
  it('🔴 M1 onTapMap 전달 시 map-native 가 그 콜백을 받고, 네이버 모양으로 발화하면 1회 올라온다', () => {
    // 초심자용 — onTapMap 은 "마커가 아닌 지도 빈 곳을 탭했다"를 네이버 지도가 알려주는 콜백이다.
    // 허브는 좌표가 필요 없어 인자 없는 콜백으로 받는다(D3 로컬 숨김).
    const onTapMap = jest.fn();
    render(<MapView center={CENTER} pins={PINS} onTapMap={onTapMap} />);

    const native = screen.getByTestId('map-native');
    expect(native.props.onTapMap).toBeDefined();

    (
      native.props as {
        onTapMap: (p: {
          latitude: number;
          longitude: number;
          x: number;
          y: number;
        }) => void;
      }
    ).onTapMap({ latitude: 33.5, longitude: 126.5, x: 10, y: 20 });

    expect(onTapMap).toHaveBeenCalledTimes(1);
  });
});

// TRIP-745 핀 3상태 색(AC-1)·기본 분홍 핀(AC-2)은 jest-cut 에서 지웠다 — SVG fill/stroke 색이라 실화면 QA 몫(live-hub.md).

// ── TRIP-795 · h10 반경 점선 원(additive) + letter 라벨 핀(additive) ─────────────
//
// 무엇을 보장하나: `radiusCircle` 을 주면 반경 원 오버레이(map-circle)를 그리고 그 반경 미터를
// 그대로 전달한다. 미전달이면 원이 없다(무회귀). `MapPin.label` 을 주면 물방울 안 SVG 텍스트가
// 번호 대신 그 letter(A/B/C/D — 카드 배지와 일치)를 그린다. 미전달이면 번호 그대로(무회귀).
//
// ★ 잠금은 prop 전달까지다(카카오 kakaoMapDocument 스냅샷 아님 — 죽은 API). 실 점선·축척·letter
//   래스터는 6-b 실기(네이버 SDK 재빌드). 목이 NaverMapCircleOverlay props 를 host 로 노출해
//   반경 전달을 관측하고, letter 는 SVG 라 content prop 으로 본다(번호 검증과 동형, TRIP-876).

describe('🔴 TRIP-795 AC-3(a) — radiusCircle: 주면 map-circle 그리고 반경 전달, 미전달이면 원 없음', () => {
  it('radiusCircle 전달 → map-circle present + radius prop 이 그 미터값(1100)이다', () => {
    // Arrange + Act
    render(
      <MapView
        center={CENTER}
        pins={PINS}
        radiusCircle={{ center: CENTER, radiusM: 1100 }}
      />
    );

    // Assert — 목이 NaverMapCircleOverlay props 를 host 로 노출한다. 반경은 그대로 전달돼야 한다
    // (정확한 색·점선은 6-b, 여기선 전달 여부·반경값만).
    const circle = screen.queryByTestId('map-circle');
    expect(circle).not.toBeNull();
    expect((circle as { props: { radius?: number } }).props.radius).toBe(1100);
  });

  it('radiusCircle 미전달 → map-circle 없음(짝 — additive 무회귀)', () => {
    // Arrange + Act — 기존 12 소비처는 radiusCircle 을 안 준다.
    render(<MapView center={CENTER} pins={PINS} />);

    // Assert
    expect(screen.queryByTestId('map-circle')).toBeNull();
  });
});

describe('🔴 TRIP-795 AC-3(b) — MapPin.label: letter 를 번호 대신 SVG 로 그린다', () => {
  it('label="A" 핀 → 핀 안에 content="A" 노드가 있고 번호(content="1")는 없다', () => {
    // Arrange + Act — letter 라벨 핀 하나(카드 배지 A 와 시각 일치).
    render(
      <MapView
        center={CENTER}
        pins={[{ number: 1, lat: 33.51, lng: 126.52, label: 'A' }]}
      />
    );

    // Assert — letter 는 SVG 텍스트라 toHaveTextContent 로는 안 보인다(목이 RNSVGTSpan.props.content
    // 에 넣는다). letter 가 번호를 대체하므로 content="1" 은 하나도 없어야 한다.
    const pin = screen.getByTestId('map-marker-pin-1');
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: 'A' }).length
    ).toBeGreaterThan(0);
    expect(within(pin).UNSAFE_queryAllByProps({ content: '1' })).toHaveLength(
      0
    );
  });

  it('label 미전달 → 번호(content="1") 그대로 그린다(짝 — additive 무회귀)', () => {
    // Arrange + Act
    render(
      <MapView center={CENTER} pins={[{ number: 1, lat: 33.5, lng: 126.5 }]} />
    );

    // Assert
    const pin = screen.getByTestId('map-marker-pin-1');
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '1' }).length
    ).toBeGreaterThan(0);
  });
});

// ── TRIP-1275 수정 루프 1 · 맞춤(region) ↔ 카메라(camera) 모드 전환 시 네이티브 지도 다시 마운트 ──
// 6-b 실측: region 을 받던 네이티브 지도가 camera 로 넘어가면 라이브러리가 region=undefined 를
// 보내고, iOS 네이티브는 camera 를 먼저 적용한 뒤 기본값(0,0) region 을 덮어써 지도가 바다로 간다.
// jest 는 네이티브 적용 순서를 못 보므로, 렌더러가 볼 수 있는 "지도 인스턴스가 새로 생겼나"로 잰다.
// getByTestId 가 돌려주는 노드는 같은 컴포넌트가 다시 그려지면 같은 객체(toBe), 새로 마운트되면
// 다른 객체다(02a 수정 루프 1 §실검증).
describe('맞춤·카메라 모드가 바뀌면 네이티브 지도를 새로 마운트한다', () => {
  // 빈 일차 — 핀 0개, 중심은 여행 지역 후보(서울).
  const EMPTY_DAY_CENTER: MapCenter = { lat: 37.5467, lng: 126.8808 };

  it('🔴 맞춤(region) → 카메라(camera): 핀 2개 날에서 빈 날로 가면 지도 인스턴스가 바뀐다', () => {
    // 준비 — 핀 2개 + fitPins 라 region 모드로 연다.
    const { rerender } = render(
      <MapView center={CENTER} pins={PINS} fitPins />
    );
    const before = screen.getByTestId('map-native');
    expect(before.props.region).toBeDefined();

    // 실행 — 빈 날로 넘어간다(핀 0개 → camera 모드).
    rerender(<MapView center={EMPTY_DAY_CENTER} pins={[]} fitPins />);

    // 단언 — 다른 인스턴스이고, 새 지도는 region 없이 빈 날 중심 camera 만 받는다.
    const after = screen.getByTestId('map-native');
    expect(after).not.toBe(before);
    expect(after.props.region).toBeUndefined();
    expect(after.props.camera).toMatchObject({
      latitude: EMPTY_DAY_CENTER.lat,
      longitude: EMPTY_DAY_CENTER.lng,
    });
  });

  it('🔴 카메라(camera) → 맞춤(region): 빈 날에서 핀 2개 날로 가도 지도 인스턴스가 바뀐다', () => {
    // 준비 — 빈 날(camera 모드)로 연다.
    const { rerender } = render(
      <MapView center={EMPTY_DAY_CENTER} pins={[]} fitPins />
    );
    const before = screen.getByTestId('map-native');
    expect(before.props.region).toBeUndefined();

    // 실행 — 핀 2개 날로 넘어간다(region 모드).
    rerender(<MapView center={CENTER} pins={PINS} fitPins />);

    // 단언 — 다른 인스턴스이고, 새 지도는 camera 없이 region 만 받는다.
    const after = screen.getByTestId('map-native');
    expect(after).not.toBe(before);
    expect(after.props.region).toBeDefined();
    expect(after.props.camera).toBeUndefined();
  });

  it('맞춤 모드 안에서 핀만 바뀌면 같은 지도 인스턴스다(깜빡임 방지 · 선제 green)', () => {
    // 준비
    const { rerender } = render(
      <MapView center={CENTER} pins={PINS} fitPins />
    );
    const before = screen.getByTestId('map-native');
    const regionBefore = before.props.region as unknown;

    // 실행 — 핀 하나를 멀리 옮긴다(여전히 핀 2개 → region 모드).
    rerender(
      <MapView
        center={CENTER}
        pins={[PINS[0], { number: 2, lat: 35.1587, lng: 129.1604 }]}
        fitPins
      />
    );

    // 단언 — 영역은 새로 계산됐는데(실제로 바뀐 렌더) 지도는 그대로다.
    const after = screen.getByTestId('map-native');
    expect(after.props.region).not.toBe(regionBefore);
    expect(after).toBe(before);
  });

  it('카메라 모드 안에서 중심만 바뀌면 같은 지도 인스턴스다(깜빡임 방지 · 선제 green)', () => {
    // 준비
    const { rerender } = render(
      <MapView center={EMPTY_DAY_CENTER} pins={[]} fitPins />
    );
    const before = screen.getByTestId('map-native');

    // 실행 — 다른 빈 날(중심이 다른 곳).
    rerender(<MapView center={CENTER} pins={[]} fitPins />);

    // 단언 — camera 는 새 중심을 받았는데(실제로 바뀐 렌더) 지도는 그대로다.
    const after = screen.getByTestId('map-native');
    expect(after.props.camera).toMatchObject({
      latitude: CENTER.lat,
      longitude: CENTER.lng,
    });
    expect(after).toBe(before);
  });

  // ── 심판 보강(03b 수정 루프 1 리뷰 경고-1·2) ── key 를 모드 대신 핀 개수·pinRegion 으로
  // 계산하는 구현을 가른다.
  it('맞춤 모드 안에서 핀이 2개 → 3개로 늘어도 같은 지도 인스턴스다(깜빡임 방지)', () => {
    // 준비 — 핀 2개 + fitPins(region 모드).
    const { rerender } = render(
      <MapView center={CENTER} pins={PINS} fitPins />
    );
    const before = screen.getByTestId('map-native');
    const regionBefore = before.props.region as unknown;
    expect(regionBefore).toBeDefined();

    // 실행 — 3곳 날(여전히 region 모드, 핀 개수만 바뀜).
    rerender(
      <MapView
        center={CENTER}
        pins={[...PINS, { number: 3, lat: 33.52, lng: 126.54 }]}
        fitPins
      />
    );

    // 단언 — region 은 새로 계산됐는데(앵커) 지도는 그대로다.
    const after = screen.getByTestId('map-native');
    expect(after.props.region).toBeDefined();
    expect(after.props.region).not.toBe(regionBefore);
    expect(after).toBe(before);
  });

  it('카메라 모드(fitPins 없음)에서 핀이 0개 → 1개로 늘어도 같은 지도 인스턴스다(사용자 위치 보존)', () => {
    // 준비 — fitPins 없이 핀 0개(camera 모드).
    const { rerender } = render(<MapView center={CENTER} pins={[]} />);
    const before = screen.getByTestId('map-native');
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);

    // 실행 — 같은 중심에 핀 하나가 생긴다.
    rerender(<MapView center={CENTER} pins={[PINS[0]]} />);

    // 단언 — 마커는 생겼고(앵커) 여전히 camera 모드이며 지도는 그대로다.
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(1);
    const after = screen.getByTestId('map-native');
    expect(after.props.region).toBeUndefined();
    expect(after).toBe(before);
  });

  it('🔴 반경 원 켜짐(region) → 꺼짐(camera): 원이 사라지면 지도 인스턴스가 바뀐다(h10 "최대" 조회 중)', () => {
    // 준비 — 핀 없이 반경 원만(원 영역으로 region 모드).
    const { rerender } = render(
      <MapView
        center={CENTER}
        pins={[]}
        fitPins
        radiusCircle={{ center: CENTER, radiusM: 3000 }}
      />
    );
    const before = screen.getByTestId('map-native');
    expect(before.props.region).toBeDefined();

    // 실행 — 원이 사라진다(핀도 0개 → camera 모드).
    rerender(<MapView center={CENTER} pins={[]} fitPins />);

    // 단언 — 다른 인스턴스이고, 새 지도는 region 없이 camera 만 받는다.
    const after = screen.getByTestId('map-native');
    expect(after).not.toBe(before);
    expect(after.props.region).toBeUndefined();
    expect(after.props.camera).toMatchObject({
      latitude: CENTER.lat,
      longitude: CENTER.lng,
    });
  });
});

// TRIP-1522 LG1(logoMargin 통과)은 jest-cut 에서 지웠다 — 지도 목 prop 통과뿐이다(README 판정 4).

// TRIP-1535 · 내 위치(네이버 기본 현위치) — 옵트인. 권한은 조회만 하고 묻지 않는다.
const mockGetForegroundPermission = jest.fn();
const mockRequestForegroundPermission = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForegroundPermission(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermission(...args),
}));
const trackingModes = (): string[] =>
  (globalThis as { __naverTrackingModes?: string[] }).__naverTrackingModes ??
  [];

describe('TRIP-1535 — showMyLocation: 내 위치 표시(옵트인)', () => {
  beforeEach(() => {
    trackingModes().length = 0;
    mockGetForegroundPermission.mockReset();
    mockRequestForegroundPermission.mockReset();
  });

  it('MY1 켜고 OS 권한이 granted 면 → 지도 추적 모드 NoFollow(카메라는 안 따라감), 권한 요청 0회', async () => {
    // 준비: 권한 granted → 실행: showMyLocation 렌더 → 단언: NoFollow 1회, request 0회
    mockGetForegroundPermission.mockResolvedValue({ status: 'granted' });
    render(<MapView center={CENTER} showMyLocation />);
    await waitFor(() => expect(trackingModes()).toEqual(['NoFollow']));
    expect(mockRequestForegroundPermission).not.toHaveBeenCalled();
  });

  it('MY2 켜도 권한이 없으면 → 추적을 켜지 않고 권한도 묻지 않는다', async () => {
    mockGetForegroundPermission.mockResolvedValue({ status: 'denied' });
    render(<MapView center={CENTER} showMyLocation />);
    // 앵커: 권한을 실제로 조회했다(조회 전에 단언해 공허 통과하지 않게).
    await waitFor(() => expect(mockGetForegroundPermission).toHaveBeenCalled());
    await Promise.resolve();
    expect(trackingModes()).not.toContain('NoFollow');
    expect(mockRequestForegroundPermission).not.toHaveBeenCalled();
  });

  it('MY3 안 주면 → 권한 조회도 추적 호출도 없다(다른 지도 무회귀)', async () => {
    render(<MapView center={CENTER} />);
    expect(screen.getByTestId('map-native')).toBeTruthy();
    await Promise.resolve();
    expect(mockGetForegroundPermission).not.toHaveBeenCalled();
    expect(trackingModes()).toEqual([]);
  });

  it('MY5 권한 답이 오기 전에 끄면 → 늦게 온 granted 로 켜지 않는다(경합)', async () => {
    // 준비: 권한 응답을 붙잡아 둔다 → 실행: 켜고 곧바로 끈 뒤 granted 를 돌려준다 → 단언: NoFollow 0회
    let answer: (value: { status: string }) => void = () => {};
    mockGetForegroundPermission.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const view = render(<MapView center={CENTER} showMyLocation />);
    await waitFor(() => expect(mockGetForegroundPermission).toHaveBeenCalled());
    view.rerender(<MapView center={CENTER} showMyLocation={false} />);
    await act(async () => {
      answer({ status: 'granted' });
    });
    expect(trackingModes()).not.toContain('NoFollow');
  });

  it('MY6 맞춤↔카메라 전환으로 지도가 새로 마운트되면 → 새 지도에 다시 켠다', async () => {
    mockGetForegroundPermission.mockResolvedValue({ status: 'granted' });
    const view = render(<MapView center={CENTER} showMyLocation />);
    await waitFor(() => expect(trackingModes()).toEqual(['NoFollow']));
    // 핀 맞춤을 켜면 지도가 region 모드로 다시 마운트된다(key 변경).
    view.rerender(
      <MapView center={CENTER} pins={PINS} fitPins showMyLocation />
    );
    await waitFor(() =>
      expect(trackingModes()).toEqual(['NoFollow', 'None', 'NoFollow'])
    );
  });

  it('MY7 처음엔 권한이 없다가 설정에서 허용하고 앱으로 돌아오면 → 그때 켠다', async () => {
    const listeners: ((state: string) => void)[] = [];
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener as (state: string) => void);
        return { remove: () => {} } as ReturnType<
          typeof AppState.addEventListener
        >;
      });
    mockGetForegroundPermission.mockResolvedValue({ status: 'denied' });
    render(<MapView center={CENTER} showMyLocation />);
    await waitFor(() =>
      expect(mockGetForegroundPermission).toHaveBeenCalledTimes(1)
    );
    expect(trackingModes()).toEqual([]);
    mockGetForegroundPermission.mockResolvedValue({ status: 'granted' });
    await act(async () => {
      listeners.forEach((listener) => listener('active'));
    });
    await waitFor(() => expect(trackingModes()).toEqual(['NoFollow']));
    expect(mockRequestForegroundPermission).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('MY4 켜져 있다가 끄면 → 추적을 None 으로 되돌린다', async () => {
    mockGetForegroundPermission.mockResolvedValue({ status: 'granted' });
    const view = render(<MapView center={CENTER} showMyLocation />);
    await waitFor(() => expect(trackingModes()).toEqual(['NoFollow']));
    view.rerender(<MapView center={CENTER} showMyLocation={false} />);
    expect(trackingModes()).toEqual(['NoFollow', 'None']);
  });
});
