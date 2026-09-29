---
paths:
  - "src/__tests__/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---
# 테스트 인프라 — 공용 목·헬퍼와 전역 구조 가드

## 이 층의 관례

- **소스 스캔은 `stripComments` 후에 한다.** URL의 `://`를 주석으로 오인하지 않도록 `(^|[^:])//` 또는 `(?<!:)//` 룩비하인드를 쓴다. `loginVisual`·`staySearchStructure`·`staySearchGenerated`·`tabbarVisual` 4파일은 아직 원본 `/\/\/.*/g`를 쓴다(URL이 스캔 전에 사라진다).
- **"없어야 한다" 부정 단언은 같은 `it` 안 긍정 짝과 함께 둔다** — 모집단이 비거나 파일이 사라져도 공허 통과하지 않도록 `existsSync`·대표 심볼 앵커를 건다. 탐지기 자체는 G0 자가검사로 실제 문자열에 태워 본다.
- **폴더 재귀 스캔은 새 파일을 자동 편입한다** — 같은 축을 다른 가드가 이미 재귀로 잡으면 새 가드에 복제하지 말고 편입 앵커만 둔다.
- **모듈 목은 인라인 `jest.mock(팩토리)` 대신 모듈 스코프 파일로** — NativeWind babel이 주입하는 `_ReactNativeCSSInterop` 참조가 팩토리 스코프 밖으로 걸린다. 팩토리가 필요하면 `require('@/test-support/…')`로 끌어온다.
- **라우트를 통째 렌더하는 형제 테스트는 목을 공유하지 않는다** — 라우트가 새 훅을 물면 그 라우트를 렌더하는 파일 전수(`git grep 'render(<.*Route'`)에 무해 스텁을 추가해야 한다(홈 라우트: `tabsShell`·`tabsHomeRoute`·`tabsHomeItineraryCta`).
- **모듈 싱글턴(zustand 스토어·토스트)을 쓰는 테스트는 리셋을 파일 최상위 `afterEach`에 건다** — describe 안에만 걸면 앞 테스트 상태가 새어 거짓 green이 된다.
- **`@gorhom/bottom-sheet` 목은 통과형**이라 실개폐·스냅·딤·핸들 실렌더는 jest 사각이다(6-b 실기 전용).

