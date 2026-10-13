import NaverLogin from '@react-native-seoul/naver-login';

import type { AuthorizeResult } from '../model/useSocialLogin';

/**
 * 네이버 네이티브 SDK 인가 어댑터(TRIP-210 · AC-2 · AC-5 · AC-8′). 이 파일만 네이버 SDK를
 * **정적** import한다 — makeAuthorize.ts가 `await import`로 지연 로드해서만 닿으므로 SDK가
 * 앱 부팅 정적 그래프에 실리지 않는다(AC-11).
 *
 * 카카오와 달리 네이버는 취소를 **resolve + `failureResponse.isCancel` 불리언**으로 알린다
 * (reject가 아니다 — SDK 소스 실측, D3). `isSuccess:false`이고 취소가 아니면 진짜 실패이므로
 * 조용히 삼키지 않고 throw한다(INV-4).
 *
 * consumerKey는 기존 `EXPO_PUBLIC_NAVER_CLIENT_ID`를 재사용한다(D2 — 새 변수를 만들지 않는다).
 * consumerSecret은 네이버 SDK `initialize()`의 **필수** 파라미터라 예외로 노출하되(D5), 값은
 * 반드시 `EXPO_PUBLIC_NAVER_CLIENT_SECRET`(env) 경유로만 전달한다 — 하드코딩 금지. 서버 쪽
 * 검증(BR-U0-02 fail-closed)은 이 값과 무관하게 그대로 유지된다. 예외 사유·변수명은
 * frontend/README.md에도 명시한다(AC-8′).
 */
export async function naverAuthorize(): Promise<AuthorizeResult> {
  NaverLogin.initialize({
    consumerKey: process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '',
    // consumerSecret: SDK 필수 파라미터라 env 경유로만 넘긴다(D5 예외 — 위 문서 주석 참고).
    consumerSecret: process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET ?? '',
    appName: 'TripPilot',
    serviceUrlSchemeIOS: process.env.EXPO_PUBLIC_NAVER_URL_SCHEME ?? '',
  });

  const response = await NaverLogin.login();

  if (!response.isSuccess) {
    if (response.failureResponse?.isCancel) {
      return { type: 'cancel' };
    }
    throw new Error(
      response.failureResponse?.message ?? '네이버 로그인에 실패했습니다.'
    );
  }
  if (!response.successResponse) {
    throw new Error('네이버 로그인 응답에 accessToken이 없습니다.');
  }
  return {
    type: 'success-token',
    accessToken: response.successResponse.accessToken,
  };
}
