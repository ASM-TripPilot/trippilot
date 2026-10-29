import type { Region } from '@mj-studio/react-native-naver-map';

import type { MapCenter } from './MapView';

/** 웹 초기 줌 — 네이티브 `INITIAL_ZOOM` 과 같은 값(6-b 실기 조정 knob). */
export const WEB_INITIAL_ZOOM = 14;

/** 네이티브 `Region`(남서 모서리 + 폭)을 `LatLngBounds` 재료(남서·북동 두 점)로 바꾼다. */
export function regionToCorners(region: Region): {
  sw: MapCenter;
  ne: MapCenter;
} {
  return {
    sw: { lat: region.latitude, lng: region.longitude },
    ne: {
      lat: region.latitude + region.latitudeDelta,
      lng: region.longitude + region.longitudeDelta,
    },
  };
}

/** `viewOnly` 면 드래그·핀치·휠·키보드 단축키를 모두 끈다(미전달은 켜짐 — 네이티브 기본과 같다). */
export function buildMapOptions(input: { viewOnly?: boolean }): {
  draggable: boolean;
  pinchZoom: boolean;
  scrollWheel: boolean;
  keyboardShortcuts: boolean;
} {
  const enabled = input.viewOnly !== true;
  return {
    draggable: enabled,
    pinchZoom: enabled,
    scrollWheel: enabled,
    keyboardShortcuts: enabled,
  };
}
