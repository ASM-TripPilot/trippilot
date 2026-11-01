import { buildCircleRegion, buildFitRegion } from './fitRegion';
import type { FitBand } from './fitRegion';
import type { MapCenter, MapPin } from './MapView';
import type {
  NaverMap,
  NaverMapsApi,
  NaverMarker,
  NaverOverlay,
} from './naverMapsLoader';
import { buildPathLines } from './pathLines';
import { PIN_MUTED_SOFT, PIN_PRIMARY, PIN_WHITE } from './pinShapes';
import {
  WEB_INITIAL_ZOOM,
  buildMapOptions,
  regionToCorners,
} from './webMapOptions';
import { buildWebMarker } from './webMarkerHtml';

export interface WebMapInput {
  center: MapCenter;
  pins?: readonly MapPin[];
  viewOnly?: boolean;
  fitPins?: boolean;
  fitBand?: FitBand;
  radiusCircle?: { center: MapCenter; radiusM: number };
  connectPins?: boolean;
  actualRoute?: readonly (readonly MapCenter[])[];
  showMyLocation?: boolean;
}

/** 내 위치 조회·감시 포트 — `expo-location` 이 구조적으로 만족한다. 권한은 조회만 하고 요청 함수는 일부러 뺐다(BR-U10-53). */
export interface WebLocationPort {
  getForegroundPermissionsAsync(): Promise<{ status: string }>;
  watchPositionAsync(
    options: Record<string, unknown>,
    callback: (location: {
      coords: { latitude: number; longitude: number };
    }) => void,
    errorHandler?: (message: string) => void
  ): Promise<{ remove(): void }>;
}

const PLAN_WEIGHT = 3;
const CASING_WEIGHT = 6;
const PLAN_DIMMED_WEIGHT = 1.5;
const ACTUAL_ROUTE_WEIGHT = 3;
const MY_DOT_SIZE = 18;
// 보이는 글자 없는 파란 점(INV-3). 흰 테두리·그림자로 타일 위에서 구분한다.
const MY_DOT_HTML = `<div style="width:${MY_DOT_SIZE}px;height:${MY_DOT_SIZE}px;box-sizing:border-box;border-radius:50%;background:#2F80ED;border:3px solid ${PIN_WHITE};box-shadow:0 0 4px rgba(0,0,0,0.35)"></div>`;

// 네이버가 인증 실패로 내부를 망가뜨린 뒤엔 정리 호출이 던진다 — 항목마다 삼켜 다음 정리와 실패 표면 전환을 막지 않는다.
const attempt = (cleanup: () => void): void => {
  try {
    cleanup();
  } catch {
    // 이미 망가진 객체 — 더 할 수 있는 정리가 없다.
  }
};

export interface WebMapController {
  update(input: WebMapInput): void;
  /** 컨테이너 크기가 잡힌 뒤 지도 크기를 다시 재고 같은 영역으로 한 번 더 맞춘다. */
  refit(): void;
  destroy(): void;
}

/**
 * 입력(핀·center·맞춤·원·viewOnly)을 네이버 JS 지도 호출로 옮긴다. 입력은 **값**으로 비교해, 값이 같은 재렌더는
 * 마커를 다시 만들지 않고 사용자가 끌어 둔 지도를 되돌리지 않는다. 첫 `update` 에서 지도를 만든다.
 */
