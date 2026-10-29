import { maybeCompleteAuthSession } from 'expo-web-browser';

/**
 * 웹: 팝업이 인가 후 돌아온 이 페이지에서 원 창에 결과 URL 을 postMessage 로 넘기고 팝업을 닫게 하는 호출.
 * 진행 중인 로그인이 없으면(주소창 직접 접근·새로고침) `failed` 를 돌려준다.
 */
export function completeAuthSession(): { type: 'success' | 'failed' } {
  return maybeCompleteAuthSession();
}
