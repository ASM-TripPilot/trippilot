---
paths:
  - "src/features/auth/**"
---
# `src/features/auth/` — 실구현 ①


**계층 개명(TRIP-173)**: `ui`(프레젠테이션, 구 `screens`+`components`) → `model`(상태·훅, 구 `hooks`) → `lib`·`config`(순수 로직/설정, 구 `lib`가 둘로 분리). 배선(구 `containers`)은 `pages/login/ui/LoginPage.tsx`로 이동했다(위 절 참조).

| 파일 | 역할 |
|---|---|
| `src/features/auth/ui/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/ui/SocialLoginScreen.tsx` | 소셜 로그인 비주얼 (props 8개 순수 컴포넌트, 에러 배너 블랙리스트) |
| `src/features/auth/model/useBootstrapGate.ts` | 앱 시작 토큰 복원·잠정/확정 분기, 로그인 성공 구독 재조회 |
| `src/features/auth/model/useSocialLogin.ts` | 소셜 로그인 흐름(PKCE·single-flight), code/token 엔드포인트 분기·신규가입 연령확인 분기 |
| `src/features/auth/model/resolveBootstrapDestination.ts` | 순수 함수 — 부트스트랩 상태→목적지(onboardingCompleted 분기) |
| `src/features/auth/lib/makeAuthorize.ts` | authorize 팩토리(DI 주입점) — fake/kakao/naver/real 갈래 |
| `src/features/auth/lib/kakaoAuthorize.ts` | 카카오 SDK 정적 import 유일 파일, 취소는 message 매칭 |
| `src/features/auth/lib/naverAuthorize.ts` | 네이버 SDK 정적 import 유일 파일 |
| `src/features/auth/lib/realAuthorize.ts` | expo-auth-session 참조 유일 프로덕션 파일 |
| `src/features/auth/config/oauthConfig.ts` | provider별 OAuth config를 env에서 읽음, apple만 빈 슬롯 |
| `src/features/auth/config/gradients.ts` | 그라디언트·앱아이콘 색 상수 |
| `src/features/auth/ui/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘·소셜 4종·경고 삼각형 |
| `src/features/auth/ui/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

> `src/features/auth/` 아래 `index.ts`는 여전히 **존재하지 않는다** — 이제 이게 표준이다. 배럴 신설 계획("사이클 3")은 폐기됐다(그 유예가 가리키던 사이클 3은 폐기된 FSD 이주 11사이클 계획의 것). TRIP-173 FSD 완결 2/4에서 home·onboarding의 빈 배럴 14개를 전부 삭제하며 방향이 뒤집혔다 — **구현 슬라이스는 배럴 없이 간다.**
