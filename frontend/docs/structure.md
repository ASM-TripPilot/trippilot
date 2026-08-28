# 프론트엔드 구조 지도

**무엇을 위한 문서인가**: AI도 사람도 리포를 전수로 읽지 않는다 — 찾으려고 **생각한 것만** 찾는다. 그래서 이미 있는 것을 못 보고 다시 만든다(2026-07-20 재구현 사고). 이 문서는 탐색 대상이 아니라 **훑는 목록**이다. 안 찾던 것이 눈에 걸리는 게 목적이다.

**정본은 리포다.** 이 문서와 실제가 어긋나면 실제가 옳다 — 다만 어긋난 채로 두지 않기 위해 대조 검사가 붙어 있다(아래).
## 유지 규약

**층별 파일 표(경로·용도·스텁)는 `.claude/rules/layer-*.md`로 이관됐다**(2026-08-13) — `paths:` frontmatter로 **해당 폴더를 만질 때만** 컨텍스트에 로드된다(structure.md에 다 이고 다니지 않으므로 파일 수 비례로 안 자란다). structure.md엔 **층 무관 절만** 남는다: 유지 규약·한눈에·디렉토리·재사용 공개 API·경고 포인터.

| 절 | 누가 채우나 | 어디에 |
|---|---|---|
| 파일 목록 · export 심볼 | 🤖 `structure-index.cjs --write` | `docs/structure.generated.md` (자동 생성 — 손대지 마라) |
| **용도 한 줄** · **스텁 여부** · **함정** | 🧑 [기록]에서 scribe | `.claude/rules/layer-*.md` (설명할 게 있는 파일만) |
| **재사용 공개 API** | 🧑 [기록]에서 scribe | structure.md (층 무관·재구현 방지) |

> **`docs/structure.generated.md`는 기계 담당 절반이다** — `--write`가 전 소스의 파일 목록·export를 뽑아 덮어쓴다. 손으로 고치지 마라(다음 `--write`가 덮는다). `--check`는 이 파일 + `layer-*.md` + structure.md 를 합쳐 실제 파일과 대조하므로, 새 파일은 `--write` 한 번으로 '누락'이 사라진다. 사람이 쓰는 것은 **왜 있나(용도·함정·재사용 근거)**뿐 — 기계가 주는 **무엇이 있나**를 손으로 옮겨 적지 마라.

- **경로는 리포 상대 전체 경로를 백틱으로 적는다** (`src/features/auth/lib/makeAuthorize.ts`). 대조 검사가 이 형태만 인식한다.
- 갱신은 **이번 사이클이 만진 행만**(해당 층 규칙 파일에서). 전면 재작성 금지.
- 대조: `node .claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs --check` — DOC + `.claude/rules/layer-*.md`를 함께 읽어 실제 파일과 대조한다.
  - *파일은 있는데 행이 없다* → 새 파일 누락(해당 층 규칙에 추가) · *행은 있는데 파일이 없다* → 삭제·이동 미반영
- **개념 링크는 여기 두지 않는다.** 코드→개념 진입점의 정본은 옵시디언 개념 노트의 `설명하는코드` 속성이다(경로 문자열을 `obsidian_simple_search`에 넣으면 잡힌다). 사본을 두 곳에 두면 또 갈라진다.
- **역할 칸은 "용도 한 줄" — dossier 금지.** 칸에 담기는 것은 *무엇을 하는 파일인가* 한 줄뿐이다. 구현 변경 이력은 git이, 미해결 부채·후속 티켓은 옵시디언 문제로그가, 리포 함정은 `.claude/rules/repo-traps.md`가 가진다 — 칸에 이 셋이 쌓이면 걷어내 각 소관으로 보낸다. `--check`는 행 존재만 지키고 칸 내용은 안 지키므로 칸은 손으로 짧게 유지한다. **기존 비대 칸은 전수 스윕하지 말고**, 그 행을 다른 이유로 만질 때 함께 정리해 점진 수렴시킨다.

**경고(부정 사실·기계 강제 없는 계약)는 `.claude/rules/repo-traps.md`로 이관됐다**(2026-08-13). `paths` 없는 무조건 규칙이라 메인·서브에이전트에 자동 로드된다 — structure.md엔 두지 않는다. 배제 규칙·유지 판정은 그 파일에 있다.
## 한눈에

