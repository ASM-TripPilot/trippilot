/**
 * accessToken 동기 in-memory 홀더. 요청 인터셉터는 매 요청마다 토큰을 await 없이 즉시 읽어야
 * 하는데, 실제 토큰은 async SecureStore 에만 있다 — 이 모듈은 그 간극을 메우는 캐시다(저장소 자체가
 * 아니다). 세 setter(setAccessToken·clearAccessToken·hydrate) 모두 같은 값이면 구독자에게
 * 다시 통지하지 않는다(동등 비교 가드) — 없으면 hydrate 복원이 불필요한 재조회를 일으킨다.
 */

type TokenListener = (token: string | null) => void;

let currentToken: string | null = null;
const listeners = new Set<TokenListener>();

function applyToken(next: string | null): void {
  if (next === currentToken) {
    return;
  }
  currentToken = next;
  for (const listener of listeners) {
    listener(currentToken);
  }
}

export function getAccessToken(): string | null {
  return currentToken;
}

export function setAccessToken(token: string): void {
  applyToken(token);
}

export function clearAccessToken(): void {
  applyToken(null);
}

/** 콜드 재시작 시 저장소에서 읽은 값을 홀더에 복원한다(로그인이 아니라 "복원"이라 이름이 다르다). */
export function hydrate(token: string | null): void {
  applyToken(token);
}

/**
 * 토큰 변화 구독. 구독 시점의 현재 값은 재생하지 않고, 이후 실제로 값이 바뀔 때만 통지한다 —
 * 로그인 성공을 라우터 관통 없이 위로 올리는 유일한 신호다. 구독 해제 함수를 반환한다.
 */
export function subscribeAccessToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
