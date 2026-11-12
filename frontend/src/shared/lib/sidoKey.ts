// 긴 것부터 — `도` 를 먼저 떼면 `…특별자치도` 가 `…특별자치` 로 남는다.
const SIDO_SUFFIXES = ['특별자치시', '특별자치도', '특별시', '광역시', '도'];

/**
 * 시도 정식 이름 → 짧은 이름(`서울특별시`→`서울`·`경상북도`→`경북`). 끝 명칭을 뗀 뒤 3자면 1·3번째 글자로 접는다.
 * `features/trip` 과 `entities/trip` 이 같이 쓴다 — entities 는 features 를 못 물어 여기 있다(TRIP-1806).
 */
export function sidoKey(name: string): string {
  const suffix = SIDO_SUFFIXES.find((one) => name.endsWith(one));
  const stem = suffix === undefined ? name : name.slice(0, -suffix.length);
  // 접기는 시도 끝 명칭을 뗀 경우에만(`충청북도`→`충북`). 시군구(`대덕구`)를 접으면 `대구`가 된다(03b 경고-1).
  return suffix !== undefined && stem.length === 3 ? stem[0] + stem[2] : stem;
}
