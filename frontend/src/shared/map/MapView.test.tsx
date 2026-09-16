import * as fs from 'fs';
import * as path from 'path';

import { render, screen, within } from '@testing-library/react-native';

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

describe('🔴 TRIP-876 — 커스텀 분홍 번호 핀(네이버 기본 초록 마커 아님)', () => {
  it('각 마커가 번호를 담은 커스텀 핀 자식을 그리고, caption 없이 anchor 로 끝을 맞춘다', () => {
    // Arrange + Act
    render(<MapView center={CENTER} pins={PINS} />);

    // Assert — 마커마다 커스텀 핀 자식(map-marker-pin-{번호})이 있고 그 안에 번호가 보인다.
    // 네이버 기본 마커는 caption 텍스트만이라 이 자식 testID 가 없다(그래서 이게 초록마커 회귀를 잡는다).
    // 번호는 SVG 로 그린다(iOS 마커 래스터가 RN <Text> 글리프를 못 잡아 SVG 로 전환, 6-b 실측) —
    // react-native-svg 는 문자열을 RNSVGTSpan 의 `content` prop 으로 넣어 toHaveTextContent 로는
    // 안 보이므로, 핀 뷰 안에서 content===번호인 노드가 있는지로 확인한다.
    for (const pin of PINS) {
      const pinView = screen.getByTestId(`map-marker-pin-${pin.number}`);
      const labels = within(pinView).UNSAFE_queryAllByProps({
        content: String(pin.number),
      });
      expect(labels.length).toBeGreaterThan(0);
    }

    // 짝 — 기본 마커로 되돌리면(caption 부여·children 제거) 위가 red. 마커엔 caption 이 없고
    // anchor 는 물방울 끝(아래 꼭짓점)이 좌표를 가리키도록 {x:0.5, y:1} 이다.
    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(PINS.length);
    for (const marker of markers) {
      expect(marker.props.caption).toBeUndefined();
      expect(marker.props.anchor).toEqual({ x: 0.5, y: 1 });
    }
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

  it('onCameraIdle 미전달 시 map-native 는 그 콜백을 받지 않는다(짝 — 있을 때만 감싼다)', () => {
    // maxLevel↔minZoom 과 같은 옵트인 패턴 — 안 준 콜백을 지도에 억지로 달지 않는다.
    render(<MapView center={CENTER} pins={PINS} />);

    expect(screen.getByTestId('map-native').props.onCameraIdle).toBeUndefined();
  });
});

// ── TRIP-745 · 핀 3상태 + 현재위치 점 + 경로선 색 (01b AC-1~4) ──────────────────
//
// 무엇을 보장하나: MapPin.state 로 핀이 done/current/upcoming 세 얼굴로 갈리고(색·번호·체크),
// currentLocation 으로 파란 점+링+라벨이 옵션으로 얹히며, 연결 경로선이 빨강(#FF385C)으로
// 그려진다. 인프라 확장만이라 화면 배선은 이번 범위 밖(TRIP-746).
//
// ★ 색은 SVG fill/stroke 리터럴로만 실측 가능(className 은 SVG 에 안 붙는 map 트랩) — 각 상태의
//   물방울 채움·테두리를 상태별로 단언하고 교차-부재로 "색 바꿔도 green" 가짜통과를 막는다
//   (TRIP-876 03b 참고-1 선례). 번호·체크·라벨은 전부 react-native-svg 여야 iOS 마커 래스터에
//   찍힌다(RN <Text> 는 안 찍힘, TRIP-876 실측) — 그래서 라벨도 getByText 가 아니라 content prop 으로
//   검증한다(RNTL 은 SVG 문자열을 못 읽고 목이 RNSVGTSpan.props.content 에 넣는다).
//   ⚠️ content 쿼리는 SVG text 하나당 2노드(Text+TSpan)라 present=`>0`, 부재=`length 0` 로만 판정한다.

/** done 마커는 번호 대신 흰 체크(SVG Path)를 그린다 — 체크는 text 가 아니라 testID 로 식별한다. */
const CHECK_TESTID = (n: number) => `map-marker-check-${n}`;

const STATE_PINS: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52, state: 'done' },
  { number: 2, lat: 33.515, lng: 126.526, state: 'current' },
  { number: 3, lat: 33.52, lng: 126.53, state: 'upcoming' },
];

