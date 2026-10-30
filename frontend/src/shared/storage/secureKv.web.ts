/**
 * TRIP-1647 · 키-값 저장 한 겹(웹) — `localStorage`. 웹엔 OS 보안 저장소가 없어 토큰이 브라우저 저장소에
 * 평문으로 남는다(SEC-09 의 의도적 약화 — XSS 에 노출). 네이티브 쌍(`secureKv.ts`)과 이름·인자 개수가 같다.
 *
 * 저장소가 없거나(SSR·비브라우저) 막혔거나(시크릿 모드 SecurityError) 가득 차면(Quota) 에러를 삼키지 않고
 * **거절된 Promise** 로 돌려준다(INV-4) — 동기 throw 가 아니라 `async` 라야 호출부 `await`/`.catch` 가 받는다.
 * `localStorage` 는 호출 때마다 꺼낸다 — 접근 자체가 던지는 브라우저가 있어 로드 시점에 한 번 잡아 두지 않는다.
 */

export async function getSecureItem(key: string): Promise<string | null> {
  return globalThis.localStorage.getItem(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  globalThis.localStorage.setItem(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  globalThis.localStorage.removeItem(key);
}
