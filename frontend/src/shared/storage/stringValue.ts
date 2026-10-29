import { getSecureItem, setSecureItem } from './secureKv';

/**
 * TRIP-1122 · 키별 문자열 1개 저장소(도메인 무관 — 키 이름과 뜻은 윗층이 갖는다). 값은 감싸지 않고
 * 그대로 저장한다. `idSet.ts` 와 같은 이유로 `index.ts`(토큰, SEC-09)에서 재수출하지 않는다 — 딥 경로로
 * import 한다. 저장소는 `./secureKv` 어댑터가 고르고, 실패는 호출부가 받는다.
 */

export async function readStringValue(key: string): Promise<string | null> {
  return (await getSecureItem(key)) ?? null;
}

export async function writeStringValue(
  key: string,
  value: string
): Promise<void> {
  await setSecureItem(key, value);
}
