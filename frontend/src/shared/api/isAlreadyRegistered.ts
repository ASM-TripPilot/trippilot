import { isAxiosError } from 'axios';

/**
 * 409 = "이미 그 여행에 있다"(INV-U1-18 · BR-U1-50). 목표 상태와 결과 상태가 같으므로 실패로
 * 세지 않는다 — 다만 삼키지도 않는다(호출부가 안내를 낸다, INV-4).
 *
 * `shared/api` 에 있는 이유: 위저드 배선(g01)과 필수 방문지 배선(h07)이 같은 판정을 쓴다.
 * 승격의 값은 사용처 개수가 아니라 **판정이 한 군데에만 있다**는 것이다(README §승격 규칙).
 */
export function isAlreadyRegistered(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 409;
}
