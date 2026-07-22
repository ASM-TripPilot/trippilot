# 프론트엔드 구조 지도

**무엇을 위한 문서인가**: AI도 사람도 리포를 전수로 읽지 않는다 — 찾으려고 **생각한 것만** 찾는다. 그래서 이미 있는 것을 못 보고 다시 만든다(2026-07-20 재구현 사고). 이 문서는 탐색 대상이 아니라 **훑는 목록**이다. 안 찾던 것이 눈에 걸리는 게 목적이다.

**정본은 리포다.** 이 문서와 실제가 어긋나면 실제가 옳다 — 다만 어긋난 채로 두지 않기 위해 대조 검사가 붙어 있다(아래).

## 유지 규약

| 절 | 누가 채우나 |
|---|---|
| 파일 목록 · export 심볼 | 🤖 `node .claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs` |
| **용도 한 줄** · **스텁 여부** · **경고** | 🧑 사이클 [기록]에서 scribe |

- **경로는 리포 상대 전체 경로를 백틱으로 적는다** (`src/features/auth/lib/makeAuthorize.ts`). 대조 검사가 이 형태만 인식한다.
- 갱신은 **이번 사이클이 만진 행만**. 전면 재작성 금지.
- 대조: `node .claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs --check`
  - *파일은 있는데 행이 없다* → 새 파일 누락 · *행은 있는데 파일이 없다* → 삭제·이동 미반영
- **개념 링크는 여기 두지 않는다.** 코드→개념 진입점의 정본은 옵시디언 개념 노트의 `설명하는코드` 속성이다(경로 문자열을 `obsidian_simple_search`에 넣으면 잡힌다). 사본을 두 곳에 두면 또 갈라진다.

## 한눈에

- **스택**: Expo(development build + prebuild) · Expo Router · TypeScript strict · NativeWind · TanStack Query + Zustand · orval · Jest + fast-check
- **경로 별칭**: `@/*` → `./src/*`
- **구현 범위**: `auth` + `onboarding` **두 feature만 실구현.** 나머지 9개 feature는 `export {}` 한 줄짜리 빈 스텁이다.
- **앱 런타임 목 0건.** msw는 테스트 오라클(`msw/node`)에만 있고, `src/__tests__/noMswInStaticGraph.test.ts`가 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제한다.
- **문서 대상 파일 89개** (병렬 배치된 `*.test.ts(x)`는 대상 소스 행이 대표하므로 제외. `src/__tests__/` 전역 가드는 독립 산출물이라 포함)

## 디렉토리

```
frontend/
├── src/
│   ├── app/          Expo Router 라우트 (파일 = 화면)
│   ├── features/     도메인 기능 (auth·onboarding 실구현, 나머지 9개 빈 스텁)
│   ├── shared/       도메인 무관 공용
│   ├── mocks/        테스트 오라클 전용 msw/node (앱 런타임 목 아님)
│   ├── test-support/ 테스트 전용 목·헬퍼
│   └── __tests__/    전역 가드 테스트
├── __mocks__/        Jest 자동 목 (네이티브 모듈)
└── (설정) app.config.ts · orval.config.ts · eslint.config.js · babel.config.js
          jest.config.js · jest.integration.config.js · metro.config.js · tailwind.config.js
```

## `src/app/` — 라우트

