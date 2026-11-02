import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';

import type { SocialProvider } from '@/shared/api';

import { useAppleButton } from '../model/useAppleButton';
import { useSocialLogin } from '../model/useSocialLogin';
import { externalBrowserUrl, isInAppBrowser } from '../lib/inAppBrowser';
import { isNaverLoginAvailable } from '../lib/isNaverLoginAvailable';
import { makeAuthorize } from '../lib/makeAuthorize';
import { SocialLoginScreen } from './SocialLoginScreen';

/** 웹이면 브라우저 UA, 앱이면 빈 문자열(앱 안 브라우저 판정은 웹에만 의미가 있다). */
function webUserAgent(): string {
  return Platform.OS === 'web' ? (globalThis.navigator?.userAgent ?? '') : '';
}

/**
 * 소셜 로그인 페이지((auth)/login 이 렌더). useSocialLogin 상태를 SocialLoginScreen props 로
 * 흘리고, 버튼 탭에는 makeAuthorize(provider)(fake/real DI)를 signIn 에 주입한다. 성공하면 직접
 * 분기하지 않고 게이트('/')로 복귀시켜 부트스트랩이 다음 목적지를 재판정하게 한다(D3). 409 충돌은
 * conflictProvider 코드로 재로그인하고, 시트 취소는 화면을 idle 로 되돌린다.
 * 애플 버튼은 useAppleButton 이 가용성(isAvailableAsync)을 판정한 뒤에만 화면에 넘긴다(TRIP-932).
 */
export function LoginPage() {
  const { signIn, confirmAge, phase, errorCode, conflictProvider } =
    useSocialLogin();
  const [dismissed, setDismissed] = useState(false);
  const AppleButton = useAppleButton();
  const [inAppNotice] = useState(() => isInAppBrowser(webUserAgent()));

  // 앱 안 브라우저면 마운트 때 한 번 바깥 브라우저로 내보낸다(카카오톡·안드로이드). 못 나가면(iOS 인스타 등)
  // 화면 안내만 남는다. 크롬이 없어 같은 웹뷰로 돌아오면 머무름 표식 때문에 다시 내보내지 않는다.
  useEffect(() => {
    const href = globalThis.location?.href;
    if (!inAppNotice || !href) {
      return;
    }
    const target = externalBrowserUrl(webUserAgent(), href);
    if (target) {
      globalThis.location.href = target;
    }
  }, [inAppNotice]);

  useEffect(() => {
    if (phase === 'success') {
      router.replace('/');
    }
  }, [phase]);

  const handleSignIn = (provider: SocialProvider) => {
    setDismissed(false);
    signIn(provider, makeAuthorize(provider));
  };

  const handleConflictContinue = () => {
    if (!conflictProvider) {
      return;
    }
    const provider = conflictProvider as SocialProvider;
    setDismissed(false);
    signIn(provider, makeAuthorize(provider));
  };

  const dismissSheet = () => setDismissed(true);

  return (
    <SocialLoginScreen
      phase={dismissed ? 'idle' : phase}
      errorCode={errorCode}
      conflictProvider={conflictProvider}
      onSignIn={handleSignIn}
      onConflictContinue={handleConflictContinue}
      onConflictCancel={dismissSheet}
      onAgeConfirm={confirmAge}
      onAgeCancel={dismissSheet}
      AppleButton={AppleButton}
      hideNaver={!isNaverLoginAvailable()}
      inAppNotice={inAppNotice}
    />
  );
}
