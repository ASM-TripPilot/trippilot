/** 2개씩 묶어 그리드 행을 만든다(홀수면 마지막 행은 1개만 남는다). 온보딩 취향 1/2·2/2 가 같이 쓴다. */
export function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}