- **스택**: Expo(development build + prebuild) · Expo Router · TypeScript strict · NativeWind · TanStack Query + Zustand · orval · Jest + fast-check
- **경로 별칭**: `@/*` → `./src/*`
- **구현 범위**: `auth`·`home`·`onboarding`·`stay`·`explore`·`trip`(TRIP-205부터 — 아래 참조) **여섯 feature가 화면째 실구현**(`explore`는 TRIP-183에서 e00 지역 선택+'내 주변'으로 신설 — 이번 사이클[TRIP-197]에서 문서 소급 반영, 실제 구현은 그 사이클 산출물. 아래 `src/features/explore/` 절). `stay`는 TRIP-179(데이터 계층)·TRIP-180(`formatPrice`)·TRIP-181(e02 default 1상태)에 이어 **TRIP-182로 나머지 5상태**(loading·empty·filter-zero·partial-failure·error) + SafeArea 이관까지 붙어 **e02가 완결**됐다 — 아래 `src/features/stay/` 절. `trip`은 TRIP-203·204가 `model/`만 채운 계약 계층이었다가 **TRIP-205로 `ui/`가 처음 생겨 g01 위저드 1/2 셸이 화면째 완성**됐다(배선 `pages/trip-new-step1/`·라우트 `app/trips/new/`까지 셋이 한 사이클에 함께 신설) — 아래 `src/features/trip/` 절. 나머지 자리는 도메인 작업이 시작될 때 새로 만든다 — TRIP-173 FSD 완결 2/4에서 참조 0인 빈 배럴(`export {}`) 14개를 전부 삭제했고, 그중 8개(`archive`·`execution`·`itinerary`·`notification`·`planb`·`settings`·`stay`·`trip`)는 디렉토리째 사라졌다(`stay`는 TRIP-179로 재등장).
- **화면이 아닌 공용 신설**: `shared/map/`이 TRIP-197로 처음 생겼다 — 카카오 지도 JavaScript SDK를 WebView에 얹는 브리지(화면이 아니라 지도 렌더 표면만, 소비 화면은 후속 e05 티켓). 아래 `src/shared/map/` 절.
- **서버 상태 계층 신설(TRIP-179)**: TanStack Query `QueryClientProvider`가 `src/app/_layout.tsx`에 배선됐다(모듈 스코프 단일 `QueryClient`, 기본 옵션 미조정). orval이 `backend/docs/design/openapi.yaml`의 `stays` 태그만 코드젠(`filters.tags`, 아래 경고 참조)해 `src/shared/api/generated/`에 8파일을 생성한다. 생성 코드는 전부 `src/shared/api/mutator.ts`(`customInstance`)를 거쳐 기존 `authedClient`(Bearer·401 single-flight 리프레시)를 탄다 — 새 인증 코드 0.
- **여행 생성 계약 계층 신설(TRIP-203)**: `src/features/trip/model/`이 처음 생겼다 — **화면은 없다**(여행 생성 위저드는 TRIP-205 몫, 이 칸은 훅·타입·조립 함수까지). orval이 `trips`·`preferences` 태그를 추가 코드젠해 생성물이 **17→49파일**로 늘었다(엔드포인트 12+2, 스키마 30개 신규) — 태그 단위 필터라 오퍼레이션 하나만 못 골라 다수가 소비자 0으로 동반 생성됐다. 아래 `src/features/trip/`·`src/shared/api/generated/` 절.
- **앱 런타임 목 0건.** msw는 테스트 오라클(`msw/node`)에만 있고, `src/__tests__/noMswInStaticGraph.test.ts`가 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제한다.
- **문서 대상 파일 수·목록·export 심볼은 `structure-index.cjs`(+`--check`)가 정본이다** — 산문으로 세거나 티켓별 증감 이력을 여기 쌓지 않는다(손 카운트는 드리프트한다: 서술 282 vs 실측 318, 실측). 파일 증감 이력이 필요하면 git이 가진다.
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
## `src/features/` — 아직 시작 안 한 도메인

TRIP-173 FSD 완결 2/4에서 참조 0인 빈 배럴(`export {}` 한 줄) 14개를 `git rm`으로 전부 삭제했다. 그중 8개(`archive`·`execution`·`itinerary`·`notification`·`planb`·`settings`·`stay`·`trip`)는 그 배럴이 디렉토리 안의 유일한 파일이라 **디렉토리째 사라졌다** — `stay`는 위 절대로 TRIP-179로 재등장(데이터 계층만), `itinerary`는 위 절대로 TRIP-295로 재등장(순수 함수만). 지금 `src/features/`에는 `auth`·`home`·`onboarding`·`stay`·`explore`·`trip`·`itinerary` 7개다.

