import * as AppleAuthentication from 'expo-apple-authentication';
import { Pressable, Text } from 'react-native';

import type { AuthorizeResult } from '../model/useSocialLogin';
import { AppleLogoGlyph } from '@/features/auth/index.view';

/**
 * 애플 네이티브 로그인 어댑터(TRIP-932). 이 파일만 애플 SDK를 **정적** import한다 —
 * makeAuthorize.ts·LoginPage가 `await import`로 지연 로드해서만 닿는다(nativeSdkLazyBoundary
 * 경계, 카카오·네이버 어댑터와 같은 격리).
 *
 * 애플 버튼(AppleSignInButton)도 여기 둔다. 컨테이너가 이 모듈을 늦게 불러와 버튼 컴포넌트를
 * 화면에 prop으로 넘기므로, 가용성 판정(isAvailableAsync)이 참일 때만 버튼이 존재한다.
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
 * 애플 버튼 — HIG 커스텀 버튼(TRIP-1124). 이웃 소셜 버튼과 같은 표면(흰 배경·ink 테두리·높이 52·
 * 반경 12)에 로고 24 + "Apple로 계속하기"를 그린다. HIG는 버튼 안 로고·제목을 검정 또는 흰색만
 * 허용하므로 제목은 text-ink(#222)가 아니라 text-black이다. testID 는 래퍼(auth-login-apple)가
 * 화면 쪽에 이미 있어 표면에는 달지 않는다.
 */
export function AppleSignInButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-[52px] w-full flex-row items-center justify-center gap-[10px] rounded-button border border-ink bg-canvas"
    >
      <AppleLogoGlyph size={24} testID="auth-login-apple-icon" />
      <Text
        testID="auth-login-apple-label"
        className="font-noto-bold text-hero font-bold text-black"
      >
        Apple로 계속하기
      </Text>
    </Pressable>
  );
}
