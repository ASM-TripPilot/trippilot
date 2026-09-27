/**
 * TRIP-1011 — 주소 문자열이 여행지(지역 이름)에 속하는지 판정하는 순수 함수.
 *
 * 지역 이름 상수표는 두지 않는다(TRIP-445 서버 카탈로그 원칙) — 끝 명칭을 뗀 뒤 3자면 1·3번째
 * 글자로 접는 규칙만으로 정식 명칭(`서울특별시`·`충청북도`)과 카카오 지번 약칭(`서울`·`충북`)이
 * 같은 키가 된다. `시·군·구` 는 떼지 않는다 — 떼면 경기 `광주시` 가 `광주`(광역시)와 같아진다.
 */

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
