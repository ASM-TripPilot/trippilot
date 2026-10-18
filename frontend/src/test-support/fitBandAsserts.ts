/**
 * TRIP-1416 · 보이는 띠 맞춤 단언 헬퍼 — 셸·허브·MapView 테스트가 같은 잣대로 region 을 잰다.
 *
 * 네이버 `Region` 은 남서 모서리(`latitude`·`longitude`) + 북동까지의 양수 폭이다. SDK 는 이 상자가
 * 화면에 **다 보이는 최대 줌**으로 맞추므로, 상자가 세로로 꽉 찰 때(세로가 줌을 정할 때)만
 * "상자의 위쪽 x%" 가 "화면의 위쪽 x%" 와 같다 — 그래서 두 단언을 짝으로 쓴다.
 */

export interface NativeRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

// 부동소수 반올림만 흡수한다(1e-9° 는 서브밀리미터).
const EPS = 1e-9;

/**
 * 모든 핀이 보이는 띠 안에 있다 — 위도는 아래 `bottom` 비율 위 · 위쪽 `topPx / screenHeight` 비율 아래,
 * 경도는 상자 안. `topPx` 는 위에서 가리는 높이의 **바닥값**(세이프에어리어 + 오버레이 줄 바닥)이다.
 */
export function expectPinsInBand(
  region: NativeRegion | undefined,
  pins: readonly LatLng[],
  band: { bottom: number; topPx: number; screenHeight: number }
): void {
  expect(region).toBeDefined();
  if (region === undefined) return;
  const south = region.latitude;
  const span = region.latitudeDelta;
  const lowest = south + band.bottom * span;
  const highest = south + (1 - band.topPx / band.screenHeight) * span;
  pins.forEach(({ lat, lng }) => {
    expect(lat).toBeGreaterThanOrEqual(lowest - EPS);
    expect(lat).toBeLessThanOrEqual(highest + EPS);
    expect(lng).toBeGreaterThanOrEqual(region.longitude - EPS);
    expect(lng).toBeLessThanOrEqual(
      region.longitude + region.longitudeDelta + EPS
    );
  });
}

/**
 * 상자가 화면보다 세로로 길쭉하다(세로가 줌을 정한다) — `Δlat / (Δlng · cos(핀 묶음 가운데 위도)) ≥ 화면 세로/가로`.
 * cos 기준 위도는 **핀 묶음 가운데**다(구현과 같은 모델 — 02a ★2).
 */
export function expectHeightLimited(
  region: NativeRegion | undefined,
  pins: readonly LatLng[],
  aspect: number
): void {
  expect(region).toBeDefined();
  if (region === undefined) return;
  const lats = pins.map((p) => p.lat);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const ratio =
    region.latitudeDelta /
    (region.longitudeDelta * Math.cos((midLat * Math.PI) / 180));
  expect(ratio).toBeGreaterThanOrEqual(aspect * (1 - 1e-9));
}
