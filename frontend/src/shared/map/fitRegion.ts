import type { Region } from '@mj-studio/react-native-naver-map';

import type { MapCenter } from './MapView';

// ponytail: 여백 배율·최소 폭은 대략값 — 물방울 핀 머리가 카드 가장자리에 잘리면 6-b 실기에서 조정한다.
/** 핀 폭에 곱하는 여백 배율(양쪽 20%씩). */
const PADDING_FACTOR = 1.4;
/** 핀이 한 점에 겹쳐도 폭이 0 이 되지 않게 하는 최소 폭(도, ≈1km). */
const MIN_DELTA_DEG = 0.01;

/**
 * TRIP-1416 · 보이는 띠 — 화면 높이에 대한 비율. `top` = 위에서 가린 비율(세이프에어리어+오버레이 줄),
 * `bottom` = 아래에서 가린 비율(시트), `aspect` = 화면 세로/가로(선택). `top + bottom` 은 1 미만이어야 한다.
 */
export interface FitBand {
  top: number;
  bottom: number;
  aspect?: number;
}

/**
 * 핀 전부가 한 화면에 들어오는 네이버 `Region`(남서 모서리 + 양수 폭)을 만든다(TRIP-1022 #040).
 * 핀이 없으면 null(center 카메라 사다리가 맡는다). **핀 1개도 region** 이다(TRIP-1363) — 최소 폭
 * `MIN_DELTA_DEG` 로 그 점을 가운데 둔다. 1개일 때만 camera 로 떨어지면 일차 전환(2핀↔1핀)에서
 * MapView 의 key='region'/'camera' 가 뒤집혀 네이티브 지도가 통째 remount(타일 재로드·깜빡임)된다.
 *
 * `band` 를 주면(TRIP-1416) 상자를 위아래로 늘려 핀 묶음을 **보이는 띠** 가운데에 둔다 — 시트가 덮는
 * 아래 `bottom`·칩 줄이 덮는 위 `top` 만큼 상자가 커진다. `aspect` 가 있으면 상자를 화면보다 세로로
 * 길쭉하게 만든다: SDK fitBounds 는 상자가 다 보이는 최대 줌을 고르고 남는 축을 가운데 두므로,
 * 가로가 줌을 정하면 "상자 위쪽 x%" ≠ "화면 위쪽 x%" 가 돼 띠가 어긋난다(가림 50% 넘는 허브에서 핀이 시트에 걸림).
 * 세로 위치는 위도에 선형이라고 본다(하루 동선 폭에선 메르카토르 오차 ≈0.1%). 띠가 없거나 0 이면 지금 결과 그대로.
 */
export function buildFitRegion(
  points: readonly MapCenter[],
  band?: FitBand
): Region | null {
  if (points.length < 1) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const midLat = (minLat + maxLat) / 2;
  const longitudeDelta = Math.max(
    (maxLng - minLng) * PADDING_FACTOR,
    MIN_DELTA_DEG
  );
  const top = band?.top ?? 0;
  const bottom = band?.bottom ?? 0;
  const visible = 1 - top - bottom;
  // 핀 묶음(여백 포함)이 보이는 띠 높이에 들어가게 상자를 늘리고, 화면 비율보다 납작하면 세로로 더 늘린다.
  // cos 는 핀 묶음 가운데 위도로 잰다(fitRegion.test R6 과 같은 모델).
  const latitudeDelta = Math.max(
    Math.max((maxLat - minLat) * PADDING_FACTOR, MIN_DELTA_DEG) / visible,
    band?.aspect === undefined
      ? 0
      : band.aspect * Math.cos((midLat * Math.PI) / 180) * longitudeDelta
  );

  // 핀 묶음의 가운데를 보이는 띠의 가운데에 둔다(띠가 없으면 영역 가운데).
  return {
    latitude: midLat - (bottom + visible / 2) * latitudeDelta,
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