| 파일 | 역할 |
|---|---|
| `src/app/_layout.tsx` | 루트 레이아웃. 폰트 로드 게이팅 + 네이티브 스플래시 제어 + `GestureHandlerRootView` + `SafeAreaProvider`(null 대비 initialMetrics) + `SplashGate` |
| `src/app/force-update.tsx` | 강제 업데이트 분기 화면 |
| `src/app/reconsent.tsx` | 재동의 분기 화면 |
| `src/app/_dev/preview.tsx` | **개발 전용 정적 프리뷰** — 네트워크 없이 시각 상태 전환. 진입은 딥링크 `trippilot://_dev/preview?state=<키>` 하나뿐(**11개** 상태 키 조준 — TRIP-163에서 `pref1`·`pref2` 2키 추가. 부재·오타·배열 값은 splash 결정론 폴백 — `useLocalSearchParams`는 지연 초기화자로 최초 마운트 1회만 읽음). 같은 세션에서 연속 openurl 시 상태 미전환(1회만 읽는 계약 한계 — 실기 확인은 키마다 fresh 재기동) |
| `src/app/(auth)/_layout.tsx` | 미인증 스택 |
| `src/app/(auth)/login.tsx` | 소셜 로그인 화면 진입점 |
| `src/app/(onboarding)/_layout.tsx` | 온보딩 스택 + **완료자만 홈으로 방어** |
| `src/app/(onboarding)/index.tsx` | **진입 단계 리다이렉트** (미완 → terms) |
| `src/app/(onboarding)/terms.tsx` | 약관 라우트 — 컨테이너를 꽂는 얇은 래퍼 |
| `src/app/(onboarding)/nickname.tsx` | 닉네임 라우트 — 얇은 래퍼 |
| `src/app/(onboarding)/pref1.tsx` | 취향 1/2 라우트(c09) — `PrefStep1Container`를 꽂는 얇은 래퍼 |
| `src/app/(onboarding)/pref2.tsx` | 취향 2/2 라우트(c09b) — `PrefStep2Container`를 꽂는 얇은 래퍼 |
| `src/app/(tabs)/_layout.tsx` | 탭 네비게이터 |
| `src/app/(tabs)/index.tsx` | 홈 탭 — **껍데기** |
| `src/app/(tabs)/explore.tsx` | 탐색 탭 — **껍데기** |
| `src/app/(tabs)/itinerary.tsx` | 일정 탭 — **껍데기** |
| `src/app/(tabs)/records.tsx` | 기록 탭 — **껍데기** |
| `src/app/(tabs)/my.tsx` | 마이 탭 — **껍데기** |

## `src/features/auth/` — 실구현 ①

계층: `screens`(프레젠테이션) → `containers`(배선) → `hooks`(상태) → `model`·`lib`(순수 로직)

| 파일 | 역할 |
|---|---|
| `src/features/auth/screens/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/screens/SocialLoginScreen.tsx` | 소셜 로그인 비주얼 (props 8개 순수 컴포넌트) |
| `src/features/auth/containers/SplashGate.tsx` | 부트스트랩 결과에 따라 라우팅 결정 |
| `src/features/auth/containers/SocialLoginContainer.tsx` | 로그인 훅 ↔ 화면 배선 |
| `src/features/auth/hooks/useBootstrapGate.ts` | 앱 시작 시 토큰 복원 · 잠정/확정 분기. `BOOTSTRAP_TIMEOUT_MS` 포함 |
| `src/features/auth/hooks/useSocialLogin.ts` | 소셜 로그인 흐름(PKCE · single-flight). 성공 시 `saveTokens` + `setAccessToken` 둘 다 |
| `src/features/auth/model/resolveBootstrapDestination.ts` | **순수 함수** — 부트스트랩 상태 → 목적지 |
| `src/features/auth/lib/makeAuthorize.ts` | authorize 팩토리(DI 주입점). **3갈래** — fake 토글 on→fake / off+clientId→`realAuthorize` **동적 import** / off+설정없음→throw(INV-4) |
| `src/features/auth/lib/realAuthorize.ts` | **`expo-auth-session`을 참조하는 유일한 프로덕션 파일.** `AuthRequest(usePKCE:true)` + `promptAsync` → 3필드 정규화 |
| `src/features/auth/lib/oauthConfig.ts` | provider별 OAuth config를 **env에서** 읽음(`EXPO_PUBLIC_GOOGLE_*`). discovery 정적 하드코딩. **Google만 채움**, kakao/naver/apple 빈 슬롯. 네이티브 의존 0 |
| `src/features/auth/lib/gradients.ts` | 그라디언트·앱아이콘 색 상수 |
| `src/features/auth/components/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘 · 소셜 4종 로고 |
| `src/features/auth/components/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

## `src/features/onboarding/` — 실구현 ②

