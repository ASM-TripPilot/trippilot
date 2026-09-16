import { render, screen } from '@testing-library/react-native';

import { CenterPinPicker } from '@/shared/map';
import type { MapCenter } from '@/shared/map';

/**
 * TRIP-866 (S4) — 중앙 고정 핀 picker(CenterPinPicker) 코어. 01b AC1~3.
 *
 * 무엇을(초심자용):
 *  - **중앙 고정 핀**: 핀은 화면 한가운데 붙박이고, 사용자가 *지도를 움직여* 원하는 곳을 핀 아래로
 *    가져온다(핀을 끌지 않는다). 옛 "지도를 길게 눌러 찍기"의 대체다.
 *  - **onCameraIdle**: 지도가 움직이다 멈추면(카메라가 idle 상태가 되면) 네이버 지도가 그때의
 *    중심 좌표를 알려주는 콜백이다. picker 는 이걸 받아 `onPick({lat,lng})` 으로 올린다.
 *  - **제어형 camera 되먹임 함정**: onPick 으로 받은 좌표를 다시 지도 center 로 먹이면, 제어형
 *    camera 가 방금 사용자가 민 지도를 원위치로 되돌린다(pan 이 씹힌다). 그래서 picker 는 마운트
 *    시점의 center 를 **한 번만 포획(initialCenter)** 해 그 뒤로는 center prop 변경을 무시한다.
 *
 * 실물 코어 테스트다 — 얇은 목(`mapViewMock`)이 아니라 진짜 `CenterPinPicker` + 진짜 `MapView`를
 * 태운다. 네이버 SDK 는 네이티브 모듈이라 `__mocks__/@mj-studio/react-native-naver-map.tsx`
 * (prop-기록형 목)가 자동 적용된다: NaverMapView→testID="map-native", props 를 그대로 노출해
 * 테스트가 `map-native.props.onCameraIdle(...)`·`.camera` 를 직접 관측한다.
 *
 * 구현 전엔 배럴에 `CenterPinPicker` export 가 없어 `undefined` → render 가 던진다(정상 red).
 *
 * 3동작(AAA): 준비(center·onPick 으로 render) → 실행(map-native 의 onCameraIdle 발화 / rerender)
 * → 단언(onPick 인자·camera 값·testID 존재).
 */

// no-dynamic-env-var(eslint-plugin-expo) 회피 — 선언과 대입을 분리한다(MapView.test.tsx 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  // 키가 있어야 MapView 가 map-native 를 그린다(없으면 무조건 map-failure).
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

describe('🔴 AC1 — 렌더: center 를 주면 picker 루트 + 지도 + 중앙 고정 핀이 뜬다', () => {
  it('center-pin-picker 루트 아래 map-native(지도)와 map-center-pin(고정 핀)이 있다', () => {
    // Arrange + Act
    render(<CenterPinPicker center={CENTER} onPick={jest.fn()} />);

    // Assert — 세 조각이 모두 있어야 사용자가 지도를 움직여 핀을 맞출 수 있다.
    expect(screen.getByTestId('center-pin-picker')).toBeTruthy();
    expect(screen.getByTestId('map-native')).toBeTruthy();
    expect(screen.getByTestId('map-center-pin')).toBeTruthy();
    // 짝 — 지도가 살아 있다(키 부재 폴백 map-failure 가 아니다). 이게 없으면 위 단언이
    // map-failure 화면에서도 공허 통과할 수 있다.
    expect(screen.queryByTestId('map-failure')).toBeNull();
  });
});

describe('🔴 AC2 — onCameraIdle → onPick 으로 {lat,lng} 로 변환돼 올라온다 (축 변환)', () => {
  it('지도가 멈춰 보고한 {latitude,longitude} 가 onPick 에 {lat,lng} 로 전달된다', () => {
    const onPick = jest.fn();
    render(<CenterPinPicker center={CENTER} onPick={onPick} />);

    // Act — 네이버 지도가 카메라 idle 로 알려주는 것은 {latitude, longitude} 다. 목이 그
    // 콜백을 host 로 통과시키므로 테스트가 직접 발화한다(webview onError 직접 발화 선례 동형).
    // lat≠lng 인 좌표(33.5 vs 126.5)로 발화해 축 스왑/직통 뮤턴트를 잡는다.
    const native = screen.getByTestId('map-native');
    (
      native.props as {
        onCameraIdle: (p: { latitude: number; longitude: number }) => void;
      }
    ).onCameraIdle({ latitude: 33.5, longitude: 126.5 });

    // Assert — 리포 전체 {lat,lng} 순서로 변환된다(네이버 {latitude,longitude} 와 다름).
    // toEqual 로 완전일치 — {lat:126.5,lng:33.5} 스왑이나 {latitude,longitude} 직통을 red 로 잡는다.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ lat: 33.5, lng: 126.5 });
  });
});

describe('🔴 AC3 — ★ initialCenter 포획: center prop 이 바뀌어도 지도 카메라는 첫 값에 고정', () => {
  it('C1 로 마운트 후 C2 로 rerender 해도 map-native.camera 는 C1 을 유지한다', () => {
    // 되먹임 함정 방지의 핵심 — onPick 좌표가 다시 center 로 들어와도(부모가 그렇게 배선하면)
    // picker 는 마운트 시 포획한 첫 center 만 지도에 흘려, 사용자가 민 지도를 되돌리지 않는다.
    const C1: MapCenter = { lat: 33.4, lng: 126.5 };
    const C2: MapCenter = { lat: 37.5, lng: 127.0 };

    const view = render(<CenterPinPicker center={C1} onPick={jest.fn()} />);

    // Act — 마운트 후 center 를 C2 로 바꾼다(부모의 좌표 되먹임을 흉내).
    view.rerender(<CenterPinPicker center={C2} onPick={jest.fn()} />);

    // Assert — 지도로 가는 camera 는 여전히 C1 이다(C2 로 재중심되지 않는다). 제어형 MapView 는
    // camera={{latitude:center.lat, longitude:center.lng, zoom}} 를 host 에 노출한다.
    const camera = screen.getByTestId('map-native').props.camera as {
      latitude: number;
      longitude: number;
    };
    expect(camera.latitude).toBe(C1.lat);
    expect(camera.longitude).toBe(C1.lng);

    // 뮤테이션 후보(포획 제거): picker 가 initialCenter 대신 center 를 직통으로 MapView 에
    // 넘기면 rerender 후 camera 가 C2(37.5/127.0)로 바뀌어 두 단언이 red 가 된다.
    expect(camera.latitude).not.toBe(C2.lat);
  });
});
