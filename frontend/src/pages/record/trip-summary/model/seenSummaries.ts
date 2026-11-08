/**
 * TRIP-1831 · 이 앱 세션에서 이미 본 여행 요약(tripId) — 다시 열면 등장 연출 없이 바로 보인다.
 * 앱을 껐다 켜면 한 번 다시 재생한다(기기 저장은 비동기라 첫 렌더에 판정할 수 없고, `RevealItem` 은 재생 도중 `revealing` 이 뒤집히면 끝으로 점프한다).
 * 읽기는 페이지가 첫 렌더에 `useState` 초기화 함수로 한 번만 한다.
 */
const seen = new Set<string>();

export const hasSeenSummary = (tripId: string): boolean => seen.has(tripId);

export const markSummarySeen = (tripId: string): void => {
  seen.add(tripId);
};

export const resetSeenSummariesForTests = (): void => {
  seen.clear();
};
