/** d04 지역 칩 라벨(TRIP-1023 #026) — `[]`=전국, 한 곳=그 이름, 여러 곳="{첫 지역} 외 N곳". */
export function formatRegionChipLabel(regionNames: readonly string[]): string {
  if (regionNames.length === 0) return '전국';
  if (regionNames.length === 1) return regionNames[0];
  return `${regionNames[0]} 외 ${regionNames.length - 1}곳`;
}
