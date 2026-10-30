/**
 * 네이티브 no-op. 소셜 로그인 팝업이 돌아오는 `/oauth/{provider}` 는 웹 전용 중계라 iOS 에선 쓰이지 않는다 —
 * 항상 `failed`(진행 중인 세션 없음)를 돌려 페이지가 `/` 로 보내게 한다. expo-web-browser 를 import 하지 않아
 * iOS 번들에 새 정적 의존이 생기지 않는다(웹은 `completeAuthSession.web.ts` 가 대신 잡힌다).
 */
export function completeAuthSession(): { type: 'success' | 'failed' } {
  return { type: 'failed' };
}
