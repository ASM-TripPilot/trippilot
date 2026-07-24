/**
 * 동기 in-memory access-token holder. 인증 인터셉터는 매 요청마다 토큰을 동기로(즉시) 읽어야 하는데
 * (getAccessToken) 실토큰은 async SecureStore 에만 있다 — 그 간극을 메우는 메모리 상자다.
 * 로그인/리프레시 성공이 set, 세션 만료가 clear, 콜드 재시작이 hydrate 로 저장소 값을 복원한다.
 * 모듈 스코프 단일 상태(tokenManager 단일 소유) — 저장소가 아니라 저장소의 캐시일 뿐이다.
 *
 * TRIP-172(결함 A) — 로그인 화면은 부트스트랩 게이트보다 한참 아래에 있어 "로그인 성공"을 콜백으로
 * 끌어올리려면 라우터를 관통해야 한다. 토큰이 바뀌는 이 지점이 유일한 공통 신호라, 새 store 를
 * 만드는 대신 이 홀더를 구독 가능하게만 만든다(subscribeAccessToken). 같은 값 재설정은 통지하지
 * 않는다 — 그래야 콜드 재시작 복원(hydrate)이 불필요한 재조회를 만들지 않는다.
 */

let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

function notify(): void {
  for (const listener of listeners) {
    listener(accessToken);
  }
}

export function setAccessToken(token: string): void {
  if (accessToken === token) {
    return;
  }
  accessToken = token;
  notify();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken(): void {
  if (accessToken === null) {
    return;
  }
  accessToken = null;
  notify();
}

export function hydrate(token: string | null): void {
  if (accessToken === token) {
    return;
  }
  accessToken = token;
  notify();
}

/**
 * 토큰 변화를 구독한다. 반환값은 구독 해제 함수(호출하면 더 이상 통지받지 않는다).
 * 리스너는 값이 실제로 바뀔 때만(위 3함수의 동등 비교 가드) 불린다.
 */
export function subscribeAccessToken(
  listener: (token: string | null) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
