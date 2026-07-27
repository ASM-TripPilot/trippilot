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
- **문서 대상 파일 98개** (병렬 배치된 `*.test.ts(x)`는 대상 소스 행이 대표하므로 제외. `src/__tests__/` 전역 가드는 독립 산출물이라 포함)

## 디렉토리

```
frontend/
├── src/
│   ├── app/          Expo Router 라우트 (파일 = 화면)
│   ├── app-shell/    src/app **밖**의 루트 셸 조립 (TRIP-173 신설 — SplashGate)
│   ├── pages/        FSD pages 층 — 화면별 배선 (TRIP-173 신설, 구 `features/*/containers` 5개가 이주)
│   ├── features/     도메인 기능 (auth·onboarding 실구현, 나머지 9개 빈 스텁)
│   ├── shared/       도메인 무관 공용
│   ├── mocks/        테스트 오라클 전용 msw/node (앱 런타임 목 아님)
│   ├── test-support/ 테스트 전용 목·헬퍼
│   └── __tests__/    전역 가드 테스트
├── __mocks__/        Jest 자동 목 (네이티브 모듈)
└── (설정) app.config.ts · orval.config.ts · eslint.config.js · babel.config.js
          jest.config.js · jest.integration.config.js · metro.config.js · tailwind.config.js
```

**FSD 층 방향 규칙 — 아직 0개(TRIP-173 사이클 1 기준).** `app-shell`·`pages`가 신설됐지만 이번 사이클은 폴더 배치만 바꿨고, "하위 층이 상위 층을 참조하면 안 된다" 같은 방향 규칙은 eslint·테스트 어디에도 없다(사이클 4에서 도입 예정, code-critic 경고-1 실측 — `features` → `pages` 역참조를 lint 0 error로 통과시킴). 지금 이 규칙이 이미 있다고 가정하고 작업하지 마라.

## `src/app/` — 라우트

| 파일 | 역할 |
|---|---|
| `src/app/_layout.tsx` | 루트 레이아웃. 폰트 로드 게이팅 + 네이티브 스플래시 제어 + `GestureHandlerRootView` + `SafeAreaProvider`(null 대비 initialMetrics) + `SplashGate` |
| `src/app/force-update.tsx` | 강제 업데이트 분기 화면 |
| `src/app/reconsent.tsx` | 재동의 분기 화면 |
| `src/app/_dev/preview.tsx` | **개발 전용 정적 프리뷰** — 네트워크 없이 시각 상태 전환. 진입은 딥링크 `trippilot://_dev/preview?state=<키>` 하나뿐(**15개** 상태 키 조준 — TRIP-170에서 홈 4상태(`home-default`·`home-no-trip`·`home-empty`·`home-loading`) 끝에 append. 부재·오타·배열 값은 splash 결정론 폴백 — `useLocalSearchParams`는 지연 초기화자로 최초 마운트 1회만 읽음). 같은 세션에서 연속 openurl 시 상태 미전환(1회만 읽는 계약 한계 — 실기 확인은 키마다 fresh 재기동) |
| `src/app/(auth)/_layout.tsx` | 미인증 스택 |
| `src/app/(auth)/login.tsx` | 소셜 로그인 화면 진입점 |
| `src/app/(onboarding)/_layout.tsx` | 온보딩 스택 + **완료자만 홈으로 방어** |
| `src/app/(onboarding)/index.tsx` | **진입 단계 리다이렉트** (미완 → terms) |
| `src/app/(onboarding)/terms.tsx` | 약관 라우트 — 컨테이너를 꽂는 얇은 래퍼 |
| `src/app/(onboarding)/nickname.tsx` | 닉네임 라우트 — 얇은 래퍼 |
| `src/app/(onboarding)/pref1.tsx` | 취향 1/2 라우트(c09) — `PrefStep1Page`를 꽂는 얇은 래퍼(구 `PrefStep1Container`) |
| `src/app/(onboarding)/pref2.tsx` | 취향 2/2 라우트(c09b) — `PrefStep2Page`를 꽂는 얇은 래퍼(구 `PrefStep2Container`) |
| `src/app/(tabs)/_layout.tsx` | 탭 네비게이터 — `Tabs`에 `tabBar` 렌더프롭(Q4 전면 커스텀) + `BottomTabBar` 어댑터(라우트↔탭key 양방향 번역: `routeNameToTabKey`(index→home, 활성 표시) · `handlePressTab`(home→index, 누름 이동 — **홈 탭 press 미검증**, code-critic 경고1)) |
| `src/app/(tabs)/index.tsx` | 홈 탭 라우트 — `HomeScreen`(no-trip 픽스처, 게이트① G-1)을 그리는 얇은 래퍼. **더 이상 껍데기 아님**(TRIP-170) |
| `src/app/(tabs)/explore.tsx` | 탐색 탭 — **껍데기** |
| `src/app/(tabs)/itinerary.tsx` | 일정 탭 — **껍데기** |
| `src/app/(tabs)/records.tsx` | 기록 탭 — **껍데기** |
| `src/app/(tabs)/my.tsx` | 마이 탭 — **껍데기** |

## `src/app-shell/` — 루트 셸 (TRIP-173 신설)

Expo Router가 `src/app`을 이미 점유해 비표준 이름을 썼다(01b Seed 확정) — `src/app` **밖**에 있다.

| 파일 | 역할 |
|---|---|
| `src/app-shell/ui/SplashGate.tsx` | 부트스트랩 결과에 따라 라우팅 결정(구 `features/auth/containers/SplashGate.tsx`). 향후 `QueryClientProvider` 등 앱 전역 프로바이더가 여기 모일 자리 |
| `src/app-shell/index.ts` | 배럴 — `SplashGate` 재수출. `src/app/_layout.tsx`가 이 배럴을 경유(딥 임포트 0건, code-critic E5 확인) |

## `src/pages/` — FSD pages 층 (TRIP-173 신설, 5슬라이스)

구 `features/{auth,onboarding}/containers/*`(훅 ↔ 화면 배선)가 이주한 자리. **아직 방향 규칙 없음**(위 "FSD 층 방향 규칙" 참조) — 지금은 폴더 배치일 뿐이다.

| 슬라이스 | 파일 | 역할 |
|---|---|---|
| `login` | `src/pages/login/ui/LoginPage.tsx` | 로그인 훅 ↔ 화면 배선(구 `SocialLoginContainer.tsx`, 심볼도 `*Page`로 개명) |
| | `src/pages/login/index.ts` | 배럴 — `LoginPage` 재수출 |
| `onboarding-terms` | `src/pages/onboarding-terms/ui/TermsPage.tsx` | 약관 훅 ↔ 화면 배선(구 `TermsContainer.tsx`) |
| | `src/pages/onboarding-terms/index.ts` | 배럴 |
| `onboarding-nickname` | `src/pages/onboarding-nickname/ui/NicknamePage.tsx` | 닉네임 훅 ↔ 화면 배선(구 `NicknameContainer.tsx`) |
| | `src/pages/onboarding-nickname/index.ts` | 배럴 |
| `onboarding-pref1` | `src/pages/onboarding-pref1/ui/PrefStep1Page.tsx` | 취향 1/2 배선(구 `PrefStep1Container.tsx`) |
| | `src/pages/onboarding-pref1/index.ts` | 배럴 |
| `onboarding-pref2` | `src/pages/onboarding-pref2/ui/PrefStep2Page.tsx` | 취향 2/2 배선(구 `PrefStep2Container.tsx`) |
| | `src/pages/onboarding-pref2/index.ts` | 배럴 |

> **⚠️ 배럴 경유는 지금 관행일 뿐 강제되지 않는다** — 라우트 5개는 전부 배럴을 경유하지만(위반 0건), 승인 테스트(`fsdStructure.test.ts`)의 단언이 `toContain`(부분 문자열)이라 딥 임포트로 바꿔도 잡히지 않는다(code-critic 참고-1 실측). 회귀 방지는 승인 테스트 수정이 필요해 사이클 3 몫으로 이관됨.

## `src/features/auth/` — 실구현 ①

**계층 개명(TRIP-173)**: `ui`(프레젠테이션, 구 `screens`+`components`) → `model`(상태·훅, 구 `hooks`) → `lib`·`config`(순수 로직/설정, 구 `lib`가 둘로 분리). 배선(구 `containers`)은 `pages/login/ui/LoginPage.tsx`로 이동했다(위 절 참조).

| 파일 | 역할 |
|---|---|
| `src/features/auth/ui/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/ui/SocialLoginScreen.tsx` | 소셜 로그인 비주얼 (props 8개 순수 컴포넌트). 에러 배너 조건이 **블랙리스트**(연령제한·이메일충돌 전용화면 2종만 제외, 나머지는 phase가 `'error'`면 전부 배너 — TRIP-172 결함 F, INV-4). ⚠️ 하단 고지 문구는 여전히 기존 약관 문구뿐 — 결함 B(연령 고지 문구) 반영 안 됨 |
| `src/features/auth/model/useBootstrapGate.ts` | 앱 시작 시 토큰 복원(`hydrate`가 첫 조회보다 선행) · 잠정/확정 분기. `BOOTSTRAP_TIMEOUT_MS` 포함. 로그인 성공(토큰 변경)을 `subscribeAccessToken`으로 구독해 재조회한다(TRIP-172 결함 A) — 구독은 첫 왕복이 끝난 뒤에만 건다 |
| `src/features/auth/model/useSocialLogin.ts` | 소셜 로그인 흐름(PKCE · single-flight, `phaseRef` 잠금). `'exchanging'` phase 신설, `authorize()` reject는 `phase='error'`(INV-4)로 표면화(TRIP-172 결함 E). 성공 시 `saveTokens` + `setAccessToken` 둘 다. ⚠️ **결함 B 미해결** — `confirmAge()`가 여전히 같은 `authorizationCode`를 재전송한다(:154, OAuth 인가코드는 1회용이라 실서버에서 항상 거부됨). 다음 사이클 1순위 |
| `src/features/auth/model/resolveBootstrapDestination.ts` | **순수 함수** — 부트스트랩 상태 → 목적지. `AUTHENTICATED`는 `onboardingCompleted`로 `HOME`/`ONBOARDING` 분기(TRIP-172 — 서버에 `ONBOARDING_INCOMPLETE` 상태 자체가 없다, D7) |
| `src/features/auth/lib/makeAuthorize.ts` | authorize 팩토리(DI 주입점). **제자리**(TRIP-173에서 안 옮김). **3갈래** — fake 토글 on→fake / off+clientId→`realAuthorize` **동적 import** / off+설정없음→throw(INV-4) |
| `src/features/auth/lib/realAuthorize.ts` | **`expo-auth-session`을 참조하는 유일한 프로덕션 파일.** **제자리**(TRIP-173에서 안 옮김). `AuthRequest`가 이제 `config.usePKCE`를 그대로 쓴다(naver만 false). PKCE 미사용 시 `codeVerifier`가 빈 문자열 대신 `generateOpaqueToken()` 대체값(백엔드 `@NotBlank` 회피, TRIP-172 결함 C). naver는 `state`도 직접 생성 — 둘 다 암호학적으로 안전한 난수는 아님(참고 #2, 실기 전 `expo-crypto` 교체 검토) |
| `src/features/auth/config/oauthConfig.ts` | provider별 OAuth config를 **env에서** 읽음(`EXPO_PUBLIC_{GOOGLE,KAKAO,NAVER}_*`). discovery 정적 하드코딩. **google·kakao·naver 채움**(TRIP-172), **apple만 빈 슬롯**(백엔드 fail-closed). naver는 `usePKCE:false` + `requiresState:true`(PKCE 미지원). 네이티브 의존 0 |
| `src/features/auth/config/gradients.ts` | 그라디언트·앱아이콘 색 상수 |
| `src/features/auth/ui/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘 · 소셜 4종 로고 |
| `src/features/auth/ui/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

> `src/features/auth/` 아래 `index.ts`는 여전히 **존재하지 않는다**(auth만 배럴이 없음) — 배럴 신설은 사이클 3 범위.

## `src/features/onboarding/` — 실구현 ②

**계층 개명(TRIP-173)**: auth와 동형으로 축소 — `ui`(프레젠테이션, 구 `screens`+`components`) → `model`(상태·훅·스토어, 구 `hooks`+`store`+기존 `model`이 합류). 배선(구 `containers`)은 `pages/onboarding-{terms,nickname,pref1,pref2}/ui/`로 이동(위 `src/pages/` 절 참조). **`store/` 디렉토리는 폐지** — Zustand 스토어가 `model/`로 합류했다.

| 파일 | 역할 |
|---|---|
| `src/features/onboarding/ui/TermsScreen.tsx` | 약관 화면(프레젠테이션 · props만) |
| `src/features/onboarding/ui/NicknameScreen.tsx` | 닉네임 화면(오류·대체칩 표시만). 칩은 값(인덱스 아님)을 올림 |
| `src/features/onboarding/ui/PrefStep1Screen.tsx` | 취향 1/2 화면(프레젠테이션 · Figma c09/1643:1183 정합) — 스타일 그리드(복수)+페이스(단일). props만, 스토어·네트워크 모름 |
| `src/features/onboarding/ui/PrefStep2Screen.tsx` | 취향 2/2 화면(프레젠테이션 · Figma c09b/1774:2258 정합) — 예산(단일)+동행·음식·이동(복수) + back chevron(Q4 결정, 2/2 전용) |
| `src/features/onboarding/model/useTermsConsent.ts` | 약관 3종 로드·토글·`POST /me/consents` **1회** 제출. 실패 시 이동 안 함 |
| `src/features/onboarding/model/useNickname.ts` | 닉네임 프리필 + **순서 저장**(형식→check→PATCH→complete). 각 단계 실패 시 다음 미호출 |
| `src/features/onboarding/model/useOnboardingProgress.ts` | 온보딩 진행 상태 훅 seam. ⚠️ **현재 `{false,false}` 하드코딩**(FW1) — 아래 경고. 취향 스텝은 이 모델을 확장하지 않음(1회성 통과 흐름 — 02a §7-11) |
| `src/features/onboarding/model/resolveOnboardingStep.ts` | **순수 함수** — 진행 상태 → 잔여 단계(`terms`/`nickname`/`done`) |
| `src/features/onboarding/model/validateNicknameFormat.ts` | **순수 함수** — 닉네임 길이(코드포인트 2~20)만. 내용 판정은 서버 권한 |
| `src/features/onboarding/model/preferenceSelection.ts` | **순수 함수** — `toggleMulti`(복수 축)·`toggleSingle`(단일 축). `null`=미설정, 전부 해제 시 `[]`가 아니라 `null`로 복귀(US-ONB-14) |
| `src/features/onboarding/model/preferenceStore.ts` | **Zustand 스토어**(구 `store/preferenceStore.ts`, TRIP-173에서 `model/`로 합류) — 취향 6축(styles·pace·budget·companions·foods·transports) 세션 메모리 상태. **persist 없음**(인터뷰3), 토글 판단은 `model/preferenceSelection`에 위임. `create(createPreferenceDraft)` 형태(구조 가드 6-2 정합 — 제네릭 직접 호출 시 `create<` 리터럴이 가드를 오탐시킴, 개념 [[구조 가드와 긍정 앵커]]) |
| `src/features/onboarding/ui/OnboardingGlyphs.tsx` | 인라인 SVG — 약관·닉네임·취향 화면 글리프. 기존 5종(체크·재생성 등)+**신규 19종**(스타일7·페이스3·동행4·이동3·info·skip chevron 등, TRIP-163). raw hex 색 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일들과 **같은 폴더가 됐다.** F2 raw-hex 가드(`onboardingStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`SCREEN_SOURCE_FILES` 상수로 6개 고정, code-critic W-2·W-3 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
| `src/features/onboarding/index.ts` | 배럴 스텁(`export {}`) — 아무도 안 씀. **제자리**(채우기는 사이클 3, `features/auth`용 신설 배럴과 한 덩어리) |

## `src/features/home/` — 실구현 ③ (TRIP-170)

계층: `model`(순수 타입·상수) → `components`(전용 글리프) → `screens`(프레젠테이션). **컨테이너·훅 없음** — 서버 API 부재로 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0).

| 파일 | 역할 |
|---|---|
| `src/features/home/model/homeTypes.ts` | prop 계약 타입 — 판별 유니온 `HomeSections`(`ready`/`empty`/`loading`) 포함 |
| `src/features/home/model/homeFixtures.ts` | 4상태 고정 목업(Q2 — Figma 표시값 그대로 상수화). `HOME_DEFAULT_PROPS`·`HOME_NO_TRIP_PROPS`·`HOME_EMPTY_PROPS`·`HOME_LOADING_PROPS` |
| `src/features/home/components/HomeGlyphs.tsx` | 홈 전용 인라인 SVG 10종(AuthGlyphs/OnboardingGlyphs 패턴). raw hex 직박(`screens/` 밖이라 D-3 가드 미대상) |
| `src/features/home/screens/HomeScreen.tsx` | 4상태 프레젠테이션 화면. props만 받음 — `expo-router`·`@/shared/api`·타 feature import 0(homeStructure D-1이 기계 강제) |
| `src/features/home/index.ts` | 배럴 스텁(`export {}`) — 아무도 안 씀 |

## `src/features/` 빈 스텁 (`export {}` 한 줄)

**디렉토리가 있다고 구현된 게 아니다.** 아래 8개는 전부 껍데기이며, 해당 도메인 작업 = 이 파일부터 채우는 일이다(`home`은 TRIP-170으로 위 실구현 ③절로 이동).

`src/features/archive/index.ts` · `src/features/execution/index.ts` · `src/features/itinerary/index.ts` · `src/features/notification/index.ts` · `src/features/planb/index.ts` · `src/features/settings/index.ts` · `src/features/stay/index.ts` · `src/features/trip/index.ts`

## `src/shared/`

| 파일 | 역할 |
|---|---|
| `src/shared/api/index.ts` | **구현됨** — axios 인스턴스 · 인터셉터 · 토큰 갱신 · 서버 호출 전체. `authedClient` 인스턴스가 온보딩 5종 + `fetchBootstrap`(TRIP-172 결함 A-2, 이전엔 무인증 `baseClient`였음)을 인증 경로로 보낸다. `SERVER_ERROR_CODE_TRANSLATIONS`가 서버 실코드→프론트 계약 코드 번역표(현재 `AGE_REQUIREMENT_NOT_MET`→`AGE_NOT_MET` 1건, `normalizeSocialError`의 `??` 결과값에 적용 — 승인 테스트가 이 표를 겨냥하지 않아 미검증) |
| `src/shared/api/tokenManager.ts` | **구현됨** — 동기 in-memory 액세스토큰 홀더. SecureStore(비동기)와 공존, 인터셉터가 동기로 읽는다. `subscribeAccessToken`으로 토큰 변화를 구독 가능(TRIP-172, 값이 실제로 바뀔 때만 통지 — 동등비교 가드) |
| `src/shared/storage/index.ts` | **구현됨** — expo-secure-store 토큰 저장소. `hasStoredToken`은 **accessToken 존재만 판정**한다(`getItemAsync(ACCESS_TOKEN_KEY) != null` — refreshToken만 없는 부분 저장도 true). TRIP-173 재작성 3/8에서 실수로 "두 토큰 다 있어야 true"로 좁혀졌다가(콜드스타트 폴백이 HOME→LOGIN으로 뒤집힘) code-critic이 잡아 원복됨 — 이 함수를 실제로 도는 테스트가 리포에 없어 재발해도 362건이 그대로 green이니 다음에 손댈 때 주의 |
| `src/shared/version/compareVersion.ts` | **구현됨** — 버전 비교(강제 업데이트 판정) |
| `src/shared/location/LocationPreprompt.tsx` | **전체화면**(레이더 히어로·denied 전용 레이아웃 — 카드형은 폐기됐고 내부 마크업만 전면 교체, props/testID 시그니처 무변경). `default`/`permission-denied` 2상태. `expo-location`을 import조차 안 함(구조적으로 OS 다이얼로그 못 부름). **라우트 미등록**(실사용처 0, 프리뷰 전용) |
| `src/shared/location/LocationGlyphs.tsx` | 인라인 SVG — 위치 화면 글리프(레이더 히어로·오프 타일). stroke/fill 색은 `locationColors.ts` 상수 경유(`shared/location/**` 는 F2 raw-hex 가드 대상) |
| `src/shared/location/lib/locationColors.ts` | 위치 글리프 색 상수(raw hex 분리 — `gradients.ts` 패턴 재사용). 토큰 색과 수동 동기화 필요(03b 참고-2) |
| `src/shared/location/index.ts` | 배럴 스텁(`export {}`) |
| `src/shared/ui/BottomTabBar.tsx` | 순수 뷰 탭바(TRIP-170) — 5탭 아이콘 자체 보유(인라인 SVG), 네비게이션을 모른다(`activeKey`·`onPressTab` 두 prop뿐). testID `shell-tabbar-*` |
| `src/shared/ui/index.ts` | 배럴 스텁(`export {}`) — `BottomTabBar`는 이 배럴을 거치지 않고 직접 import됨 |
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
| `src/test-support/expoRouterTabsMock.tsx` | expo-router `Tabs`/`Tabs.Screen` 관찰 목(TRIP-170) — `capturedTabsProps` 홀더 + `tabs-route-*` 마커 |
| `src/test-support/splashGateMock.tsx` | `SplashGate` 목 |
| `__mocks__/@gorhom/bottom-sheet.tsx` | 네이티브 모듈 자동 목 |
| `src/__tests__/noMswInStaticGraph.test.ts` | 정적 import 그래프를 fs로 훑어 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제 |
| `src/__tests__/importBoundary.test.ts` | import 경계 가드 — 계층·feature 격리 위반 차단 |
| `src/__tests__/fsdStructure.test.ts` | **TRIP-173 신설(사이클 1 유일한 신규 파일)** — auth `{config,lib,model,ui}` 4칸·onboarding `{model,ui}` 2칸 대표 파일 존재, `pages` 5슬라이스의 배럴·라우트 참조, `app-shell`이 `src/app` 밖에 있는지를 검사. **폴더 배치만 본다 — import 방향·소스 내용은 안 본다**(code-critic E3·E5·E6 실측). 사이클 2~4가 이 파일에 덧붙여 자란다. 주석 상단에 A(영구)/B(한시) 졸업 조건 명시(게이트①-1→①-2 재제시로 추가됨) |
| `src/__tests__/onboardingStructure.test.ts` | 온보딩 계층·경계 구조 가드(서버 권한 경계 등). `PAGES_DIR`+`ONBOARDING_PAGE_SLICES`(TRIP-173 신설 — 온보딩 컨테이너 4개가 `pages/`로 나가며 금칙어 가드 사정거리에 다시 편입) |
| `src/__tests__/onboardingPrefStructure.test.ts` | 취향 스토어·모델 구조 가드(TRIP-163) — persist 금지·`@/shared/api` 미참조·`create(` 표기(구조 가드 6-2, 개념 [[구조 가드와 긍정 앵커]]) |
| `src/__tests__/homeStructure.test.ts` | 홈 소스 스캔 가드(TRIP-170, `@jest-environment node`) — 픽스처 상수화(D-1)·INV-3 `duration` 식별자 0(D-2)·토큰 raw-hex 0(D-3)·SafeArea 규약(D-4)·탭바 격리(D-5) |
| `src/__tests__/onboardingPrefRoutes.test.tsx` | 취향 1/2·2/2 라우트 존재·내비게이션 계약 가드(TRIP-163) — push/replace/back 분기 |
| `src/__tests__/tabsShell.test.tsx` | `(tabs)/_layout.tsx` 배선 가드(TRIP-170) — 5탭 등록 순서·`tabBar` 렌더프롭·어댑터 활성 매핑/press→navigate·홈 라우트 래퍼·4탭 껍데기 유지 |
| `src/__tests__/devPreviewPref.test.tsx` | 프리뷰 `pref1`·`pref2` 상태 렌더 가드(TRIP-163) — 빈 선택 상태로 직접 렌더, 가드 우회 아님 |
| `src/__tests__/devPreviewHome.test.tsx` | 프리뷰 홈 4키 가드(TRIP-170) — 딥링크 4키·토글 진입·미존재 키 splash 폴백 결정론 |
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
| `setAccessToken` · `getAccessToken` · `clearAccessToken` · `hydrate` · `subscribeAccessToken` | `shared/api/tokenManager` | 동기 in-memory 토큰 홀더. `getAccessToken`은 **동기** 반환(인터셉터용). `subscribeAccessToken(listener)`은 토큰이 실제로 바뀔 때만 통지하고 구독 해제 함수를 반환한다(TRIP-172 신규 — 로그인 성공 후 부트스트랩 재조회의 유일한 신호) |
| `saveTokens` · `getTokens` · `clearTokens` · `hasStoredToken` | `shared/storage` | 토큰 저장소 CRUD. **로그인 여부 판정도 `hasStoredToken`**(accessToken 단독 판정 — 위 파일별 역할 표 참고, 심판 0이라 조용히 재발할 수 있다) |
| `compareVersion` | `shared/version` | 버전 문자열 비교(`-1\|0\|1`) |
| `makeAuthorize` | `features/auth/lib` | provider별 authorize 팩토리(DI 주입점) |
| `getOAuthConfig` | `features/auth/config/oauthConfig` | provider별 OAuth config(env). 네이티브 의존 0 |
| `realAuthorize` | `features/auth/lib/realAuthorize` | expo-auth-session PKCE authorize. **`makeAuthorize`가 동적 import로만 부름** |
| `resolveBootstrapDestination` | `features/auth/model` | 부트스트랩 상태 → 목적지(순수) |
| `resolveOnboardingStep` · `validateNicknameFormat` | `features/onboarding/model` | 잔여 온보딩 단계 · 닉네임 길이 검증(순수) |
| `toggleMulti` · `toggleSingle` | `features/onboarding/model/preferenceSelection` | 취향 축 토글 순수 규칙(복수/단일 공용). `null`=미설정, 빈 배열로 안 떨어짐(US-ONB-14) |
| `usePreferenceStore` | `features/onboarding/model/preferenceStore` | 취향 6축 세션 메모리 Zustand 스토어(persist 없음). **TRIP-173에서 `store/`→`model/` 합류** |
| `BottomTabBar` · `ShellTabKey` · `BottomTabBarProps` | `shared/ui` | 순수 뷰 탭바(TRIP-170) — `activeKey`·`onPressTab` 두 prop만, 네비게이션 모름 |
| `HOME_DEFAULT_PROPS` · `HOME_NO_TRIP_PROPS` · `HOME_EMPTY_PROPS` · `HOME_LOADING_PROPS` | `features/home/model/homeFixtures` | 홈 4상태 Figma 고정 목업(Q2 — 서버 없어 유일한 데이터 소스) |
| `HomeScreenProps` · `HomeSections`(외 조각 타입) | `features/home/model/homeTypes` | 홈 화면 prop 계약 — 판별 유니온 `HomeSections`(ready/empty/loading) |
| `useBootstrapGate` · `useSocialLogin` | `features/auth/model` | 부트스트랩 · 소셜 로그인 훅. **TRIP-173에서 `hooks/`→`model/` 개명** |
| `useTermsConsent` · `useNickname` · `useOnboardingProgress` | `features/onboarding/model` | 약관 · 닉네임 · 진행 상태 훅. **TRIP-173에서 `hooks/`→`model/` 개명** |
| `SPLASH_BACKGROUND_COLORS` · `SPLASH_BACKGROUND_LOCATIONS` · `APP_ICON_COLORS` | `features/auth/config/gradients` | 그라디언트 상수. **TRIP-173에서 `lib/`→`config/` 개명** |
| `BOOTSTRAP_TIMEOUT_MS` | `features/auth/model` | 부트스트랩 타임아웃 |
| `LoginPage` | `pages/login` | 로그인 훅↔화면 배선(구 `features/auth/containers/SocialLoginContainer`, TRIP-173 신설) |
| `TermsPage` · `NicknamePage` · `PrefStep1Page` · `PrefStep2Page` | `pages/onboarding-{terms,nickname,pref1,pref2}` | 온보딩 각 단계 배선(구 `features/onboarding/containers/*Container`, TRIP-173 신설) |
| `SplashGate` | `app-shell` | 부트스트랩 결과 라우팅(구 `features/auth/containers/SplashGate`, TRIP-173 신설 — `src/app` 밖) |

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
- **홈에 실 데이터를 배선하려면** → 서버 API가 아직 없다(TRIP-170 범위 밖). `homeFixtures.ts`를 API 훅으로 교체하는 자리이며, `HomeScreen.tsx`에 `msw`·`@/mocks/*`를 직접 넣지 마라(`noMswInStaticGraph.test.ts`가 잡는다).
- **탭바 하단 인셋을 만지려면** → 전면 커스텀 탭바(74h)가 홈 인디케이터 기기의 bottom inset을 아직 합산하지 않는다(code-critic 경고2, 실기 이연 — 백엔드 부재로 실 홈 도달 불가해 미검증).
- **실 OAuth 실행·검증(AC-S7)** → 아직 **실행 불가**(TRIP-172 04b, FAIL 아님·환경 전제 부재). `ios/Podfile.lock`에 `ExpoAuthSession`·`ExpoWebBrowser`·`ExpoCrypto` 0건(설치된 dev build가 2026-07-20, 이 3종 추가 이전) + `.env.local`의 `EXPO_PUBLIC_AUTH_FAKE=1` 아직 켜짐 + google clientId 빈 값(`GOCSPX-` = 웹/데스크톱 유형이라 `trippilot://` 커스텀 스킴 등록 불가, iOS 유형 재발급 필요) + kakao/naver clientId 키 자체가 `.env.local`에 없음. 재개 순서는 리포 devlog `2026-07-24-20260723-trip172-social-real-wiring.md` 참조. jest 343건 green은 이 전제와 무관.
- **apple** → `oauthConfig`에 여전히 빈 슬롯(백엔드 fail-closed로 막아둠, 이번 범위 밖). **kakao/naver는 TRIP-172로 채워졌다** — naver는 `usePKCE:false`+`state` 필수인 비표준 갈래라 다시 만질 땐 `realAuthorize.ts`의 조건부 분기부터 확인.
- **연령확인(결함 B)을 만지려면** → `useSocialLogin.ts:154`의 `confirmAge()`가 **여전히 같은 `authorizationCode`로 재교환**한다 — OAuth 인가코드는 1회용이라 실서버에서 반드시 거부된다. 인터뷰에서 확정된 목표(로그인 버튼 하단 고지 문구, 모달 없음)가 AC로 전환되지 않아 이번 사이클에서 손대지 못했다(TRIP-172 04b §4). 다음 사이클 1순위 — 게이트①부터 새로 열어야 한다(화면 계약 + 기존 테스트 9건 변경 필요).
- **화면 비주얼** → `figma-screen-impl` 스킬 절차를 따른다. 밴드 맵은 `.claude/skills/spec-perception/reference/figma-structure.md`.
