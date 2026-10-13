import type { AuthorizeResult } from '../useSocialLogin';

/** 서버 토큰 응답 픽스처 — `useSocialLogin.*.test.tsx` 4파일이 복사해 쓰던 것(TRIP-1355). */
export function tokenPair(isNewUser: boolean, provider = 'GOOGLE') {
  return {
    accessToken: 'server-access-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'server-refresh-token',
    refreshExpiresIn: 7776000,
    isNewUser,
    account: {
      accountId: '00000000-0000-0000-0000-000000000001',
      status: 'ACTIVE',
      email: null,
      socialProviders: [provider],
      onboardingCompleted: false,
    },
  };
}

/**
 * TRIP-248 — 백엔드가 "연령확인이 아직 없다"고 거절할 때 훅에 닿는 정규화 에러.
 *
 * ⚠️ `status` 를 일부러 담지 않는다(D2). 판정은 body 의 `code` + `fields` 만 보아야 하고,
 * 픽스처에 400 을 넣어 주면 `status === 400` 으로 짠 구현이 그대로 통과해 D2 가 아무 심판도
 * 못 받는다. 연령 관련 상태코드는 이미 정본(422)과 백엔드 구현(403)이 갈라진 전례가 있다.
 *
 * `field` 값은 백엔드 AuthenticateWithSocialUseCase.kt:77 원문 그대로다.
 */
export function ageConfirmationRequired() {
  return {
    code: 'VALIDATION_ERROR',
    fields: [
      {
        field: 'ageConfirmation',
        reason: '신규 가입 시 연령확인이 필요합니다',
      },
    ],
  };
}

/** 인가 결과를 그대로 돌려주는 스텁 authorize. */
export function authorizeWith(result: AuthorizeResult) {
  return jest.fn(async (): Promise<AuthorizeResult> => result);
}
