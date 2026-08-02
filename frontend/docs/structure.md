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

**배제 규칙 — 무엇을 여기 적지 않는가**(2026-07-31 신설). 셋 중 하나에 걸리면 안 적는다:

1. **그래프·스크립트가 답하면** 안 적는다 — 파일 목록·export 심볼은 `structure-index.cjs` 소관이다.
2. **테스트가 red로 잡으면** 안 적는다 — 구조 가드·import 경계는 실패가 스스로 알린다.
3. **티켓이 닫히면 사라질 것이면** 안 적는다 — 미해결 부채는 문제로그·devlog로.

남는 것은 셋뿐이다: **부정 사실**(무엇이 없는가·그게 의도인가) · **지금 어디까지 왔나** · **기계 강제가 없는 계약**.

*유지 판정: 경고 절이 **12건을 넘으면** 위 셋 중 하나가 새고 있는 것이다 — scribe가 [기록]에서 건수를 세고 넘으면 무엇이 들어왔는지 보고한다. 6사이클 관찰 — 초과 보고가 실제로 항목을 걸러낸 건수 0이면 이 카운터를 뗀다.*

## 한눈에

- **스택**: Expo(development build + prebuild) · Expo Router · TypeScript strict · NativeWind · TanStack Query + Zustand · orval · Jest + fast-check
- **경로 별칭**: `@/*` → `./src/*`
- **구현 범위**: `auth`·`home`·`onboarding`·`stay`·`explore` **다섯 feature가 화면째 실구현**(`explore`는 TRIP-183에서 e00 지역 선택+'내 주변'으로 신설 — 이번 사이클[TRIP-197]에서 문서 소급 반영, 실제 구현은 그 사이클 산출물. 아래 `src/features/explore/` 절). `stay`는 TRIP-179(데이터 계층)·TRIP-180(`formatPrice`)·TRIP-181(e02 default 1상태)에 이어 **TRIP-182로 나머지 5상태**(loading·empty·filter-zero·partial-failure·error) + SafeArea 이관까지 붙어 **e02가 완결**됐다 — 아래 `src/features/stay/` 절. 나머지 자리는 도메인 작업이 시작될 때 새로 만든다 — TRIP-173 FSD 완결 2/4에서 참조 0인 빈 배럴(`export {}`) 14개를 전부 삭제했고, 그중 8개(`archive`·`execution`·`itinerary`·`notification`·`planb`·`settings`·`stay`·`trip`)는 디렉토리째 사라졌다(`stay`는 TRIP-179로 재등장).
- **화면이 아닌 공용 신설**: `shared/map/`이 TRIP-197로 처음 생겼다 — 카카오 지도 JavaScript SDK를 WebView에 얹는 브리지(화면이 아니라 지도 렌더 표면만, 소비 화면은 후속 e05 티켓). 아래 `src/shared/map/` 절.
- **서버 상태 계층 신설(TRIP-179)**: TanStack Query `QueryClientProvider`가 `src/app/_layout.tsx`에 배선됐다(모듈 스코프 단일 `QueryClient`, 기본 옵션 미조정). orval이 `backend/docs/design/openapi.yaml`의 `stays` 태그만 코드젠(`filters.tags`, 아래 경고 참조)해 `src/shared/api/generated/`에 8파일을 생성한다. 생성 코드는 전부 `src/shared/api/mutator.ts`(`customInstance`)를 거쳐 기존 `authedClient`(Bearer·401 single-flight 리프레시)를 탄다 — 새 인증 코드 0.
- **여행 생성 계약 계층 신설(TRIP-203)**: `src/features/trip/model/`이 처음 생겼다 — **화면은 없다**(여행 생성 위저드는 TRIP-205 몫, 이 칸은 훅·타입·조립 함수까지). orval이 `trips`·`preferences` 태그를 추가 코드젠해 생성물이 **17→49파일**로 늘었다(엔드포인트 12+2, 스키마 30개 신규) — 태그 단위 필터라 오퍼레이션 하나만 못 골라 다수가 소비자 0으로 동반 생성됐다. 아래 `src/features/trip/`·`src/shared/api/generated/` 절.
- **앱 런타임 목 0건.** msw는 테스트 오라클(`msw/node`)에만 있고, `src/__tests__/noMswInStaticGraph.test.ts`가 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제한다.
- **문서 대상 파일 143개** (병렬 배치된 `*.test.ts(x)`는 대상 소스 행이 대표하므로 제외. `src/__tests__/` 전역 가드는 독립 산출물이라 포함. TRIP-181로 +7 — `staySearchStructure.test.ts`·라우트·배럴·배선·화면·글리프·`stayKey.ts`. TRIP-182로 +5 — `staySearchState.ts`·`filterReasonLabel.ts`·`StateNotice.tsx`·`SkeletonList.tsx`·`PartialFailureBanner.tsx`. **TRIP-183으로 +17(이번 사이클 소급 반영)** — `explore` 4파일·`region-picker` 2파일·라우트 2파일 + `saved-stays` 코드젠 9파일(스키마 8·클라이언트 1, 소비자 0). **TRIP-197로 +6** — `shared/map` 3파일(공존 테스트는 co-located 대표 제외) + 전역 테스트 2파일 + `__mocks__/react-native-webview.tsx`. **TRIP-198로 +8 = 151** — `stay-register` 슬라이스 2파일 · 라우트 1 · `features/stay` 모델 2 + 화면 1 · 전역 가드 1 · 목 1. **TRIP-199는 +0 = 151 불변** — 신규 소스 파일 0개, 기존 6개 수정만(전부 위 행에 반영) + 신규 테스트 5개는 전부 co-located라 대표 행에 흡수. **TRIP-210으로 +5 = 156** — `kakaoAuthorize.ts`·`naverAuthorize.ts`(SDK 어댑터 2) · `nativeSocialSdkMock.ts`(목 인프라) · `socialSdkSecrets.test.ts`·`socialSdkConfigPlugin.test.ts`(전역 가드 2). `nativeSdkLazyBoundary.test.ts`·`makeAuthorize.nativeSdk.test.ts`·`useSocialLogin.tokenPath.test.tsx`는 전부 기존 소스와 co-located라 대표 행에 흡수. **TRIP-203으로 +35 = 191** — `features/trip/model` 3파일(테스트 3개는 co-located 흡수) + orval `trips`·`preferences` 코드젠 32파일(엔드포인트 2·스키마 30, 다수 소비자 0 — 아래 `src/shared/api/generated/` 절). **TRIP-204로 +2 = 193** — `features/trip/model/tripDraft.ts`(신규 소스, co-located `tripDraft.test.ts`는 대표 행에 흡수) + `__tests__/tripDraftBoundary.test.ts`(전역 가드 신규))

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
| `src/app/_layout.tsx` | 루트 레이아웃. 폰트 로드 게이팅 + 네이티브 스플래시 제어 + `GestureHandlerRootView` + `SafeAreaProvider`(null 대비 initialMetrics) + **`QueryClientProvider`(TRIP-179, `SplashGate` 바깥에 배선 — 향후 `SplashGate`가 `useQuery`로 바뀌어도 안전)** + `SplashGate` |
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
| `src/app/stays/index.tsx` | **신규(TRIP-181)** — `/stays` 라우트, `@/pages/stay-search` 배럴을 경유하는 얇은 래퍼(훅·마크업 0). `(tabs)` **밖**(탐색 탭의 하위 화면이라 탭 자체가 아님) — expo-router가 파일시스템 라우트를 자동 등록해 `SplashGate`의 어떤 `Stack.Protected` guard에도 안 걸린다. **실기로 확정**(04b 2차): 미인증 상태에서도 딥링크로 열린다(API 401이라 데이터 노출은 없음). 후속 티켓 + TRIP-183 선행 조건으로 유지 — 아래 경고 참조 |
| `src/app/stays/register.tsx` | **신규(TRIP-198)** — `/stays/register` 라우트, `@/pages/stay-register` 배럴 경유 얇은 래퍼(5줄, `app/stays/index.tsx`와 동형). 구조 가드가 `useState`·`useGetStaysGeocode`·`FlatList` 0건을 부정 단언으로 잠근다. `stays/index.tsx`와 같은 미인증 딥링크 노출 조건을 공유한다(아래 경고 참조 — 이번 사이클도 안 풀었다) |
| `src/app/explore/region.tsx` | **신규(TRIP-183, 이번 사이클 문서 소급 반영)** — d1b·e00 지역 선택 라우트. `@/pages/region-picker` 배럴을 경유하는 얇은 래퍼(9줄). 목적(`purpose`)은 쿼리 파라미터로 온다: `/explore/region`(기본 `stay`) · `?purpose=trip` |
| `src/app/explore/destination/[region].tsx` | **신규(TRIP-183) — ⚠️ 스텁("자리만").** 27줄, "{지역} 상세 / 준비 중이에요"만 렌더. `typedRoutes: true`라 목적지 파일이 없으면 `router.push('/explore/destination/…')`가 타입 단계에서 막혀 만든 자리다 — `frontend-components.md` §2 `DestinationDetail`의 실제 요구(인기 스팟 그리드 등)는 **밴드 d 티켓 몫**이라 하나도 안 만들었다 |

## `src/app-shell/` — 루트 셸 (TRIP-173 신설)

Expo Router가 `src/app`을 이미 점유해 비표준 이름을 썼다(01b Seed 확정) — `src/app` **밖**에 있다.

| 파일 | 역할 |
|---|---|
| `src/app-shell/ui/SplashGate.tsx` | 부트스트랩 결과에 따라 라우팅 결정(구 `features/auth/containers/SplashGate.tsx`). 향후 `QueryClientProvider` 등 앱 전역 프로바이더가 여기 모일 자리 |
| `src/app-shell/index.ts` | 배럴 — `SplashGate` 재수출. `src/app/_layout.tsx`가 이 배럴을 경유(딥 임포트 0건, code-critic E5 확인) |

## `src/pages/` — FSD pages 층 (TRIP-173 신설, 8슬라이스 — TRIP-181로 `stay-search`·TRIP-183으로 `region-picker`·**TRIP-198로 `stay-register` 추가**)

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
| `stay-search` | `src/pages/stay-search/ui/StaySearchPage.tsx` | **TRIP-181 신규 → TRIP-182로 확장**(22→61줄). `useLocalSearchParams`로 `region`(배열·빈 문자열 방어 후 `\|\|` 폴백 `'부산'`)에 더해 `amenity`·`stayType`도 읽어 `toParamList()`로 `string\|string[]→string[]` 정규화(빈 값은 파라미터 자체를 안 보냄) → `useStaySearch(...)` → **`resolveStaySearchState(...)`가 판정을 이 한 곳에서만 수행**(화면은 재판정 금지, 구조 가드로 잠금) → `<StaySearchScreen region items state onRetry={() => refetch()} />`. `data?.items?.length ?? 0`(03b W-3 수정 — `?.items.length`였다면 계약 위반 응답에서 크래시) |
| | `src/pages/stay-search/index.ts` | 배럴(`StaySearchPage` 재수출) — 게이트②에서 배럴 유지 vs 딥임포트 선택지 중 **배럴 유지 채택**(6슬라이스 중 5개가 배럴 관례라 일관성) |
| `stay-register` | `src/pages/stay-register/ui/StayRegisterPage.tsx` | **신규(TRIP-198)** — e05 등록 배선(182줄). 상태 8축(`query`/`submittedQuery` 분리·후보·좌표확정·지도시트·날짜범위·달력월·제출)을 전부 여기서 지고 무상태 화면에 `flow` 한 덩어리 + 콜백 13개로 내린다. `useGetStaysGeocode`는 `enabled: (submittedQuery ?? '').trim() !== ''`로 꺼 둔다(빈/공백 검색어가 서버 400 → 엉뚱한 "지도 장애" 문구가 되는 경로 차단, 5-b W-2). **재검색·후보 변경이 `coordConfirmed`를 반드시 푼다**(§3-2 가중치 1.0 — 'A의 좌표'에 'B의 이름'이 붙는 불일치 차단). 제출 진입에 `canSubmitStayRegister` 가드를 둔다(5-b B-1 — 버튼 `disabled`만으로는 실패 배너의 "다시 시도"가 통째로 우회했다). ⚠️ 여기는 `useRouter()` 훅을 쓰는데 `StaySearchPage`는 정적 `router` 싱글턴이다 — 설계 비대칭이 아니라 **각 페이지 통합테스트 목의 차이**가 원인이다(그쪽 동결 목이 `useRouter` 미제공) |
| | `src/pages/stay-register/index.ts` | 배럴(`StayRegisterPage` 재수출) |
| `region-picker` | `src/pages/region-picker/ui/RegionPickerPage.tsx` | **신규(TRIP-183, 이번 사이클 문서 소급 반영)** — 지역 선택 배선(106줄). URL `purpose`는 신뢰 경계로 취급(`'trip'`이 아니면 전부 `'stay'`로 결정론적 폴백) → `resolveNearby(...)` 호출 → 성공 시 `router.push('/stays?lat=&lng=')`(**`radiusKm` 미포함** — 서버 기본값 5km에 위임, TRIP-202와 접점). 저장 숙소 좌표는 `coordConfirmed === true`인 것만 '내 주변' 거점 후보로 인정(미확정 좌표 배제, INV-U1-08과 같은 취지) |
| | `src/pages/region-picker/index.ts` | 배럴 — `RegionPickerPage` 재수출 |

