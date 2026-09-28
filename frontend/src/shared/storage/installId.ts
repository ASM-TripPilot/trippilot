import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * TRIP-1070 · 설치 단위 기기 식별자 — 사진 메타의 `deviceId`(서버가 "어느 폰 앨범의 사진인가"를 가르는 표식).
 * 처음 한 번 무작위 id 를 만들어 SecureStore 에 두고 이후엔 그 값을 쓴다.
 *
 * `index.ts`(토큰)에서 재수출하지 않는다 — 테스트들이 `@/shared/storage` 배럴을 통째로 목으로
 * 갈아끼우므로 딥 경로로 import 한다(idSet 선례).
 *
 * 모듈 단위 약속 하나를 기억한다 — 화면 여러 곳이 동시에 처음 물어도 id 는 하나다(각자 만들면 한 설치에
 * id 가 둘이 되어 먼저 붙인 사진이 영영 "다른 기기"가 된다). 실패하면 기억을 지워 다음 호출이 다시 시도한다.
 *
 * iOS 키체인 값은 앱을 지웠다 다시 깔아도 남을 수 있다 — 그때는 같은 기기로 본다(브리프 맹점 ④-2).
 */

const KEY = 'installId';

let pending: Promise<string> | null = null;

export function getInstallId(): Promise<string> {
  pending ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored) return stored;
    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, id);
    return id;
  })().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