계층은 auth와 동형 + **`store/`(Zustand, 리포 첫 도입 — TRIP-163)**: `screens`(프레젠테이션) → `containers`(배선) → `hooks`·`store`(상태) → `model`(순수 로직).

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/screens/TermsScreen.tsx` | 약관 화면(프레젠테이션 · props만) |
| `src/features/onboarding/screens/NicknameScreen.tsx` | 닉네임 화면(오류·대체칩 표시만). 칩은 값(인덱스 아님)을 올림 |
| `src/features/onboarding/screens/PrefStep1Screen.tsx` | 취향 1/2 화면(프레젠테이션 · Figma c09/1643:1183 정합) — 스타일 그리드(복수)+페이스(단일). props만, 스토어·네트워크 모름 |
| `src/features/onboarding/screens/PrefStep2Screen.tsx` | 취향 2/2 화면(프레젠테이션 · Figma c09b/1774:2258 정합) — 예산(단일)+동행·음식·이동(복수) + back chevron(Q4 결정, 2/2 전용) |
| `src/features/onboarding/containers/TermsContainer.tsx` | 약관 훅 ↔ 화면 배선. 성공 시 `router.replace('/(onboarding)/nickname')` |
| `src/features/onboarding/containers/NicknameContainer.tsx` | 닉네임 훅 ↔ 화면 배선. 성공 시 **취향 1/2**(`/(onboarding)/pref1`)로 이동(TRIP-163 인터뷰1 — 종전 게이트(`/`) 복귀에서 교체. ⚠️ 파일 상단 docstring은 구 목적지를 서술한 채 stale — 03b 참고②, 후속 티켓) |
| `src/features/onboarding/containers/PrefStep1Container.tsx` | 취향 1/2 배선 — 스토어 ↔ 화면 ↔ router. '다음'은 `push`(2/2의 `back()`이 되돌아오도록), 일괄 탈출은 `replace('/')`. 저장(PUT) 배선 없음(Q1 — 후속 wiring 사이클) |
| `src/features/onboarding/containers/PrefStep2Container.tsx` | 취향 2/2 배선 — 스토어 ↔ 화면 ↔ router. back은 `router.back()`(Q4, 2/2 전용), '완료'·일괄 탈출 모두 `replace('/')`(닉네임과 동형 게이트 재판정 패턴) |
| `src/features/onboarding/hooks/useTermsConsent.ts` | 약관 3종 로드·토글·`POST /me/consents` **1회** 제출. 실패 시 이동 안 함 |
| `src/features/onboarding/hooks/useNickname.ts` | 닉네임 프리필 + **순서 저장**(형식→check→PATCH→complete). 각 단계 실패 시 다음 미호출 |
| `src/features/onboarding/hooks/useOnboardingProgress.ts` | 온보딩 진행 상태 훅 seam. ⚠️ **현재 `{false,false}` 하드코딩**(FW1) — 아래 경고. 취향 스텝은 이 모델을 확장하지 않음(1회성 통과 흐름 — 02a §7-11) |
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 → 잔여 단계(`terms`/`nickname`/`done`) |
| `src/features/onboarding/model/validateNicknameFormat.ts` | **순수 함수** — 닉네임 길이(코드포인트 2~20)만. 내용 판정은 서버 권한 |
| `src/features/onboarding/model/preferenceSelection.ts` | **순수 함수** — `toggleMulti`(복수 축)·`toggleSingle`(단일 축). `null`=미설정, 전부 해제 시 `[]`가 아니라 `null`로 복귀(US-ONB-14) |
| `src/features/onboarding/store/preferenceStore.ts` | **Zustand 스토어**(신설 `store/` 디렉토리) — 취향 6축(styles·pace·budget·companions·foods·transports) 세션 메모리 상태. **persist 없음**(인터뷰3), 토글 판단은 `model/preferenceSelection`에 위임. `create(createPreferenceDraft)` 형태(구조 가드 6-2 정합 — 제네릭 직접 호출 시 `create<` 리터럴이 가드를 오탐시킴, 개념 [[구조 가드와 긍정 앵커]]) |
| `src/features/onboarding/components/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프. 기존 5종(체크·재생성 등)+**신규 19종**(스타일7·페이스3·동행4·이동3·info·skip chevron 등, TRIP-163). raw hex 색 직박(`screens/` 스코프 밖이라 F2 raw-hex 가드 미대상 — 03b 참고-2: 향후 `screens/`로 이동 시 red) |
| `src/features/onboarding/index.ts` | 배럴 스텁(`export {}`) — 아무도 안 씀 |

