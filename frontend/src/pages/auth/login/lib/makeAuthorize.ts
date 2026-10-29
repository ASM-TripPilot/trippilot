import { Platform } from 'react-native';

import type { SocialProvider } from '@/shared/api';

import type { Authorize, AuthorizeResult } from '../model/useSocialLogin';
import { getOAuthConfig } from '../config/oauthConfig';
import { isNaverLoginAvailable } from './isNaverLoginAvailable';

/**
 * dev fake OAuth provider 팩토리(DI 씨앗). `signIn(provider, makeAuthorize(provider))` 로 주입되어,
 * env 토글 EXPO_PUBLIC_AUTH_FAKE 가 켜진 dev 경로에서만 env EXPO_PUBLIC_AUTH_FAKE_OUTCOME 대로 가짜
 * 인가 결과를 낸다(cancel|dismiss, 그 외/미지정은 success-code). 결과 출처를 목 모듈이 아니라 env 로 둔
 * 이유는 `@/mocks/*` 를 앱 정적 그래프에서 끊기 위함이다(eslint `no-restricted-imports` 가 `@/mocks`·상대경로 `mocks`·`msw` 정적 import 를 막는다 · 게이트①-2 계약).
 * 성공 결과에는 PKCE codeVerifier 만 담고 시크릿은 담지 않는다(SEC-AUTH).
 *
 * 토글이 꺼진 실 빌드에서는 provider 별로 실 경로가 갈린다(TRIP-210):
 *  - apple — 항상 네이티브 SDK 어댑터(appleAuthorize, TRIP-932). env 게이트가 없다 — 버튼 노출을
 *    컨테이너가 isAvailableAsync 로 이미 거른다(Android 는 버튼 자체가 없다).
 *  - kakao — EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY 가 있으면 네이티브 SDK 어댑터(kakaoAuthorize)로.
 *  - naver — EXPO_PUBLIC_NAVER_URL_SCHEME 이 있으면 네이티브 SDK 어댑터(naverAuthorize)로.
 *    (naver SDK 필수 파라미터인 consumerSecret 자체는 naverAuthorize.ts 안에서만 env 로 읽는다
 *    — AC-8′ 가 "시크릿 env 참조는 어댑터 파일 1개에만" 을 소스 스캔으로 잠그므로, 이 게이트는
 *    일부러 시크릿이 아닌 EXPO_PUBLIC_NAVER_URL_SCHEME 로 잡는다.)
 *    없으면 브라우저 OAuth 로 보내지 않고 인가 전에 throw 한다 — 서버가 네이버 code 경로를 닫아
 *    (#1072, PKCE 없는 code 교환 거절) 그 길은 로그인 창을 다 거친 뒤 항상 501 로 끝난다.
 *  - 그 외(google, 또는 SDK 전용 env 가 비어 아직 미설정인 kakao) — 기존
 *    getOAuthConfig(provider).clientId 가 있어야 브라우저 OAuth(realAuthorize)로 위임하고,
 *    없으면 빈 값으로 몰래 시도하지 않고 throw 한다(INV-4).
 * 세 SDK 모두 `await import` 로 지연 로드해서만 닿으므로 이 파일의 정적 그래프에 실리지
 * 않는다(AC-11 · Hermes 부팅 격리 — expo-auth-session 을 감싼 realAuthorize 와 같은 경계).
 */
export function makeAuthorize(provider: SocialProvider): Authorize {
  // TRIP-1035 — 갈래를 **여기서 한 번** 정하고, flow 표지와 실제 분기가 같은 값을 쓴다(단일 출처).
  // 호출 시점 env 를 읽는다 — 모듈 최상위에서 계산하면 import 시점 env 에 묶인다.
  const route = resolveRoute(provider);
  const authorize = async (): Promise<AuthorizeResult> => {
    switch (route) {
      case 'apple': {
        const { appleAuthorize } = await import('./appleAuthorize');
        return appleAuthorize();
      }
      case 'kakao-sdk': {
        const { kakaoAuthorize } = await import('./kakaoAuthorize');
        return kakaoAuthorize();
      }
      case 'naver-sdk': {
        const { naverAuthorize } = await import('./naverAuthorize');
        return naverAuthorize();
      }
      case 'naver-unavailable':
        // 훅이 AUTHORIZE_FAILED 배너로 드러낸다(INV-4 — 침묵 금지). 서버엔 아무것도 나가지 않는다.
        throw new Error(
          '네이버 로그인 미설정: EXPO_PUBLIC_NAVER_URL_SCHEME 이 비어 SDK 로그인을 쓸 수 없습니다.'
        );
      case 'browser': {
        const config = getOAuthConfig(provider);
        if (!config.clientId) {
          throw new Error(
            `실 OAuth client 미설정: ${provider} clientId 가 비어 있어 인가할 수 없습니다.`
          );
        }
        const { realAuthorize } = await import('./realAuthorize');
        return realAuthorize(provider, config);
      }
      case 'fake':
        switch (process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME) {
          case 'cancel':
            return { type: 'cancel' };
          case 'dismiss':
            return { type: 'dismiss' };
          default:
            return {
              type: 'success-code',
              authorizationCode: 'fake-code',
              codeVerifier: 'fake-verifier',
              redirectUri: `trippilot://oauth/${provider}`,
            };
        }
    }
  };
  // naver-unavailable 은 token 으로 둔다 — code 면 훅이 인가 전에 연령 시트부터 띄워, 확인을 받은 뒤에야 실패한다.
  const flow = route === 'browser' || route === 'fake' ? 'code' : 'token';
  return Object.assign(authorize, { flow } as const);
}

type Route =
  | 'fake'
  | 'apple'
  | 'kakao-sdk'
  | 'naver-sdk'
  | 'naver-unavailable'
  | 'browser';

function resolveRoute(provider: SocialProvider): Route {
  if (isFakeAuthEnabled()) {
    return 'fake';
  }
  if (provider === 'apple') {
    return 'apple';
  }
  // 웹은 카카오 SDK 가 없다 — 네이티브 앱 키가 같은 .env 로 들어와 있어도 브라우저 OAuth 로 간다(TRIP-1649).
  if (
    provider === 'kakao' &&
    Platform.OS !== 'web' &&
    process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY
  ) {
    return 'kakao-sdk';
  }
  if (provider === 'naver') {
    // 버튼 노출 판정(LoginPage)과 같은 함수 — 숨겨진 버튼이 어떻게든 불렸을 때의 방어선이 이 갈래다.
    return isNaverLoginAvailable() ? 'naver-sdk' : 'naver-unavailable';
  }
  return 'browser';
}

function isFakeAuthEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_AUTH_FAKE;
  return flag === '1' || flag === 'true';
}
