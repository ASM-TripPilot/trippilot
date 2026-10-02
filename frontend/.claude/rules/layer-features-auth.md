---
paths:
  - "src/features/auth/**"
---
# `src/features/auth/` — 스플래시·소셜 로그인


계층: `ui`(프레젠테이션) → `model`(상태·훅) → `lib`·`config`(순수 로직/설정). 배선은 `pages/login/ui/LoginPage.tsx`. 로그인 화면 뷰 `SocialLoginScreen`·애플 버튼 훅 `useAppleButton`은 TRIP-1146으로 `pages/login/{ui,model}/`로 이사했다(소비처가 그 page 하나뿐).

| 파일 | 역할 |
|---|---|
| `src/features/auth/ui/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/model/useBootstrapGate.ts` | 앱 시작 토큰 복원·잠정/확정 분기, 로그인 성공 구독 재조회 |
| `src/features/auth/model/useSocialLogin.ts` | 소셜 로그인 흐름(PKCE·single-flight), code/token 엔드포인트 분기·신규가입 연령확인 분기 |
| `src/features/auth/model/resolveBootstrapDestination.ts` | 순수 함수 — 부트스트랩 상태→목적지(onboardingCompleted 분기) |
| `src/features/auth/model/gateDestination.ts` | 게이트 밖 화면(설정 등)이 부트스트랩 목적지를 기다릴 통로(TRIP-1034 신규) — 모듈 전역 pub/sub, `waitFor`는 지금 값이 이미 target이면 즉시 끝남(재생), `reset`은 테스트 전용 |
| `src/features/auth/lib/makeAuthorize.ts` | authorize 팩토리(DI 주입점) — apple은 네이티브 SDK, kakao·naver는 env가 있으면 네이티브 SDK, 그 외는 expo-auth-session/fake. SDK 어댑터는 동적 import |
| `src/features/auth/lib/kakaoAuthorize.ts` | 카카오 SDK를 import하는 유일 파일, 취소는 message 매칭 |
| `src/features/auth/lib/naverAuthorize.ts` | 네이버 SDK를 import하는 유일 파일 |
| `src/features/auth/lib/appleAuthorize.tsx` | 애플 SDK를 정적 import하는 유일 파일(지연 로드로만 닿음) + `AppleSignInButton`. **버튼은 시스템 `AppleAuthenticationButton`이 아니라 직접 그리는 HIG 커스텀 `Pressable`**(TRIP-1124 — 이웃 구글 버튼과 표면 클래스 복사, 로고 24 `#000`, 제목 `text-hero text-black`: HIG가 버튼 안 로고·제목을 검정/흰색만 허용해 `text-ink`(#222) 불가). SDK를 하나도 안 쓰는 순수 UI인데 lib에 있다 — 가용성 판정 뒤에만 버튼을 건네는 주입 경로 때문. **`lib → ui`(`../ui/AuthGlyphs`의 `AppleLogoGlyph`) 역방향 import** — 위 계층 화살표의 반대라 가드가 없고(옛 슬라이스 안 config→ui 선례였던 `amenityIcons`는 TRIP-1148로 `pages/stay-detail/config`에 이사해 이제 pages→features 정방향 층간 import다 — 슬라이스 안 역방향 선례는 남아 있지 않다), `AuthGlyphs`가 이 파일을 정적 import하는 날 순환 + SDK가 화면 그래프로 샌다 |
| `src/features/auth/lib/realAuthorize.ts` | expo-auth-session 참조 유일 프로덕션 파일 |
| `src/features/auth/config/oauthConfig.ts` | provider별 OAuth config를 env에서 읽음, apple은 빈 슬롯(네이티브 SDK라 불필요) |
| `src/features/auth/config/gradients.ts` | 그라디언트·앱아이콘 색 상수 |
| `src/features/auth/ui/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘·소셜 4종·경고 삼각형·`AppleLogoGlyph`(TRIP-1124 신설, Figma c02 벡터 보관본 `d` 그대로 — 공식 Apple Design Resources 파일이 아니다, 교체 여부 미결. `LoginPage.apple.test.tsx`의 `FIGMA_APPLE_LOGO_D` 상수가 바이트 대조로 잠근다) |
| `src/features/auth/ui/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

> 구현 슬라이스는 배럴(`index.ts`) 없이 간다 — `src/features/auth/`에도 없다.
