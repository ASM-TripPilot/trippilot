/**
 * '내 주변' 좌표 해석 — US-STAY-01 정상·예외 · BR-U1-11.
 *
 * **판정을 순수 함수로 뽑은 이유**(TRIP-182 `resolveStaySearchState` 선례): 이 결정에 필요한
 * 것은 세 물음의 답뿐이다 — 권한을 줬나 · 현재 좌표를 얻었나 · 등록 숙소 좌표가 있나.
 * 그 셋을 인자로 받으면 `expo-location`도 서버도 목킹하지 않고 분기를 전수 검사할 수 있다.
 * 실제 배선(권한 다이얼로그·`GET /saved-stays`)은 컨테이너가 한다.
 */

export interface Coords {
  lat: number;
  lng: number;
}

export interface NearbyDeps {
  /** OS 위치 권한 요청. 이미 허용돼 있으면 다이얼로그 없이 바로 granted 를 돌려준다. */
  requestPermission(): Promise<{ granted: boolean }>;
  /** 현재 좌표. 권한이 있어도 실내·기기 사정으로 실패할 수 있다(던져도 된다). */
  getCurrentPosition(): Promise<Coords>;
  /** 등록 숙소 중 **좌표가 확정된** 첫 곳. 없으면 null(던져도 된다). */
  getSavedStayCoords(): Promise<Coords | null>;
}

export type NearbyResult =
  /** 현재 위치로 조회 */
  | ({ kind: 'granted' } & Coords)
  /** 현재 위치를 못 써서 등록 숙소 좌표로 **대체** 조회 — 화면이 이 사실을 고지해야 한다 */
  | ({ kind: 'fallback' } & Coords)
  /** 좌표를 하나도 못 구했다 — 조회하지 않는다 */
  | {
      kind: 'unavailable';
      reason: 'denied-no-fallback' | 'position-failed';
    };

/** 던지는 의존성을 null 로 접는다 — 대체 좌표 조회 실패가 전체 흐름을 깨뜨리면 안 된다. */
async function safeSavedStayCoords(deps: NearbyDeps): Promise<Coords | null> {
  try {
    return await deps.getSavedStayCoords();
  } catch {
    return null;
  }
}

/**
 * 좌표 해석 결과를 결정론적으로 하나 돌려준다 — 어떤 경로에서도 예외를 밖으로 내보내지 않는다(INV-4).
 *
 * 우선순위: **현재 위치 > 등록 숙소 > 없음**. 등록 숙소가 있어도 권한이 있으면 현재 위치가
 * 이긴다 — 대체는 현재 위치를 못 쓸 때만 발동한다.
 *
 * `reason` 을 둘로 나눈 이유: 권한 거부와 측위 실패는 사용자가 할 일이 다르다
 * (설정에서 권한 켜기 vs 다시 시도). 한 값으로 뭉개면 안내를 고를 수 없다.
 */
export async function resolveNearby(deps: NearbyDeps): Promise<NearbyResult> {
  const { granted } = await deps.requestPermission();

  if (!granted) {
    const fallback = await safeSavedStayCoords(deps);
    return fallback
      ? { kind: 'fallback', ...fallback }
      : { kind: 'unavailable', reason: 'denied-no-fallback' };
  }

  try {
    const here = await deps.getCurrentPosition();
    return { kind: 'granted', ...here };
  } catch {
    const fallback = await safeSavedStayCoords(deps);
    return fallback
      ? { kind: 'fallback', ...fallback }
      : { kind: 'unavailable', reason: 'position-failed' };
  }
}
