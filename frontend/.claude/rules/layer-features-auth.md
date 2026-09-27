---
paths:
  - "src/features/auth/**"
---
# `src/features/auth/` — 스플래시·소셜 로그인


계층: `ui`(프레젠테이션) → `model`(상태·훅) → `lib`·`config`(순수 로직/설정). 배선은 `pages/login/ui/LoginPage.tsx`.

| 파일 | 역할 |
|---|---|
| `src/features/auth/ui/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/ui/SocialLoginScreen.tsx` | 소셜 로그인 비주얼 (props 순수 컴포넌트, 에러 배너 블랙리스트) |
| `src/features/auth/model/useBootstrapGate.ts` | 앱 시작 토큰 복원·잠정/확정 분기, 로그인 성공 구독 재조회 |
| `src/features/auth/model/useSocialLogin.ts` | 소셜 로그인 흐름(PKCE·single-flight), code/token 엔드포인트 분기·신규가입 연령확인 분기 |
| `src/features/auth/model/resolveBootstrapDestination.ts` | 순수 함수 — 부트스트랩 상태→목적지(onboardingCompleted 분기) |
| `src/features/auth/lib/makeAuthorize.ts` | authorize 팩토리(DI 주입점) — apple은 네이티브 SDK, kakao·naver는 env가 있으면 네이티브 SDK, 그 외는 expo-auth-session/fake. SDK 어댑터는 동적 import |
| `src/features/auth/lib/kakaoAuthorize.ts` | 카카오 SDK를 import하는 유일 파일, 취소는 message 매칭 |
| `src/features/auth/lib/naverAuthorize.ts` | 네이버 SDK를 import하는 유일 파일 |
| `src/features/auth/lib/realAuthorize.ts` | expo-auth-session 참조 유일 프로덕션 파일 |
| `src/features/auth/config/oauthConfig.ts` | provider별 OAuth config를 env에서 읽음, apple은 빈 슬롯(네이티브 SDK라 불필요) |
| `src/features/auth/config/gradients.ts` | 그라디언트·앱아이콘 색 상수 |
| `src/features/auth/ui/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘·소셜 4종·경고 삼각형 |
| `src/features/auth/ui/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

> 구현 슬라이스는 배럴(`index.ts`) 없이 간다 — `src/features/auth/`에도 없다.