describe('🔴 AC-1 — 핀 state → 상태별 렌더(색·번호·체크)', () => {
  it('done: 번호 leaf 없이 흰 체크 + 초록(#0E9384) 물방울, 분홍 아님', () => {
    // Arrange + Act
    render(<MapView center={CENTER} pins={STATE_PINS} />);

    // Assert
    const pin = screen.getByTestId('map-marker-pin-1');
    // 완료는 번호를 안 그린다(흰 체크로 대체). content='1' 노드가 하나도 없어야 한다.
    expect(within(pin).UNSAFE_queryAllByProps({ content: '1' })).toHaveLength(
      0
    );
    // 흰 체크가 present 하고 그 stroke 가 흰색이다(체크는 SVG Path 라 testID 로 식별).
    const check = within(pin).queryByTestId(CHECK_TESTID(1));
    expect(check).not.toBeNull();
    expect((check as { props: { stroke?: string } }).props.stroke).toBe(
      '#FFFFFF'
    );
    // 초록 물방울(success). 있어야 하고, 분홍이면 안 된다(done 을 분홍으로 그리는 스왑 차단).
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#0E9384' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' })
    ).toHaveLength(0);
  });

  it('current: 번호 "2" + 분홍(#FF385C) 물방울, 초록·회색 아님, 체크 없음', () => {
    render(<MapView center={CENTER} pins={STATE_PINS} />);

    const pin = screen.getByTestId('map-marker-pin-2');
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '2' }).length
    ).toBeGreaterThan(0);
    expect(within(pin).queryByTestId(CHECK_TESTID(2))).toBeNull();
    // 분홍 물방울(primary). done(초록)·upcoming(회색 아웃라인)과 갈린다.
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#0E9384' })
    ).toHaveLength(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ stroke: '#9AA1AB' })
    ).toHaveLength(0);
  });

  it('upcoming: 번호 "3"(회색 #9AA1AB) + 회색 아웃라인, 분홍·초록 아님, 체크 없음', () => {
    render(<MapView center={CENTER} pins={STATE_PINS} />);

    const pin = screen.getByTestId('map-marker-pin-3');
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '3' }).length
    ).toBeGreaterThan(0);
    expect(within(pin).queryByTestId(CHECK_TESTID(3))).toBeNull();
    // 회색 아웃라인(stroke)과 회색 번호(fill)가 upcoming 을 가른다.
    expect(
      within(pin).UNSAFE_queryAllByProps({ stroke: '#9AA1AB' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#9AA1AB' }).length
    ).toBeGreaterThan(0);
    // 분홍·초록 물방울이면 안 된다(current/done 으로 스왑 차단).
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' })
    ).toHaveLength(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#0E9384' })
    ).toHaveLength(0);
  });
});

describe('🟢 AC-2 — state 미전달 = 기존 분홍 핀(무회귀 선제 앵커)', () => {
  it('state 없는 핀은 분홍(#FF385C) 물방울 + 번호를 그린다(기본 거동 보존)', () => {
    // Arrange + Act — state 를 안 준다. 기본은 분홍 물방울에 번호(무번호 done 만 예외).
    render(
      <MapView center={CENTER} pins={[{ number: 1, lat: 33.5, lng: 126.5 }]} />
    );

    // Assert
    const pin = screen.getByTestId('map-marker-pin-1');
    expect(
      within(pin).UNSAFE_queryAllByProps({ fill: '#FF385C' }).length
    ).toBeGreaterThan(0);
    expect(
      within(pin).UNSAFE_queryAllByProps({ content: '1' }).length
    ).toBeGreaterThan(0);
    // 기본 핀에 done 체크가 붙으면 안 된다(무번호 완료로 오인 금지).
    expect(within(pin).queryByTestId(CHECK_TESTID(1))).toBeNull();
  });
});

describe('🔴 AC-3 — 연결 경로선 색이 빨강(#FF385C)', () => {
  it('경로선(map-path)의 color prop 이 #FF385C 다', () => {
    // Arrange + Act — pins 2개 + connectPins 기본(true) → 경로선 1개.
    render(<MapView center={CENTER} pins={PINS} />);

    // Assert — 목이 NaverMapPathOverlay props 를 그대로 노출한다(색은 hex 문자열).
    // connectPins={false} 시 경로선 부재는 기존 AC3 describe 가 이미 잠근다(무회귀).
    expect(screen.getByTestId('map-path').props.color).toBe('#FF385C');
  });
});

describe('🔴 AC-4 — 현재위치 오버레이(파란 점·링·라벨)', () => {
  it('currentLocation 전달 → 파란(#1659C9) 점·링 + "현재 위치" SVG 라벨, collapsable={false}', () => {
    // Arrange + Act
    render(
      <MapView
        center={CENTER}
        pins={PINS}
        currentLocation={{ lat: 33.5, lng: 126.5 }}
      />
    );

    // Assert — 현재위치 마커의 커스텀 뷰(map-current-location)가 뜬다.
    const cur = screen.queryByTestId('map-current-location');
    expect(cur).not.toBeNull();
    // 마커 래스터 필수 prop — 없으면 iOS New Arch 에서 기본 마커로 나온다(실제 flatten 방지는 6-b).
    expect(
      (cur as { props: { collapsable?: boolean } }).props.collapsable
    ).toBe(false);
    // 라벨은 SVG 라 getByText 가 아니라 content prop 으로 본다(다문자·공백 문자열 매치).
    expect(
      within(
        cur as ReturnType<typeof screen.getByTestId>
      ).UNSAFE_queryAllByProps({ content: '현재 위치' }).length
    ).toBeGreaterThan(0);
    // 파란 점·링(link 색). 여러 요소가 이 색을 쓰므로 present 만 본다.
    expect(
      within(
        cur as ReturnType<typeof screen.getByTestId>
      ).UNSAFE_queryAllByProps({ fill: '#1659C9' }).length
    ).toBeGreaterThan(0);
  });

  it('currentLocation 미전달 → 현재위치 마커 부재(짝 — 항상 렌더 회귀 방지)', () => {
    // Arrange + Act
    render(<MapView center={CENTER} pins={PINS} />);

    // Assert
    expect(screen.queryByTestId('map-current-location')).toBeNull();
  });
});
