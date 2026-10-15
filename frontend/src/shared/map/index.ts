// 신 코어(TRIP-863 S1) — 공급자 중립 네이버 지도 래퍼.
export { MapView } from './MapView';
export type {
  MapViewProps,
  MapCenter,
  MapPin,
  MapPinState,
  MapPinKind,
} from './MapView';

// 중앙 고정 핀 좌표 선택기(TRIP-866 S4) — MapView + onCameraIdle 위에 얹은 얇은 래퍼.
export { CenterPinPicker } from './CenterPinPicker';
export type { CenterPinPickerProps } from './CenterPinPicker';

// TRIP-1343 — 지도 위 계획｜실제 토글(여행 중·후 공용).
export { RouteToggle, actualDistanceLabel } from './RouteToggle';
export type { RouteToggleProps } from './RouteToggle';

// "네이버 지도에서 보기" — 장소 하나를 네이버 지도 앱 → 웹으로 여는 링크(장소 상세 d06·i10 공용).
export {
  buildNaverPlaceAppUrl,
  buildNaverPlaceWebUrl,
  canOpenNaverPlace,
  openNaverPlace,
} from './naverPlaceLink';
export type { NaverPlaceTarget } from './naverPlaceLink';
