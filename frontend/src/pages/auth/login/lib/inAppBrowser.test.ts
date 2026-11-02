import {
  externalBrowserUrl,
  isInAppBrowser,
  STAY_MARKER,
  withStayMarker,
} from './inAppBrowser';

/**
 * 웹 로그인 — 앱 안 브라우저 판정과 바깥 브라우저 주소(2026-11-02 운영 출시 직후 인스타 로그인 실패).
 * 구글은 앱 안 웹뷰 OAuth 를 정책으로 막아서(disallowed_useragent) 바깥 브라우저로 나가야만 된다.
 * 3동작: 준비(실제 기기 UA 문자열·주소) → 실행(판정 함수) → 단언(참/거짓 또는 주소 문자열).
 */

// 실제 기기에서 쓰는 UA 모양(앱 버전 숫자만 다를 뿐 표식 단어는 같다).
const UA = {
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone15,2; iOS 18_1; ko_KR; ko; scale=3.00; 1179x2556; 658395151)',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 357.0.0.25.101 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918N; dm3q; qcom; ko_KR; 658395163)',
  iosKakao:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.5',
  androidKakao:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36;KAKAOTALK 2410950',
  iosFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 [FBAN/FBIOS;FBAV/489.0.0.47.106;FBBV/663236711;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/ko_KR;FBOP/5]',
  iosLine:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.18.0',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/489.0.0.47.106;]',
  iosDaum:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 DaumApps/7.7.0 DaumDevice/mobile',
  // 앱 이름 표식이 없는 안드로이드 웹뷰(`; wv)` 만 있다).
  androidPlainWebView:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36',
  iosNaverApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.10.1; 15PRO)',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
} as const;

const HREF = 'https://app.trippilot.co.kr/login';

describe('isInAppBrowser — 앱 안 브라우저면 참', () => {
  it.each([
    ['iOS 인스타그램', UA.iosInstagram],
    ['안드로이드 인스타그램', UA.androidInstagram],
    ['iOS 카카오톡', UA.iosKakao],
    ['안드로이드 카카오톡', UA.androidKakao],
    ['iOS 페이스북', UA.iosFacebook],
    ['iOS 라인', UA.iosLine],
    ['iOS 네이버 앱', UA.iosNaverApp],
    ['안드로이드 페이스북(FB_IAB·FBAV)', UA.androidFacebook],
    ['iOS 다음 앱', UA.iosDaum],
    ['이름 없는 안드로이드 웹뷰(; wv)', UA.androidPlainWebView],
  ])('%s → 참', (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it.each([
    ['iOS Safari', UA.iosSafari],
    ['iOS Chrome', UA.iosChrome],
    ['안드로이드 Chrome', UA.androidChrome],
    ['삼성 인터넷', UA.samsungInternet],
    ['데스크톱 Chrome', UA.desktopChrome],
    ['빈 문자열', ''],
  ])('%s → 거짓(평범한 브라우저는 건드리지 않는다)', (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(false);
  });
});

describe('externalBrowserUrl — 바깥 브라우저로 나갈 주소', () => {
  it('평범한 브라우저 → null(이동하지 않는다)', () => {
    expect(externalBrowserUrl(UA.iosSafari, HREF)).toBeNull();
    expect(externalBrowserUrl(UA.androidChrome, HREF)).toBeNull();
  });

  it('카카오톡(iOS·안드로이드) → 카카오톡 외부 브라우저 열기 스킴, 주소는 인코딩', () => {
    const expected = `kakaotalk://web/openExternal?url=${encodeURIComponent(HREF)}`;

    expect(externalBrowserUrl(UA.iosKakao, HREF)).toBe(expected);
    expect(externalBrowserUrl(UA.androidKakao, HREF)).toBe(expected);
  });

  it('안드로이드 인스타그램 → Chrome intent(표식 없는 원래 주소), 크롬이 없을 때 돌아올 주소엔 표식을 붙인다', () => {
    const href = `${HREF}?from=ig`;

    expect(externalBrowserUrl(UA.androidInstagram, href)).toBe(
      'intent://app.trippilot.co.kr/login?from=ig#Intent;scheme=https;package=com.android.chrome;' +
        `S.browser_fallback_url=${encodeURIComponent(`${href}&${STAY_MARKER}`)};end`
    );
  });

  it('이름 없는 안드로이드 웹뷰 → null(안내만 — intent 를 못 받는 앱이면 오류 화면이 뜬다)', () => {
    expect(externalBrowserUrl(UA.androidPlainWebView, HREF)).toBeNull();
  });

  it('안드로이드 페이스북 → Chrome intent(이름이 확인된 앱)', () => {
    expect(externalBrowserUrl(UA.androidFacebook, HREF)).toMatch(
      /^intent:\/\/app\.trippilot\.co\.kr\/login#Intent;/
    );
  });

  it('iOS 인스타그램·페이스북 → null(앱 밖으로 강제로 못 나간다 — 안내 문구만)', () => {
    expect(externalBrowserUrl(UA.iosInstagram, HREF)).toBeNull();
    expect(externalBrowserUrl(UA.iosFacebook, HREF)).toBeNull();
  });

  it(`주소에 머무름 표식(${STAY_MARKER})이 있으면 null — 크롬이 없어 같은 웹뷰로 돌아와도 다시 튕기지 않는다`, () => {
    const marked = `${HREF}?${STAY_MARKER}`;

    expect(externalBrowserUrl(UA.androidInstagram, marked)).toBeNull();
    expect(externalBrowserUrl(UA.androidKakao, marked)).toBeNull();
  });

  it('크롬이 없어 돌아올 주소로 같은 웹뷰에 돌아오면 다시 내보내지 않는다(무한 튕김 없음)', () => {
    // 준비 — 기존 검색어가 있는 지금 주소와, 표식을 붙인 기대값.
    const href = `${HREF}?a=1`;
    const marked = withStayMarker(href);

    // 실행 — 바깥 주소를 만들고, 크롬이 없어 돌아왔다고 치고 돌아올 주소로 다시 판정.
    const intent = externalBrowserUrl(UA.androidInstagram, href);
    const fallback = decodeURIComponent(
      /S\.browser_fallback_url=([^;]+);/.exec(intent ?? '')?.[1] ?? ''
    );

    // 단언 — 기존 검색어는 남고 표식이 붙었으며, 돌아온 주소로는 다시 내보내지 않는다.
    expect(marked).toBe(`${HREF}?a=1&${STAY_MARKER}`);
    expect(withStayMarker(marked)).toBe(marked);
    expect(fallback).toBe(marked);
    expect(externalBrowserUrl(UA.androidInstagram, fallback)).toBeNull();
  });
});
