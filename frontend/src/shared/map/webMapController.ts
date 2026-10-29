import { buildCircleRegion, buildFitRegion } from './fitRegion';
import type { FitBand } from './fitRegion';
import type { MapCenter, MapPin } from './MapView';
import type { NaverMap, NaverMapsApi, NaverOverlay } from './naverMapsLoader';
import { PIN_PRIMARY } from './pinShapes';
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
}

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
}): WebMapController {
  const { maps } = deps.naver;
  let map: NaverMap | null = null;
  let destroyed = false;
  let markers: NaverOverlay[] = [];
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
        pinKey = nextPinKey;
        markers.forEach((marker) => marker.setMap(null));
        const target = map;
        markers = pins.map((pin, index) => {
          const { html, width, height, anchor } = buildWebMarker(pin);
          const marker = new maps.Marker({
            position: latLng(pin),
            map: target,
            icon: {
              content: html,
              anchor: new maps.Point(width * anchor.x, height * anchor.y),
            },
          });
          maps.Event.addListener(marker, 'click', () => deps.onPinTap(index));
          return marker;
        });
      }

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
    },
    refit() {
      if (destroyed || map === null) return;
      map.autoResize();
      if (fitCorners !== null) fit(fitCorners);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // 네이버가 인증 실패로 내부를 망가뜨린 뒤엔 정리 호출이 던진다 — 항목마다 삼켜 다음 정리와 실패 표면 전환을 막지 않는다.
      const attempt = (cleanup: () => void): void => {
        try {
          cleanup();
        } catch {
          // 이미 망가진 객체 — 더 할 수 있는 정리가 없다.
        }
      };
      markers.forEach((marker) => attempt(() => marker.setMap(null)));
      attempt(() => circle?.setMap(null));
      markers = [];
      circle = null;
      attempt(() => map?.destroy());
      map = null;
    },
  };
}
