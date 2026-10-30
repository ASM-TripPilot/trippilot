import * as SecureStore from 'expo-secure-store';

/**
 * TRIP-1647 · 키-값 저장 한 겹(네이티브) — iOS·Android 는 OS 보안 저장소(`expo-secure-store`)에 인자 그대로
 * 통과시킨다(옵션·값 가공 없음). 웹은 같은 이름의 `secureKv.web.ts` 가 대신 읽힌다(Metro 가 플랫폼 확장자로 고른다).
 * 두 파일은 export 이름·인자 개수가 같아야 한다 — `tsc` 는 `.web.ts` 를 단독으로는 검사하지만 import 는
 * 이 파일로만 풀어 두 파일의 시그니처를 서로 비교하지 않으므로 `secureKv.test.ts` 가 지킨다.
 */

export function getSecureItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export function setSecureItem(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value);
}

export function deleteSecureItem(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key);
}
