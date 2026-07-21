/**
 * 동기 in-memory access-token holder. 인증 인터셉터는 매 요청마다 토큰을 동기로(즉시) 읽어야 하는데
 * (getAccessToken) 실토큰은 async SecureStore 에만 있다 — 그 간극을 메우는 메모리 상자다.
 * 로그인/리프레시 성공이 set, 세션 만료가 clear, 콜드 재시작이 hydrate 로 저장소 값을 복원한다.
 * 모듈 스코프 단일 상태(tokenManager 단일 소유) — 저장소가 아니라 저장소의 캐시일 뿐이다.
 */

let accessToken: string | null = null;

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function hydrate(token: string | null): void {
  accessToken = token;
}