새 도메인을 시작할 때 빈 배럴부터 만들지 않는다 — **`auth`가 선례**다: 배럴 없이 딥 임포트로 시작하고, 재수출할 공개 API가 실제로 생기면 그때 배럴을 만든다. `export {};`만 있는 선점은 `fsdStructure.test.ts`의 AC-4(아래 테스트 인프라 절)가 기계로 막는다.
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
| `buildCreateTripRequest` · `CreateTripInput` | `features/trip/model/createTripRequest` | **TRIP-207로 2인자→1인자 반전.** 여행 생성 요청 조립 순수 함수 — `input.budgetTotal`이 숫자일 때만 키를 붙인다(취향은 더 이상 이 함수에 안 들어온다, TRIP-203의 "취향 러프값 자동 부착"을 뒤집음) + `preferenceSnapshot` 런타임 제거는 유지 |
| `parseBudgetAmount` · `formatBudgetAmount` · `BudgetAmount` | `features/trip/model/budgetAmount` | **신규(TRIP-207)** — 문자열↔정수 판별 유니온 파싱·포맷 순수 함수. 리포에 문자열→숫자 파싱 함수가 이전엔 없었다(`compareVersion`은 버전 세그먼트 전용). `0`도 유효값(`kind:'amount'`), 빈 문자열은 `kind:'empty'`(오류 아님) |
| `validateTripDraft` · `nightsSum` · `toCompanionType` · `tripLength` · `TripDraft` · `TripViolationCode` | `features/trip/model/tripDraft` | 드래프트 위반 코드 집합 판정(순수·PBT numRuns 500) · Σ박수 · 온보딩→서버 동반유형 매핑(TRIP-204) · 여행 기간 일수(**TRIP-206으로 export화**, 박수 초과 문구의 분모). AC-8이 UI·쿼리 훅·라우터 import를 전이까지 금지. **TRIP-205가 첫 소비자**(`pages/trip-new-step1/`가 유일하게 부름) |
| `seedMustVisits` · `resolveMustVisitSection` · `mustVisitFailureNotice` · `mergeMustVisitSeeds` | `features/trip/model/mustVisitSeed` | **TRIP-209 신규(앞 3개) → TRIP-288로 `mergeMustVisitSeeds` 추가.** 담은 장소를 '꼭 갈 곳' 시드로 바꾸는 순수 함수 4개 — 변환(`seedMustVisits`)·얼굴 판정(`resolveMustVisitSection`)·배너 문구(`mustVisitFailureNotice`)·**재시드 병합**(`mergeMustVisitSeeds({current,incoming,excluded})`, `current` 접두사 보존·추가 전용·참조 보존— 리포 최초의 차집합/병합 순수 함수, `grep`으로 확인 후 신설). `MustVisitSeedItem[]`만 받고 서버 DTO(`SavedPlace` 등)는 스토어 바깥에서 이미 걸러진 상태여야 한다(구조 가드) |
| `presetRange` · `formatDateRange` · `PERIOD_PRESETS` · `COMPANION_OPTIONS` · `PeriodPresetCode` · `CompanionCode` | `features/trip/model/tripWizardStep1` | 프리셋 코드 → 실제 날짜 범위(에포크 일수 계산, `new Date(` 미사용) + 표시 포맷(TRIP-205). 시계 안 읽음(기준일은 인자) |
| `useTripWizardStore` · `TripWizardDraft` · `TripWizardField` | `features/trip/model/tripWizardStore` | 위저드 1/2 드래프트 Zustand 스토어(TRIP-205) — persist 없음, 판정은 안 하는 상태 상자. `touched`는 건드린 축 집합(**TRIP-206이 첫 소비자**, 오류 문구 게이팅). `createdTripId`·`setCreatedTripId`는 TRIP-206 신규(g02 선투자, 심판 0건). `budgetText`·`setBudgetText`는 **TRIP-207 신규**(`TripWizardField`에 `'budget'` 추가) — 액션 하나뿐, 프리필은 이 액션을 타지 않는다(파생값). **TRIP-288 신규**: `excludedMustVisitPoiIds: string[]`(x로 뺀 `sourcePoiId` 집합, `INITIAL_DRAFT` 포함) · `addMustVisits(items)`(재시드 전용 문 — `initMustVisits`의 N2-2 동결을 안 건드림) · `resetMustVisits()`(위저드 진입마다 시드 3필드만 비움 — `reset()`과 값 출처는 같으나 키 목록은 손으로 유지하는 별도 사본, 새 시드 필드 추가 시 여기도 수동으로 넣을 것) |

