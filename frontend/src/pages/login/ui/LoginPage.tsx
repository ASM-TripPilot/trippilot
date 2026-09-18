import { useEffect, useState } from 'react';
import { router } from 'expo-router';

import type { SocialProvider } from '@/shared/api';

import { useSocialLogin } from '@/features/auth/model/useSocialLogin';
import { makeAuthorize } from '@/features/auth/lib/makeAuthorize';
import { SocialLoginScreen } from '@/features/auth/ui/SocialLoginScreen';

/**
 * 소셜 로그인 페이지((auth)/login 이 렌더). useSocialLogin 상태를 SocialLoginScreen props 로
 * 흘리고, 버튼 탭에는 makeAuthorize(provider)(fake/real DI)를 signIn 에 주입한다. 성공하면 직접
 * 분기하지 않고 게이트('/')로 복귀시켜 부트스트랩이 다음 목적지를 재판정하게 한다(D3). 409 충돌은
 * conflictProvider 코드로 재로그인하고, 시트 취소는 화면을 idle 로 되돌린다.
 */
export function LoginPage() {
  const { signIn, confirmAge, phase, errorCode, conflictProvider } =
    useSocialLogin();
  const [dismissed, setDismissed] = useState(false);

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
    />
  );
}
