/** d04 지역 칩 라벨(TRIP-1023 #026) — `[]`=전체 지역(서비스 지역 전부 조회, TRIP-1560), 한 곳=그 이름, 여러 곳="{첫 지역} 외 N곳". */
export function formatRegionChipLabel(regionNames: readonly string[]): string {
  if (regionNames.length === 0) return '전체 지역';
  if (regionNames.length === 1) return regionNames[0];
  return `${regionNames[0]} 외 ${regionNames.length - 1}곳`;
}