| `daysInMonth` · `firstWeekdayOfMonth` · `shiftMonth` · `nightsBetween` · `isDateInRange` · `isStayRangeValid` · `applyDatePick` · `commitDateRange` · `StayDateRange` | `features/stay/model/stayDates` | 달력·날짜 순수 함수 8개(TRIP-198, 에포크 일수 기준). **여행 기간 계산엔 재사용 불가** — 같은 날/역전을 `null`로 접는 숙소 판정과 여행(0박 합법·역전은 별도 코드)은 의미가 반대다(TRIP-204 01b D5) |
| `stayRegisterSchema` · `resolveName` · `canSubmitStayRegister` · `buildStayRegisterRequest` · `StayRegisterFlow` · `StayRegisterTab` | `features/stay/model/stayRegisterForm` | 등록 폼 판정·조립(TRIP-198). zod는 날짜 순서 한 규칙만, 좌표 게이트는 zod보다 먼저 `if`로 |
| `useRegions` · `filterRegions` · `limitRegionsWhenEmpty` · `regionTint` · `groupRegionsBySido` · `RegionGroup` | `features/explore/model/regions` | **드리프트 정정(2026-08-28, 이 행이 TRIP-183 시절 `REGIONS`·`RegionCode`·상수 6개로 낡아 있었다 — TRIP-445가 서버 카탈로그로 전면 교체한 뒤 미반영).** 지연 require 서버 카탈로그 훅(`useRegions`, network 지뢰 회피)·2인자 클라 필터(`filterRegions`)·빈 검색어 상한(`limitRegionsWhenEmpty`, TRIP-469, **TRIP-597로 `RegionPickerPage` 소비처가 걷혀 현재 고아 — 함수·테스트는 존치**)·결정적 해시 색(`regionTint`). **TRIP-597 신규**: `groupRegionsBySido(regions)` — 평면 `Region[]`을 `regionCode` 앞 2자리(시도 코드)로 접는 순수 함수, `RegionGroup{sidoCode,sidoName,sido,sigungu}` 반환. 시/도→구/군 드릴다운(`RegionPickerScreen`)의 계산 축 |
| `useSavedPlaces` · `SavedPlacesOutcome` · `SavedPlacesFailureReason` | `features/explore/model/savedPlaces` | **신규(TRIP-220) → TRIP-221이 첫 소비자 → TRIP-222가 반환값을 처음 읽음 → TRIP-223으로 재확장.** 담기 토글 훅. 낙관적 업데이트(리포 최초 패턴) + 판별 유니온 결과(`{kind:'saved'\|'removed'}`\|`{kind:'failed',reason}`, reason은 `unauthenticated`\|`saved-id-unknown`\|`not-found`\|`network` 4갈래). `savedPoiIds: string[]`는 TRIP-221 추가(CTA 개수 출처). **TRIP-222부터 `PlaceExplorePage.attemptToggle`이 이 반환을 소비**해 `SAVE_FAILURE_NOTICE[reason]`을 배너로 표면화한다(이전엔 `void`로 버려 실패가 사용자에게 안 닿았다). **TRIP-223 추가**: `savedPlaces: SavedPlace[]`(원본)·`isPending`·`isError`·`refetch` — d02가 정렬·4얼굴 판정에 쓰는 유일한 데이터 출처(전부 추가, d04 무회귀) |
| `firstCoPickSlotKey` · `nextCoPickSlotKey` | `features/itinerary/model/coPickSlots` | **신규(TRIP-504)** — copick(h13→h14) 선형 순회의 "다음 갈 슬롯은?"을 산출하는 순수함수 쌍. 상세·함정은 `.claude/rules/layer-features-itinerary.md` |
| `findSavedPlaceId` · `optimisticSavedPlaceId` | `features/explore/model/savedPlaceIndex` | **신규(TRIP-220)** — poiId→savedPlaceId 역인덱스(순수) + 낙관 삽입 임시 표식(`optimistic:{poiId}`) 생성 |
| `visiblePlaces` | `features/explore/model/placeListView` | **신규(TRIP-221)** — `nameKo` 부분일치 검색 + `savedCount` 내림차순 정렬 순수 함수. 캐시 배열 제자리 정렬 금지(항상 새 배열 반환). **TRIP-222부터 그 길이가 `resolvePlaceListState`의 `itemCount`**(서버 원본 개수 아님, Seed Q2) |
| `resolvePlaceListState` · `PlaceListState` | `features/explore/model/placeListState` | **신규(TRIP-222)** — 판별 유니온(5종, `filter-zero`는 `blame` 포함) + 판정 순수 함수(PBT 대상, numRuns 500). 우선순위 `loading>error>results>filter-zero>empty`. 화면은 이 결과를 받기만 하고 재판정하지 않는다(구조 가드 AC-G3). **TRIP-223이 d02의 판정에도 재사용**(전용 판정 함수를 새로 만들지 않음 — d02는 `hasQuery`·`hasCategory`를 늘 false로 고정 호출해 `filter-zero`는 구조적으로 도달 불가) |
| `orderSavedPlaces` · `SAVED_PLACE_BADGE` | `features/explore/model/savedPlaceList` | **신규(TRIP-223)** — `savedAt` 오름차순 정렬(낙관 표식 항목은 항상 맨 끝, PBT 500런) 순수 함수 + `dataStatus`→배지 문구 `Record` 테이블(`visiblePlaces`와는 입력 타입·정렬 축이 달라 확장이 아니라 별도 함수로 분리, 02_test-designer_map.md §5-2) |
| `hasUsableCoords` · `SAVE_FAILURE_NOTICE` · `COORD_BLOCKED_NOTICE` · `PlaceSaveNotice` | `features/explore/model/placeSaveGuard` | **신규(TRIP-222) → TRIP-223으로 확장.** 좌표 유효성 순수 술어(PBT) + 담기 실패 4갈래·좌표 차단 안내 문구 테이블(`Record` 전수 강제로 갈래 증가 시 tsc가 먼저 깨짐, AC-14). **TRIP-223 추가**: `REMOVE_FAILURE_NOTICE`(해제 실패 전용 문구, 같은 `Record` 패턴) |
| `PREVIEW_PLACES` · `PREVIEW_SAVED_POI_IDS` · `PREVIEW_SAVED_PLACES` | `features/explore/model/exploreFixtures` | **신규(경량 사이클 20260805, TRIP-221·223)** — dev 프리뷰 전용 고정 픽스처(`homeFixtures.ts`와 같은 자리). `imageUrl`은 전부 `null`(INV-1, 위 `src/features/explore/` 절 행 참고) |
| `StateNotice` · `StateNoticeAction` | `shared/ui/StateNotice` | **승격(TRIP-222, `git mv` — 내용 무변경) → TRIP-223으로 판별 유니온화.** 원래 `features/stay/ui`(TRIP-182). `empty`·`filter-zero`·`error` 3상태 공용 안내 블록. **TRIP-223**: `icon?`·`illustration?` 옵셔널 슬롯 2개를 `{icon; illustration?:never} \| {icon?:never; illustration}` 판별 유니온으로 교체(03b W-1 — 옵셔널 2개가 "둘 다 생략"도 통과시켜 tsc 심판이 사라졌던 것을 닫음, 뮤테이션으로 실효 확인). 호출부: `stay`(3)·`explore`(3, d04+d02) |
| `toBaseSections` · `BaseSection` | `features/trip/model/baseSections` | **TRIP-224 신규 → TRIP-225가 첫 소비자로 확정.** 배정·저장숙소·`{startDate}` → 거점 구간 행 파생 순수 함수(BR-U1-28, PBT numRuns 500). 판정·거르기·클램프 0건 — 여행 기간 밖 배정도 산식 그대로 낸다(D3·D17). 구분자 en dash(U+2013, D2). 세 번째 인자가 `Trip` → `Pick<Trip,'startDate'>`로 좁혀졌다(TRIP-225, 소비자가 실제로 읽는 만큼만) |
| `formatSectionRange` · `formatTripRange` · `unresolvedDaysView` · `UnresolvedDaysView` | `features/trip/model/baseScreen` | **신규(TRIP-225)** — g02 표시 문자열·미해결 날짜 뷰 순수 함수. `formatSectionRange`는 구간 날짜(`'6/10–6/12'`, en dash) · `formatTripRange`는 위저드 여행 기간(`'6월 10일–13일'`, 같은 달 둘째 월 생략) · `unresolvedDaysView`는 날짜별 상태 → 앞 2개+나머지 개수로 접는 뷰(고르기·자르기·세기 세 관심사 분리) |
| `useTripBases` · `useTripCoverage` · `useAssignBase` · `useUnassignBase` · `useInvalidateBases` | `features/trip/model/useTripBases` | **신규(TRIP-225)** — 거점 배정 서버 상태 훅 5개. 조회 둘은 `enabled: tripId !== undefined` 한 줄(★10). `useInvalidateBases`는 `bases`·`coverage` 두 키만 무효화(`saved-stays` 제외, ★4). `useAssignBase`는 409를 `isAlreadyAssigned`로 접어 성공 취급(D13-b). `useUnassignBase`는 같은 재조회 구조지만 409/404 접기가 없다(비대칭, 참고 등급 결함 — devlog 인수인계) |
| `baseBlockReason` · `canSaveStayFix` · `isOutsideTripPeriod` · `extendedTripPeriod` · `tripDayOptions` · `applyDayPick` | `features/trip/model/baseGate` | **신규(TRIP-226)** — 거점 지정 전제 판정 순수 함수 6개(BR-U1-22·26·27). `baseBlockReason`은 3단 `if` 우선순위 `DATES_MISSING > DATES_REVERSED > COORD_UNCONFIRMED`. `canSaveStayFix`는 그 별칭이지만 **프로덕션 소비자 0건**(카드·시트 두 게이트는 `baseBlockReason`을 직접 호출, code-critic W-3). `extendedTripPeriod`는 기간 경계 **등호 포함**(BR-U1-27). import 0건(★17, `tripBaseGateStructure.test.ts`가 잠금) |
| `useFixSavedStay` · `useExtendTripPeriod` | `features/trip/model/useBaseFix` | **신규(TRIP-226)** — 좌표·날짜 보완 전화 담당 훅 2개. `useFixSavedStay`는 `PATCH /saved-stays/{id}` 성공 시 `saved-stays`만 무효화. `useExtendTripPeriod`는 `PATCH /trips/{id}` 성공 시 `coverage`만 무효화(응답은 안 읽음 — 화면 기억은 배선의 `setPeriod`가 별도 갱신) |
| `timeBandLabel` · `TimeBandLabel` | `features/itinerary/model/timeBandLabel` | **신규(TRIP-295)** — `HH:mm:ss` → 시간대 라벨(리터럴 유니온 4종) 사영, PBT numRuns 500 + 86,400초 전수 열거. 소비자 0(밴드 h 화면 칸이 나중에 부른다). 성격 축 미포함(범위 축소) |
| `buildSlotKey` · `parseSlotKey` · `buildSlotKeys` · `ParsedSlotKey` · `SlotKeySet` | `features/itinerary/model/slotKey` | **신규(TRIP-295)** — slotKey 조립·파싱·목록 충돌 검출(BR-U2-04, 판별 유니온 반환). 리포 최초의 키 왕복 함수(`stayKey`는 단방향). 소비자 0 |
| `joinMustVisits` · `resolveMustVisitListView` · `MUST_VISIT_NAME_PLACEHOLDER` · `buildMustVisitPins` | `features/itinerary/model/mustVisitList` | **신규(TRIP-296) → TRIP-326으로 `buildMustVisitPins` 추가.** h05 조인+얼굴 판정. `resolveMustVisitListView`는 items를 가장 먼저 본다(목록이 있으면 실패·로딩이 얼굴을 못 갈아 끼움 — TRIP-222·223과 반대 방향 재발을 같은 원리로 막음, [[얼굴 판정이 잔존 데이터를 가린다]]). `buildMustVisitPins`는 `buildDraftPins`(TRIP-297)와 같은 형태의 핀 조립기 — 좌표 없는 항목만 건너뛰고 번호를 안 당긴다 |
| `tripDayChips` · `startTimeOptions` · `startTimeLabel` · `mustVisitTimeBlockReason` · `canSubmitMustVisitTime` · `buildFixedMustVisitRequest` · `DWELL_OPTIONS` · `DEFAULT_DWELL_KEY` | `features/itinerary/model/mustVisitTimeForm` | **신규(TRIP-296)** — h07 날짜·시각·검증. `startTimeLabel`이 리포 최초의 12/24시간제 병기 포맷터 |
| `buildDraftDayTabs` · `formatDraftDayHeader` · `buildDraftPins` · `shouldKeepPollingDraft` · `resolveDraftView` · `buildGenerationGauge` · `DraftDayTab` · `DraftPin` · `DraftView` · `GenerationDayState` · `GenerationGaugeCell` · `DRAFT_POLL_INTERVAL_MS` · `DRAFT_POLL_MAX_COUNT` | `features/itinerary/model/draftView` | **신규(TRIP-297) → TRIP-337로 `buildGenerationGauge`·`GenerationDayState`·`GenerationGaugeCell` 추가 + `DraftView.listed.generating?` 필드.** h11 순수 판정 5함수 + 판별 유니온 3타입 + 상수 2개(폴링 간격·상한, 정본 부재·발명값). `DraftPage.tsx`가 유일한 소비자. **TRIP-337 추가분**: `buildGenerationGauge(tabs)`는 h10 일자별 3상태 게이지를 `tabs.hasData`에서 도출(주입 아님) — `DraftScreen.tsx`가 유일한 소비자 |
| `legDistance` | `features/itinerary/model/legDistance` | **신규(TRIP-354)** — `(distanceRanges: (string\|null)[]) => string\|null`. 슬롯들의 서버 `distanceRange` 문자열을 느슨 파싱(`km`\|`m`)·미터 정규화·합산해 날짜헤더 총이동거리 라벨("이동 3.2km") 조립. broken 값 하나라도 있으면 그날 전체를 `null`로 접는다(느슨한 파싱 실패=적은 숫자보다 안전한 침묵). INV-3(소요시간 미표시) 준수 |
| `resolvePlanState` · `formatNightsLabel` · `buildPlanDayTabs` · `isConfirmLocked` · `PlanState` · `PlanDayTab` | `features/itinerary/model/planState` | **신규(TRIP-299) → TRIP-401로 목적지 판정 2함수 추가(별도 행 없음, 같은 파일) → TRIP-337로 `isConfirmLocked` 추가.** h25 순수 판정 3함수 + 판별 유니온 2타입. `ItineraryPlanPage.tsx`가 유일한 소비자. `formatDraftDayHeader`(위 `draftView` 행)는 카드 위 날짜 헤더 표시에 그대로 재사용됐다(같은 feature 내 재사용, 새 포맷터 미신설). **TRIP-337 추가분**: `isConfirmLocked(generationState?): boolean`(1줄) — PARTIAL이면 확정 예방잠금, `resolvePlanState`와 별개 관심사 |
| `isAlreadyRegistered` | `shared/api` | **신규(TRIP-296)** — 409 판정 승격(D9). `TripNewStep1Page.tsx`가 첫 소비자, `MustVisitTimePage.tsx`가 두 번째 |
| `isNotFound` | `shared/api` | **신규(TRIP-297)** — 404 판정(`isAlreadyRegistered`와 동형). `DraftPage.tsx`의 `handleRetry`가 유일한 소비자 |
| `HeartFilledGlyph` · `CheckGlyph` · `SearchGlyph` · `WarningTriangleGlyph` · `BaseBadgePinGlyph` | `features/trip/ui/TripGlyphs` | **신규(TRIP-225)** — g02 전용 인라인 SVG 글리프 5종(카드 저장 표시·지정 완료 배지·empty 안내·notrip/error 경고·`거점` 배지 안 핀). 기존 `ChevronRightGlyph`·`BedGlyph`에 tone 확장도 이 파일(위 `src/features/trip/ui/` 절 TripGlyphs.tsx 행 참고) |
| `SearchGlyph` | `features/stay/ui/StayGlyphs` | **신규(TRIP-461)** — e04 empty CTA 돋보기. ⚠️ **동명이인**: `features/trip/ui/TripGlyphs`에도 같은 이름 `SearchGlyph`가 있다(위 행, TRIP-225) — features 간 직접 import 금지라 재사용 대신 같은 벡터를 색만 흰색(`ON_PRIMARY`)으로 바꿔 새로 그렸다. grep하면 두 벌이 나오니 import 경로로 구분할 것 |
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
| `HOME_DEFAULT_PROPS` · `HOME_NO_TRIP_PROPS` · `HOME_EMPTY_PROPS` · `HOME_LOADING_PROPS` | `features/home/model/homeFixtures` | 홈 4상수 Figma 고정 목업(Q2 — 서버 없어 유일한 데이터 소스). **TRIP-316 재작성**: 신 세대 "발견·영감 피드" 실측값으로 전면 교체, `HOME_NO_TRIP_PROPS`는 `HOME_DEFAULT_PROPS`와 바이트 동일(신 프레임에 no-trip 픽셀 정본 없음, 가정 B). **TRIP-317 추가**: `HOME_COLLECTING_PROPS`·`HOME_PLANNING_PROPS`·`HOME_UPCOMING_PROPS`·`HOME_POST_TRIP_PROPS` — discovery 기저 위에 `phase`만 주입한 프리뷰 전용 상수(실착지 `(tabs)/index.tsx`는 무변경, discovery 유지) |
| `HomeScreenProps` · `HomeSections` · `HomeCollectionCard` · `HomeSpotCard` · `HomeItineraryCard` · `HomeMagazineHero` | `features/home/model/homeTypes` | 홈 화면 prop 계약(**TRIP-316 재작성** — 구 `trip`·`nextPlan`·`resume`·`taste` 계약 전부 폐기). `HomeScreenProps{hero; sections}` — `hero`는 상태 무관 고정 블록, `sections`는 판별 유니온 `HomeSections`(`ready`/`empty`/`loading`, 3섹션 한 덩어리로 동시 전환). **TRIP-317 추가**: `HomeScreenProps.phase?: HomePhase`(옵셔널 additive, 316 무회귀) — `HomePhase`는 `discovery`·`collecting`·`planning`·`upcoming`·`postTrip` 5종 판별 유니온(화면은 `phase.kind`로 스위치만, TRIP-206 S-6). 페이로드 타입 `TripHeroData`·`HomeStatTile`·`NextStop`·`NearbyCard`·`RecapCard`·`PastTrip`·`HomeSoftNote` 7종 신규(전부 컴파일용, home 내부 소비만 — 재사용 대상 아님) |
| `useBootstrapGate` · `useSocialLogin` | `features/auth/model` | 부트스트랩 · 소셜 로그인 훅. **TRIP-173에서 `hooks/`→`model/` 개명** |
| `useTermsConsent` · `useNickname` · `useOnboardingProgress` | `features/onboarding/model` | 약관 · 닉네임 · 진행 상태 훅. **TRIP-173에서 `hooks/`→`model/` 개명** |
| `SPLASH_BACKGROUND_COLORS` · `SPLASH_BACKGROUND_LOCATIONS` · `APP_ICON_COLORS` · `AUTH_ICON_COLORS` | `features/auth/config/gradients` | 그라디언트 상수. **TRIP-173에서 `lib/`→`config/` 개명**, `AUTH_ICON_COLORS`(경고 글리프 색)는 **FSD 완결 4/4 신설**(code-critic 03b 참고-1: 이 행 갱신 누락이 "이름 다른 재구현" 경로를 여는 사례로 실측됨 — 다음에 경고 아이콘 색이 또 필요하면 여기부터 본다) |
| `BOOTSTRAP_TIMEOUT_MS` | `features/auth/model` | 부트스트랩 타임아웃 |
| `LoginPage` | `pages/login` | 로그인 훅↔화면 배선(구 `features/auth/containers/SocialLoginContainer`, TRIP-173 신설) |
| `TermsPage` · `NicknamePage` · `PrefStep1Page` · `PrefStep2Page` | `pages/onboarding-{terms,nickname,pref1,pref2}` | 온보딩 각 단계 배선(구 `features/onboarding/containers/*Container`, TRIP-173 신설) |
| `LocationPage` | `pages/onboarding-location` | **신규(TRIP-459)** — c08 위치 권한 프리프롬프트 배선. 동결 `shared/location/LocationPreprompt`(TRIP-162)의 콜백에 `expo-location` 실호출(리포 최초)을 건다. nickname→location→pref1 체인 삽입(D7 반전, `onboardingStructure.test.ts`) |
| `SplashGate` | `app-shell` | 부트스트랩 결과 라우팅(구 `features/auth/containers/SplashGate`, TRIP-173 신설 — `src/app` 밖) |
| `SPLASH_MIN_VISIBLE_MS` | `app-shell/ui/SplashGate` | **신규(TRIP-579)** — 스플래시 최소 노출 하한(900ms, 발명값). resolved여도 마운트 후 이 값이 지나기 전엔 라우팅하지 않는다. 선례 `BOOTSTRAP_TIMEOUT_MS`(위 행)와 동형(export된 발명값 상수) |
| `dwellMinutes` | `features/execution/model/dwellMinutes` | **신규(TRIP-396)** — `completedAt − arrivedAt` 분 산출 순수 함수(한쪽 null→null, 역전→`Math.max(0,·)`). `liveTimeStructure` 가드 하에 `split(':')`로 산출(Date API 미사용). **소비처 0** — 서버가 dwell을 스스로 도출해 클라→서버 dwell 필드가 계약에 없다(데드코드, 상세는 `.claude/rules/repo-traps.md` "여행 중 실행" 절) |
| `deriveVisitProgress` | `features/execution/model/visitProgress` | **신규(TRIP-396)** — `VisitCheckList → {completedPoiIds, activePoiId, visitCheckIdByPoiId}`. 완료가 진행 중보다 우선, 즉석(slotKey=null)도 도착이면 active. `projectSlotProgress`(slotProgress.ts)에 주입해 i01 active 카드를 처음 프로덕션에 띄운다 |
| `useVisitCheck` | `features/execution/model/useVisitCheck` | **신규(TRIP-396)** — 도착(`arrive`)·완료(`complete`) 낙관 갱신 훅(imperative, `savedPlaces.ts` 동형). **롤백이 슬롯키(레코드) 단위**(통짜 스냅숏 아님 — W-2 방어, savedStays/savedPlaces 선례의 개선판) |
| `buildGeofenceRegions` · `geofenceArriveRequest` · `registerGeofences` · `clearGeofences` | `shared/location/geofence` | **신규(TRIP-396)** — 예정 슬롯 좌표 → 지오펜스 등록/해제 계약(`registerGeofences`/`clearGeofences`) + 진입→`ArriveRequest{source:AUTO_GEOFENCE}` 순수 매핑(`geofenceArriveRequest`). 실 네이티브 발화(`startGeofencingAsync`)는 `registerGeofences`가 `armed:false` degrade 스텁으로 대신함(`useActualRoute.ts` 선례 동형) — expo-task-manager·background 권한·리빌드 선행, 4함수 전부 프로덕션 소비처 0 |

> ⚠️ **제거된 심볼**(참조하면 깨진다): `setApiAdapter` · `defaultAdapter` · `SCENARIO_LIST` · `getActiveScenarioKey`

> **이 목록이 못 잡는 것**: 이름이 다른 같은 기능(`hasStoredToken`이 있는데 `isLoggedIn`을 새로 만드는 경우). 그래서 **찾아봤으나 없어서 새로 만든다는 사실**을 브리프·03에 적고 게이트 요약에 올린다.
## 지금 작업하려면 (경고)

리포 함정은 **`.claude/rules/repo-traps.md`로 이관됐다** — `paths` 없는 무조건 규칙이라 메인·서브에이전트에 시작 시 자동 로드된다. 여기 다시 쌓지 마라. 부채·후속 티켓은 옵시디언 문제로그 소관.