> **⚠️ 배럴 경유는 지금 관행일 뿐 강제되지 않는다** — 라우트 5개는 전부 배럴을 경유하지만(위반 0건), 승인 테스트(`fsdStructure.test.ts`)의 단언이 `toContain`(부분 문자열)이라 딥 임포트로 바꿔도 잡히지 않는다(code-critic 참고-1 실측). 회귀 방지는 승인 테스트 수정이 필요해 사이클 3 몫으로 이관됨. `region-picker`도 이 관행을 따른다(강제는 `fsdStructure.test.ts`의 pages 슬라이스 **7개 완전일치** 집합 단언뿐 — `PAGE_SLICES` forEach 상수 자체는 여전히 로그인·온보딩 5개만 대상, region-picker·stay-search는 그 forEach 밖).

## `src/features/auth/` — 실구현 ①

**계층 개명(TRIP-173)**: `ui`(프레젠테이션, 구 `screens`+`components`) → `model`(상태·훅, 구 `hooks`) → `lib`·`config`(순수 로직/설정, 구 `lib`가 둘로 분리). 배선(구 `containers`)은 `pages/login/ui/LoginPage.tsx`로 이동했다(위 절 참조).

| 파일 | 역할 |
|---|---|
| `src/features/auth/ui/SplashScreen.tsx` | 스플래시 비주얼 (프레젠테이션 전용) |
| `src/features/auth/ui/SocialLoginScreen.tsx` | 소셜 로그인 비주얼 (props 8개 순수 컴포넌트). 에러 배너 조건이 **블랙리스트**(연령제한·이메일충돌 전용화면 2종만 제외, 나머지는 phase가 `'error'`면 전부 배너 — TRIP-172 결함 F, INV-4). ⚠️ 하단 고지 문구는 여전히 기존 약관 문구뿐 — 결함 B(연령 고지 문구) 반영 안 됨. **TRIP-173 FSD 완결 4/4**(Figma `c02-social-login` `1284:1208` 정합) — 카카오 라벨 한글화(`카카오로 계속하기`) · 소셜 버튼 라벨 Bold화 · 에러 배너 재구성(배경 `bg-primary-pale`+모서리+`WarningTriangleGlyph`, 구 회색 텍스트 한 줄에서 교체). `SocialLoginScreen.visual.test.tsx`가 AC-V1~V3을 **렌더 층**(`within` 스코프)에서 잠금 — 소스 스캔은 위치를 못 봐서 안 씀(개념 [[가드의 사정거리]] 실측 6). ⚠️ 카카오 라벨 한글화로 충돌 시트(`이미 kakao 로그인으로`)와 표기가 갈라짐 — [[2026-07-28 카카오·kakao 표시명 불일치]] |
| `src/features/auth/model/useBootstrapGate.ts` | 앱 시작 시 토큰 복원(`hydrate`가 첫 조회보다 선행) · 잠정/확정 분기. `BOOTSTRAP_TIMEOUT_MS` 포함. 로그인 성공(토큰 변경)을 `subscribeAccessToken`으로 구독해 재조회한다(TRIP-172 결함 A) — 구독은 첫 왕복이 끝난 뒤에만 건다 |
| `src/features/auth/model/useSocialLogin.ts` | 소셜 로그인 흐름(PKCE · single-flight, `phaseRef` 잠금). `'exchanging'` phase 신설, `authorize()` reject는 `phase='error'`(INV-4)로 표면화(TRIP-172 결함 E). 성공 시 `saveTokens` + `setAccessToken` 둘 다. **TRIP-210** — `AuthorizeResult` 성공 판별자가 `'success-code'`/`'success-token'` 둘로 갈렸고(D1), `PendingExchange` 태그드 유니온으로 `postSocialLogin`(code)/`postSocialTokenLogin`(token) 두 엔드포인트를 분기한다. `confirmAge()` 재전송도 같은 태그를 유지한 채 `ageConfirmation`만 덧붙임. ⚠️ **결함 B는 code 갈래(google)에만 남는다** — `confirmAge()`가 같은 `authorizationCode`를 재전송하는데 인가코드는 1회용이라 실서버가 거부한다(:154 부근). **token 갈래(kakao·naver)는 accessToken이 재사용 가능해 이 결함을 우연히 비껴간다**(재전송이 실서버에서 성립하는지는 L2 미검증) |
| `src/features/auth/model/resolveBootstrapDestination.ts` | **순수 함수** — 부트스트랩 상태 → 목적지. `AUTHENTICATED`는 `onboardingCompleted`로 `HOME`/`ONBOARDING` 분기(TRIP-172 — 서버에 `ONBOARDING_INCOMPLETE` 상태 자체가 없다, D7) |
| `src/features/auth/lib/makeAuthorize.ts` | authorize 팩토리(DI 주입점). **제자리**(TRIP-173에서 안 옮김). **TRIP-210으로 갈래 확장** — fake 토글 on→fake / off+kakao+`EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY`→`kakaoAuthorize` **동적 import** / off+naver+`EXPO_PUBLIC_NAVER_URL_SCHEME`→`naverAuthorize` **동적 import** / 그 외(google 포함)+clientId→`realAuthorize` 동적 import / 설정없음→throw(INV-4). ⚠️ 네이버 게이트가 `CLIENT_SECRET`이 아니라 `URL_SCHEME`인 것은 `socialSdkSecrets.test.ts`의 "시크릿 env를 읽는 프로덕션 파일은 정확히 1개" 단언을 피하려는 선택이라 **테스트 안에서만** 두 env가 동등하다 — Android는 `URL_SCHEME`을 안 쓰므로(SDK Android `initialize`엔 scheme 파라미터가 없다) Android 위주 env 설정 시 네이버가 조용히 `realAuthorize`(code 경로)로 강등될 수 있다(code-critic 참고3, 후속 티켓 후보) |
| `src/features/auth/lib/kakaoAuthorize.ts` | **신규(TRIP-210)** — 카카오 SDK(`@react-native-seoul/kakao-login`)를 **정적 import하는 유일한 파일**. `login()` 성공 → `{type:'success-token', accessToken}`. 취소 판별은 **message 접두어 문자열 매칭**(`message.startsWith('ClientFailed(Cancelled)')`) — SDK가 취소·실패를 구분하는 타입/코드를 안 주고 message 고정 포맷에만 정보가 있다(iOS `RNKakaoLogins.swift` 실측). ⚠️ **이 판별은 iOS 포맷 실측에만 근거한다 — Android는 `describe()` 래핑이 없어 원문 메시지 포맷이 다르고 미검증이다**(`ponytail:` 주석 있음, 후속 티켓 후보) |
| `src/features/auth/lib/naverAuthorize.ts` | **신규(TRIP-210)** — 네이버 SDK(`@react-native-seoul/naver-login`)를 **정적 import하는 유일한 파일**. `initialize()`(consumerKey=기존 `EXPO_PUBLIC_NAVER_CLIENT_ID` 재사용 · consumerSecret=`EXPO_PUBLIC_NAVER_CLIENT_SECRET`, D5 시크릿 예외) → `login()`. 취소는 카카오와 달리 **resolve + `failureResponse.isCancel` 불리언**(reject 아님, SDK 소스 실측) |
| `src/features/auth/lib/realAuthorize.ts` | **`expo-auth-session`을 참조하는 유일한 프로덕션 파일.** **제자리**(TRIP-173에서 안 옮김). `AuthRequest`가 이제 `config.usePKCE`를 그대로 쓴다(naver만 false). PKCE 미사용 시 `codeVerifier`가 빈 문자열 대신 `generateOpaqueToken()` 대체값(백엔드 `@NotBlank` 회피, TRIP-172 결함 C). naver는 `state`도 직접 생성 — 둘 다 암호학적으로 안전한 난수는 아님(참고 #2, 실기 전 `expo-crypto` 교체 검토). **TRIP-210부터 google 전용 경로 + kakao·naver의 SDK env 미설정 시 폴백**(D1 개명 반영, `'success'`→`'success-code'`) |
| `src/features/auth/config/oauthConfig.ts` | provider별 OAuth config를 **env에서** 읽음(`EXPO_PUBLIC_{GOOGLE,KAKAO,NAVER}_*`). discovery 정적 하드코딩. **google·kakao·naver 채움**(TRIP-172), **apple만 빈 슬롯**(백엔드 fail-closed). naver는 `usePKCE:false` + `requiresState:true`(PKCE 미지원). 네이티브 의존 0 |
| `src/features/auth/config/gradients.ts` | 그라디언트·앱아이콘 색 상수. **TRIP-173 FSD 4/4** `AUTH_ICON_COLORS`(경고 글리프 색, `warning: '#C13515'` = tailwind `primary-text`) 추가 — `fsdStructure.test.ts:252`가 `auth/config/` 파일 목록을 완전일치 앵커해 새 파일 대신 이 모듈에 얹음(재사용 공개 API 표에도 등재) |
| `src/features/auth/ui/AuthGlyphs.tsx` | 인라인 SVG — 앱아이콘 · 소셜 4종 로고 · **TRIP-173 FSD 4/4 신설** `WarningTriangleGlyph`(18×18 경고 삼각형 — `LocationInfoGlyph` 형태 선례 그대로, 색은 `AUTH_ICON_COLORS.warning` 경유, Figma 원본과 `d=`·색·굵기 글자 그대로 일치). `strokeWidth`·렌더 크기(`size`) 부분 회귀는 `loginVisual.test.ts`가 잠금(개념 [[가드의 사정거리]] 실측 6) |
| `src/features/auth/ui/SplashIllustration.tsx` | 인라인 SVG — 스플래시 일러스트 |

> `src/features/auth/` 아래 `index.ts`는 여전히 **존재하지 않는다** — 이제 이게 표준이다. 배럴 신설 계획("사이클 3")은 폐기됐다(그 유예가 가리키던 사이클 3은 폐기된 FSD 이주 11사이클 계획의 것). TRIP-173 FSD 완결 2/4에서 home·onboarding의 빈 배럴 14개를 전부 삭제하며 방향이 뒤집혔다 — **구현 슬라이스는 배럴 없이 간다.**

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

## `src/features/home/` — 실구현 ③ (TRIP-170)

계층: `model`(순수 타입·상수) → `ui`(화면+전용 글리프, TRIP-173 FSD 완결 1/4에서 `screens`·`components` 2칸이 합류). **컨테이너·훅 없음** — 서버 API 부재로 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0).

