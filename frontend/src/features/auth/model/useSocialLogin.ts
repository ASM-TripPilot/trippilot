import { useCallback, useRef, useState } from 'react';

import {
  postSocialLogin,
  type SocialLoginBody,
  type SocialProvider,
} from '@/shared/api';
import { setAccessToken } from '@/shared/api/tokenManager';
import { saveTokens } from '@/shared/storage';

export type SocialLoginPhase =
  | 'idle'
  | 'authorizing'
  | 'exchanging'
  | 'needs-age'
  | 'success'
  | 'cancelled'
  | 'error';

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

// TRIP-172(결함 E) — authorize() 자체가 던지는 실패(예: 실 OAuth client 미설정, promptAsync
// 예외)에 붙이는 코드. 사용자 취소({type:'cancel'|'dismiss'} resolve)와 반드시 분리된다 —
// 그건 phase='cancelled'로 가고 errorCode 를 채우지 않는다(7-21).
const AUTHORIZE_FAILED_CODE = 'AUTHORIZE_FAILED';

/**
 * 소셜 로그인 오케스트레이션. provider 인가는 `authorize` 로 주입받고(PKCE 실구현은
 * 어댑터 뒤에 숨는다), 교환 바디에는 codeVerifier 만 실어 서버로 나른다(시크릿 비노출).
 * 신규 판정 시 토큰을 커밋하지 않고 연령확인(SELF_DECLARED) 재전송 후 저장한다.
 *
 * TRIP-172(결함 E) — 인가/교환 중('authorizing'/'exchanging')에는 새 signIn 을 무시한다
 * (연속 탭이 provider 를 섞거나 인가코드를 중복 교환하지 않도록). state 는 다음 렌더까지
 * 반영되지 않아 신뢰할 수 없으므로, phaseRef 로 "지금 이 순간의" phase 를 동기로 추적한다.
 */
export function useSocialLogin(): SocialLoginState {
  const [phase, setPhase] = useState<SocialLoginPhase>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [conflictProvider, setConflictProvider] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  const phaseRef = useRef<SocialLoginPhase>('idle');
  const applyPhase = useCallback((next: SocialLoginPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

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
          applyPhase('needs-age');
          return;
        }
        setIsNewUser(tokens.isNewUser);
        await saveTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
        setAccessToken(tokens.accessToken);
        applyPhase('success');
      } catch (error) {
        const normalized = error as {
          code?: string;
          existingProvider?: string | null;
        };
        setErrorCode(normalized.code ?? 'UNKNOWN');
        setConflictProvider(normalized.existingProvider ?? null);
        applyPhase('error');
      }
    },
    [applyPhase]
  );

  const signIn = useCallback(
    (provider: SocialProvider, authorize: Authorize) => {
      if (
        phaseRef.current === 'authorizing' ||
        phaseRef.current === 'exchanging'
      ) {
        // 흐름 잠금 — 인가/교환 진행 중의 새 시도는 no-op(Seed §5 동시성안전).
        return;
      }
      setErrorCode(null);
      setConflictProvider(null);
      setIsNewUser(false);
      applyPhase('authorizing');
      void (async () => {
        let result: AuthorizeResult;
        try {
          result = await authorize();
        } catch {
          // authorize() 자체의 예외는 사용자 취소가 아니라 시스템 실패다(INV-4 — 침묵 금지).
          // 취소는 {type:'cancel'|'dismiss'} resolve 로 오므로 이 catch 에 걸리지 않는다.
          setErrorCode(AUTHORIZE_FAILED_CODE);
          applyPhase('error');
          return;
        }
        if (result.type !== 'success') {
          applyPhase('cancelled');
          return;
        }
        const body: SocialLoginBody = {
          authorizationCode: result.authorizationCode,
          codeVerifier: result.codeVerifier,
          redirectUri: result.redirectUri,
        };
        pendingRef.current = { provider, body };
        applyPhase('exchanging');
        await exchange(provider, body, false);
      })();
    },
    [applyPhase, exchange]
  );

  const confirmAge = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    applyPhase('authorizing');
    void exchange(
      pending.provider,
      { ...pending.body, ageConfirmation: { method: 'SELF_DECLARED' } },
      true
    );
  }, [applyPhase, exchange]);

  return { signIn, confirmAge, phase, errorCode, conflictProvider, isNewUser };
}
