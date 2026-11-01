import type { Href, Router } from 'expo-router';

/** 헬퍼가 쓰는 라우터의 최소 모양 — useRouter() 결과든 정적 router 든 이 세 멤버만 있으면 된다. */
export type BackRouter = Pick<Router, 'canGoBack' | 'back' | 'replace'>;

/**
 * 돌아갈 화면이 스택에 있으면 한 장 뒤로, 없으면 폴백으로 갈아 끼운다.
 * 딥링크 콜드 진입·웹 새로고침은 스택이 1장이라 back() 이 처리되지 않고 조용히 무동작이 되기 때문이다.
 * 폴백은 호출부가 누른 시점 값으로 넘긴다(홈은 '/' 가 아니라 shellTabHref('home')).
 */
export function goBackOr(router: BackRouter, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
