// 신 코어(TRIP-863 S1) — 공급자 중립 네이버 지도 래퍼.
export { MapView } from './MapView';
export type { MapViewProps, MapCenter, MapPin } from './MapView';

// 중앙 고정 핀 좌표 선택기(TRIP-866 S4) — MapView + onCameraIdle 위에 얹은 얇은 래퍼.
export { CenterPinPicker } from './CenterPinPicker';
export type { CenterPinPickerProps } from './CenterPinPicker';

// 임시 카카오 호환 별칭(S3 소비처 전환·S5 최종 삭제). 소비처 12파일이 아직 이 표면을 문다.
export { KakaoMapView } from './kakaoCompat';
export type { KakaoMapViewProps, KakaoMapMessage } from './kakaoCompat';
