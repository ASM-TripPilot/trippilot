import type { Place } from '../model';

/**
 * TRIP-1432 — 장소 레인 순서: 사진 있는 곳을 모두 앞에, 각 그룹 안에서는 지역(시도 코드 앞 2자리)을
 * 번갈아 뽑는다. 라운드는 그 그룹에서 지역이 처음 나타난 순서, 지역 안은 입력 순서 그대로.
 * 코드가 없으면 "코드 없음" 한 지역. 입력은 바꾸지 않는다(react-query 캐시 배열).
 */
export function orderLanePlaces(places: readonly Place[]): Place[] {
  const withPhoto = places.filter((p) => Boolean(p.imageUrl));
  const noPhoto = places.filter((p) => !p.imageUrl);
  return [...interleaveByRegion(withPhoto), ...interleaveByRegion(noPhoto)];
}

function interleaveByRegion(places: readonly Place[]): Place[] {
  // Map 은 키를 넣은 순서를 기억한다 → 라운드 순서 = 지역이 처음 나타난 순서.
  const byRegion = new Map<string, Place[]>();
  for (const p of places) {
    const key = p.regionCode?.slice(0, 2) ?? '';
    const bucket = byRegion.get(key);
    if (bucket) bucket.push(p);
    else byRegion.set(key, [p]);
  }
  const buckets = [...byRegion.values()];
  const out: Place[] = [];
  for (let round = 0; out.length < places.length; round += 1) {
    for (const bucket of buckets) {
      if (round < bucket.length) out.push(bucket[round]);
    }
  }
  return out;
}