export function createWebMapController(deps: {
  naver: NaverMapsApi;
  element: HTMLElement;
  onPinTap: (index: number) => void;
  onCameraIdle?: (center: MapCenter) => void;
  location?: WebLocationPort;
}): WebMapController {
  const { maps } = deps.naver;
  let map: NaverMap | null = null;
  let destroyed = false;
  let markers: NaverOverlay[] = [];
  let lines: NaverOverlay[] = [];
  let lineKey: string | null = null;
  // 내 위치: `locSession` 은 켜질 때마다 새로 매기고 끄거나 destroy 하면 올려, 늦게 끝난 조회·감시·위치를 무효로 만든다.
  let locOn = false;
  let locSession = 0;
  let locSub: { remove(): void } | null = null;
  let dot: NaverMarker | null = null;
  let circle: NaverOverlay | null = null;
  let pinKey: string | null = null;
  let circleKey: string | null = null;
  let centerKey: string | null = null;
  let fitKey: string | null = null;
  let viewOnlyKey: boolean | null = null;
  let fitCorners: ReturnType<typeof regionToCorners> | null = null;

  const latLng = (point: MapCenter) => new maps.LatLng(point.lat, point.lng);
  const fit = (corners: NonNullable<typeof fitCorners>): void => {
    map?.fitBounds(
      new maps.LatLngBounds(latLng(corners.sw), latLng(corners.ne))
    );
  };

  const stopLocation = (): void => {
    locOn = false;
    locSession += 1;
    const sub = locSub;
    const oldDot = dot;
    locSub = null;
    dot = null;
    if (sub) attempt(() => sub.remove());
    if (oldDot) attempt(() => oldDot.setMap(null));
  };

  const startLocation = (): void => {
    locOn = true;
    locSession += 1;
    const session = locSession;
    const port = deps.location;
    if (!port) return;
    const onPosition = (location: {
      coords: { latitude: number; longitude: number };
    }): void => {
      if (session !== locSession || map === null) return;
      const position = latLng({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
      if (dot) {
        dot.setPosition(position);
        return;
      }
      dot = new maps.Marker({
        position,
        map,
        clickable: false,
        icon: {
          content: MY_DOT_HTML,
          anchor: new maps.Point(MY_DOT_SIZE / 2, MY_DOT_SIZE / 2),
        },
      });
    };
    // 조회→감시 체인은 어느 단계에서 실패해도 점만 없을 뿐이다(삼킨다).
    void (async () => {
      try {
        const { status } = await port.getForegroundPermissionsAsync();
        if (session !== locSession || status !== 'granted') return;
        const sub = await port.watchPositionAsync({}, onPosition);
        if (session === locSession) locSub = sub;
        else attempt(() => sub.remove());
      } catch {
        // 위치를 못 얻으면 점이 없을 뿐 지도는 정상이다.
      }
    })();
  };

  const drawLines = (input: WebMapInput): void => {
    const path = buildPathLines(input);
    const nextLineKey = JSON.stringify(path);
    if (nextLineKey === lineKey) return;
    // 키는 다 그린 뒤에만 정한다 — 중간에 던지면 null 로 남아 다음 갱신이 다시 그린다.
    lineKey = null;
    lines.forEach((line) => attempt(() => line.setMap(null)));
    lines = [];
    const target = map;
    const draw = (
      points: readonly MapCenter[],
      strokeColor: string,
      strokeWeight: number,
      strokeStyle?: string
    ): void => {
      // 만들자마자 추적에 넣는다 — 다음 것이 던져도 지도에 남은 선을 다음 갱신이 걷을 수 있다.
      lines.push(
        new maps.Polyline({
          map: target,
          path: points.map(latLng),
          strokeColor,
          strokeWeight,
          strokeOpacity: 1,
          ...(strokeStyle === undefined ? {} : { strokeStyle }),
        })
      );
    };
    try {
      if (path.plan !== null) {
        // 먼저 만든 흰 케이싱이 아래에 깔리고 primary 가 위에 얹힌다(zIndex 같을 때 나중이 위 — 육안 확인).
        if (path.planDimmed) {
          draw(path.plan, PIN_MUTED_SOFT, PLAN_DIMMED_WEIGHT);
        } else {
          draw(path.plan, PIN_WHITE, CASING_WEIGHT);
          draw(path.plan, PIN_PRIMARY, PLAN_WEIGHT);
        }
      }
      path.segments.forEach((segment) =>
        draw(segment, PIN_PRIMARY, ACTUAL_ROUTE_WEIGHT, 'shortdash')
      );
      lineKey = nextLineKey;
    } catch {
      // 네이버가 망가진 뒤 — 효과 밖으로 던지지 않는다(INV-4 는 실패 표면이 맡는다).
    }
  };

  return {
    update(input) {
      if (destroyed) return;
      const pins = input.pins ?? [];
      const viewOnly = input.viewOnly === true;
      const pinRegion =
        input.fitPins === true
          ? buildFitRegion(
              pins.map((pin) => ({ lat: pin.lat, lng: pin.lng })),
              input.fitBand
            )
          : null;
      const region =
        pinRegion ??
        (input.radiusCircle
          ? buildCircleRegion(
              input.radiusCircle.center,
              input.radiusCircle.radiusM
            )
          : null);
      const nextFitKey = region === null ? null : JSON.stringify(region);
      const nextCenterKey = `${input.center.lat},${input.center.lng}`;

      if (map === null) {
        map = new maps.Map(deps.element, {
          ...buildMapOptions({ viewOnly }),
          center: latLng(input.center),
          zoom: WEB_INITIAL_ZOOM,
        });
        viewOnlyKey = viewOnly;
        centerKey = nextCenterKey;
        const created = map;
        const { onCameraIdle } = deps;
        if (onCameraIdle) {
          maps.Event.addListener(created, 'idle', () => {
            if (destroyed) return;
            const center = created.getCenter();
            onCameraIdle({ lat: center.lat(), lng: center.lng() });
          });
        }
      } else if (viewOnly !== viewOnlyKey) {
        map.setOptions(buildMapOptions({ viewOnly }));
        viewOnlyKey = viewOnly;
      }

      if (region !== null) {
        if (nextFitKey !== fitKey) {
          fitCorners = regionToCorners(region);
          fit(fitCorners);
        }
      } else {
        fitCorners = null;
        // 맞춤이 풀렸거나 center 값이 바뀐 때만 중심을 옮긴다.
        if (nextCenterKey !== centerKey || fitKey !== null) {
          map.setCenter(latLng(input.center));
        }
      }
      fitKey = nextFitKey;
      centerKey = nextCenterKey;

      const nextPinKey = JSON.stringify(
        pins.map((p) => [p.number, p.lat, p.lng, p.state, p.kind, p.label])
      );
      if (nextPinKey !== pinKey) {
        pinKey = null;
        markers.forEach((marker) => attempt(() => marker.setMap(null)));
        markers = [];
        const target = map;
        try {
          pins.forEach((pin, index) => {
            const { html, width, height, anchor } = buildWebMarker(pin);
            const marker = new maps.Marker({
              position: latLng(pin),
              map: target,
              icon: {
                content: html,
                anchor: new maps.Point(width * anchor.x, height * anchor.y),
              },
            });
            markers.push(marker);
            maps.Event.addListener(marker, 'click', () => deps.onPinTap(index));
          });
          pinKey = nextPinKey;
        } catch {
          // 라인과 같다 — 만든 마커는 추적하고 키는 비워 다음 갱신이 다시 만든다.
        }
      }

      drawLines(input);

      const nextCircleKey = input.radiusCircle
        ? `${input.radiusCircle.center.lat},${input.radiusCircle.center.lng},${input.radiusCircle.radiusM}`
        : null;
      if (nextCircleKey !== circleKey) {
        circleKey = nextCircleKey;
        circle?.setMap(null);
        circle = input.radiusCircle
          ? new maps.Circle({
              map,
              center: latLng(input.radiusCircle.center),
              radius: input.radiusCircle.radiusM,
              strokeColor: PIN_PRIMARY,
              strokeWeight: 1.5,
              strokeOpacity: 1,
              fillColor: PIN_PRIMARY,
              fillOpacity: 0,
            })
          : null;
      }

      const wantLocation = input.showMyLocation === true;
      if (wantLocation && !locOn) startLocation();
      else if (!wantLocation && locOn) stopLocation();
    },
    refit() {
      if (destroyed || map === null) return;
      map.autoResize();
      if (fitCorners !== null) fit(fitCorners);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      markers.forEach((marker) => attempt(() => marker.setMap(null)));
      lines.forEach((line) => attempt(() => line.setMap(null)));
      stopLocation();
      attempt(() => circle?.setMap(null));
      lines = [];
      markers = [];
      circle = null;
      attempt(() => map?.destroy());
      map = null;
    },
  };
}
