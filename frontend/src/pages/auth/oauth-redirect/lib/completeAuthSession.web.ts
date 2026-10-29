import { maybeCompleteAuthSession } from 'expo-web-browser';

/**
 * 웹: 팝업이 인가 후 돌아온 이 페이지에서 원 창에 결과 URL 을 postMessage 로 넘기고 팝업을 닫게 하는 호출.
 * 진행 중인 로그인이 없으면(주소창 직접 접근·새로고침) `failed` 를 돌려준다.
 *
 * 넘긴 **뒤에** 주소의 `#…`(fragment)를 지운다(TRIP-1650) — 네이버 implicit 은 access token 이 거기 실려 오고,
 * fragment 는 주소창·방문 기록에 남는다. 라이브러리는 `location.href` 를 동기로 읽어 문자열로 복사해 넘기므로 그 뒤에 지워도 안전하고,
 * 먼저 지우면 원 창이 토큰을 못 받는다. 던져도·`failed` 여도 지운다(finally). `history` 가 없는 환경(jest)에서는 건너뛴다.
 * 새 히스토리 항목을 만들지 않으려고 `replaceState` 만 쓴다(`location.hash=''` 는 `#` 를 남기고 항목을 더한다).
 */
export function completeAuthSession(): { type: 'success' | 'failed' } {
  try {
    return maybeCompleteAuthSession();
  } finally {
    const { history, location } = globalThis;
    history?.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}`
    );
  }
}
