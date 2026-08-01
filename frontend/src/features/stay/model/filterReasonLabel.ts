/**
 * 필터 사유 코드 → 한글 라벨(01b Seed Q3 · AC-4 재료). 콜론 뒤에 값이 있으면 그 값을 그대로
 * 쓰고(서버가 이미 한글이다), 값이 없으면 축 이름 사전을 따르며, 사전에 없는 축은 코드
 * 그대로 폴백한다(서버가 축을 늘려도 안 깨진다).
 */
const AXIS_LABELS: Record<string, string> = {
  stayType: '숙소 유형',
  amenity: '편의시설',
};

export function filterReasonLabel(reason: string): string {
  const [axis, value] = reason.split(':');
  if (value) return value;
  return AXIS_LABELS[axis] ?? axis;
}