## `src/features/` 빈 스텁 (`export {}` 한 줄)

**디렉토리가 있다고 구현된 게 아니다.** 아래 9개는 전부 껍데기이며, 해당 도메인 작업 = 이 파일부터 채우는 일이다.

`src/features/archive/index.ts` · `src/features/execution/index.ts` · `src/features/home/index.ts` · `src/features/itinerary/index.ts` · `src/features/notification/index.ts` · `src/features/planb/index.ts` · `src/features/settings/index.ts` · `src/features/stay/index.ts` · `src/features/trip/index.ts`

## `src/shared/`

| 파일 | 역할 |
|---|---|
| `src/shared/api/index.ts` | **구현됨** — axios 인스턴스 · 인터셉터 · 토큰 갱신 · 서버 호출 전체. `authedClient` 인스턴스가 온보딩 5종을 인증 경로로 보낸다 |
| `src/shared/api/tokenManager.ts` | **구현됨** — 동기 in-memory 액세스토큰 홀더. SecureStore(비동기)와 공존, 인터셉터가 동기로 읽는다 |
| `src/shared/storage/index.ts` | **구현됨** — expo-secure-store 토큰 저장소 |
| `src/shared/version/compareVersion.ts` | **구현됨** — 버전 비교(강제 업데이트 판정) |
| `src/shared/location/LocationPreprompt.tsx` | **전체화면**(레이더 히어로·denied 전용 레이아웃 — 카드형은 폐기됐고 내부 마크업만 전면 교체, props/testID 시그니처 무변경). `default`/`permission-denied` 2상태. `expo-location`을 import조차 안 함(구조적으로 OS 다이얼로그 못 부름). **라우트 미등록**(실사용처 0, 프리뷰 전용) |
| `src/shared/location/LocationGlyphs.tsx` | 인라인 SVG — 위치 화면 글리프(레이더 히어로·오프 타일). stroke/fill 색은 `locationColors.ts` 상수 경유(`shared/location/**` 는 F2 raw-hex 가드 대상) |
| `src/shared/location/lib/locationColors.ts` | 위치 글리프 색 상수(raw hex 분리 — `gradients.ts` 패턴 재사용). 토큰 색과 수동 동기화 필요(03b 참고-2) |
| `src/shared/location/index.ts` | 배럴 스텁(`export {}`) |
| `src/shared/ui/index.ts` | **빈 스텁** |
| `src/shared/validation/index.ts` | **빈 스텁** |
| `src/shared/map/index.ts` | **빈 스텁** |

## 테스트 인프라