| 파일 | 역할 |
|---|---|
| `src/mocks/handlers.ts` | msw 핸들러 — **테스트 오라클 전용** |
| `src/mocks/server.ts` | msw/**node** 서버 (통합 버킷 전용) |
| `src/mocks/scenarios.ts` | 시나리오 정의·상태. **앱 런타임은 안 씀**(makeAuthorize가 env로 전환됨) |
| `src/test-support/onboardingScenarios.ts` | 온보딩 목 거동. **앱이 참조하지 않는 테스트 전용 모듈** |
| `src/test-support/expoAuthSessionMock.ts` | `expo-auth-session`·`web-browser`·`crypto` 가상 목 + 스파이 |
| `src/test-support/expoRouterStackMock.tsx` | expo-router `Stack` 목(관찰 마커) |
| `src/test-support/expoRouterRedirectMock.tsx` | expo-router `Redirect`·`Stack` 목 — 진입 가드 테스트용 |
| `src/test-support/expoRouterTabsMock.tsx` | expo-router `Tabs`/`Tabs.Screen` 관찰 목 — `capturedTabsProps` 홀더 + `tabs-route-*` 마커 + no-op `useRouter()`(홈 라우트 크래시 방지 스텁). 소비자는 `tabsShell.test.tsx` 하나 |
| `src/test-support/splashGateMock.tsx` | `SplashGate` 목 |
| `src/test-support/queryClientProbe.tsx` | `SplashGate` 자리의 관찰용 가짜 — 렌더 시 `useQueryClient()`를 담아(`getObservedQueryClient`) `query-client-probe` 마커를 그린다. `resetObservedQueryClient`로 파일 간 상태를 비운다 |
| `src/test-support/nativeSocialSdkMock.ts` | 카카오·네이버 로그인 SDK `{virtual:true}` 가짜 모듈 + 스파이(default·named 네임스페이스·named 함수 세 import 형태가 같은 스파이에 닿는다). `naverInitializeSpy`는 **일부러 리셋하지 않는다**(모듈 스코프 메모이즈 구현도 관측되게) |
| `src/test-support/flushNotifications.ts` | react-query `notifyManager`에 이미 예약된 알림 **뒤에** 자기 차례를 끼워 FIFO로 기다리는 헬퍼(시간이 아니라 순서로 기다림). **스케줄러 잠금(`setScheduler(cb => setTimeout(cb, 5))`)은 여기 두지 않고 소비 파일 `beforeAll`에 인라인으로만 건다** — 공용 setup으로 옮기면 지연이 전 파일로 샌다 |
| `src/test-support/toastHarness.tsx` | `Toast.tsx` 모듈 싱글턴용 `resetToast`(타이머까지 정리) + `WithToastHost` 렌더 래퍼. 리셋은 파일 최상위 `afterEach`에 건다 |
| `src/test-support/sheetTree.ts` | 셸(`MapSheetShell`) 화면 렌더 트리 읽기 도우미(`closestAncestor`·`isInsideSheet`·`sheetScrollOf`·`renderedText`). 전제: `__mocks__/@gorhom/bottom-sheet`의 `BottomSheet`·`BottomSheetScrollView`는 같은 통과형이고 `BottomSheetFlatList`는 RN `FlatList` 그대로. ⚠️ **`JSON.stringify(screen.toJSON())`는 셸 list 경로에서 순환 참조로 죽는다**(FlatList가 헤더·푸터 엘리먼트를 호스트 props로 흘림) → 글자 검사는 화면 Text를 모으는 `renderedText`로. 소비: j01 뷰·페이지 테스트 |
| `src/test-support/tripRecordsTrip.ts` | `GET /trips/{tripId}` `Trip` 픽스처(`tripRecordsTrip(title, tripId)`) — j01 페이지가 헤더 여행명을 얻으려 그 GET을 쏘므로, MSW `onUnhandledRequest: 'error'`인 통합 테스트는 파일마다 핸들러가 필요하다 → 모양을 한 곳에 |
| `src/test-support/wizardDraftFixture.ts` | 위저드 드래프트(`useTripWizardStore`) 도우미 — `freshWizardDraft`(`getInitialState()`로 기대 초기값 도출) · `captureDraftAtNextCall`(`router.push`가 불리는 **순간**의 드래프트 포획 — 사후 비교는 push 뒤 reset을 거짓 green으로 통과시킨다) · `resetWizardDraft`(파일 최상위 `afterEach` 전용) 등 |
| `src/__tests__/tripWizardEntryCensus.test.ts` | `'/trips/new/step1'` 리터럴의 **파일별 등장 횟수**를 표로 `toEqual` — 파일 집합만 보면 같은 화면의 두 번째 "여행 만들기" 버튼을 못 잡는다. 리터럴을 헬퍼로 옮기면 red — 호출처에 그대로 둔다 |
| `__mocks__/@gorhom/bottom-sheet.tsx` | 네이티브 모듈 자동 목(통과형 — children 무조건 렌더) |
| `__mocks__/react-native-draggable-flatlist.tsx` | 드래그 리스트 모듈 스코프 목 — `renderItem`을 실제로 돌려 카드를 렌더하고, `onDragEnd`는 호스트 View prop으로 노출해 테스트가 `props.onDragEnd({data,from,to})`로 직접 발화 |
| `src/__tests__/noMswInStaticGraph.test.ts` | 정적 import 그래프를 fs로 훑어 프로덕션의 `@/mocks/*`·`msw` import 0을 기계 강제 |
| `src/__tests__/importBoundary.test.ts` | import 경계 가드 — ESLint 룰 ID(`import/no-restricted-paths` 포함·`import/no-unresolved` 불포함)로 "경계 위반"과 "해석 실패"를 구분. **단독 실행 시 `NODE_OPTIONS=--experimental-vm-modules` 필요**(`pnpm test:node` 스크립트가 넣어 준다 — `pnpm exec jest` 단독이면 실패) |
| `src/__tests__/importBoundaryLayers.test.ts` | `ESLint.lintText`+가짜 filePath로 FSD 6층 방향과 feature 격리(`src/features` 전 슬라이스 `it.each`)를 탐침한다. 빈 층 대상 허용 프로브는 실파일이 없어 `no-unresolved`가 뜨므로 "경계 룰 미발화"까지만 단언. 단독 실행 함정은 위와 같다 |
| `src/__tests__/fsdLayerStructure.test.ts` | FSD 층 구조 fs 스캔 — src 직계 디렉토리 허용목록 · features·pages·widgets 슬라이스 세그먼트 ⊆ {ui,model,lib,config} · shared 층의 상위층 import 0 |
| `src/__tests__/widgetsStructure.test.ts` | widgets 층 구조 가드 — 위젯 UI에 expo-router·`@/features`·`@/pages`·raw hex·`useState` 0(`TimeSheet.tsx`의 선택 셀 상태만 예외) · `fab-stack`·`time-sheet` 소비 앵커 |
| `src/widgets/time-sheet/ui/TimeSheet.test.tsx` | 공용 시각 시트 렌더 — testID 트리·셀 선택·`endsNextDay` 시·분 두 축·분 셀 bare 숫자(INV-3) |
| `src/__tests__/fsdStructure.test.ts` | FSD 폴더 배치(대표 파일 존재·pages 배럴·`app-shell` 위치)와 빈 배럴(`export {};`) 0 — **폴더 배치만 본다**(import 방향·내용은 안 봄). "슬라이스가 정확히 N개" 단언은 디렉토리 이름만 보므로 테스트 파일을 최종 위치에 쓰기만 해도 조기 green이 될 수 있다 |
| `src/__tests__/staySearchStructure.test.ts` | e01 숙소 검색 소스 가드 — INV-3 · raw hex(`features/stay/ui` 동적 스캔, `*Glyphs.tsx` 제외) · 프레젠테이션 순수성 · SafeArea · `resolveStaySearchState`는 페이지만 호출 |
| `src/__tests__/fabBottomOffsetStructure.test.ts` | FAB 바닥 오프셋 금칙어 가드(TRIP-1103) — `src/` 프로덕션 소스(`*.test.*` 제외)에 `bottom-[100px]` 0줄, **주석도 안 걷고 센다**(머리 주석 속 100도 잡음). 세 화면 파일을 실제로 읽었다는 앵커 포함. 84 가 아닌 다른 틀린 값(90 등)은 못 막는다 — 값 정본은 Figma·`HomeScreen.tsx` 주석 |
| `src/__tests__/stayRegisterStructure.test.ts` | e05 등록 표면 구조 가드 — 화면 `useState` 0(페이지가 상태 소유) · INV-3 · raw hex · 지도 재사용 · e02→e05 진입 배선. duration 탐지는 `/duration/i`(단어 경계 `\b`를 쓰면 `stayDuration`을 못 잡는다) |
| `src/__tests__/onboardingStructure.test.ts` | 온보딩 계층·경계 구조 가드(서버 권한 경계, `pages/` 온보딩 컨테이너 포함) |
| `src/__tests__/onboardingPrefStructure.test.ts` | 취향 스토어·모델 구조 가드 — persist 금지·`@/shared/api` 미참조·`create(` 표기 |
| `src/__tests__/homeStructure.test.ts` | 홈 소스 스캔 가드 — 픽스처 상수화·INV-3·raw hex·SafeArea·탭바 격리 + 단계 얼굴은 `HomeScreen.tsx` 한 파일(`ui/*Face.tsx` 분리 0) |
| `src/__tests__/onboardingPrefRoutes.test.tsx` | 취향 1/2·2/2 라우트 존재·내비게이션 계약 가드 — push/replace/back 분기 |
| `src/__tests__/tabsShell.test.tsx` | `(tabs)/_layout.tsx` 배선 가드 — 5탭 등록 순서·`tabBar` 렌더프롭·활성 매핑/press→navigate. 홈 라우트를 렌더하므로 홈이 무는 훅(`useGetTrips`·`useSavedPlaces`·`useSavedStays`)의 무해 스텁을 가진다 |
| `src/__tests__/tabbarVisual.test.ts` | `BottomTabBar.tsx` 비주얼 소스 스캔(치수·아이콘 좌표계·색 토큰). `active` 변형·실제 겹침은 사정거리 밖 |
| `src/__tests__/tabbarOverlay.test.ts` | 탭바 오버레이 소스 가드 — `BottomTabBar.tsx` 루트에 `absolute`+`bottom-0`+`h-[84px]` 동거 + 화면별 하단 패딩 ≥84(일정 빈 상태는 `MyTripsListScreen.tsx`). 실제 겹침·투명 밴드·터치 통과는 6-b 전용 |
| `src/__tests__/tabsExploreRoute.test.tsx` | `(tabs)/explore.tsx` 라우트 배선 — 구획 렌더·검색 제출(`decodeURIComponent` 후 비교)·카드·부분 실패 생존(INV-4). `useStaySearch`·`useSavedPlaces`는 딥 경로로 목(다른 경로면 실 훅이 돌아 QueryClient 부재로 죽는다) |
| `src/__tests__/exploreLandingAxisRemoval.test.ts` | d01 랜딩에서 축 세그먼트 금칙 토큰 0 + 앵커 3종 생존 소스 가드 |
| `src/__tests__/tabsExploreRouteSave.integration.test.tsx` | d01 숙소 카드 저장 하트 통합(msw) — `useSavedStays`는 **실물**(낙관/롤백 관찰). 담김/미담김은 서로 다른 글리프 testID로 구분(fill 색 토글은 jest가 못 본다) |
| `src/__tests__/loginVisual.test.ts` | `AuthGlyphs.tsx` `WarningTriangleGlyph` 소스 스캔 — 함수 블록 슬라이스로 같은 모듈 다른 글리프가 개수를 채우는 우회를 차단. 라벨·배너는 `SocialLoginScreen.visual.test.tsx`의 렌더 층(className은 렌더 트리에 prop으로 남는다) |
| `src/__tests__/authSheetHandleStructure.test.ts` | c02 로그인 `Sheet`의 `<BottomSheet … handleComponent={null}>` **엘리먼트 결합** 정규식 가드 — prop이 그 태그에 있음까지만 증명(실렌더 핸들 수는 목 사각) |
| `src/__tests__/devPreviewPref.test.tsx` | 프리뷰 `pref1`·`pref2` 상태 렌더 가드 — 빈 선택 상태로 직접 렌더, 가드 우회 아님 |
| `src/__tests__/devPreviewHome.test.tsx` | 프리뷰 홈 키 가드 — 딥링크·토글 진입·미존재 키 splash 폴백 결정론 |
| `src/__tests__/onboardingEntryGuard.test.tsx` | 온보딩 진입 리다이렉트·완료자 방어 가드 |
| `src/__tests__/rootLayout.test.tsx` | 루트 부팅 골격 |
| `src/__tests__/rootLayoutSafeArea.test.tsx` | `SafeAreaProvider` 도입 후에도 자식이 렌더되는지 |
| `src/__tests__/devPreview.test.tsx` | 프리뷰 상태 렌더. 런타임 지뢰 목으로 네트워크 격리 |
| `src/__tests__/devPreviewDeepLink.test.tsx` | 프리뷰 딥링크 `?state=` 파라미터 → 초기 화면 결정론 가드(부재·오타·대소문자·빈 문자열·배열 값 → 전부 splash 폴백) |
| `src/__tests__/design-tokens.test.ts` | 디자인 토큰 가드 |
| `src/__tests__/openapiContract.test.ts` | `backend/docs/design/openapi.yaml`을 글자로 읽는 계약 앵커(YAML 파서 의존 0) — `/stays/search` 경로·`servers`·정의 없는 `$ref` 0 · 파라미터 이름 완전일치 |
| `src/__tests__/rootLayoutQueryProvider.test.tsx` | 앱 루트를 실제 렌더해 `SplashGate` 자리(`queryClientProbe` 목) 안쪽에서 진짜 `QueryClient`가 잡히는지 |
| `src/__tests__/rootLayoutToastHost.test.tsx` | `<ToastHost/>`가 `SplashGate` **바깥**(형제)에 한 번만 배치됐는지 배선 가드 |
| `src/shared/ui/Toast.test.tsx` | `showToast`/`hideToast` 가짜 타이머 테스트 — `TOAST_VISIBLE_MS` 뒤 사라짐 · hide가 타이머 정리 · 연속 show는 앞 타이머 취소. 페이드 애니메이션을 안 넣은 이유도 같다(타이머 카운트를 흐림) |
| `src/__tests__/staySearchGenerated.test.ts` | 커밋된 코드젠 출력을 fs로 읽어 검사(`pnpm codegen` 실행 안 함) — 파일 목록·심볼·파라미터·INV-3·응답 표현력. 파일 목록은 하한형이라 나중에 들어온 생성물 내용은 이 가드 밖 |
| `src/__tests__/visitCheckGenerated.test.ts` | 생성 타입의 `updatedAt`·`expectedUpdatedAt`·`serverUpdatedAt` 계약 — non-nullable은 `NULLABLE_UPDATED_AT` 부정 짝으로 잠근다(`/updatedAt:\s*string/`만으로는 `string \| null`도 매치) |
| `src/__tests__/recordsDurationStructure.test.ts` | `features/record/ui/**` 재귀 소요시간 표기 0(INV-3). `recordsStructure` G6과 기능적으로 겹친다 — 동적 `${m}분` 렌더 사각은 `VisitTimeSheet.test.tsx`(렌더 층)가 메운다 |
| `src/__tests__/recordAttributionStructure.test.ts` | `stayAttribution.ts`에 `new Date(`/`Date.now(` 0(타임존 안전) + record가 생성 훅을 직접 감싸는 긍정 앵커 |
| `src/__tests__/recordPhotoBinaryGuard.test.ts` | `features/record`+`shared/photo` 재귀 — 사진 바이너리·`storage_key` 금칙어와 `expo-image-picker`/`expo-media-library` import 0(INV-U5-03). 범위를 `shared` 전체로 넓히면 생성 코드 주석의 `storage_key`로 거짓 red |
| `src/__tests__/reflectionDistanceFormatStructure.test.ts` | 회고 거리 표기 단일출처(TRIP-1086) — `formatKm.ts` 실재 + 세 소비처(`ReflectionStatsRow`·`summaryStats`·`reflectionFallback`)가 `formatKm(`을 부르고 `${…istanceKm}km` 직접 보간 0. **주석을 걷은 뒤 줄 내용으로 판정**한다(줄 번호 판정은 첫 실행 red였음) |
| `src/__tests__/reflectionFallbackStructure.test.ts` | 표시본 단일출처 — `resolveDisplayNarrative`는 `reflectionFallback.ts`에만 있고 페이지만 호출, `features/reflection/ui/**`에 `draftNarrative`·`editedNarrative` 참조 0 |
| `src/__tests__/reflectionStructure.test.ts` | `features/reflection/**` 경계(다른 feature import 0)·3층·새 HTTP 0·INV-3 재귀 가드 — j04 요약·j06 공유 카드 파일도 재귀로 자동 편입 |
| `src/__tests__/reflectionSummaryStructure.test.ts` | j04 요약 표면 전용 — testID 소유 앵커·3층·`useTripSummary` 무HTTP. 경계·재귀 INV-3은 `reflectionStructure`에 위임 |
| `src/__tests__/shareCardStructure.test.ts` | j06 공유 카드 — 캡처·저장·업로드 계열 금칙 import 0(BR-U5-46) + `buildShareCard`·`captureShareImage` 실참조 |
| `src/__tests__/travelStyleStructure.test.ts` | j05 여행 스타일 — 저장 mutation 훅·`customInstance`·axios 0(INV-U5-09, `reflectionStructure` G5는 mutation 훅을 안 봐서 이 가드가 유일한 그물) · `app/records/style.tsx` 존재+`app/records/index.tsx` 부재 · `@/features/settings` 참조 0 |
| `src/__tests__/recordsCalendarStructure.test.ts` | j07 기록 캘린더 — 3층·testID 소유·`@/features/stay`·`@/features/trip` 0 + `@/shared/date` 참조 · 읽기전용 · `shared/date/monthGrid` INV-3(재귀 스캔 밖이라 여기가 유일한 그물) |
| `src/__tests__/tabsRecordsRoute.test.tsx` | `(tabs)/records.tsx` 라우트 렌더 — 카드→기록 push · 빈 상태→새 여행 push · 월 이동 |
| `src/__tests__/mapBridgeStructure.test.ts` | 지도 키·도메인 소스 스캔 — 키는 env 참조로만, git 추적 전수에 키 리터럴 0. **git 추적 전수는 `git ls-files`로 인덱스를 열거한다** — 테스트 파일을 `rm`만 하고 스테이지하지 않으면 없는 경로를 열어 ENOENT로 FAIL한다(`git rm`/`git add`로 스테이지) |
| `src/__tests__/tripDraftBoundary.test.ts` | `tripDraft.ts`의 import를 **전이 의존까지** 순회 — 평면 금칙 목록은 `@/shared/api` 배럴 한 줄로 뚫린다(그 배럴이 axios를 끈다) |
| `src/__tests__/tripWizardEntryReset.test.tsx` | 위저드 레이아웃 마운트 시 시드 초기화·형제 화면 효과 순서·리렌더 보존. 실제 라우터가 레이아웃을 재마운트하는지는 jest 밖(6-b) |
| `src/__tests__/tripWizardStep1Boundary.test.ts` | g01 화면 그래프에 쿼리 훅·라우터·`expo-location` 0 · `new Date(`·`Date.now(` 0(기준일 주입) · 위저드 라우트 존재·`(tabs)` 아래 부재 |
| `src/__tests__/tripWizardStep2Structure.test.ts` | g02 라우트 두께 + 화면·배선에 `.sort(`·인라인 박수 재계산 0(`nightlyBaseCards`가 소유) + 제거된 배선 needle 부재(`setPeriod` 등) · 주소 조회·지역 판정(`useQueries`·`sidoKey` 등)은 `features/trip/model`에만 |
| `src/__tests__/tripBudgetStructure.test.ts` | 예산 3파일에 `toLocaleString`·`Intl.` 0 — node 동작 테스트는 Hermes 서식 차이를 못 봐 이 파일이 유일한 그물 |
| `src/features/trip/model/budgetAmount.tierForAmount.test.ts` | `tierForAmount`(TRIP-1091) — 경계 6점(499,999/500,000/…/3,000,000)·0·1 예제 + PBT 4(범위 내·단조·칩 대표 금액 왕복·구간별). ⚠️ 생성기를 `oneof(0~5,000,000, 0~1e12)`로 섞는다 — 균등 0~1e12만 쓰면 세 경계가 있는 300만 아래를 거의 안 밟아 단조성이 공허하게 참 |
| `src/pages/trip-new-step1/ui/TripNewStep1Page.budgetTier.integration.test.tsx` | g01 예산 행·시트 칩 등급 출처(TRIP-1091) R1~R10 — 프리필 등급을 기대 등급과 **다르게** 둔다(같으면 버그 코드도 통과). R5는 프리필 `고급+1,200,000`(역산하면 중간)으로 "프리필 금액은 역산하지 않는다"를 행·시트 양쪽에서 잠그고, R10은 `PUT/PATCH /me/preferences` 0회를 `GET` 관측 짝과 함께 단언 |
| `src/features/trip/model/budgetAmount.tier.test.ts` | `budgetForTier(tier)` 1인자(TRIP-1067) — 고정 맵(저가30만·중간100만·고급200만·럭셔리400만, 온보딩 범위 가운데값)×예제 4 + 무작위 500회(박수·인원 인자를 넘겨도 안 바뀜, `Function.length`로 박수 인자 부재 확인 — 기본값 인자는 `length`에 안 잡혀 `@ts-expect-error`로 이중 판정). 구 TRIP-1045 단가×박수 PBT는 폐기 |
| `src/features/trip/model/budgetAmount.isBudgetTier.test.ts` | `isBudgetTier`(TRIP-1107) U1~U6 — 칩 4값 참·`undefined`·4값 밖(`'LOW'`)·상속 키(`'toString'`) 거짓. 뮤테이션 실측: `in` 교체는 red 7, 4값 배열 사본 `.includes` 교체는 green(동작이 같아 원리적으로 못 잡음 — 소스 리뷰 몫) |
| `src/pages/trip-new-step1/ui/TripNewStep1Page.budgetPrefill.integration.test.tsx` | g01 예산 시트 첫 열림 등급 프리필(TRIP-1107) AC-1~8 — 온보딩 금액·적용 금액이 등급 대표 금액을 이김, 열기만으로는 스토어 커밋 0. ⚠️ AC-2의 "같은 칩을 눌러도 값이 같다" 단언은 판별력이 없다(이미 채워진 칸에서 같은 칩 재누름은 값이 안 바뀜) — "칩 경로와 같은 출처"를 실제로 지키는 건 `budgetSheet` D5 |
| `src/__tests__/savedPlacesStructure.test.ts` | 서버 DTO 식별자를 Zustand 스토어에 복사하지 않는다(`frontend/README.md`). 파생값만 복사한 스토어는 못 잡는다 |
| `src/__tests__/placeDetailStubRoute.test.tsx` | `explore/places/[poiId].tsx` 라우트가 `@/pages/place-detail`에 위임하는지(페이지 목으로 QueryClient 없이 렌더) |
| `src/__tests__/placeExploreStructure.test.ts` | d04 소스 스캔 — INV-3·zustand 0·이미지 URL 발명 금지·화면 순수성·`@/features/stay`/`@/features/trip` 0(예외: `PlaceExplorePage.tsx`의 `tripWizardStore` 한 경로)·raw hex·SafeArea |
| `src/__tests__/regionCatalogStructure.test.ts` | 지역 카탈로그 서버 연동 — 소비처에 `REGIONS`·`RegionCode` 0 + `useRegions` 참조 · '내 주변' 배선 완전 부재 · 화면 `.sort(` 0. `regionTint` 팔레트 hex는 어느 스캔에도 안 걸린다 |
| `src/__tests__/sharedUiStructure.test.ts` | `shared/ui` 재귀 — 상위층·zustand import 0 · INV-3 · URL 리터럴 0 · raw hex. `useState`·router·query·axios는 이 파일 밖(`eslint.config.js` 파일 단위 블록이 잡는다) |
| `src/__tests__/placeExploreStateStructure.test.ts` | d04 상태 판정 단일 출처·새 prop 옵셔널·타이머 금지(`shared/ui/Toast.tsx`만 면제). `features/explore/ui`가 `showToast`로 우회하는 것은 못 잡는다 |
| `src/__tests__/pagesLayerStructure.test.ts` | `src/pages` 층 전수 재귀 — INV-3·zustand·`https?://`·타이머·raw hex 0 + 긍정 짝. 새 페이지 슬라이스는 자동 편입 |
| `src/__tests__/devPreviewMap.test.tsx` | 프리뷰 `map-default`가 지도 컴포넌트를 렌더하는지 — env 미설정이라 **항상 키 없음 분기(`map-failure`)만** 밟는다 |
| `src/__tests__/socialSdkSecrets.test.ts` | 소셜 SDK 키·시크릿 소스 스캔 — `.env` 미추적 · git 추적 전 파일에 `VAR=<값>` 대입 0(공백 클래스는 `[^\S\n]` — `\s`는 개행을 건너 다음 줄을 값으로 오판) · `app.config.ts` env 참조 |
| `src/__tests__/socialSdkConfigPlugin.test.ts` | `app.config.ts` kakao·naver config plugin 등록 — 옵션 키 허용목록·값 출처·**provider 간 값 교차 없음**(`[string, any]`라 tsc가 못 잡는 자리) |
| `src/__tests__/devPreviewExplore.test.tsx` | 프리뷰 탐색 2키가 항목을 실제로 1개 이상 그리는지(빈 목록 공허 통과 차단) |
| `src/features/trip/ui/StaySelectSheet.test.tsx` | g02 숙소 선택 시트 props-only 렌더 — 단일 선택·지정 disabled(`toBeDisabled`+press+핸들러 0회)·실패 인라인·가격/사진 미렌더 |
| `src/pages/trip-new-step2/ui/TripNewStep2Page.staysheet.integration.test.tsx` | 카드 탭→시트→선택→지정 통합 — `useAssignBase` 인자 `{tripId,data:{savedStayId,dateFrom,dateTo}}` 완전일치 |
| `src/__tests__/staySelectSheetStructure.test.ts` | 시트 props-only 소스 가드 — `useState`·router·query·store·타 feature import 0 + 가격/사진 미렌더 소스 짝 |
| `src/__tests__/itineraryMustVisitStructure.test.ts` | h05·h07 소스 층 가드 — `pagesLayerStructure` 자동 편입 + 409 판정 공용 승격 요구 |
| `src/__tests__/itineraryDraftStructure.test.ts` | h11 소스 가드 — 라우트 두께·`pages`+`features/itinerary` 타이머 0(폴링 결과는 `draftView.test.ts`) · 심볼·경로 계약(`ZeroCandidateScreen.tsx` 부재). `startAt` 소스 스캔은 고정 블록 예외 때문에 표현 불가라 두지 않는다 |
| `src/__tests__/generationGaugeFoldStructure.test.ts` | TRIP-1040 배치 감시관 — `foldGenerationGauge` 자가검사(예시 3종) + `DraftPage.tsx`·`preview.tsx`가 실제로 그 함수를 named import·호출하는지(문자열 스캔, "판단은 소비처" 계약이 소스에서 새지 않게 고정) |
| `src/__tests__/itineraryMapSurfaceStructure.test.ts` | 지도 호출부 옵트인 경계 — `src/` 전체에서 `<MapView`를 쓰는 파일이 명부(`OPEN_CALLERS`·`LOCKED_CALLERS`·`NO_LINE_CALLERS`)와 정확히 같아야 하고, `MapSheetShell`의 `mapViewOnly={false}`는 `LiveHubView.tsx` 하나(`SHELL_UNLOCK`). **새 지도 호출부는 명부 등재와 파생 카운트(`openTags`·`defaultTags`) 갱신이 필요**하다(미등재면 fail-closed red — 반복 실측) · 사진·URL 유출 0 · 좌표 간격 · `DraftScreenProps` 필드 동결 |
| `src/__tests__/planbReplanDraftStructure.test.ts` | i13·i16 소스 가드 — INV-3 · 무쓰기(apply 훅 import 0) · 화면 순수성(dispatch는 페이지 1곳) |
| `src/__tests__/liveLocationRoute.test.tsx` | i20·i21 라우트 얇은 위임 — `useLocalSearchParams` 값이 페이지에 도달하는지(한 쌍만 확인이라 하드코딩도 통과) |
| `src/features/itinerary/ui/GenerationFallbackScreen.test.tsx` | h07 폴백 인터스티셜 렌더 — 카피 완전일치·체크리스트·하드실패 변형·INV-3 렌더 텍스트 스캔. 지도는 `@/test-support/mapViewMock` |
| `src/features/itinerary/ui/GeneratingScreen.pulse.test.tsx` | h07 3단계 원 펄스(TRIP-1046, 20ms 표본) — `jest.spyOn(NativeAnimatedHelper.default,'shouldUseNativeDriver').mockReturnValue(false)`로 JS 드라이버 강제(네이티브 드라이버 아래선 가짜 타이머로도 opacity가 안 움직임) + `Animated.timing` 스파이 인자로 `useNativeDriver:true` 설정을 별도 확인. 처음 움직인 표본 순서 1<2<3(엄격 증가)로 stagger 판정, 3~4초 창의 얼굴 종류 수(`Set.size>1`)로 loop 반복(1회성 펄스 회귀) 판정, 언마운트 뒤 애니메이션 값 불변 2건(응답 전/후 이탈). 세 원의 구조 서명(호스트+className, style 제외)이 같아야 함(⚑C 동일 얼굴) |
| `src/pages/itinerary-generating/ui/GeneratingPage.leaveToast.integration.test.tsx` | h09 이탈 토스트(TRIP-1046) — `leave()`(`rerender(null)`로 페이지만 트리에서 빼고 `ToastHost`는 유지, `unmount()`는 호스트까지 지워 못 씀) + `jest.spyOn(ToastModule,'showToast')` 호출횟수로 "정확히 1회" 판정(호스트는 1개만 그려 화면상으론 안 갈림). phase를 바꿔 `rerender`할 때 새 엘리먼트(`cloneElement`)를 넘겨야 재렌더됨(같은 JSX 참조면 React가 건너뜀). StrictMode 흉내 cleanup(mount 2·cleanup 1)에서 토스트 0건 단언 포함 |
| `src/__tests__/itineraryTimeStructure.test.ts` | `features/itinerary/ui` 재귀 소요시간 문자열 0(INV-3) + 일정 라우트 두께 |
| `src/__tests__/itineraryEditStructure.test.ts` | h24 편집 파일 정본 경로 실재 + 재귀 모집단 편입 앵커 + INV-3·raw hex |
| `src/__tests__/itineraryEditSheetStructure.test.ts` | h24 편집 화면이 `@gorhom/bottom-sheet`·`useItineraryEditStore`를 직참조하지 않는지(화면 순수성) |
| `src/__tests__/tabsItineraryRoute.test.tsx` | 일정 탭 "내 여행" 목록 — 카드 렌더·무리다이렉트(`Redirect` 목의 마커 부재가 트립와이어)·빈 상태·스켈레톤·최신순·**눌린 카드의** 목적지·카드별 itinerary GET 파생. 줄바꿈 부제는 `.props.children` 직단언(`toHaveTextContent`는 `\n`을 정규화) |
| `src/__tests__/tabsHomeRoute.test.tsx` | `(tabs)/index.tsx` 홈 라우트 — FAB·더보기 push · 여행 유무별 얼굴 · 실 `Trip` 값 · 로딩/오류 · 장소/숙소 배지 교차배선(서로 다른 값으로 주입) |
| `src/features/itinerary/model/itineraryDestination.test.ts` | `resolveItineraryDestination` 표 전수 `it.each`(404→method … CONFIRMED→live), 입력 타입은 함수 시그니처에 고정 |
| `src/__tests__/tabsHomeItineraryCta.test.tsx` | 홈 여행 카드 CTA가 탭과 같은 목적지로 push · 로딩·비-404 오류 중 press는 미호출(INV-4) |
| `src/features/itinerary/ui/MethodPickerScreen.test.tsx` | h04 방식 선택 — 차단 사유(BR-U3-01)·안내 액션·뒤로 무회귀 |
| `src/pages/itinerary-plan/ui/ItineraryPlanPage.escape.integration.test.tsx` | h25 4얼굴 탈출구 — msw로 얼굴 강제(훅 목 금지) + `useRouter` 4메서드 목. 딥링크(`canGoBack()===false`)는 `replace('/(tabs)')` 완전일치(`/(tabs)/itinerary`는 리다이렉트 함정) |
| `src/__tests__/itineraryManualStructure.test.ts` | h19·h20 소스 가드 — "이동 시간" 류 카피 0(INV-3) + 재귀 편입 |
| `src/features/itinerary/model/itineraryEditStore.addSlot.test.ts` | `addSlot` 순수함수 — 비파괴 append + 읽기전용 5필드 키 완전일치(여분 키 누출 차단) |
| `src/pages/itinerary-manual/ui/ManualPlanPage.integration.test.tsx` | h19 배선 — 마운트 POST 1회·여분 키 0. 폴백 배너 부재 단언은 이 표면에 폴백 경로가 없어 지금은 공허 통과(미래 회귀 트립와이어) |
| `src/pages/itinerary-manual/ui/PlaceAddPage.integration.test.tsx` | h20 배선 — 검색·클라 필터·카테고리 재조회. **add→PUT 전체 플로우는 범위 밖**(캐시 무효화 회귀 심판 없음) |
| `src/entities/itinerary-slot/lib/categoryPlaceholder.test.ts` | `resolveCategoryPlaceholder` 매핑 — 7종 `tintClass` 완전일치·폴백·iconKey distinct. 프로토타입 키 입력은 다루지 않는다 |
| `src/features/itinerary/ui/MyTripCard.test.tsx` | h37 카드 렌더 — 제목·메타·부가정보 완전일치 + 배지/resume 유무 짝. `metaLine` 조립 로직은 컨테이너 소관이라 여기서 안 돈다 |
| `src/__tests__/liveTimeStructure.test.ts` | `features/execution/**` + 허브 파일(`HUB_FILES`)에 슬롯 시각 재추정 산술 0(BR-U4-34) — `new Date`·`Date.now`·`.getHours` 등·날짜 라이브러리·`startAt`/`endAt` 인접 산술 금지. execution 안 날짜 포맷이 `shared/date`에 있는 이유 |
| `src/__tests__/executionDurationStructure.test.ts` | `features/{execution,planb}/ui/**` 소요시간 표기 0(INV-3) — 렌더 스캔이 못 보는 `accessibilityLabel`도 잡는다 |
| `src/__tests__/noStepCountStructure.test.ts` | 전역 걸음 수 계열 심볼 0(BR-U4-41) — 합성어만 탐지(`stepper`·`step1` 오탐 제외) |
| `src/__tests__/liveHubStructure.test.ts` | i01 허브 재작성의 삭제·이관 가드 — 사라진 표면 부재·삭제 모듈 import/jest.mock 0·허브 뷰는 `*Glyphs.tsx` 경유로만 SVG |
| `src/__tests__/devPreviewLiveHub.test.tsx` | `live-hub-{closed,half,expanded}` 프리뷰 키가 `LiveHubView`를 초기 스냅과 함께 마운트하는지 |
| `src/__tests__/planbManualRoute.test.tsx` | i07 라우트가 `ItineraryEditPage`를 `tripId`+`inTrip=true`로 부르고 `variant`가 새지 않는지 |
| `src/__tests__/planbEditUnifyStructure.test.ts` | i07·h12 통합 가드 — 옛 planb-manual 라우트·위젯·testID·문구 전역 0 + INV-3 |
| `src/features/planb/model/reorderKeepingLocked.test.ts` | 잠긴 칸 고정 재정렬 예시 + fast-check PBT(고정 index 불변·순열·상대 순서 보존). 이 규칙을 부르는 프로덕션 드래그 표면은 아직 없다 |
| `src/pages/itinerary-edit/ui/ItineraryEditPage.inTrip.integration.test.tsx` | h12·i07 페이지 계약 — 완료 알약 press는 시트 안 엶 · 드래그가 `reorderKeepingLocked` 경유 · CONFIRMED 409는 정직 안내(라우터 4메서드 0회) |
| `src/pages/itinerary-edit/ui/ItineraryEditPage.save-exit.integration.test.tsx` | 저장 성공 뒤 복귀 계약 — 위반 없음→back/replace 폴백 · 위반(h12·i07·다른 날만)→머묾+배지 · 연타 PUT 1회 · 토스트 완전일치. 편집 스위트 6파일의 expo-router 목은 `canGoBack`이 있어야 한다(없으면 onSuccess TypeError가 삼켜짐) |
| `src/__tests__/planbSafeAreaStructure.test.ts` | `PlanbDiffPage` top-edge 래퍼(≥2 — 이중 래핑 회귀는 못 잡음)·`useSafeAreaInsets` 미사용(Provider 부재 크래시 회피) · i19 시트는 전면화면 래퍼를 들고 오지 않음 |
| `src/__tests__/savedStaysStructure.test.ts` | e04 저장한 숙소 3층 책임·화면 순수성·raw hex |
| `src/__tests__/myStaysStructure.test.ts` | `features/settings/ui` 재귀 INV-3 · raw hex(파일명 필터 — 새 화면은 필터에 추가해야 한다) · `MyStaysScreen` SafeArea |
| `src/features/settings/model/stayTripLink.test.ts` | `buildStayTripLink` — 연결/미연결/혼합/first-wins/유령 base 배제/빈 입력 |
| `src/features/settings/ui/MyStaysScreen.test.tsx` | l04 화면 — 행 표시·토글→다이얼로그 게이트(확정에서만 콜백)·disabled·empty·INV-3 |
| `src/pages/my-stays/ui/MyStaysPage.integration.test.tsx` | l04 페이지 배선 — 화면은 null 반환 props-캡처 목(NativeWind 함정 회피) · DELETE 인자·무효화(`invalidateQueries` spy) |
| `src/features/settings/model/styleCardModel.test.ts` | `buildStyleCardModel` — official 매핑·insufficient는 preview 미유출·게이지 전수 |
| `src/features/settings/ui/StyleSummaryCard.test.tsx` | 스타일 카드 — 채움/빈 점을 서로 다른 testID로 세어 SVG fill 함정 차단 · 상세 진입 disabled degrade(INV-4) |
| `src/pages/my-page/ui/MyPage.integration.test.tsx` | 마이 페이지 배선+배치(`layer-pages.md` `my-page` 행) |
| `src/__tests__/notificationKindGuard.test.tsx` | 알림 설정 화면이 계약 밖 kind(COMMUNITY·SYSTEM)를 주입받아도 렌더하지 않는지(`VISIBLE_ROWS` 자체 소유) |
| `src/__tests__/notificationStructure.test.ts` | `features/notification/**` 다른 feature import 0 + 3층 앵커 |
| `src/__tests__/notificationDurationStructure.test.ts` | 알림 표면 소요시간 심볼 0(INV-3) + 탐지기 자가검사 |
| `src/features/settings/model/preferenceDraft.test.ts` | 취향 역변환 — 안 만진 축은 omit(`toStrictEqual`로 여분 `undefined` 키까지) |
| `src/features/settings/ui/PreferencesEditScreen.integration.test.tsx` | 취향 편집 MSW 통합 — 시드·한 축 PUT 바디·400 인라인(INV-4) |
| `src/features/settings/ui/PreferencesEditScreen.baseline.test.tsx` | 저장 diff 기준선이 시드 시점으로 얼어 있는지(lost update 방지) |
| `src/features/settings/model/personalizationCopy.test.ts` | 개인화 문구표 전수 + `NOT_ENOUGH_RECORDS`에 동의 유도 문구 없음(BR-U5-44) |
| `src/features/settings/ui/PersonalizationScreen.test.tsx` | reason 3얼굴·목록 개수·토글 배선 — `NOT_ENOUGH_RECORDS`는 토글 ON 유지+동의 문구 부재 |
| `src/pages/settings-personalization/ui/PersonalizationPage.integration.test.tsx` | 토글 → GRANT/REVOKE — `reason`이 아니라 `applied`로 판정하는 뮤턴트를 잡는 `NOT_ENOUGH_RECORDS` 케이스 포함 · termsVersion 필터 · `invalidateQueries` spy |
| `src/shared/api/patchConsent.test.ts` | `patchConsent` 와이어 계약 — URL에 termsType, body는 `{action, termsVersion}` 두 필드만 |
| `src/__tests__/personalizationStructure.test.ts` | l05 3층 배선·라우트 무로직(경계는 `settingsBoundary.test.ts`가 재귀로 편입) |
| `src/__tests__/editSheetHandleStructure.test.ts` | g01/g02 편집 시트 핸들 단일화 — `handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}` 바인딩 + 그래버 바 부재(클래스 순서 무관 정규식). `#DDDDDD`는 `hairline-strong` 토큰 값의 손 복제라 토큰이 바뀌어도 green |
| `src/__tests__/homeGlyphColorStructure.test.ts` | `HomeGlyphs.tsx` `LocationPinGlyph` stroke 색 소스 스캔 — 이 테스트가 만들어질 당시엔 "RNTL이 SVG `stroke`를 못 봐서 유일한 그물"로 적었으나, TRIP-1050 실측 정정: host 노드(`typeof n.type==='string'`)의 `props.stroke.payload`(`processColor` 정수)로 렌더 트리에서도 잴 수 있다 — `findAll`이 이 파일에서 소스 스캔을 쓴 것은 원리적 불가가 아니라 이 파일이 그 방식을 먼저 택한 것뿐(근거: `frontend/src/features/explore/ui/SavedPlaceListScreen.test.tsx:680-687`) |
| `src/__tests__/tripPeriodFromNightsStructure.test.ts` | g01 기간 시트 "시작만 고르기" 전환 — 옛 표면 prop·testID·헬퍼 부재 + `applyRangePick` 고아 0 + 프리뷰 총량 |
| `src/features/trip/model/tripWizardStore.periodFromNights.test.ts` | 시작·박수 재계산 예시 + fast-check 액션열 PBT(**매 단계 뒤** 끝−시작=Σnights, 오라클은 구현과 다른 계산 경로). `reset()`은 파일 최상위 `beforeEach`+`afterEach` 둘 다 |
| `src/__tests__/devPreviewDeleteDialog.test.tsx` | `settings-delete-dialog` 프리뷰가 설정 화면 위에 다이얼로그를 나중 형제로 겹쳐 그리는지. 배경 비교는 testID 순서열만이라 표시값 드리프트는 못 잡는다 |
| `src/__tests__/deleteAccountDialogGate.test.ts` | `DeleteAccountDialog`의 프리뷰 전용 prop `initialStep`이 프로덕션에 새지 않는지(BR-U6-25 법적 게이트). JSX prop 추출은 글자 단위 근사라 prop 값 문자열에 짝 안 맞는 `}`·`//`가 있으면 뒤 prop을 놓친다 |