| 파일 | 역할 |
|---|---|
| `src/features/home/model/homeTypes.ts` | prop 계약 타입 — 판별 유니온 `HomeSections`(`ready`/`empty`/`loading`) 포함 |
| `src/features/home/model/homeFixtures.ts` | 4상태 고정 목업(Q2 — Figma 표시값 그대로 상수화). `HOME_DEFAULT_PROPS`·`HOME_NO_TRIP_PROPS`·`HOME_EMPTY_PROPS`·`HOME_LOADING_PROPS` |
| `src/features/home/ui/HomeGlyphs.tsx` | 홈 전용 인라인 SVG 10종(AuthGlyphs/OnboardingGlyphs 패턴). raw hex 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일과 **같은 폴더가 됐다.** D-3 가드(`homeStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`HOME_SCREEN_SOURCE_FILES` 동결목록으로 1건 고정, code-critic W-1 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
| `src/features/home/ui/HomeScreen.tsx` | 4상태 프레젠테이션 화면. props만 받음 — `expo-router`·`@/shared/api`·타 feature import 0(homeStructure D-1이 기계 강제) |

## `src/features/stay/` — 화면째 실구현 ④ (TRIP-179·180·181·182)

TRIP-173에서 빈 배럴과 함께 디렉토리째 삭제됐다가, TRIP-179가 서버 상태 배관(계약 동기화 + `QueryClientProvider` + 도메인 훅)의 첫 소비자 자리로 다시 만들었다. TRIP-181로 첫 소비 화면(e02 default, items 1건 이상)이 붙었고, **TRIP-182로 나머지 5상태(loading·empty·filter-zero·partial-failure·error) + SafeArea 이관이 붙어 e02가 완결**됐다 — 판정은 순수 함수 `resolveStaySearchState`(판별 유니온 `StaySearchState`), 부품은 `StateNotice`(empty·filter-zero·error 공용) · `SkeletonList`(loading) · `PartialFailureBanner`(partial) 4개로 나뉜다(5블록으로 옮기지 않았다).

| 파일 | 역할 |
|---|---|
| `src/features/stay/model/useStaySearch.ts` | 생성 훅(`useGetStaysSearch`)을 도메인 이름으로 재수출하는 얇은 층(몸통 1줄). params를 그대로 전달만 — 오류 정규화·기본 파라미터 가공 0(D6, 소비 화면 부재로 명시적 이연 — TRIP-181이 처음 소비했지만 이연 자체는 안 풀림). 존재 이유는 "생성물 경로(`orval.config.ts` 설정이 만들어 내는, `mode`·태그가 바뀌면 흔들리는 경로)를 한 곳에 가둔다"는 것이지 "나중에 계약을 더할 자리"가 아니다(게이트②에서 근거 교체) |
| `src/features/stay/model/formatPrice.ts` | 순수 함수(TRIP-180) — 최저가 스냅숏(`StayPrice \| null \| undefined`)을 카드 문자열로 변환. 없음 → `'가격 미확인'`, 있음 → `'{천단위구분}원~'`. `currency` 미참조·시계/네트워크/저장소 미접근. 존재 판정은 `price == null`(falsy 아님 — `amount: 0`을 지키기 위해). 천단위 구분은 `toLocaleString`/`Intl` 대신 결정론적 정규식 조립(node↔Hermes 로케일 갈림 회피). **TRIP-181이 첫 호출자**(`StaySearchScreen.tsx`가 반환값을 그대로 씀, `· 1박` 접미 없음) |
| `src/features/stay/model/stayKey.ts` | **신규(TRIP-181)** — 순수 함수 `` stayKey(item) = `${externalSource}:${externalId}` ``. 계약(`StayItem`)에 `stayId` 필드가 없어(정본 침묵) 직접 합성. React `keyExtractor`와 testID(`stay-card-{key}`·`stay-card-save-{key}`)의 **유일한 출처** — 화면 소스는 `item.externalId`를 직접 안 쓴다(소스 스캔이 반대증명으로 잠금) |
| `src/features/stay/model/staySearchState.ts` | **신규(TRIP-182)** — 판별 유니온 `StaySearchState`(`loading`\|`error`\|`results`\|`filter-zero`\|`empty` 5종, `partial-failure`는 `results.degraded===true`로 인코딩) + 순수 함수 `resolveStaySearchState`(우선순위: pending→error→results→filter-zero→empty). 콜백·`undefined` 방어 없음 — PBT 대상(fast-check, numRuns 500) |
| `src/features/stay/model/filterReasonLabel.ts` | **신규(TRIP-182)** — 순수 함수. `filterZeroReasons` 코드(`amenity:조식` 등) → 한글 표시명. 콜론 뒤 값이 있으면 그 값, 없으면 축 사전(`stayType`·`amenity` 2줄), 모르는 축은 코드 그대로 폴백 |
| `src/features/stay/model/stayDates.ts` | **신규(TRIP-198)** — 달력·날짜 순수 함수 8개. 공개: `daysInMonth`·`firstWeekdayOfMonth`·`shiftMonth`·`nightsBetween`·`isDateInRange`·`isStayRangeValid`·`applyDatePick`·`commitDateRange` + 타입 `StayDateRange`. 박수는 항상 **에포크 일수(UTC 정수)** 차로 계산해 로컬 타임존에 따라 하루가 밀리는 것을 막는다. `applyDatePick`은 결과가 "체크인만(대기)" 아니면 "checkOut > checkIn"뿐이라 **역전·같은 날 범위를 구조적으로 만들 수 없다**(AC-4를 검사가 아니라 형태로 막는다). `shiftMonth`는 5-b W-1 수복분(달력이 한 달만 그려 월말엔 어떤 범위도 못 골랐다) — 개월 총합 환산이라 12월↔1월 분기가 없다. ⚠️ **`isStayRangeValid`는 한쪽만 있어도 `true`다**(날짜가 선택 항목이라 의도된 것) — 반쪽 상태를 막는 유일한 장치가 `commitDateRange` 한 곳이라는 것이 5-b N-4의 지적이고, **미룸 상태다**(후속 티켓 후보) |
| `src/features/stay/model/stayRegisterForm.ts` | **신규(TRIP-198)** — 등록 폼 판정·조립. 공개: `stayRegisterSchema`(zod)·`canSubmitStayRegister`·`buildStayRegisterRequest` + 타입 `StayRegisterFlow`. **zod가 맡는 것은 날짜 순서 한 규칙뿐**이고(`.refine` → `isStayRangeValid`), 요청 본문의 모양은 orval 생성 타입 `RegisterSavedStayRequest`가 타입 단계에서 잠근다 — 둘을 섞지 말 것. `canSubmitStayRegister`는 좌표 게이트(`selectedCandidate`·`coordConfirmed`·`submitStatus`)를 **zod보다 먼저 `if`로** 본다(AC-3은 서버 400 의존을 위반으로 규정하므로 클라이언트가 진짜로 막아야 하는 유일한 규칙). `buildStayRegisterRequest`는 날짜 둘 다 있을 때만 키를 붙인다(`checkIn: null` 전송과 키 부재는 서버에 다른 뜻, AC-5). **`registerRoute`는 TRIP-199부터 `flow.coordSource`(`'MAP_SEARCH'`\|`'PIN'`)를 그대로 옮긴다**(이전엔 `'MAP_SEARCH'` 고정이었음) · **신규(TRIP-199)** `resolveName` export — 이름 후보 둘(사용자 입력·카카오 건물명) 중 서버 요청 `name`에 넣을 하나를 정하는 규칙(트림된 입력 우선, 없으면 건물명, 둘 다 없으면 빈 문자열). 게이트·조립·화면 안내 세 곳이 같은 함수를 써야 이름 판정이 갈라지지 않는다(export 안 하고 각자 복사하면 W-2/W-4류 드리프트 재발) |
| `src/features/stay/ui/StayRegisterScreen.tsx` | **신규(TRIP-198)** — e05 무상태 프레젠테이션(605줄). `flow`·`today` 2개 + 콜백 13개만 받고 **상태·네트워크·라우팅을 전혀 모른다**. `today`를 주입받는 이유는 결정론(화면이 `new Date()`를 부르면 테스트가 실행일에 흔들린다). 로컬 함수 6개(`RegisterTabs`·`CandidateSkeleton`·`SearchFailBlock`·`CandidateList`·`CalendarSheet`·`MapSheet`). 지도는 `@/shared/map`의 `KakaoMapView` 재사용(후보 N핀 미구현, Seed §3-3) — **시트가 열리면 인라인 미리보기를 숨겨 WebView 마운트를 실질 1개로 유지**한다. `coordConfirmed`를 true로 만드는 것은 시트 안 「이 위치로 확인」 버튼 하나뿐이고, 지도 실패 시 같은 testID의 「이 주소로 확인」 폴백이 그 자리를 대신한다(INV-4 — 지도 장애로 등록이 막히지 않는다). 실패 배너의 「다시 시도」에도 `disabled={!canSubmit}`가 걸려 있다(5-b B-1 이중화 — 페이지는 "안 나가게", 화면은 "잠긴 게 보이게"). **TRIP-199부터 핀 지정 탭은 활성**(지도 검색과 동일 계열 표기) — 링크 붙여넣기 탭만 "준비 중" 라벨과 함께 잠긴 채 보인다(`/stays/parse-link` 계약 미존재, BR-U1-21). 핀 지정 탭은 `PinPanel`(인라인 196px 지도 + 롱프레스 + 확정 시트 재사용)로 구현되며, `onMapMessage`로 `PIN_DROP`·`GEOCODE_OK`·`GEOCODE_FAIL`을 받아 `pinAddressStatus`(`idle`\|`loading`\|`success`\|`error`) 4상태로 안내를 그린다. 픽셀 충실도(간격·그림자·앱바)는 이 계약이 안 잠근다 — figma-screen-impl 루프 몫. 핀 탭은 Figma 전용 프레임이 없어 픽셀 대조 기준 자체가 없다(AC-V4 폐기) |
| `src/features/stay/ui/StaySearchScreen.tsx` | **TRIP-181 신규 → TRIP-182로 5상태+SafeArea 확장**(186→382줄). `region`·`items`에 옵셔널 `state?: StaySearchState`·`onRetry?: () => void` 2개 추가(기본값 있어 2-prop 호출도 여전히 green — AC-9 회귀 보호). 루트가 **`View`에서 `SafeAreaView edges={['top']}`로 교체**(TRIP-181 SafeArea 결함 해소, testID `stay-search-root`는 안쪽 `View`가 유지). 로컬 함수 5개 신설(`RegisterPromptCard`·`EmptyBlock`·`FilterZeroNotice`·`ErrorNotice`·`ListEmptyBlock`) — `FlatList`의 `ListHeaderComponent`(헤더+`degraded`면 배너)·`ListEmptyComponent`(`state.kind`별 안내) 기존 두 슬롯에 얹었다(새 분기 골격 없음). `contentContainerStyle={{flexGrow:1}}` + 안내 3종 `flex-1 justify-center`로 filter-zero·error 세로 중앙정렬(정본 §6 함정1 해소, 5-c). 카드 순서는 서버 응답 순서 그대로(BR-U1-15, `.sort()`/`.filter()` 없음). 필터 칩 3개·저장 하트·수동등록 3버튼(Q7)은 **시각 스텁**(누름 배선 0, "정직한 스텁") |
| `src/features/stay/ui/StateNotice.tsx` | **신규(TRIP-182)** — `empty`·`filter-zero`·`error` 3상태 공용 안내 블록. 원형 배지(아이콘은 호출부가 넘김) + 제목 + 부제 + 버튼 N(`variant: outline\|filled\|link`), `dashed?`로 empty만 점선 박스 |
| `src/features/stay/ui/SkeletonList.tsx` | **신규(TRIP-182)** — `loading` 전용. 라벨(`숙소를 모으는 중`) + 세로형 스켈레톤 카드 2장(Q11 — 신 default 세로 카드 재해석, Figma 구 프레임 가로 4장은 미채택) |
| `src/features/stay/ui/PartialFailureBanner.tsx` | **신규(TRIP-182)** — partial-failure 배너. 경고 삼각형 + 본문 + `다시 시도`(Pressable, `onRetry` 직결). 컨테이너 자신은 Pressable이 아님(press 버블링 함정 회피) |
| `src/features/stay/ui/StayGlyphs.tsx` | **TRIP-181 신규 4종 → TRIP-182로 4종 추가**(110→232줄). TRIP-181: `BackChevronGlyph`·`ChevronDownGlyph`·`FilterSlidersGlyph`·`HeartOutlineGlyph`. **TRIP-182 추가**: `WarningTriangleGlyph`(파라미터화된 `tone: 'ink'\|'primary'`로 배너 20px·error 배지 32px 겸용)·`MapPinGlyph`·`PlusGlyph`·`ChevronRightGlyph` — 전부 Figma 벡터 path 실측(근사 안 함). 다른 feature 글리프를 재사용하지 않고 새로 그렸다(features 간 직접 import 금지 관례 — `eslint.config.js`의 `FEATURES` 배열엔 `stay`가 없어 기계 강제는 없지만 소스 스캔 가드가 대신 잡는다). ⚠️ 이 파일은 raw hex 가드(`SCREEN_FILES`) 스캔 **밖**(아래 "지금 작업하려면" 경고 참조). ⚠️ **P1 미처리 발견(04b)**: `FilterSlidersGlyph`(filter-zero 배지)만 색 prop이 없어 먹색으로 남음 — Figma 정본은 분홍, 후속 티켓 P1 일괄분 이월 |

## `src/features/explore/` — 실구현 ⑤ (TRIP-183, 이번 사이클 문서 소급 반영)

d1b·e00 지역 선택 + '내 주변' 진입점. **컨테이너 없음** — 배선은 `src/pages/region-picker/`(위 절)가 갖는다.

| 파일 | 역할 |
|---|---|
| `src/features/explore/model/regions.ts` | 지역 상수 6개(`RegionCode`·`Region` — `code`는 testID·라우팅용 ASCII, `name`은 표시 라벨 **겸 서버 질의값**, 두 필드로 나눈 이유는 testID에 한글을 안 쓰기 위해) + 클라이언트 필터 `filterRegions`(빈 질의=전체, 불일치=빈 배열 — 전체로 되돌리면 필터가 고장난 것처럼 보임). `GET /regions` 계약 자체가 없고, **있어도 지금은 소용없다** — 백엔드 콘텐츠가 `StubJejuContentAdapter`의 제주 고정 5곳뿐이라 반환값이 `["제주"]` 하나 |
| `src/features/explore/model/resolveNearby.ts` | **이 슬라이스의 판정 본체.** `NearbyDeps`(권한 요청·현재 위치·등록 숙소 좌표 3개를 인자로 주입받는) 순수 함수 — 훅이 아니라 의존성 주입 방식이라 `expo-location`·서버 목킹 없이 7분기 전수 검사 가능. 우선순위 **현재 위치 > 등록 숙소 > 없음**, 모든 실패 경로가 예외를 밖으로 안 던짐(INV-4, `safeSavedStayCoords`가 `try/catch`). `Coords`·`NearbyDeps`·`NearbyResult`도 여기서 export — ⚠️ `shared/map`(TRIP-197)이 좌표 타입을 쓰게 되면 이 `Coords`를 `shared`로 승격할지가 열린 질문(README §61 "`shared/`는 `features/`를 모른다" 충돌, TRIP-197 01_brief Q4가 이번엔 "타입 안 씀"으로 비켜감 — 미해결) |
| `src/features/explore/ui/ExploreGlyphs.tsx` | 인라인 SVG 4종(백 셰브론·검색·주변 핀·정보) |
| `src/features/explore/ui/RegionPickerScreen.tsx` | e00·d1b 화면(props만, 222줄). `purpose: 'stay'\|'trip'`로 카피·다음 이동만 갈라짐(`COPY` 상수 표가 BR-U1-07 구현 그 자체) · `purpose==='stay'`일 때만 '내 주변' 렌더(US-STAY-01) · 지역 사진은 이미지 에셋 0건(실측)이라 `REGION_TINT` 그라데이션으로 대체(에셋 오면 교체 예정, 주석에 명시) · `@/shared/api`·쿼리 훅·`expo-location` import 0(프리뷰 동결 테스트가 전이 의존까지 잡음) |

**알려진 한계(숨기지 않음)**: ① '내 주변'이 대체 좌표(등록 숙소)로 이동했다는 고지가 결과 화면(e02)까지 안 이어진다(뒤로 오면 문구가 보이는 정도) — e02에 파라미터·배너를 더해야 하는 후속 티켓 ② d03 목적지 상세는 위 `[region].tsx` 스텁 그대로 ③ 집계(숙소 수·최저가) 없음(계약 없음, US-EXPL-02 예외항이 이미 규정) ④ `shared/location/LocationPreprompt.tsx`(권한 사전 안내 143줄)를 여전히 안 씀 — e00 동선에 그 자리가 Figma에 없음.

## `src/features/trip/` — 계약 계층만, 화면 없음 (TRIP-203)

**여행 생성 위저드(TRIP-205)가 아직 없다** — 이 슬라이스는 `model/`뿐이고 `ui/`가 없다. 서버 계약(orval `trips`·`preferences` 태그)을 도메인 이름으로 감싸는 얇은 층까지가 이번 칸이다. `useStaySearch`(TRIP-179) 선례를 그대로 반복 — 몸통이 짧은 이유는 게으름이 아니라 그 선례가 "생성물 경로를 한 곳에 가둔다"로 근거를 굳혀 둔 형태를 따른 것.

| 파일 | 역할 |
|---|---|
| `src/features/trip/model/createTripRequest.ts` | `CreateTripInput` 타입(`= Omit<CreateTripRequest, 'budgetTotal'\|'preferenceSnapshot'>`) + 순수 함수 `buildCreateTripRequest(input, preference)`. `preference?.budget?.rawAmount`가 **숫자일 때만**(`typeof === 'number'`, `0`도 유효값으로 지킴) `budgetTotal` 키를 붙이고, `preferenceSnapshot`은 **런타임으로 걷어낸다**(`{...input}` 스프레드 전에 구조 분해로 제거 — `Omit`은 타입 선언일 뿐이라 그것만으론 안 지켜졌다, code-critic W-1 → 5-c 수정) |
| `src/features/trip/model/useCreateTrip.ts` | `useCreateTrip()` — 생성물 `usePostTrips`를 그대로 반환하되 `onSuccess`에서 `invalidateQueries({queryKey: getGetTripsQueryKey()})` 한 줄만 얹는다(`GET /trips` 목록만 무효화, 취향 조회는 그대로 둠). ⚠️ 호출자가 `mutateAsync({ data: request })`처럼 생성물의 `{ data: }` 봉투를 그대로 봐야 하고, **그 경로로 `buildCreateTripRequest`를 우회해 `preferenceSnapshot`을 직접 실어 보내도 막는 장치가 없다**(code-critic W-2, 후속 티켓 후보 — 아래 "지금 작업하려면"이 아니라 devlog 인수인계 소관) |
| `src/features/trip/model/usePreferencePrefill.ts` | `usePreferencePrefill()` — 생성물 `useGetMePreferences`를 그대로 반환하는 1줄. `features/onboarding/model/preferenceStore.ts`의 `usePreferenceStore`(로컬 드래프트, persist 없음, 서버 미전송)와 이름이 비슷하지만 다른 물건 — 이쪽은 서버가 이미 저장한 취향을 읽는다 |
| `src/features/trip/model/tripDraft.ts` | **신규(TRIP-204)** — 위저드 드래프트 검증 순수 함수 3개 + 타입 2개(`TripDraft`·`TripViolationCode`). `validateTripDraft`는 위반 코드 **집합**(중복 없음, 순서 무계약)을 돌려준다 — `NO_DESTINATION`·`END_BEFORE_START`·`NIGHTS_EXCEED_PERIOD`·`PARTY_BELOW_ONE` 4종 고정(계약에 없는 판정은 발명하지 않음, 01b D4). `nightsSum`은 Σ박수, `toCompanionType`은 온보딩 5값→서버 `CompanionType` 4값 매핑(`Map` 기반, `부모님→null`). 화면 없음(TRIP-205 몫) — AC-8을 `tripDraftBoundary.test.ts`(전이 의존까지)가 잠근다. **5-c에서 페일오픈→페일클로즈로 반전**(판독 불가 날짜·`NaN` nights가 조용히 "통과"로 무너지던 것을 비교 방향 반전으로 닫음 — `tripDraft.ts:31-39`·`:57-77` 주석 참고) |

## `src/features/` — 아직 시작 안 한 도메인

TRIP-173 FSD 완결 2/4에서 참조 0인 빈 배럴(`export {}` 한 줄) 14개를 `git rm`으로 전부 삭제했다. 그중 8개(`archive`·`execution`·`itinerary`·`notification`·`planb`·`settings`·`stay`·`trip`)는 그 배럴이 디렉토리 안의 유일한 파일이라 **디렉토리째 사라졌다** — `stay`는 위 절대로 TRIP-179로 재등장(데이터 계층만). 지금 `src/features/`에는 `auth`·`home`·`onboarding`·`stay` 4개뿐이다.

새 도메인을 시작할 때 빈 배럴부터 만들지 않는다 — **`auth`가 선례**다: 배럴 없이 딥 임포트로 시작하고, 재수출할 공개 API가 실제로 생기면 그때 배럴을 만든다. `export {};`만 있는 선점은 `fsdStructure.test.ts`의 AC-4(아래 테스트 인프라 절)가 기계로 막는다.

## `src/shared/`

| 파일 | 역할 |
|---|---|
| `src/shared/api/index.ts` | **구현됨** — axios 인스턴스 · 인터셉터 · 토큰 갱신 · 서버 호출 전체. `authedClient` 인스턴스가 온보딩 5종 + `fetchBootstrap`(TRIP-172 결함 A-2, 이전엔 무인증 `baseClient`였음)을 인증 경로로 보낸다. `SERVER_ERROR_CODE_TRANSLATIONS`가 서버 실코드→프론트 계약 코드 번역표(현재 `AGE_REQUIREMENT_NOT_MET`→`AGE_NOT_MET` 1건, `normalizeSocialError`의 `??` 결과값에 적용 — 승인 테스트가 이 표를 겨냥하지 않아 미검증). `authedClient`는 **TRIP-179에서 처음 export**됐다(가시성만 변경, 새 심볼 아님 — `mutator.ts` 전용) |
| `src/shared/api/mutator.ts` | **신규(TRIP-179)** — orval이 생성한 클라이언트(`generated/**`)가 실제 HTTP 호출에 쓰는 단일 범용 함수(`customInstance`). `authedClient`를 그대로 얹고(새 인증 코드 0), `paramsSerializer: { indexes: null }`로 배열 쿼리를 브래킷 없이 직렬화(`amenity=A&amenity=B` — Spring `@RequestParam List<String>` 계약), `response.data`만 반환(AxiosResponse 껍질 벗기기). 오류 정규화는 안 거친다(그대로 위로 흘려보냄 — D6 이연) |
| `src/shared/api/tokenManager.ts` | **구현됨** — 동기 in-memory 액세스토큰 홀더. SecureStore(비동기)와 공존, 인터셉터가 동기로 읽는다. `subscribeAccessToken`으로 토큰 변화를 구독 가능(TRIP-172, 값이 실제로 바뀔 때만 통지 — 동등비교 가드) |
| `src/shared/storage/index.ts` | **구현됨** — expo-secure-store 토큰 저장소. `hasStoredToken`은 **accessToken 존재만 판정**한다(`getItemAsync(ACCESS_TOKEN_KEY) != null` — refreshToken만 없는 부분 저장도 true). TRIP-173 재작성 3/8에서 실수로 "두 토큰 다 있어야 true"로 좁혀졌다가(콜드스타트 폴백이 HOME→LOGIN으로 뒤집힘) code-critic이 잡아 원복됨 — 이 함수를 실제로 도는 테스트가 리포에 없어 재발해도 362건이 그대로 green이니 다음에 손댈 때 주의 |
| `src/shared/version/compareVersion.ts` | **구현됨** — 버전 비교(강제 업데이트 판정) |
| `src/shared/location/LocationPreprompt.tsx` | **전체화면**(레이더 히어로·denied 전용 레이아웃 — 카드형은 폐기됐고 내부 마크업만 전면 교체, props/testID 시그니처 무변경). `default`/`permission-denied` 2상태. `expo-location`을 import조차 안 함(구조적으로 OS 다이얼로그 못 부름). **라우트 미등록**(실사용처 0, 프리뷰 전용) |
| `src/shared/location/LocationGlyphs.tsx` | 인라인 SVG — 위치 화면 글리프(레이더 히어로·오프 타일). stroke/fill 색은 `locationColors.ts` 상수 경유(`shared/location/**` 는 F2 raw-hex 가드 대상) |
| `src/shared/location/lib/locationColors.ts` | 위치 글리프 색 상수(raw hex 분리 — `gradients.ts` 패턴 재사용). 토큰 색과 수동 동기화 필요(03b 참고-2) |
| `src/shared/ui/BottomTabBar.tsx` | 순수 뷰 탭바(TRIP-170) — 5탭 아이콘 자체 보유(인라인 SVG), 네비게이션을 모른다(`activeKey`·`onPressTab` 두 prop뿐). testID `shell-tabbar-*`. **TRIP-173 FSD 완결 3/4**에서 비주얼을 Figma 마스터(`1236:1177`)에 정합 — 풀폭 직각 바(74px·`bg-canvas`·`border-t`) → 투명 84px 밴드 안에 334×64 알약(`rounded-pill`·`bg-surface-soft`, 좌우 28px 여백). 탭 폭 `flex-1`(가변) → `w-[62px]`(고정). 아이콘 좌표계 `0 0 24 24` → `0 0 27 27` + path 10종 전량 교체. prop 계약·testID·접근성 전부 불변. 알약 배경은 1차 판정(Figma raw CSS `rgba(255,255,255,0.68)`)에서 프로덕션 렌더 실측(`#F7F7F7`)으로 **되정정**돼 `bg-surface-soft` 토큰이 됐다(raw 선언값과 렌더 합성값은 다른 질문 — 메커니즘은 미확정) |

### `src/shared/map/` — 카카오 지도 WebView 브리지 (TRIP-197 신설 → TRIP-199로 핀·역지오코딩 확장)

**화면이 아니다** — 지도 렌더 표면만 증명하는 칸(부모 TRIP-75·U1). 카카오가 RN 네이티브 지도 래퍼를 안 만든다(`@react-native-kakao/map`은 저자가 2025-03-19 커밋으로 map 패키지 자체를 삭제) — 그래서 `react-native-webview` 안에 카카오 지도 **JavaScript** SDK를 얹는 우회로 갔다.

| 파일 | 역할 |
|---|---|
| `src/shared/map/mapHtml.ts` | `MapCenter` 타입 · `REGISTERED_DOMAIN` · `MAP_LOAD_FAILED_MESSAGE` · **신규(TRIP-199)** `KakaoMapMessage` 판별 유니온(`PIN_DROP`\|`GEOCODE_OK`\|`GEOCODE_FAIL` — `postMessage`가 문자열 하나만 보낼 수 있어 종류 꼬리표가 필요) · `buildMapHtml(center, jsKey, enablePin = true)` — SDK를 `libraries=services`(역지오코딩 모듈)까지 실어 조립. `enablePin` 3번째 인자로 롱프레스·마커·`coord2Address` 대본을 실을지 고른다(핀을 안 받는 검색 미리보기·확정 시트는 `KakaoMapView`가 `onMapMessage` 없이 불릴 때 자동으로 `false`). 롱프레스는 SDK 내장 이벤트가 없어 `mousedown`+600ms 타이머로 흉내(`dragstart`가 취소) · 응답은 `pinSeq` 일련번호로 늦게 온 이전 핀의 응답을 버림 · 빈 주소는 성공이 아니라 `GEOCODE_FAIL` · **`coord2Address(lng, lat, cb)`는 경도가 먼저다**(리포 전체 `{lat,lng}` 순서와 반대 — 문자열 안 JS라 tsc가 못 잡음, 뒤바뀌면 에러 없이 엉뚱한 주소가 나옴) |
| `src/shared/map/KakaoMapView.tsx` | `KakaoMapView`(`center` + **신규(TRIP-199) 옵셔널 `onMapMessage?: (message: KakaoMapMessage) => void`**) · `KakaoMapViewProps`. `onMessage`로 받은 JSON을 `isFiniteNumber`(NaN·문자열·null 방어, TRIP-197 이월 N5 판정)로 거른 뒤 `onMapMessage`로 전달. **`source.html`은 `useState`의 lazy initializer로 마운트 시점 `center`에 한 번만 고정되고 이후 `center`가 바뀌어도 다시 조립되지 않는다**(TRIP-199 5-a B-1 수정 — WebView는 `source`가 바뀌면 문서를 통째로 재로드해 진행 중이던 역지오코딩 콜백을 죽인다. 좌표를 바꿔 다시 그려야 하는 호출부는 `key`로 이 컴포넌트를 remount한다) |
| `src/shared/map/index.ts` | 배럴 — `KakaoMapView`·`KakaoMapViewProps`·`REGISTERED_DOMAIN`·`MapCenter`·**`KakaoMapMessage`(신규 TRIP-199, 타입 전용 재수출)** |

**소비처 있음(TRIP-198부터)** — `StayRegisterScreen.tsx`(e05)가 검색 미리보기·좌표 확정 시트(`MapSheet`)·**핀 지정 탭(`PinPanel`, TRIP-199 신규)** 셋에서 재사용한다. 시트가 열려 있는 동안엔 핀 지도를 언마운트하지 않고 배경막과 함께 계속 그려(TRIP-199 5-a 2차 B-2 — "지도 마운트는 실질 1개" 규율을 이 자리에서 의도적으로 깸, `ponytail:` 주석에 천장 명시) WebView 2개가 동시에 존재한다.

### `src/shared/api/generated/` — 도구 생성물 (orval, TRIP-179)

`pnpm codegen`(`orval.config.ts` — `filters: { mode: 'include', tags: ['stays', 'saved-stays', 'trips', 'preferences'] }`(**TRIP-183으로 `saved-stays` 추가, TRIP-203으로 `trips`·`preferences` 추가**) + `httpClient: 'axios'` + `override.mutator`)이 `backend/docs/design/openapi.yaml`의 네 태그 경로만 읽어 생성(17→49파일). **사람이 손댄 줄 0건** — 재생성하면 통째로 덮인다. `pnpm codegen`은 리포 prettier를 거치지 않는다 — 재생성 직후 포매터(`prettier --write`)를 돌리지 않으면 순수 포맷 차이로 큰 diff가 난다(codegen → prettier 순서 고정). 이 절 전체가 `docs/structure.md` 유지 규약의 "파일 목록" 기계 담당분에 해당하지만, 코드젠 필터가 없으면 전 태그가 생성돼 여기 목록이 통째로 낡는다는 것 자체가 경고다(아래 "지금 작업하려면" 참조). orval은 **태그 단위로만** 필터링해 오퍼레이션 하나만 못 고른다 — `trips` 태그 12개·`preferences` 태그 2개 오퍼레이션 중 이번에 배선된 것은 `POST /trips`·`GET /me/preferences` 둘뿐이고, 나머지는 `saved-stays` CRUD 5종과 같은 소비자 0 상태다.

| 파일 | 역할 |
|---|---|
| `src/shared/api/generated/stays/stays.ts` | `getStaysSearch`·`useGetStaysSearch`(TanStack Query 훅) · `getStaysGeocode`·`useGetStaysGeocode`(같은 태그라 동반 생성, 소비자 없음) |
| `src/shared/api/generated/schemas/staySearchResponse.ts` | `StaySearchResponse` 타입(`items`·`degraded`·`filterZeroReasons`) |
| `src/shared/api/generated/schemas/stayItem.ts` | `StayItem` 타입(`price?: StayPrice \| null` 포함) |
| `src/shared/api/generated/schemas/stayPrice.ts` | `StayPrice` 타입 |
| `src/shared/api/generated/schemas/getStaysSearchParams.ts` | `GetStaysSearchParams` 타입(`region?`·`amenity?`·`stayType?` — 날짜·인원·정렬 없음, BR-U1-10/15) |
| `src/shared/api/generated/schemas/getStaysGeocodeParams.ts` | `GetStaysGeocodeParams` 타입(지오코딩, 소비자 없음) |
| `src/shared/api/generated/schemas/geocodeCandidate.ts` | `GeocodeCandidate` 타입(지오코딩, 소비자 없음) |
| `src/shared/api/generated/schemas/index.ts` | 위 스키마 배럴 재수출(export 없음 — re-export만) |
| `src/shared/api/generated/saved-stays/saved-stays.ts` | **신규(TRIP-183, 이번 사이클 문서 소급 반영) — ⚠️ 소비자 0.** `postSavedStays`·`usePostSavedStays`(등록) · `getSavedStays`·`useGetSavedStays`(목록) · `getSavedStaysSavedStayId`·`useGetSavedStaysSavedStayId`(단건) · `patchSavedStaysSavedStayId`·`usePatchSavedStaysSavedStayId`(수정) · `deleteSavedStaysSavedStayId`·`useDeleteSavedStaysSavedStayId`(삭제) — CRUD 5종 전부 코드젠만 되고 화면 배선은 아직 없다 |
| `src/shared/api/generated/schemas/registerRoute.ts` | `RegisterRoute` — `MAP_SEARCH`\|`LINK_PASTE`\|`PIN` 3값(BR-U1-21 숙소 등록 경로 3종의 타입 표현) |
| `src/shared/api/generated/schemas/registerSavedStayRequest.ts` | `RegisterSavedStayRequest` — `name`·`registerRoute`·`lat?`·`lng?`·`coordConfirmed?`·`checkIn?`·`checkOut?`·`externalSource?`·`externalId?`·`memo?` |
| `src/shared/api/generated/schemas/editSavedStayRequest.ts` | `EditSavedStayRequest` — `RegisterSavedStayRequest`에서 `registerRoute`·외부 출처 필드가 빠진 부분집합(경로 재변경 불가 암시) |
| `src/shared/api/generated/schemas/savedStay.ts` | `SavedStay` — 응답 전체 형태. `coordConfirmed: boolean`에 "false면 거점 배정 불가(INV-U1-08)" 주석이 스키마 자체에 있음(orval이 openapi description을 그대로 옮김) |
| `src/shared/api/generated/schemas/errorResponse.ts` | 공용 에러 응답 포락선 `{error: ErrorResponseError}` — saved-stays 전용이 아니라 U1 공용 형태 |
| `src/shared/api/generated/schemas/errorResponseError.ts` | `ErrorResponseError` — `{code,message,traceId?,fields?,existingProvider?}`(`existingProvider`는 TRIP-211 — SOCIAL_EMAIL_CONFLICT 409 전용, 이번 사이클은 그 재생성 빚만 선행 커밋 `df43082`로 분리 반영) |
| `src/shared/api/generated/schemas/errorResponseErrorExistingProvider.ts` | **TRIP-211 재생성분(선행 커밋 `df43082`)** — `'google'\|'apple'\|'kakao'\|'naver'` |
| `src/shared/api/generated/schemas/errorResponseErrorFieldsItem.ts` | `ErrorResponseErrorFieldsItem` — `{field?,reason?}`(필드별 검증 오류) |
| `src/shared/api/generated/schemas/validationErrorResponse.ts` | `ValidationErrorResponse = ErrorResponse`(입력 검증 실패 — 별도 필드 없이 의미만 다른 타입 별칭) |
| `src/shared/api/generated/trips/trips.ts` | **신규(TRIP-203)** — `postTrips`·`usePostTrips`(생성, 유일한 소비처) · `getTrips`·`useGetTrips`·`getGetTripsQueryKey`(목록, `useCreateTrip`의 무효화 키 출처) + `getTripsTripId`·`patchTripsTripId`·`deleteTripsTripId`·`postTripsTripIdBases`·`getTripsTripIdBases`·`deleteBasesId`·`getCoverage`·`postMustVisits`·`getMustVisits`·`deleteMustVisitsId` — **⚠️ 소비자 0**(bases·coverage·must-visits, TRIP-84·미티켓 US-TRIP-06·TRIP-209 소관. openapi에 `operationId` 0건이라 orval이 method+path로 이름을 지었다 — 티켓 표기 `createTrip`이 아니라 `postTrips`) |
| `src/shared/api/generated/preferences/preferences.ts` | **신규(TRIP-203)** — `getMePreferences`·`useGetMePreferences`(조회, `usePreferencePrefill`이 재수출) + `putMePreferences`·`usePutMePreferences` — **⚠️ PUT은 소비자 0**(이번 칸은 조회만 배선, 계정 취향 수정 화면은 이 스토리 밖) |
| `src/shared/api/generated/schemas/createTripRequest.ts` | `CreateTripRequest` — required `startDate`·`endDate`·`destinations`, 옵셔널 `title`·`party`·`companionType`·`budgetTotal`·`preferenceSnapshot`(AC-3·AC-6이 이 필수/옵셔널 경계를 잠근다) |
| `src/shared/api/generated/schemas/trip.ts` | `Trip` — required 10필드(`tripId`·`title`·`startDate`·`endDate`·`party`·`preferenceSnapshot`·`destinations`·`status`·`createdAt`·`updatedAt`). `preferenceSnapshot`이 **응답에는 required**인 것이 AC-6("클라이언트는 안 보낸다")의 근거(채우는 주인은 서버) |
| `src/shared/api/generated/schemas/tripDestination.ts` | `TripDestination` — `{seq,region,nights}` 셋 다 필수 |
| `src/shared/api/generated/schemas/companionType.ts` | `CompanionType` — `'혼자'\|'친구'\|'연인'\|'가족'` 4값. **`'커플'` 없음**(온보딩 축과 다른 목록, BR-U1-39 — `커플→연인` 매핑 함수는 TRIP-204 소관) |
| `src/shared/api/generated/schemas/tripStatus.ts` | `TripStatus` — `'PLANNED'\|'CONFIRMED'\|'ACTIVE'\|'ENDED'`(BR-U1-42 단방향) |
| `src/shared/api/generated/schemas/tripPreferenceSnapshot.ts` | `Trip.preferenceSnapshot`의 타입(응답 쪽, required — 취향 동결 스냅숏. 만드는 자리는 서버, 클라이언트는 절대 안 만듦) |
| `src/shared/api/generated/schemas/createTripRequestPreferenceSnapshot.ts` | `CreateTripRequest.preferenceSnapshot`의 타입(요청 쪽, 옵셔널 — `buildCreateTripRequest`가 이 키를 결과에서 걷어내 AC-6을 지킨다) |
| `src/shared/api/generated/schemas/preferenceView.ts` | `PreferenceView` — 7축(`pace`·`budget`·`companion`·`styles`·`activities`·`foodTastes`·`transportModes`) **전부 옵셔널**. `usePreferencePrefill`의 반환 타입 |
| `src/shared/api/generated/schemas/preferenceViewBudget.ts` | `PreferenceView.budget` — `{tier?,rawAmount?,isNeutralDefault?}`. `rawAmount`가 숫자일 때만 여행 생성 요청의 `budgetTotal`로 실린다 |
| `src/shared/api/generated/schemas/preferenceViewCompanion.ts` | `PreferenceView.companion` — 동행 축 취향(이번 칸은 소비 안 함) |
| `src/shared/api/generated/schemas/addMustVisitRequest.ts` · `src/shared/api/generated/schemas/assignBaseRequest.ts` · `src/shared/api/generated/schemas/baseAssignment.ts` · `src/shared/api/generated/schemas/coverage.ts` · `src/shared/api/generated/schemas/dayCoverage.ts` · `src/shared/api/generated/schemas/dayCoverageStatus.ts` · `src/shared/api/generated/schemas/editTripRequest.ts` · `src/shared/api/generated/schemas/mustVisit.ts` · `src/shared/api/generated/schemas/mustVisitType.ts` | **`trips` 태그가 통째로 딸려오며 생긴 소비자 0 스키마 9종**(bases·coverage·must-visits 도메인) — TRIP-84·TRIP-209 소관, 이번 사이클은 배선하지 않음 |
| `src/shared/api/generated/schemas/preferenceInput.ts` · `src/shared/api/generated/schemas/preferenceInputActivitiesItem.ts` · `src/shared/api/generated/schemas/preferenceInputBudgetTier.ts` · `src/shared/api/generated/schemas/preferenceInputCompanionTypesItem.ts` · `src/shared/api/generated/schemas/preferenceInputFoodTastesItem.ts` · `src/shared/api/generated/schemas/preferenceInputPace.ts` · `src/shared/api/generated/schemas/preferenceInputStylesItem.ts` · `src/shared/api/generated/schemas/preferenceInputTransportModesItem.ts` · `src/shared/api/generated/schemas/prefArrayAxis.ts` · `src/shared/api/generated/schemas/prefScalarAxis.ts` | **`PUT /me/preferences` 요청 바디 스키마 10종 — ⚠️ 소비자 0**(이번 칸은 `GET`만 배선. 계정 취향 수정 화면이 생길 때 소비) |

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
| `src/test-support/queryClientProbe.tsx` | **신규(TRIP-179)** — `SplashGate` 자리를 대신할 관찰용 가짜 컴포넌트. 렌더될 때 `useQueryClient()`를 불러 모듈 변수에 담고(`getObservedQueryClient`) `<View testID="query-client-probe" />`를 마커로 그린다. `resetObservedQueryClient`로 파일 간 상태를 비운다 |
| `src/test-support/kakaoMapViewMock.tsx` | **신규(TRIP-198)** — `@/shared/map`의 `KakaoMapView`를 `center`를 `Text`로 뱉는 가짜로 치환한다. WebView는 jest 렌더 트리에서 아무 내용도 안 남기므로, **화면이 어느 좌표로 지도를 띄웠는지 확인할 수 있는 유일한 창구**다 |
| `src/test-support/nativeSocialSdkMock.ts` | **신규(TRIP-210)** — `@react-native-seoul/kakao-login`·`naver-login` 두 SDK의 `{virtual:true}` 가짜 모듈 + 관찰 스파이(`expoAuthSessionMock.ts`와 동형 패턴). default·named 네임스페이스·named 함수 세 import 형태 모두 같은 스파이에 닿는다(V2 실측). `naverInitializeSpy`는 **일부러 리셋하지 않는다**(★D8 — 모듈 스코프 메모이즈 구현도 관측되게 하려는 설계) |
| `__mocks__/@gorhom/bottom-sheet.tsx` | 네이티브 모듈 자동 목 |
| `__mocks__/react-native-webview.tsx` | **신규(TRIP-197)** — `react-native-webview`를 `<View {...props}>` 통과 컴포넌트로 자동 치환(`bottom-sheet` 목과 동형 패턴). `forwardRef`+`useImperativeHandle`로 `.reload()` 리모컨을 흉내내지만 **현재 어떤 테스트도 ref를 안 씀**(선례 존치가 기본값, 승인 해시에 포함) |
| `src/__tests__/noMswInStaticGraph.test.ts` | 정적 import 그래프를 fs로 훑어 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제 |
| `src/__tests__/importBoundary.test.ts` | import 경계 가드 — 계층·feature 격리 위반 차단. **FSD 완결 2/4에서 보강**(34→54줄, code-critic 발견 구멍 수리) — 프로브를 배럴 의존(구 `@/features/stay`, 삭제 예정 대상이었다)에서 실파일 딥 경로로 떼고, 단언을 에러 개수(`errorCount>0`)에서 **룰 ID**(`import/no-restricted-paths` 포함 · `import/no-unresolved` 불포함)로 바꿔 "경계 위반"과 "모듈 해석 실패"를 구분한다. **단독 실행 시 `NODE_OPTIONS=--experimental-vm-modules` 필요**(`pnpm exec jest` 단독 금지 — 없으면 2/2 실패, 테스트 결함처럼 보이지만 실행 방법 문제) |
| `src/__tests__/fsdStructure.test.ts` | **TRIP-173 신설(사이클 1 유일한 신규 파일)** — auth `{config,lib,model,ui}` 4칸·onboarding `{model,ui}` 2칸·**home `{model,ui}` 2칸(FSD 완결 1/4 신설, it 1-3)** 대표 파일 존재, `pages` **6슬라이스**(TRIP-181로 `stay-search` 추가, B 카운터 0→1 — `PAGE_SLICES` forEach 상수는 미포함이라 개별 슬라이스 검사는 여전히 5개 대상)의 배럴·라우트 참조, `app-shell`이 `src/app` 밖에 있는지를 검사. **폴더 배치만 본다 — import 방향·소스 내용은 안 본다**(code-critic E3·E5·E6 실측). **FSD 완결 2/4(AC-4, it 4-1) 신설** — `features`·`shared` 두 층 전수 스캔으로 빈 배럴(`export {};`) 0개 단언(A·영구) + 진짜 배럴(`shared/api`·`shared/storage`) 대표 심볼 생존 긍정 짝(B) + **스캔이 실제로 두 층에 닿았는지**(`scannedLayers` 앵커, code-critic W-1 보강 — 안 넣으면 `BARREL_LAYERS`를 비워도 green이었다)까지 확인한다. 사이클 3~4가 이 파일에 덧붙여 자란다. 주석 상단에 A(영구)/B(한시) 졸업 조건 명시(게이트①-1→①-2 재제시로 추가됨). ⚠️ "pages 슬라이스가 정확히 N개" 배열 단언은 **디렉토리 이름만** 보고 내용은 안 봐서, 통합테스트 파일을 최종 위치에 물리적으로 쓰기만 해도 구현 전에 조기 green이 될 수 있다(TRIP-181 실측 — red 소급 확인에서 오판 금지 사전 기록 필요) |
| `src/__tests__/staySearchStructure.test.ts` | **TRIP-181 신규 → TRIP-182로 강화**(기존 4개 describe `it` 본문 무변경 + 신규 describe 3개 추가). duration 식별자 0(INV-3, `STAY_SURFACE_DIRS` 3층 전체) · raw hex 0(V1, `TOKENIZED_HEX` 7색→**11색** 확장) · 프레젠테이션 순수성(`useState`·`useReducer`·`zustand`·`expo-router`·query·axios·타 feature import 11종 0건) · 3파일 상호 배제. **TRIP-182 신규**: ① `features/stay/ui` 디렉토리 **동적 스캔**(`*Glyphs.tsx` 제외)으로 V1 사정거리를 화면 1파일에서 부품 파일 전체로 확장(`SCREEN_FILES` 배열 자체는 안 건드림 — 배열 순서 의존 회귀 방지) ② AC-13 SafeArea 구조 가드(`SafeAreaView`+`edges` `top`+`stay-search-root` 유지, 실제 겹침은 6-b 소관) ③ AC-8 배선 단일 출처(`resolveStaySearchState`는 `StaySearchPage`만 호출, 화면은 재호출 금지) |
| `src/__tests__/stayRegisterStructure.test.ts` | **신규(TRIP-198)** — e05 등록 표면 구조 가드 9묶음(G-0~G-8). FSD 상태 소유(화면에 `useState` 0 · 페이지가 진다) · INV-3 `duration` 0건 · raw hex 0 · 토큰 경유 · 지도 재사용(신규 지도 컴포넌트 0) · 배럴·라우트 배선 · e02→e05 진입(`router.push`·`/stays/register`·`onPressRegister`, 화면 쪽은 `expo-router` 0의 부정 짝) · zod 규약과 새 의존성 0. ⚠️ **이 파일은 게이트①-2에서 3건이 수복됐다** — 모집단 비대칭(`pages/stay-register` 전체 → `/ui`), `/\bduration\b/i` → `/duration/i`(단어 경계가 `stayDuration`을 못 잡아 **자가검사가 항상 false**였고, 그게 곧 INV-3 가드의 실제 커버리지 구멍이었다), `toContain('useRouter')` → `toContain('router.push')`(동결 목이 `useRouter` 미제공이라 훅 구현이 동결 7건을 즉사시켰다). 검증 n=1이 이 3건을 잡았고 구현 결함은 0건이었다 |
| `src/__tests__/onboardingStructure.test.ts` | 온보딩 계층·경계 구조 가드(서버 권한 경계 등). `PAGES_DIR`+`ONBOARDING_PAGE_SLICES`(TRIP-173 신설 — 온보딩 컨테이너 4개가 `pages/`로 나가며 금칙어 가드 사정거리에 다시 편입) |
| `src/__tests__/onboardingPrefStructure.test.ts` | 취향 스토어·모델 구조 가드(TRIP-163) — persist 금지·`@/shared/api` 미참조·`create(` 표기(구조 가드 6-2, 개념 [[구조 가드와 긍정 앵커]]) |
| `src/__tests__/homeStructure.test.ts` | 홈 소스 스캔 가드(TRIP-170, `@jest-environment node`) — 픽스처 상수화(D-1)·INV-3 `duration` 식별자 0(D-2)·토큰 raw-hex 0(D-3)·SafeArea 규약(D-4)·탭바 격리(D-5). D-3·D-4 모집단은 TRIP-173 FSD 완결 1/4에서 `screens/` 폴더 전체 → `ui/*Screen.tsx` 파일명 필터 + `HOME_SCREEN_SOURCE_FILES` 동결목록(현재 1건, `onboardingStructure` 선례와 동형)으로 교체됐다 |
| `src/__tests__/onboardingPrefRoutes.test.tsx` | 취향 1/2·2/2 라우트 존재·내비게이션 계약 가드(TRIP-163) — push/replace/back 분기 |
| `src/__tests__/tabsShell.test.tsx` | `(tabs)/_layout.tsx` 배선 가드(TRIP-170) — 5탭 등록 순서·`tabBar` 렌더프롭·어댑터 활성 매핑/press→navigate·홈 라우트 래퍼·4탭 껍데기 유지 |
| `src/__tests__/tabbarVisual.test.ts` | **TRIP-173 FSD 완결 3/4 신설** — `BottomTabBar.tsx` 비주얼 소스 스캔 가드(AC-V1 밴드 84+알약 반경 · AC-V2 아이콘 좌표계 27 전량 · AC-V3 옛 풀폭 직각 바 흔적 0 · AC-V4 색 토큰 경유). **모든 `it`이 `stripComments()`로 주석을 제거한 뒤 스캔** — 게이트①-1에서 헤더 주석의 `rounded-pill` 문구가 부정 단언을 실제 코드 없이 만족시키는 거짓 GREEN이 나온 것을 게이트①-2에서 근본 수정. 렌더 크기(`size=27`, 호출부+기본값 12곳)·스크린샷이 잡은 수정값 6종(`h-[64px]`·`leading-[13px]`·`bg-surface-soft`·`w-[62px]`·`px-[28px]`·`style={PILL_SURFACE_STYLE}`)도 함께 잠근다. `active=1~4` 변형은 탭을 누를 수 없어(접근성 권한 부재) 코드 대조로만 담보 — 스크린샷은 홈 활성 1상태만 검증 |
| `src/__tests__/loginVisual.test.ts` | **TRIP-173 FSD 완결 4/4 신설** — `AuthGlyphs.tsx`의 `WarningTriangleGlyph` 비주얼 **소스 스캔** 가드(AC-V4: `viewBox="0 0 18 18"` · `strokeWidth={1.575}` 배열 비교(개수·값·순서) · 렌더 크기 3곳 잠금(기본값·`size`→`width`/`height` 배선·호출부) · 색 상수 경유 · 스캔 대상 경로 존재 앵커). `stripComments` + 함수 블록/JSX 태그 슬라이스로 이 모듈의 다른 글리프 5개가 개수를 채워주는 우회를 차단(게이트①-2 보강, W-1·W-3 — `tabbarVisual.test.ts`와 같은 구멍이 두 사이클 연속 재현). AC-V1~V3(라벨 웨이트·에러 배너)은 이 파일이 아니라 `SocialLoginScreen.visual.test.tsx`의 **렌더 층**이 잠근다 — `className`이 jest 렌더 트리에 평문 prop으로 남는다는 4-a 실측으로 Seed를 뒤집은 결과(개념 [[가드의 사정거리]] 실측 6, "렌더 층과 소스 층은 사정거리가 다르다") |
| `src/__tests__/devPreviewPref.test.tsx` | 프리뷰 `pref1`·`pref2` 상태 렌더 가드(TRIP-163) — 빈 선택 상태로 직접 렌더, 가드 우회 아님 |
| `src/__tests__/devPreviewHome.test.tsx` | 프리뷰 홈 4키 가드(TRIP-170) — 딥링크 4키·토글 진입·미존재 키 splash 폴백 결정론 |
| `src/__tests__/onboardingEntryGuard.test.tsx` | 온보딩 진입 리다이렉트·완료자 방어 가드 |
| `src/__tests__/rootLayout.test.tsx` | 루트 부팅 골격 |
| `src/__tests__/rootLayoutSafeArea.test.tsx` | `SafeAreaProvider` 도입 후에도 자식이 렌더되는지 |
| `src/__tests__/devPreview.test.tsx` | 프리뷰 상태 렌더. 런타임 지뢰 목으로 네트워크 격리 |
| `src/__tests__/devPreviewDeepLink.test.tsx` | 프리뷰 딥링크 `?state=` 파라미터 → 초기 화면 결정론 가드(부재·오타·대소문자·빈 문자열·배열 값 → 전부 splash 폴백) |
| `src/__tests__/design-tokens.test.ts` | 디자인 토큰 가드 |
| `src/__tests__/openapiContract.test.ts` | **TRIP-179 신설** — `backend/docs/design/openapi.yaml`을 글자로 읽어 검사(리포에 YAML 파서 의존 0). `/stays/search` 경로 존재·`servers`가 `/api/v1`로 끝남·정의 없는 `$ref` 0건(계약 회귀 앵커) + `/stays/search` 파라미터 이름을 `['region','amenity','stayType']`로 순서 포함 완전일치(게이트①-2 보강 — 헤더가 약속한 "스펙 드리프트 잠금" 사정거리를 뮤테이션 테스트로 실측해 좁힌 결과, `sort`·`page` 같은 파라미터 추가가 그 전엔 무심판으로 통과했다) |
| `src/__tests__/rootLayoutQueryProvider.test.tsx` | **TRIP-179 신설** — 앱 루트를 실제 렌더해 `SplashGate` 자리(`queryClientProbe` 목) 안쪽에서 `QueryClient`가 잡히는지 확인(단언 3개: 던지지 않음·프로브 도달·진짜 인스턴스) |
| `src/__tests__/staySearchGenerated.test.ts` | **TRIP-179 신설** — 코드젠의 출력을 검사(`pnpm codegen`을 직접 돌리지 않고 커밋된 생성물을 fs로 읽음, 모든 스캔은 `stripComments` 경유). B-0 전처리 자기검증·B-1 생성 파일 목록 동결 8경로·B-2 심볼 존재·B-3 파라미터·B-4 `duration` 식별자 0(INV-3)·B-5 응답 표현력 6종 |
| `src/__tests__/mapBridgeStructure.test.ts` | **TRIP-197 신설** — 소스 스캔 7케이스(`@jest-environment node`). A-1 webview 버전 정합·A-2 키는 env 참조로만(+ 자기검증)·A-3 git 추적 전수에 키 리터럴 0(`.env.example` 동반 단언)·A-4 로컬 검색 지문 0·A-5 INV-3 `duration` 0·A-9 도메인 리터럴 정확히 1파일·1회·1-7 `@/features/` 0건. `stripComments`에 `(?<!:)` 룩비하인드 필수(게이트①-2 수정 — 없으면 `https://`의 `//`를 주석으로 오인해 URL이 스캔 전 사라진다, 결함 상세는 `[[반대 방향 앵커]]`·`02c_gate1-2_fix.md`) |
| `src/__tests__/tripDraftBoundary.test.ts` | **신규(TRIP-204)** — AC-8 소스 스캔, `tripDraft.ts`의 import를 **전이 의존까지** 순회(평면 금칙 목록은 `@/shared/api` 배럴 한 줄로 뚫린다 — 그 배럴이 axios를 끈다, 02a §6-⑥ 실측). `stripComments`는 `mapBridgeStructure.test.ts`의 `(?<!:)` 룩비하인드 대신 `` `:` 뒤 `//`는 주석으로 안 본다``는 동치 규칙을 `(^|[^:])`로 구현(2026-07-31 실사고를 회귀 케이스로 박음). **기존 4파일(`loginVisual.test.ts`·`staySearchStructure.test.ts`·`staySearchGenerated.test.ts`·`tabbarVisual.test.ts`)은 미수정 원본 정규식(`/\/\/.*/g`)을 아직 쓴다** — 문제로그 참고 |
| `src/__tests__/devPreviewMap.test.tsx` | **TRIP-197 신설** — 프리뷰 `map-default` 상태 키 1개가 지도 컴포넌트(`map-root`)를 렌더하는지만 확인(층 C 실기 확인의 진입점이 실제로 열리는지). env를 세팅하지 않아 **항상 키 없음 분기(`map-failure`)만 밟는다** — 해피패스는 이 파일에서 0회 실행(설계 의도, code-critic N4) |
| `src/__tests__/socialSdkSecrets.test.ts` | **신규(TRIP-210)** — 소셜 SDK 키·시크릿 소스 스캔 4묶음(AC-7·AC-8′). `.env`·`.env.local` 미추적 + `.env.example` 4변수 이름만(값 없음) · git 추적 **전 파일**(확장자 무관) 전수에 `VAR=<값>` 대입 0건 · `app.config.ts`의 env 참조(주석 밖) + 32-hex 리터럴 0 · 네이버 시크릿이 코드·주석 양쪽에 등장(raw>stripped로 판정, ★D5) + README 명시. ⚠️ **게이트①-2에서 대입 탐지기를 수정했다** — `=` 뒤 `\s*`가 개행을 건너 값 없는 변수가 연달을 때 다음 줄 첫 글자를 값으로 오판했다(자가검사가 전부 한 줄짜리라 못 잡음). 공백 클래스를 `[^\S\n]`로 통일 + 여러 줄 자가검사 4건 추가 |
| `src/__tests__/socialSdkConfigPlugin.test.ts` | **신규(TRIP-210, 게이트①-3 — code-critic 경고3 대응)** — `app.config.ts`의 kakao·naver config plugin 등록 소스 스캔. 튜플 등록(패키지명 2개) · 옵션 키 이름 허용목록(`kakaoAppKey`/`urlScheme`) · 값이 실제로 그 provider의 env에서 오는지 · **카카오·네이버 값이 서로 뒤바뀌지 않는지**(교차 배선) 4중 단언. `plugins` 배열 타입이 `[string, any]`라 tsc가 옵션 오타·값 교차를 못 잡는 자리를 메운다 |


## 재사용 공개 API

**새 함수를 만들기 전에 여기부터 본다.** 있으면 다시 만들지 말고 가져다 쓴다.
(대상: `shared/*` + `features/*/lib`·`model`·`hooks`. 화면·컨테이너는 재사용 대상이 아니라 제외.)

| 심볼 | 위치 | 무엇 |
|---|---|---|
| `createAuthedApiClient` | `shared/api` | 인증 붙은 axios 인스턴스 생성 |
| `authedClient` | `shared/api` | 이미 만들어진 인증 axios 인스턴스(TRIP-179부터 export — mutator 전용, 원래도 있던 심볼) |
| `customInstance` | `shared/api/mutator` | orval 생성 클라이언트가 HTTP 호출에 위임하는 단일 함수(TRIP-179) — `authedClient` 경유 + 배열 쿼리 브래킷 없이 직렬화 |
| `useStaySearch` | `features/stay/model` | `/stays/search` 도메인 훅(TRIP-179, 생성 훅의 얇은 재수출) — 소비 화면 아직 없음 |
| `formatPrice` | `features/stay/model` | `formatPrice(price?: StayPrice \| null): string` — 최저가 스냅숏 → 카드 금액 문자열(TRIP-180, PBT 5건). **TRIP-181이 첫 소비**(`StaySearchScreen.tsx`) |
| `stayKey` | `features/stay/model` | `stayKey(item: Pick<StayItem,'externalSource'\|'externalId'>): string` — `${externalSource}:${externalId}` 합성(TRIP-181). React key·testID 공용 출처 |
| `resolveStaySearchState` · `StaySearchState` | `features/stay/model/staySearchState` | 판별 유니온(5종) + 판정 순수 함수(TRIP-182, PBT 대상). 화면은 이 결과를 받기만 하고 재판정하지 않는다(구조 가드) |
| `filterReasonLabel` | `features/stay/model/filterReasonLabel` | `filterZeroReasons` 코드 → 한글 표시명(TRIP-182). 축 사전 2줄 + 모르는 축 폴백 |
| `buildCreateTripRequest` · `CreateTripInput` | `features/trip/model/createTripRequest` | 여행 생성 요청 조립 순수 함수(TRIP-203) — 예산 러프값 3갈래(있음·null·미도착) + `preferenceSnapshot` 런타임 제거 |
| `validateTripDraft` · `nightsSum` · `toCompanionType` · `TripDraft` · `TripViolationCode` | `features/trip/model/tripDraft` | **신규(TRIP-204)** — 드래프트 위반 코드 집합 판정(순수·PBT numRuns 500) · Σ박수 · 온보딩→서버 동반유형 매핑. AC-8이 UI·쿼리 훅·라우터 import를 전이까지 금지 |
| `daysInMonth` · `firstWeekdayOfMonth` · `shiftMonth` · `nightsBetween` · `isDateInRange` · `isStayRangeValid` · `applyDatePick` · `commitDateRange` · `StayDateRange` | `features/stay/model/stayDates` | 달력·날짜 순수 함수 8개(TRIP-198, 에포크 일수 기준). **여행 기간 계산엔 재사용 불가** — 같은 날/역전을 `null`로 접는 숙소 판정과 여행(0박 합법·역전은 별도 코드)은 의미가 반대다(TRIP-204 01b D5) |
| `stayRegisterSchema` · `resolveName` · `canSubmitStayRegister` · `buildStayRegisterRequest` · `StayRegisterFlow` · `StayRegisterTab` | `features/stay/model/stayRegisterForm` | 등록 폼 판정·조립(TRIP-198). zod는 날짜 순서 한 규칙만, 좌표 게이트는 zod보다 먼저 `if`로 |
| `filterRegions` · `REGIONS` · `RegionCode` · `Region` | `features/explore/model/regions` | 지역 상수 6개 + 클라이언트 필터(TRIP-183) |
| `resolveNearby` · `Coords` · `NearbyDeps` · `NearbyResult` | `features/explore/model/resolveNearby` | '내 주변' 판정 순수 함수 — 현재 위치 > 등록 숙소 > 없음 우선순위, DI 주입 방식(TRIP-183) |
| `useCreateTrip` | `features/trip/model` | `POST /trips` mutation 래퍼(TRIP-203) — 성공 시 `GET /trips` 목록만 무효화. `usePostTrips`(생성물)를 그대로 감싸 몸통 1줄, 반환값은 `{ data: CreateTripRequest }` 봉투를 그대로 노출 |
| `usePreferencePrefill` | `features/trip/model` | `GET /me/preferences` 조회 훅(TRIP-203) — `useGetMePreferences` 재수출 1줄. `usePreferenceStore`(온보딩 로컬 드래프트)와 다른 물건 |
| `fetchBootstrap` · `postSocialLogin` · `postSocialTokenLogin` · `refreshTokens` | `shared/api` | 부트스트랩 조회 · 소셜 로그인(인가코드 경로) · 소셜 로그인(**네이티브 SDK access token 경로**, TRIP-210) · 토큰 갱신. `postSocialTokenLogin`은 `postSocialLogin`과 완전히 같은 모양(무인증 `baseClient` + 기존 `normalizeSocialError` 재사용, 새 에러 매핑 0) |
| `fetchTerms` · `submitConsents` | `shared/api` | 약관 목록 · 동의 1회 제출(체크된 것만 GRANT) |
| `fetchNicknameSuggestions` · `checkNickname` · `updateNickname` · `completeOnboarding` | `shared/api` | 후보 조회 · 서버 판정 · 저장 · 온보딩 완료 |
| `setAccessToken` · `getAccessToken` · `clearAccessToken` · `hydrate` · `subscribeAccessToken` | `shared/api/tokenManager` | 동기 in-memory 토큰 홀더. `getAccessToken`은 **동기** 반환(인터셉터용). `subscribeAccessToken(listener)`은 토큰이 실제로 바뀔 때만 통지하고 구독 해제 함수를 반환한다(TRIP-172 신규 — 로그인 성공 후 부트스트랩 재조회의 유일한 신호) |
| `saveTokens` · `getTokens` · `clearTokens` · `hasStoredToken` | `shared/storage` | 토큰 저장소 CRUD. **로그인 여부 판정도 `hasStoredToken`**(accessToken 단독 판정 — 위 파일별 역할 표 참고, 심판 0이라 조용히 재발할 수 있다) |
| `compareVersion` | `shared/version` | 버전 문자열 비교(`-1\|0\|1`) |
| `makeAuthorize` | `features/auth/lib` | provider별 authorize 팩토리(DI 주입점) |
| `getOAuthConfig` | `features/auth/config/oauthConfig` | provider별 OAuth config(env). 네이티브 의존 0 |
| `realAuthorize` | `features/auth/lib/realAuthorize` | expo-auth-session PKCE authorize. **`makeAuthorize`가 동적 import로만 부름** |
| `kakaoAuthorize` · `naverAuthorize` | `features/auth/lib/{kakaoAuthorize,naverAuthorize}` | **신규(TRIP-210)** — 카카오·네이버 네이티브 SDK authorize. `realAuthorize`와 동형으로 **`makeAuthorize`가 동적 import로만 부름**(SDK가 정적 그래프에 안 실림, AC-11) |
| `resolveBootstrapDestination` | `features/auth/model` | 부트스트랩 상태 → 목적지(순수) |
| `resolveOnboardingStep` · `validateNicknameFormat` | `features/onboarding/model` | 잔여 온보딩 단계 · 닉네임 길이 검증(순수) |
| `toggleMulti` · `toggleSingle` | `features/onboarding/model/preferenceSelection` | 취향 축 토글 순수 규칙(복수/단일 공용). `null`=미설정, 빈 배열로 안 떨어짐(US-ONB-14) |
| `usePreferenceStore` | `features/onboarding/model/preferenceStore` | 취향 6축 세션 메모리 Zustand 스토어(persist 없음). **TRIP-173에서 `store/`→`model/` 합류** |
| `BottomTabBar` · `ShellTabKey` · `BottomTabBarProps` | `shared/ui` | 순수 뷰 탭바(TRIP-170) — `activeKey`·`onPressTab` 두 prop만, 네비게이션 모름 |
| `HOME_DEFAULT_PROPS` · `HOME_NO_TRIP_PROPS` · `HOME_EMPTY_PROPS` · `HOME_LOADING_PROPS` | `features/home/model/homeFixtures` | 홈 4상태 Figma 고정 목업(Q2 — 서버 없어 유일한 데이터 소스) |
| `HomeScreenProps` · `HomeSections`(외 조각 타입) | `features/home/model/homeTypes` | 홈 화면 prop 계약 — 판별 유니온 `HomeSections`(ready/empty/loading) |
| `useBootstrapGate` · `useSocialLogin` | `features/auth/model` | 부트스트랩 · 소셜 로그인 훅. **TRIP-173에서 `hooks/`→`model/` 개명** |
| `useTermsConsent` · `useNickname` · `useOnboardingProgress` | `features/onboarding/model` | 약관 · 닉네임 · 진행 상태 훅. **TRIP-173에서 `hooks/`→`model/` 개명** |
| `SPLASH_BACKGROUND_COLORS` · `SPLASH_BACKGROUND_LOCATIONS` · `APP_ICON_COLORS` · `AUTH_ICON_COLORS` | `features/auth/config/gradients` | 그라디언트 상수. **TRIP-173에서 `lib/`→`config/` 개명**, `AUTH_ICON_COLORS`(경고 글리프 색)는 **FSD 완결 4/4 신설**(code-critic 03b 참고-1: 이 행 갱신 누락이 "이름 다른 재구현" 경로를 여는 사례로 실측됨 — 다음에 경고 아이콘 색이 또 필요하면 여기부터 본다) |
| `BOOTSTRAP_TIMEOUT_MS` | `features/auth/model` | 부트스트랩 타임아웃 |
| `LoginPage` | `pages/login` | 로그인 훅↔화면 배선(구 `features/auth/containers/SocialLoginContainer`, TRIP-173 신설) |
| `TermsPage` · `NicknamePage` · `PrefStep1Page` · `PrefStep2Page` | `pages/onboarding-{terms,nickname,pref1,pref2}` | 온보딩 각 단계 배선(구 `features/onboarding/containers/*Container`, TRIP-173 신설) |
| `SplashGate` | `app-shell` | 부트스트랩 결과 라우팅(구 `features/auth/containers/SplashGate`, TRIP-173 신설 — `src/app` 밖) |

> ⚠️ **제거된 심볼**(참조하면 깨진다): `setApiAdapter` · `defaultAdapter` · `SCENARIO_LIST` · `getActiveScenarioKey`

> **이 목록이 못 잡는 것**: 이름이 다른 같은 기능(`hasStoredToken`이 있는데 `isLoggedIn`을 새로 만드는 경우). 그래서 **찾아봤으나 없어서 새로 만든다는 사실**을 브리프·03에 적고 게이트 요약에 올린다.

## 지금 작업하려면 (경고)

리포를 읽어도, 테스트를 돌려도, 그래프를 봐도 **알 수 없는 것만** 적는다. **밟기 전에 읽는다.**

- **온보딩 완료자 라우팅** → `useOnboardingProgress`가 **하드코딩 `false`**(FW1). 실 progress는 `onboardingCompleted`인데 `features/auth`에만 있고 importBoundary가 막는다 — `shared` 승격이 선행돼야 한다.
- **세션 만료 UX** → 토큰만 clear하고 **즉시 리다이렉트는 없다**(FW2, 다음 부트스트랩이 자가치유).
- **홈 실 데이터** → 서버 API가 **아직 없다**(TRIP-170 범위 밖). `homeFixtures.ts`를 API 훅으로 교체하는 자리.
- **apple 소셜 로그인** → `oauthConfig`에 **빈 슬롯**(백엔드 fail-closed로 막아둠, 범위 밖). kakao·naver는 TRIP-172로 채워졌고, naver는 `usePKCE:false`+`state` 필수인 비표준 갈래라 다시 만질 땐 `realAuthorize.ts` 조건부 분기부터 본다.
- **`useStaySearch` 기본 파라미터·오류 정규화** → **없다**(D6 이연). params를 그대로 넘기기만 한다.
- **숙소 목록 무한 스크롤** → `/stays/search`에 **페이지네이션 파라미터가 없다**. `onEndReached`류를 붙이면 같은 1페이지를 반복 요청하는 함정인데, 그 "없음"을 잠그는 단언이 **어느 심판에도 없다**.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.
- **엣지 케이스 화면을 눈으로 보려면** → 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다.
- **화면 비주얼** → `figma-screen-impl` 스킬 절차를 따른다. 밴드 맵은 `.claude/skills/spec-perception/reference/figma-structure.md`.
- **심판 사정거리 — 믿기 전에 확인한다** → raw hex 스캔은 `*Glyphs.tsx` **제외**(SVG `stroke`/`fill`은 className을 못 받는 리포 전체 관례). AC-7 스텁 잠금의 `cardFingerprint`는 testID·className·텍스트만 굳히고 **`fill` 변화는 안 본다** — 저장 하트를 `StayGlyphs.tsx`로 옮겨 `useState` 토글을 걸면 5개 심판이 전부 green인 채로 "저장됐다는 거짓말"이 통과한다.
- **지도(`shared/map`)** → `react-native-webview`는 네이티브 모듈이라 **코드만 머지하고 재빌드를 안 하면 기존 dev build엔 웹뷰가 없다**(`pnpm expo prebuild` → `pnpm expo run:ios`). 카카오 콘솔은 **두 자리를 헷갈리기 쉽다** — 지도 JS SDK가 실제로 보는 명부는 `[앱 키]→JavaScript 키→JavaScript SDK 도메인`이고, `[플랫폼]→웹 도메인`은 카카오톡 공유용이다.

> **미해결 부채·후속 티켓·"다음 사이클 후보"는 여기 적지 않는다** — 옵시디언 문제로그와 devlog 인수인계 소관이고, [메모리] 3·4번이 그걸 읽는다. 여기 쌓으면 이 절이 장부가 되어 단조증가한다(2026-07-31 정비에서 21건 → 11건).
