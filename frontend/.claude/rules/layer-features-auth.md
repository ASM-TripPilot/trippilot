---
paths:
  - "src/features/auth/**"
---
# `src/features/auth/` — 스플래시·소셜 로그인


계층: `ui`(프레젠테이션) → `model`(상태·훅) → `lib`·`config`(순수 로직/설정). 배선은 `pages/login/ui/LoginPage.tsx`. 로그인 화면 뷰 `SocialLoginScreen`·애플 버튼 훅 `useAppleButton`은 TRIP-1146으로 `pages/login/{ui,model}/`로 이사했다(소비처가 그 page 하나뿐). 소셜 로그인 훅(`useSocialLogin`)·authorize 어댑터(`lib/` 전부)·`oauthConfig`는 TRIP-1155로 `pages/login/{model,lib,config}/`로 이사했다(`layer-pages.md`).

| 파일 | 역할 |
|---|---|
| `src/features/auth/ui/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/model/useBootstrapGate.ts` | 앱 시작 토큰 복원·잠정/확정 분기, 로그인 성공 구독 재조회 |
| `src/features/auth/model/resolveBootstrapDestination.ts` | 순수 함수 — 부트스트랩 상태→목적지(onboardingCompleted 분기) |
| `src/features/auth/model/gateDestination.ts` | 게이트 밖 화면(설정 등)이 부트스트랩 목적지를 기다릴 통로(TRIP-1034 신규) — 모듈 전역 pub/sub, `waitFor`는 지금 값이 이미 target이면 즉시 끝남(재생), `reset`은 테스트 전용 |
| `src/features/auth/config/gradients.ts` | 그라디언트·앱아이콘 색 상수 |
| `src/features/auth/ui/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘·소셜 4종·경고 삼각형·`AppleLogoGlyph`(TRIP-1124 신설, Figma c02 벡터 보관본 `d` 그대로 — 공식 Apple Design Resources 파일이 아니다, 교체 여부 미결. `LoginPage.apple.test.tsx`의 `FIGMA_APPLE_LOGO_D` 상수가 바이트 대조로 잠근다) |
| `src/features/auth/ui/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

> 구현 슬라이스는 배럴(`index.ts`) 없이 간다 — `src/features/auth/`에도 없다.
