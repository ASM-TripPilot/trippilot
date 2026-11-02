/**
 * 웹 로그인 — 앱 안 브라우저(인스타그램·페이스북·카카오톡·라인·네이버 앱 등) 판정과 바깥 브라우저 주소.
 *
 * 구글은 앱 안 웹뷰의 OAuth 를 정책으로 막고(`disallowed_useragent`), 웹 로그인의 팝업 방식도 앱 안
 * 브라우저에서 결과가 원래 창으로 돌아오지 못해 깨진다(2026-11-02 운영 실측 — 인스타에서 구글·카카오 실패).
 * 그래서 나갈 수 있는 곳은 바깥 브라우저로 내보내고, 못 나가는 곳(iOS 인스타·페이스북)은 화면이 안내만 한다.
 */

// 이름이 확인된 앱 안 브라우저 — 바깥 브라우저 이동(intent·카카오톡 스킴)을 받아 준다고 알려진 앱들.
const NAMED_IN_APP_UA =
  /Instagram|FBAN|FBAV|FB_IAB|KAKAOTALK|\bLine\/|NAVER\(inapp|DaumApps/i;
// 안드로이드 일반 웹뷰 표식(이름 없는 앱 포함) — 크롬 맞춤 탭·삼성 인터넷은 이 표식이 없어 걸리지 않는다.
// 안내는 띄우되 자동 이동은 하지 않는다: intent:// 를 처리하지 않는 앱이면 오류 화면이 뜬다.
const ANDROID_WEBVIEW_UA = /; wv\)/;

/**
 * 주소에 이 표식이 있으면 다시 내보내지 않는다 — 크롬이 없는 기기는 intent 의 돌아올 주소로 같은
 * 웹뷰에 되돌아오는데, 표식이 없으면 또 내보내 무한히 튕긴다. 표식은 돌아올 주소에만 붙인다
 * (내보낼 주소에 붙이면 지금 주소 검사에 걸려 한 번도 안 내보낸다).
 */
export const STAY_MARKER = 'inapp=stay';

/** 주소에 머무름 표식을 붙인다(이미 있으면 그대로). */
export function withStayMarker(href: string): string {
  if (href.includes(STAY_MARKER)) {
    return href;
  }
  const url = new URL(href);
  url.searchParams.set('inapp', 'stay');
  return url.toString();
}

export function isInAppBrowser(userAgent: string): boolean {
  return NAMED_IN_APP_UA.test(userAgent) || ANDROID_WEBVIEW_UA.test(userAgent);
}

/**
 * 지금 주소(`href`)에서 바깥 브라우저로 나갈 주소. 평범한 브라우저·이름 없는 웹뷰·못 나가는 곳(iOS)·
 * 표식 있는 주소면 null.
 */
export function externalBrowserUrl(
  userAgent: string,
  href: string
): string | null {
  if (!NAMED_IN_APP_UA.test(userAgent) || href.includes(STAY_MARKER)) {
    return null;
  }
  if (/KAKAOTALK/i.test(userAgent)) {
    // 카카오톡 공식 스킴 — iOS·안드로이드 모두 기본 브라우저로 연다.
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  }
  if (/Android/i.test(userAgent)) {
    const { host, pathname, search } = new URL(href);
    return (
      `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;` +
      `S.browser_fallback_url=${encodeURIComponent(withStayMarker(href))};end`
    );
  }
  return null;
}
