# 2026-07-21 · TRIP-162 온보딩 배선 (T1 인증헤더 · T2 진입 리다이렉트)

브랜치: `feature/TRIP-162-FE-register` · 사이클: `20260721-trip162-onboarding-wiring` · **자율 실행**

## 요약

- **T1**: 로그인이 액세스 토큰을 동기 홀더(`shared/api/tokenManager`, 신규)에 넣고 → 온보딩 5종 호출이 `Authorization: Bearer`를 부착 → 401 single-flight 리프레시 → 실패 시 세션 만료. `createAuthedApiClient`가 프로덕션에서 처음 인스턴스화됨.
- **T2**: `(onboarding)/index`·`_layout`이 스텁→진입 가드. 온보딩 미완 사용자가 죽은 스텁 대신 약관으로 착지.
- 백엔드 온보딩 6종 컨트롤러 실구현 확인(Spring OAuth2 RS, Bearer). 라이브 E2E는 유효 JWT 필요 → 후속.

## 검증

단위 152/152 · 통합 37/37 · prettier/lint/tsc clean · 게이트①4/4·②6/6 해시 일치. qa-verifier **PASS**(n=1).

## 후속

- FW1 `useOnboardingProgress` 하드코딩 false(실 progress는 shared 승격 필요) · FW2 세션만료 즉시 리다이렉트 · FW3 콜드재시작 hydrate · FW4 라이브 실서버 E2E · RW1 중도재진입 nickname.

## 변경 파일 (프로덕션 6)

`shared/api/tokenManager.ts`(신규) · `shared/api/index.ts` · `(onboarding)/index.tsx` · `(onboarding)/_layout.tsx` · `features/onboarding/hooks/useOnboardingProgress.ts`(신규) · `features/auth/hooks/useSocialLogin.ts`