| 파일 | 역할 |
|---|---|
| `src/mocks/handlers.ts` | msw 핸들러 — **테스트 오라클 전용** |
| `src/mocks/server.ts` | msw/**node** 서버 (통합 버킷 전용) |
| `src/mocks/scenarios.ts` | 시나리오 정의·상태. **앱 런타임은 안 씀**(makeAuthorize가 env로 전환됨) |
| `src/test-support/onboardingScenarios.ts` | 온보딩 목 거동. **앱이 참조하지 않는 테스트 전용 모듈** |
| `src/test-support/expoAuthSessionMock.ts` | `expo-auth-session`·`web-browser`·`crypto` 가상 목 + 스파이 |
| `src/test-support/expoRouterStackMock.tsx` | expo-router `Stack` 목(관찰 마커) |
| `src/test-support/expoRouterRedirectMock.tsx` | expo-router `Redirect`·`Stack` 목 — 진입 가드 테스트용 |
| `src/test-support/splashGateMock.tsx` | `SplashGate` 목 |
| `__mocks__/@gorhom/bottom-sheet.tsx` | 네이티브 모듈 자동 목 |
| `src/__tests__/noMswInStaticGraph.test.ts` | 정적 import 그래프를 fs로 훑어 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제 |
| `src/__tests__/importBoundary.test.ts` | import 경계 가드 — 계층·feature 격리 위반 차단 |
| `src/__tests__/onboardingStructure.test.ts` | 온보딩 계층·경계 구조 가드(서버 권한 경계 등) |
| `src/__tests__/onboardingPrefStructure.test.ts` | 취향 스토어·모델 구조 가드(TRIP-163) — persist 금지·`@/shared/api` 미참조·`create(` 표기(구조 가드 6-2, 개념 [[구조 가드와 긍정 앵커]]) |
| `src/__tests__/onboardingPrefRoutes.test.tsx` | 취향 1/2·2/2 라우트 존재·내비게이션 계약 가드(TRIP-163) — push/replace/back 분기 |
| `src/__tests__/devPreviewPref.test.tsx` | 프리뷰 `pref1`·`pref2` 상태 렌더 가드(TRIP-163) — 빈 선택 상태로 직접 렌더, 가드 우회 아님 |
| `src/__tests__/onboardingEntryGuard.test.tsx` | 온보딩 진입 리다이렉트·완료자 방어 가드 |
| `src/__tests__/rootLayout.test.tsx` | 루트 부팅 골격 |
| `src/__tests__/rootLayoutSafeArea.test.tsx` | `SafeAreaProvider` 도입 후에도 자식이 렌더되는지 |
| `src/__tests__/devPreview.test.tsx` | 프리뷰 상태 렌더. 런타임 지뢰 목으로 네트워크 격리 |
| `src/__tests__/devPreviewDeepLink.test.tsx` | 프리뷰 딥링크 `?state=` 파라미터 → 초기 화면 결정론 가드(부재·오타·대소문자·빈 문자열·배열 값 → 전부 splash 폴백) |
| `src/__tests__/design-tokens.test.ts` | 디자인 토큰 가드 |

## 명령

```
pnpm test              # test:node + test:integration — 반드시 둘 다
pnpm test:node         # jest (단위 버킷)
pnpm test:integration  # jest --config jest.integration.config.js (msw/node 버킷)
pnpm lint · pnpm tsc · pnpm format · pnpm codegen(orval)
```

**jest 설정이 둘로 갈려 있다.** `pnpm test:node`만 돌리면 통합 테스트가 0건 실행되고도 green으로 보인다. 테스트를 추가할 때 어느 버킷인지 먼저 정한다.

**jest가 원리적으로 못 보는 것**: 픽셀·레이아웃·Metro/Hermes·딥링크. 실기 확인이 필요하다.

```
xcrun simctl openurl booted trippilot://_dev/preview   # 프리뷰 진입
xcrun simctl io booted screenshot /tmp/shot.png        # 화면 캡처
```
(탭·스와이프 자동화는 이 환경에서 불가 — 접근성 권한 부재)

## 재사용 공개 API

**새 함수를 만들기 전에 여기부터 본다.** 있으면 다시 만들지 말고 가져다 쓴다.
(대상: `shared/*` + `features/*/lib`·`model`·`hooks`. 화면·컨테이너는 재사용 대상이 아니라 제외.)

| 심볼 | 위치 | 무엇 |
|---|---|---|
| `createAuthedApiClient` | `shared/api` | 인증 붙은 axios 인스턴스 생성 |
| `fetchBootstrap` · `postSocialLogin` · `refreshTokens` | `shared/api` | 부트스트랩 조회 · 소셜 로그인 · 토큰 갱신 |
| `fetchTerms` · `submitConsents` | `shared/api` | 약관 목록 · 동의 1회 제출(체크된 것만 GRANT) |
| `fetchNicknameSuggestions` · `checkNickname` · `updateNickname` · `completeOnboarding` | `shared/api` | 후보 조회 · 서버 판정 · 저장 · 온보딩 완료 |
| `setAccessToken` · `getAccessToken` · `clearAccessToken` · `hydrate` | `shared/api/tokenManager` | 동기 in-memory 토큰 홀더. `getAccessToken`은 **동기** 반환(인터셉터용) |
| `saveTokens` · `getTokens` · `clearTokens` · `hasStoredToken` | `shared/storage` | 토큰 저장소 CRUD. **로그인 여부 판정도 `hasStoredToken`** |
| `compareVersion` | `shared/version` | 버전 문자열 비교(`-1\|0\|1`) |
| `makeAuthorize` | `features/auth/lib` | provider별 authorize 팩토리(DI 주입점) |
| `getOAuthConfig` | `features/auth/lib/oauthConfig` | provider별 OAuth config(env). 네이티브 의존 0 |
| `realAuthorize` | `features/auth/lib/realAuthorize` | expo-auth-session PKCE authorize. **`makeAuthorize`가 동적 import로만 부름** |
| `resolveBootstrapDestination` | `features/auth/model` | 부트스트랩 상태 → 목적지(순수) |
| `resolveOnboardingStep` · `validateNicknameFormat` | `features/onboarding/model` | 잔여 온보딩 단계 · 닉네임 길이 검증(순수) |
| `toggleMulti` · `toggleSingle` | `features/onboarding/model/preferenceSelection` | 취향 축 토글 순수 규칙(복수/단일 공용). `null`=미설정, 빈 배열로 안 떨어짐(US-ONB-14) |
| `usePreferenceStore` | `features/onboarding/store/preferenceStore` | 취향 6축 세션 메모리 Zustand 스토어(persist 없음) |
| `useBootstrapGate` · `useSocialLogin` | `features/auth/hooks` | 부트스트랩 · 소셜 로그인 훅 |
| `useTermsConsent` · `useNickname` · `useOnboardingProgress` | `features/onboarding/hooks` | 약관 · 닉네임 · 진행 상태 훅 |
| `SPLASH_BACKGROUND_COLORS` · `SPLASH_BACKGROUND_LOCATIONS` · `APP_ICON_COLORS` | `features/auth/lib/gradients` | 그라디언트 상수 |
| `BOOTSTRAP_TIMEOUT_MS` | `features/auth/hooks` | 부트스트랩 타임아웃 |

> ⚠️ **제거된 심볼**(참조하면 깨진다): `setApiAdapter` · `defaultAdapter` · `SCENARIO_LIST` · `getActiveScenarioKey`

> **이 목록이 못 잡는 것**: 이름이 다른 같은 기능(`hasStoredToken`이 있는데 `isLoggedIn`을 새로 만드는 경우). 그래서 **찾아봤으나 없어서 새로 만든다는 사실**을 브리프·03에 적고 게이트 요약에 올린다.

## 지금 작업하려면 (경고)

리포를 읽어도 안 보이는 것들. **밟기 전에 읽는다.**

- **auth lib를 만지려면** → `makeAuthorize.ts`에 top-level `from 'expo-auth-session'`을 **넣지 마라.** `expoAuthSessionLazyBoundary.test.ts`(소스 스캔)가 red가 된다. 네이티브 참조는 `realAuthorize.ts`에만, 동적 import로.
- **온보딩 완료자 라우팅을 만지려면** → `useOnboardingProgress`가 **하드코딩 `false`**임을 먼저 알라(FW1). 실 progress는 `onboardingCompleted`인데 `features/auth`에만 있고 importBoundary가 막는다 — `shared` 승격이 선행돼야 한다.
- **세션 만료 UX를 만지려면** → 현재 토큰만 clear하고 즉시 리다이렉트는 없다(FW2, 다음 부트스트랩이 자가치유).
- **`shared/api`에 `expo-router`를 import하지 마라** → node 테스트가 깨진다. 라우팅은 콜백/상위로.
- **프로덕션에 `@/mocks/*`·`msw`를 import하지 마라** → `noMswInStaticGraph.test.ts`가 잡는다.
- **엣지 케이스 화면을 눈으로 보려면** → 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다.
- **실 OAuth 실행·검증** → Google 등록 + env 주입 + **네이티브 리빌드**가 필요하다. 패키지(`expo-auth-session`·`expo-web-browser`·`expo-crypto`)는 설치돼 있으나 리빌드 전이라 앱에서 아직 못 쓴다. jest는 가상 목이 우선이라 green.
- **kakao/naver/apple** → `oauthConfig`에 빈 슬롯만 있다. 비표준 OAuth라 각각 별도 배선 필요.
- **화면 비주얼** → `figma-screen-impl` 스킬 절차를 따른다. 밴드 맵은 `.claude/skills/spec-perception/reference/figma-structure.md`.
