import { useCallback, useRef, useState } from 'react';

import {
  postSocialLogin,
  type SocialLoginBody,
  type SocialProvider,
} from '@/shared/api';
import { saveTokens } from '@/shared/storage';

export type SocialLoginPhase =
  'idle' | 'authorizing' | 'needs-age' | 'success' | 'cancelled' | 'error';

export type AuthorizeResult =
  | {
      type: 'success';
      authorizationCode: string;
      codeVerifier: string;
      redirectUri: string;
    }
  | { type: 'cancel' }
  | { type: 'dismiss' };

export type Authorize = () => Promise<AuthorizeResult>;

interface SocialLoginState {
  signIn: (provider: SocialProvider, authorize: Authorize) => void;
  confirmAge: () => void;
  phase: SocialLoginPhase;
  errorCode: string | null;
  conflictProvider: string | null;
  isNewUser: boolean;
}

/**
 * 소셜 로그인 오케스트레이션. provider 인가는 `authorize` 로 주입받고(PKCE 실구현은
 * 어댑터 뒤에 숨는다), 교환 바디에는 codeVerifier 만 실어 서버로 나른다(시크릿 비노출).
 * 신규 판정 시 토큰을 커밋하지 않고 연령확인(SELF_DECLARED) 재전송 후 저장한다.
 */
export function useSocialLogin(): SocialLoginState {
  const [phase, setPhase] = useState<SocialLoginPhase>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [conflictProvider, setConflictProvider] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  const pendingRef = useRef<{
    provider: SocialProvider;
    body: SocialLoginBody;
  } | null>(null);

  const exchange = useCallback(
    async (
      provider: SocialProvider,
      body: SocialLoginBody,
      ageConfirmed: boolean
    ) => {
      try {
        const tokens = await postSocialLogin(provider, body);
        if (!ageConfirmed && tokens.isNewUser) {
          setIsNewUser(true);
          setPhase('needs-age');
          return;
        }
        setIsNewUser(tokens.isNewUser);
        await saveTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
        setPhase('success');
      } catch (error) {
        const normalized = error as {
          code?: string;
          existingProvider?: string | null;
        };
        setErrorCode(normalized.code ?? 'UNKNOWN');
        setConflictProvider(normalized.existingProvider ?? null);
        setPhase('error');
      }
    },
    []
  );

  const signIn = useCallback(
    (provider: SocialProvider, authorize: Authorize) => {
      setErrorCode(null);
      setConflictProvider(null);
      setIsNewUser(false);
      setPhase('authorizing');
      void (async () => {
        const result = await authorize();
        if (result.type !== 'success') {
          setPhase('cancelled');
          return;
        }
        const body: SocialLoginBody = {
          authorizationCode: result.authorizationCode,
          codeVerifier: result.codeVerifier,
          redirectUri: result.redirectUri,
        };
        pendingRef.current = { provider, body };
        await exchange(provider, body, false);
      })();
    },
    [exchange]
  );

  const confirmAge = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    setPhase('authorizing');
    void exchange(
      pending.provider,
      { ...pending.body, ageConfirmation: { method: 'SELF_DECLARED' } },
      true
    );
  }, [exchange]);

  return { signIn, confirmAge, phase, errorCode, conflictProvider, isNewUser };
}
