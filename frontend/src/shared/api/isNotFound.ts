import { isAxiosError } from 'axios';

/**
 * 404 = "그 자원이 아직 없다". `isAlreadyRegistered`(409)와 같은 자리·같은 형태다 —
 * 승격의 값은 사용처 개수가 아니라 **판정이 한 군데에만 있다**는 것이다(README §승격 규칙).
 *
 * 쓰이는 곳: h11 재생성(TRIP-297). "조회가 404였다(= 일정이 아직 없다 → 만들어도 안전)"와
 * "조회가 그 밖의 이유로 실패했다(= 확정 일정일 수도 있다 → 건드리면 안 된다)"를 가른다.
 * 이 구별이 없으면 조회 실패 시 확정 일정에 재생성 POST 가 나가 확정이 풀리고 동결됐던
 * poi_snapshot 참조가 사라진다(되돌리는 API 없음).
 *
 * 네트워크 오류(`response` 자체가 없다)는 **false** 다 — 응답을 못 받은 것은 "없다"는 답이
 * 아니라 "모른다"이고, 모를 때 안전한 쪽은 아무것도 하지 않는 것이다.
 */
export function isNotFound(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}
