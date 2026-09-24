import * as SecureStore from 'expo-secure-store';

/**
 * TRIP-781 · 키별 참/거짓 플래그 저장소(도메인 무관 — 키 이름과 뜻은 윗층이 갖는다).
 * `idSet.ts`와 같은 이유로 `index.ts`(토큰, SEC-09)에서 재수출하지 않는다 — 배럴을 통째로 목으로
 * 바꾸는 테스트들이 이 함수를 지운다. 딥 경로로 import 한다.
 *
 * 웹 폴백 없음: 웹(개발용)에선 SecureStore 가 reject 하고, 호출부가 그 실패를 받는다.
 */

export async function readFlag(key: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(key)) === 'true';
}

export async function writeFlag(key: string, value: boolean): Promise<void> {
  await SecureStore.setItemAsync(key, String(value));
}
