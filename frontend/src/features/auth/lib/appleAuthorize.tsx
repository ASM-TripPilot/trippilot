import * as AppleAuthentication from 'expo-apple-authentication';

import type { AuthorizeResult } from '../model/useSocialLogin';

/**
 * 애플 네이티브 로그인 어댑터(TRIP-932). 이 파일만 애플 SDK를 **정적** import한다 —
 * makeAuthorize.ts·LoginPage가 `await import`로 지연 로드해서만 닿는다(nativeSdkLazyBoundary
 * 경계, 카카오·네이버 어댑터와 같은 격리).
 *
 * 공식 버튼(AppleSignInButton)도 여기 둔다. 화면이 SDK 컴포넌트를 직접 import하면 경계가
 * 깨지므로, 컨테이너가 이 모듈을 늦게 불러와 버튼 컴포넌트를 화면에 prop으로 넘긴다.
 */

/**
 * 성공이면 identityToken → accessToken, authorizationCode(서버의 revoke 준비용, TRIP-933)를
 * 담아 `success-token`으로 정규화한다. user·email·fullName 같은 여분은 서버로 보내지 않는다.
 * 취소는 `.code === 'ERR_REQUEST_CANCELED'`로만 판정한다(Expo CodedError의 고정 코드 — 카카오처럼
 * message를 볼 필요가 없다). 그 외 실패는 같은 에러 객체를 그대로 다시 던진다(INV-4).
 */
export async function appleAuthorize(): Promise<AuthorizeResult> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED') {
      return { type: 'cancel' };
    }
    throw error;
  }
  const { identityToken, authorizationCode } = credential;
  if (!identityToken || !authorizationCode) {
    throw new Error(
      '애플 인가 응답에 identityToken 또는 authorizationCode 가 없습니다.'
    );
  }
  return {
    type: 'success-token',
    accessToken: identityToken,
    authorizationCode,
  };
}

/** 이 기기에서 애플 로그인을 쓸 수 있는가(iOS 13+ true, Android·웹 false). */
export const isAppleSignInAvailable = AppleAuthentication.isAvailableAsync;

/**
 * 공식 애플 버튼 — 로고·현지화 제목("Apple로 계속하기")을 시스템이 그린다(HIG · 심사 4.8).
 * 이웃 소셜 버튼(흰 배경 + 테두리)과 맞춰 WHITE_OUTLINE, 높이 52·반경 12도 같게 둔다.
 * 네이티브 뷰라 NativeWind className이 안 먹으므로 크기는 style로만 준다.
 */
export function AppleSignInButton({ onPress }: { onPress: () => void }) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={
        AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE
      }
      cornerRadius={12}
      style={{ width: '100%', height: 52 }}
      onPress={onPress}
    />
  );
}
