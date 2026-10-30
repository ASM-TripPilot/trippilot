import type { MapCenter, MapPin } from './MapView';

export interface PathLines {
  plan: MapCenter[] | null;
  planDimmed: boolean;
  segments: MapCenter[][];
}

/**
 * 경로선 규칙 한 곳 — 네이티브 `MapView` 와 웹 컨트롤러가 같이 쓴다. 연결선은 방문(visited)+무-kind 핀만 배열 순서로
 * 잇고(TRIP-768), 실제 경로는 점 2개 미만 세그먼트를 빼며 서로 잇지 않는다(BR-U10-37). 실제 경로가 켜지면 계획선을
 * 흐리게 그린다(BR-U10-41). `./MapView` 는 타입만 가져온다 — 웹 번들이 네이티브 SDK 를 끌고 오지 않게.
 */
export function buildPathLines(input: {
  pins?: readonly MapPin[];
  connectPins?: boolean;
  actualRoute?: readonly (readonly MapCenter[])[];
}): PathLines {
  const coords = (input.pins ?? [])
    .filter((pin) => pin.kind === undefined || pin.kind === 'visited')
    .map((pin) => ({ lat: pin.lat, lng: pin.lng }));
  const segments = (input.actualRoute ?? [])
    .filter((seg) => seg.length >= 2)
    .map((seg) => [...seg]);
  return {
    plan: input.connectPins !== false && coords.length >= 2 ? coords : null,
    planDimmed: segments.length > 0,
    segments,
  };
}
