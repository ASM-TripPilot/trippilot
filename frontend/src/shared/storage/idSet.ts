import { getSecureItem, setSecureItem } from './secureKv';

/**
 * TRIP-928 · 키별 문자열 id 집합 저장소(도메인 무관 — 키 이름과 뜻은 윗층이 갖는다).
 * `index.ts`(토큰, SEC-09)에서 재수출하지 않는다 — 테스트들이 `@/shared/storage` 배럴을 통째로
 * 목으로 갈아끼우므로, 배럴에 얹으면 그 목들이 이 함수를 지운다. 딥 경로로 import 한다.
 *
 * 저장소는 `./secureKv` 어댑터가 고른다(웹=localStorage). 막히면 reject 하고 호출부가 그 실패를 받는다.
 */

export async function readIdSet(key: string): Promise<string[]> {
  const raw = await getSecureItem(key);
  if (raw == null) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === 'string')
    : [];
}

export async function writeIdSet(
  key: string,
  ids: readonly string[]
): Promise<void> {
  await setSecureItem(key, JSON.stringify(ids));
}
