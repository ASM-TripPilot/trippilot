/**
 * filter-zero 카드의 "'{원인}' 필터 해제" 버튼이 URL 파라미터에서 무엇을 뺄지 정하는 순수 함수
 * (TRIP-416 AC-5). `filterZeroReasons` 코드(`amenity:오션뷰`·bare `stayType` 등)를 지금 적용된
 * amenity/stayType 배열에 매핑해 그 원인만 완화한다.
 *
 * reason 은 `filterReasonLabel` 과 **같은 규약**으로 읽는다 — `split(':')` 로 콜론 앞이 축, 뒤가
 * 값. 값이 있으면 그 축 배열에서 그 값만 빼고, 값이 없으면(bare 축) 그 축을 통째로 비우며,
 * amenity/stayType 밖의 모르는 축은 아무것도 바꾸지 않는다(안전). 입력 배열은 변형하지 않고
 * 언제나 새 객체·배열을 낸다(비파괴).
 */
type FilterAxes = { amenity: string[]; stayType: string[] };

export function relaxCulpritFilter(
  reason: string,
  current: FilterAxes
): FilterAxes {
  const [axis, value] = reason.split(':');
  // 항상 새 배열로 복사한다 — 반환값에서만 제거가 일어나고 입력은 그대로 남는다(비파괴 계약).
  const next: FilterAxes = {
    amenity: [...current.amenity],
    stayType: [...current.stayType],
  };
  if (axis !== 'amenity' && axis !== 'stayType') return next;
  // 값 있으면 그 값만 제거, bare 축이면 축 전체 비움. 현재 값에 없는 원인은 filter 가 그대로 둔다.
  next[axis] = value ? next[axis].filter((v) => v !== value) : [];
  return next;
}
