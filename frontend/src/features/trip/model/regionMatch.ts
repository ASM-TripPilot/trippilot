/**
 * TRIP-1011 — 주소 문자열이 여행지(지역 이름)에 속하는지 판정하는 순수 함수.
 *
 * 지역 이름 상수표는 두지 않는다(TRIP-445 서버 카탈로그 원칙) — 끝 명칭을 뗀 뒤 3자면 1·3번째
 * 글자로 접는 규칙만으로 정식 명칭(`서울특별시`·`충청북도`)과 카카오 지번 약칭(`서울`·`충북`)이
 * 같은 키가 된다. `시·군·구` 는 떼지 않는다 — 떼면 경기 `광주시` 가 `광주`(광역시)와 같아진다.
 */

import type { Region } from '@/shared/api/index.schemas';

// 긴 것부터 — `도` 를 먼저 떼면 `…특별자치도` 가 `…특별자치` 로 남는다.
const SIDO_SUFFIXES = ['특별자치시', '특별자치도', '특별시', '광역시', '도'];

export function sidoKey(name: string): string {
  const suffix = SIDO_SUFFIXES.find((one) => name.endsWith(one));
  const stem = suffix === undefined ? name : name.slice(0, -suffix.length);
  // 접기는 시도 끝 명칭을 뗀 경우에만(`충청북도`→`충북`). 시군구(`대덕구`)를 접으면 `대구`가 된다(03b 경고-1).
  return suffix !== undefined && stem.length === 3 ? stem[0] + stem[2] : stem;
}

/** 주소 앞 3토막 중 하나가 지역 이름과 같거나(시군구 여행지) 시도 키가 같으면(시도 여행지) true. */
export function addressInRegion(address: string, region: string): boolean {
  const regionKey = sidoKey(region);
  return address
    .split(/\s+/)
    .slice(0, 3)
    .some((token) => token === region || sidoKey(token) === regionKey);
}

/**
 * TRIP-1042 — 장소가 여행 지역 안인가를 행정구역 **코드**로 가른다(BR-U1-58 · INV-U1-21, 이름 비교 금지).
 * 짧은 쪽이 긴 쪽의 접두사면 안이다(01b Q1 b) — 코드는 시도 2자리·시군구 5자리 고정폭 계층이라 5자리끼리는
 * 같은 값만 통과한다. 장소 코드가 없으면 안(fail-open), 목적지 코드가 **하나라도** 없으면 판정 자체를
 * 건너뛴다(01b Q6) — 코드 있는 목적지로만 가르면 코드 없는 목적지의 장소가 전부 선택 불가로 흐려진다.
 */
export function regionCodeInTrip(
  placeCode: string | null | undefined,
  destinationCodes: readonly (string | null | undefined)[]
): boolean {
  const codes = destinationCodes.filter((code): code is string => !!code);
  if (
    !placeCode ||
    codes.length === 0 ||
    codes.length < destinationCodes.length
  ) {
    return true;
  }
  return codes.some(
    (code) => placeCode.startsWith(code) || code.startsWith(placeCode)
  );
}

/**
 * TRIP-1042 AC-9 — 행 위치를 `인천 남동구`처럼 시도 짧은 이름 + 시군구로 적는다(BR-U1-58 ④). 시도 이름은
 * 서버 카탈로그의 SIDO 행(코드 앞 2자리와 같은 코드)에서 얻는다 — 상수표 없음(TRIP-445). 카탈로그가 아직
 * 없거나 그 시도 행이 없으면 지어내지 않고 `region` 그대로. 시드 POI 처럼 `region` 이 곧 시도 짧은 이름이면
 * 겹쳐 쓰지 않는다.
 */
export function placeLocationLabel(
  place: { region?: string | null; regionCode?: string | null },
  catalog: readonly Region[]
): string | null {
  const region = place.region ?? null;
  const sidoCode = place.regionCode?.slice(0, 2);
  const sido = sidoCode
    ? catalog.find((row) => row.regionCode === sidoCode)
    : undefined;
  if (!sido) return region;
  const short = sidoKey(sido.name);
  if (!region) return short;
  return region === short ? region : `${short} ${region}`;
}

/**
 * TRIP-1074 — reverse-geocode 주소에서 숙소 카드 동네 라벨(시군구)을 뽑는다(결정 2(a)). 첫 토막(시도)은
 * 보지 않고 둘째 토막만 본다 — `서울특별시`처럼 `시`로 끝나는 시도가 있어서다. 구가 있는 일반시는
 * `수원시 영통구`로 잇는다(01b Q1-A). 시군구가 없는 주소(세종·시도 없는 주소)는 지어내지 않고 null(Q2 · INV-1).
 */
export function sigunguLabel(address: string): string | null {
  const [, second, third] = address.trim().split(/\s+/);
  if (second === undefined || !/[시군구]$/.test(second)) return null;
  return second.endsWith('시') && third?.endsWith('구')
    ? `${second} ${third}`
    : second;
}
