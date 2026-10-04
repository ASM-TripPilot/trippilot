// 다도시: TRIP-1210(BE+AI) 해소 전까지 — 서버가 날짜별 도시 배분을 못 해 서울 장소만 든 일정이
// 오류 없이 나온다(조용한 오답, INV-4). 1.0 은 위저드가 도시 하나만 받는다. 다도시가 지원되면
// 이 파일의 값만 풀면 된다(MAX_DESTINATIONS 를 올리거나 이 게이트를 쓰는 곳을 걷어낸다).
export const MAX_DESTINATIONS = 1;

export const ONE_CITY_NOTICE =
  '여러 도시 여행은 준비 중이에요. 한 도시를 골라 주세요.';

/** 지금 담긴 도시 수로 새 도시를 더 담을 수 있나. 교체(삭제 후 추가)는 0개에서 다시 열린다. */
export function canAddDestination(count: number): boolean {
  return count < MAX_DESTINATIONS;
}
