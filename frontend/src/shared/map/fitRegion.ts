import type { Region } from '@mj-studio/react-native-naver-map';

import type { MapCenter } from './MapView';

// ponytail: 여백 배율·최소 폭은 대략값 — 물방울 핀 머리가 카드 가장자리에 잘리면 6-b 실기에서 조정한다.
/** 핀 폭에 곱하는 여백 배율(양쪽 20%씩). */
const PADDING_FACTOR = 1.4;
/** 핀이 한 점에 겹쳐도 폭이 0 이 되지 않게 하는 최소 폭(도, ≈1km). */
const MIN_DELTA_DEG = 0.01;

/**
 * 핀 전부가 한 화면에 들어오는 네이버 `Region`(남서 모서리 + 양수 폭)을 만든다(TRIP-1022 #040).
 * 핀이 2개 미만이면 null — 한 점은 기존 center 카메라가 맡는다.
 */
export function buildFitRegion(points: readonly MapCenter[]): Region | null {
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latitudeDelta = Math.max(
    (maxLat - minLat) * PADDING_FACTOR,
    MIN_DELTA_DEG
  );
  const longitudeDelta = Math.max(
    (maxLng - minLng) * PADDING_FACTOR,
    MIN_DELTA_DEG
  );

  // 핀 묶음의 가운데를 영역 가운데에 둔다.
  return {
    latitude: (minLat + maxLat) / 2 - latitudeDelta / 2,
    longitude: (minLng + maxLng) / 2 - longitudeDelta / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

/** 위도 1도의 대략 길이(m). 경도 1도는 여기에 cos(위도)를 곱한다(극으로 갈수록 짧아진다). */
const M_PER_DEG_LAT = 111_320;

/**
 * 반경 원 전체가 한 화면에 들어오는 `Region`(TRIP-1043 #044). 원의 남북동서 끝을 경계 상자로 삼고
 * 핀과 같은 여백 배율을 곱한다 — 줌 고정 카메라로는 1km 넘는 원 테두리가 작은 카드 밖으로 나갔다.
 */
export function buildCircleRegion(center: MapCenter, radiusM: number): Region {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  const latitudeDelta = 2 * dLat * PADDING_FACTOR;
  const longitudeDelta = 2 * dLng * PADDING_FACTOR;
  return {
    latitude: center.lat - latitudeDelta / 2,
    longitude: center.lng - longitudeDelta / 2,
    latitudeDelta,
    longitudeDelta,
  };
}
