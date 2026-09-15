import { Text, View } from 'react-native';

/**
 * `@/shared/map`의 테스트용 목(관찰 마커) — 지도를 소비하는 화면·배선 테스트 전용.
 *
 * 왜 필요한가: 실제 `MapView`(네이버 네이티브)는 jest(순수 JS 환경)에서 SDK 를 로드하지
 * 못하고, 클라이언트 ID 부재 시 `map-failure` 로만 떨어진다. 소비 화면이 보장해야 하는 것은
 * "고른 좌표·핀이 지도로 전달된다"라서, 그 값을 밖에서 읽을 수 있는 자리가 필요하다.
 * 좌표를 텍스트로 노출한다 — `toHaveTextContent('35.1587,129.1604')`로 읽는다.
 *
 * 왜 별도 모듈인가: 인라인 `jest.mock` 팩토리 안에서 엘리먼트를 만들면 NativeWind babel 이
 * 주입하는 모듈 스코프 변수(`_ReactNativeCSSInterop`)를 팩토리가 참조해 jest 호이스트 규칙
 * (out-of-scope 변수 금지)을 위반한다(TRIP-198 실측). 그래서 모듈 스코프 파일로 분리하고,
 * 테스트는 `jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'))`로 쓴다.
 *
 * TRIP-865(S3) — 파일명을 kakaoMapViewMock → mapViewMock 으로 개명하고, 신 이름 `MapView`
 * 와 전환기 별칭 `KakaoMapView`(아직 alias 를 쓰는 소비처용, S3 에서 대부분 MapView 로 넘어가고
 * onMapMessage 를 쓰는 StayRegister 핀 지정만 S4 까지 alias 유지)를 둘 다 노출한다. 남은 props
 * (`pins`·`viewOnly`·`onPinTap`·`onMapMessage` 등)는 host 엘리먼트로 그대로 통과시켜, 테스트가
 * `getByTestId('map-root').props.onPinTap(...)`·`.onMapMessage(...)`로 직접 발화한다.
 */

export interface MapCenter {
  lat: number;
  lng: number;
}

export interface MapPin {
  number: number;
  lat: number;
  lng: number;
}

function MapView({
  center,
  ...rest
}: {
  center: MapCenter;
} & Record<string, unknown>) {
  return (
    <Text testID="map-root" {...rest}>{`${center.lat},${center.lng}`}</Text>
  );
}

// 전환기 별칭 — S3 에서 MapView 로 안 넘어간 소비처(onMapMessage 쓰는 StayRegister 핀 지정)가
// 여전히 KakaoMapView 를 부른다. S5 에서 소비처가 0 이 되면 이 export 도 제거.
const KakaoMapView = MapView;

// TRIP-866(S4) — 중앙 고정 핀 picker 의 얇은 목. 소비 화면(StayRegister 핀 지정·LiveLocation)의
// 테스트가 이 목을 통해 `onPick` 을 직접 발화해 "지도가 좌표를 보고했다"를 흉내낸다(구 onMapMessage
// 직접 발화 선례 동형). `onPick`·나머지 props 는 host 로 그대로 통과시켜
// `getByTestId('center-pin-picker').props.onPick({ lat, lng })` 로 관측·발화한다. 중앙 고정 핀은
// `map-center-pin` 마커로 존재만 노출한다(실 크로스헤어·initialCenter 포획은 실물
// CenterPinPicker.test.tsx 가 잰다 — 이 목은 소비처 배선 전용이라 그 내부를 재현하지 않는다).
function CenterPinPicker({
  center,
  ...rest
}: {
  center: MapCenter;
} & Record<string, unknown>) {
  return (
    <View testID="center-pin-picker" {...rest}>
      <View testID="map-center-pin" />
    </View>
  );
}

export { MapView, KakaoMapView, CenterPinPicker };
