---
paths:
  - "src/__tests__/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---
# 테스트 인프라 — 공용 목·헬퍼와 전역 구조 가드

## 이 층의 관례

- **남김·합침·지움의 정본은 `frontend/README.md` §테스트 전략이다** — 새 테스트 배치(화면당 단위 1 + 통합 1)·소스 스캔 추가 조건·PBT `examples` 적중 보장 규칙이 거기 있다. 소스 스캔은 출시·보안 계열만 남겼다(TRIP-1145) — **새 스캔을 이 표에 늘리기 전에** 판정 규칙과 ESLint 표현 가능성을 먼저 본다.
- **소스 스캔은 `stripComments` 후에 한다.** URL의 `://`를 주석으로 오인하지 않도록 `(^|[^:])//` 또는 `(?<!:)//` 룩비하인드를 쓴다.
- **"없어야 한다" 부정 단언은 같은 `it` 안 긍정 짝과 함께 둔다** — 모집단이 비거나 파일이 사라져도 공허 통과하지 않도록 `existsSync`·대표 심볼 앵커를 건다. 탐지기 자체는 G0 자가검사로 실제 문자열에 태워 본다.
- **폴더 재귀 스캔은 새 파일을 자동 편입한다** — 같은 축을 다른 가드가 이미 재귀로 잡으면 새 가드에 복제하지 말고 편입 앵커만 둔다.
- **모듈 목은 인라인 `jest.mock(팩토리)` 대신 모듈 스코프 파일로** — NativeWind babel이 주입하는 `_ReactNativeCSSInterop` 참조가 팩토리 스코프 밖으로 걸린다. 팩토리가 필요하면 `require('@/test-support/…')`로 끌어온다.
- **page를 통째 렌더하는 형제 테스트는 목을 공유하지 않는다** — page가 새 훅을 물면 그 page를 렌더하는 파일 전수(`git grep 'render(<.*Page'`)에 무해 스텁을 추가해야 한다(홈 page: `HomePage.test`·`tabsShell` 홈 래퍼 / 탐색 page: `ExploreLandingPage.test`·`.integration.test`·`tabsShell` 탐색 래퍼). 라우트 파일 자체는 얇은 래퍼라 `tabsShell`만 렌더한다(TRIP-1142).
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
| `__mocks__/@gorhom/bottom-sheet.tsx` | 네이티브 모듈 자동 목(통과형 — children 무조건 렌더) |
| `__mocks__/react-native-draggable-flatlist.tsx` | 드래그 리스트 모듈 스코프 목 — `renderItem`을 실제로 돌려 카드를 렌더하고, `onDragEnd`는 호스트 View prop으로 노출해 테스트가 `props.onDragEnd({data,from,to})`로 직접 발화 |
| `src/__tests__/importBoundary.test.ts` | import 경계 가드 — ESLint 룰 ID(`import/no-restricted-paths` 포함·`import/no-unresolved` 불포함)로 "경계 위반"과 "해석 실패"를 구분. **단독 실행 시 `NODE_OPTIONS=--experimental-vm-modules` 필요**(`pnpm test:node` 스크립트가 넣어 준다 — `pnpm exec jest` 단독이면 실패) |
| `src/__tests__/importBoundaryLayers.test.ts` | `ESLint.lintText`+가짜 filePath로 FSD 6층 방향과 feature 격리(`src/features` 전 슬라이스 `it.each`)를 탐침한다. 빈 층 대상 허용 프로브는 실파일이 없어 `no-unresolved`가 뜨므로 "경계 룰 미발화"까지만 단언. TRIP-1145부터 소스 스캔에서 옮긴 출시·보안 ESLint 규칙(msw·목 import · 네이티브 사진/캡처 모듈 정적 import · 개발 프리뷰 import · `no-console` · 계정 삭제 다이얼로그 prop · 빈 핸들러)의 발동·과잉 매칭도 여기서 탐침한다(예외 블록의 덮어쓰기 함정 포함). 단독 실행 함정은 위와 같다 |
| `src/__tests__/devPreviewReleaseGate.test.tsx` | 운영 빌드(`__DEV__=false`)에서 `_dev` 프리뷰가 홈으로 1회 리다이렉트되는 출시 계약 + 프리뷰 스모크(TRIP-1145 — 딥링크 조준 화면 렌더 · 키 장부 중복 0 · 없는 키/배열 값 splash 폴백). 지뢰 목 7개가 프리뷰 정적 그래프 전체의 네트워크·컨테이너 미로드를 함께 지킨다. 키별 렌더는 하지 않는다 |
| `src/widgets/time-sheet/ui/TimeSheet.test.tsx` | 공용 시각 시트 렌더 — testID 트리·셀 선택·`endsNextDay` 시·분 두 축·분 셀 bare 숫자(INV-3) |
| `src/__tests__/onboardingPrefRoutes.test.tsx` | 취향 1/2·2/2 라우트 존재·내비게이션 계약 가드 — push/replace/back 분기 |
| `src/__tests__/tabsShell.test.tsx` | `(tabs)/_layout.tsx` 배선 가드 — 5탭 등록 순서·`tabBar` 렌더프롭·활성 매핑/press→navigate. 홈·탐색 **라우트 래퍼**를 렌더하므로 두 page가 무는 훅(`useGetTrips`·`useSavedPlaces`·`useSavedStays`·`useGetPlaces`)의 무해 스텁을 가진다. 홈 래퍼 it = `PlanningHome` 조건부 자식의 유일한 심판(trips 목에 일정 훅 없음), 탐색 래퍼 it = 전국·게스트 갈래에 `shell-tabbar-root` 부재 + `/regions` 미호출을 **우연히** 지킨다(places 목에 `useGetRegions` 없음 — 스텁을 더하면 조용히 풀림) |
| `src/__tests__/onboardingEntryGuard.test.tsx` | 온보딩 진입 리다이렉트·완료자 방어 가드 |
| `src/__tests__/rootLayout.test.tsx` | 루트 부팅 골격 |
| `src/__tests__/rootLayoutSafeArea.test.tsx` | `SafeAreaProvider` 도입 후에도 자식이 렌더되는지 |
| `src/__tests__/design-tokens.test.ts` | 디자인 토큰 가드 |
| `src/__tests__/openapiContract.test.ts` | `backend/docs/design/openapi.yaml`을 글자로 읽는 계약 앵커(YAML 파서 의존 0) — `/stays/search` 경로·`servers`·정의 없는 `$ref` 0 · 파라미터 이름 완전일치 |
| `src/__tests__/rootLayoutQueryProvider.test.tsx` | 앱 루트를 실제 렌더해 `SplashGate` 자리(`queryClientProbe` 목) 안쪽에서 진짜 `QueryClient`가 잡히는지 |
| `src/__tests__/rootLayoutToastHost.test.tsx` | `<ToastHost/>`가 `SplashGate` **바깥**(형제)에 한 번만 배치됐는지 배선 가드 |
| `src/shared/ui/Toast.test.tsx` | `showToast`/`hideToast` 가짜 타이머 테스트 — `TOAST_VISIBLE_MS` 뒤 사라짐 · hide가 타이머 정리 · 연속 show는 앞 타이머 취소. 페이드 애니메이션을 안 넣은 이유도 같다(타이머 카운트를 흐림) |
| `src/__tests__/recordPhotoBinaryGuard.test.ts` | `features/{record,check-visit,attach-visit-media}`+`shared/photo`+`pages/{live-itinerary,trip-records,records-calendar}` 재귀 — 사진 바이너리·`storage_key` 금칙어 0 + `AddPhotoRequest` 실참조(INV-U5-03). 네이티브 사진 모듈 정적 import 금지는 ESLint로 옮겼다(TRIP-1145). 범위를 `shared` 전체로 넓히면 생성 코드 주석의 `storage_key`로 거짓 red |
| `src/__tests__/shareCardStructure.test.ts` | j06 공유 카드 — 서버 이미지 생성·저장·업로드 금칙 8종 0(BR-U5-46) + 온디바이스 앵커(`buildShareCard`·`isShareCaptureArmed`·`saveShareCardImage`). 스캔 대상에 캡처 어댑터를 "캡처 패키지를 정적 import 하는 파일"로 편입한다(그 탐지기 자가검사 G5a). 캡처 어댑터 정적 import 금지는 ESLint로 옮겼다(TRIP-1145) |
| `src/__tests__/tabsRecordsRoute.test.tsx` | `(tabs)/records.tsx` 라우트 렌더 — 카드→기록 push · 빈 상태→새 여행 push · 월 이동 |
| `src/__tests__/mapBridgeStructure.test.ts` | 지도 키 소스 스캔 — 키는 env 참조로만, git 추적 전수에 키 리터럴 0. **git 추적 전수는 `git ls-files`로 인덱스를 열거한다** — 테스트 파일을 `rm`만 하고 스테이지하지 않으면 없는 경로를 열어 ENOENT로 FAIL한다(`git rm`/`git add`로 스테이지) |
| `src/__tests__/tripWizardEntryReset.test.tsx` | 위저드 레이아웃 마운트 시 시드 초기화·형제 화면 효과 순서·리렌더 보존. 실제 라우터가 레이아웃을 재마운트하는지는 jest 밖(6-b) |
| `src/pages/trip/trip-new-step1/model/budgetAmount.tierForAmount.test.ts` | `tierForAmount`(TRIP-1091) — 경계 6점(499,999/500,000/…/3,000,000)·0·1 예제 + PBT 4(범위 내·단조·칩 대표 금액 왕복·구간별). ⚠️ 생성기를 `oneof(0~5,000,000, 0~1e12)`로 섞는다 — 균등 0~1e12만 쓰면 세 경계가 있는 300만 아래를 거의 안 밟아 단조성이 공허하게 참 |
| `src/pages/trip/trip-new-step1/ui/TripNewStep1Page.integration.test.tsx` | 「예산 행 역산 등급」 describe — g01 예산 행·시트 칩 등급 출처(TRIP-1091) R1~R10 — 프리필 등급을 기대 등급과 **다르게** 둔다(같으면 버그 코드도 통과). R5는 프리필 `고급+1,200,000`(역산하면 중간)으로 "프리필 금액은 역산하지 않는다"를 행·시트 양쪽에서 잠그고, R10은 `PUT/PATCH /me/preferences` 0회를 `GET` 관측 짝과 함께 단언 |
| `src/pages/trip/trip-new-step1/model/budgetAmount.tier.test.ts` | `budgetForTier(tier)` 1인자(TRIP-1067) — 고정 맵(저가30만·중간100만·고급200만·럭셔리400만, 온보딩 범위 가운데값)×예제 4 + 무작위 500회(박수·인원 인자를 넘겨도 안 바뀜, `Function.length`로 박수 인자 부재 확인 — 기본값 인자는 `length`에 안 잡혀 `@ts-expect-error`로 이중 판정). 구 TRIP-1045 단가×박수 PBT는 폐기 |
| `src/pages/trip/trip-new-step1/model/budgetAmount.isBudgetTier.test.ts` | `isBudgetTier`(TRIP-1107) U1~U6 — 칩 4값 참·`undefined`·4값 밖(`'LOW'`)·상속 키(`'toString'`) 거짓. 뮤테이션 실측: `in` 교체는 red 7, 4값 배열 사본 `.includes` 교체는 green(동작이 같아 원리적으로 못 잡음 — 소스 리뷰 몫) |
| `src/pages/trip/trip-new-step1/ui/TripNewStep1Page.integration.test.tsx` | 「예산 시트 등급 프리필」 describe — g01 예산 시트 첫 열림 등급 프리필(TRIP-1107) AC-1~8 — 온보딩 금액·적용 금액이 등급 대표 금액을 이김, 열기만으로는 스토어 커밋 0. ⚠️ AC-2의 "같은 칩을 눌러도 값이 같다" 단언은 판별력이 없다(이미 채워진 칸에서 같은 칩 재누름은 값이 안 바뀜) — "칩 경로와 같은 출처"를 실제로 지키는 건 같은 파일 「예산 편집 시트」 describe D5 |
| `src/__tests__/placeDetailStubRoute.test.tsx` | `explore/places/[poiId].tsx` 라우트가 `@/pages/explore/place-detail`에 위임하는지(페이지 목으로 QueryClient 없이 렌더) |
| `src/__tests__/socialSdkSecrets.test.ts` | 소셜 SDK 키·시크릿 소스 스캔 — `.env` 미추적 · git 추적 전 파일에 `VAR=<값>` 대입 0(공백 클래스는 `[^\S\n]` — `\s`는 개행을 건너 다음 줄을 값으로 오판) · `app.config.ts` env 참조 |
| `src/__tests__/socialSdkConfigPlugin.test.ts` | `app.config.ts` kakao·naver config plugin 등록 — 옵션 키 허용목록·값 출처·**provider 간 값 교차 없음**(`[string, any]`라 tsc가 못 잡는 자리) |
| `src/pages/trip/trip-new-step2/ui/StaySelectSheet.test.tsx` | g02 숙소 선택 시트 props-only 렌더 — 단일 선택·지정 disabled(`toBeDisabled`+press+핸들러 0회)·실패 인라인·가격/사진 미렌더 |
| `src/pages/trip/trip-new-step2/ui/TripNewStep2Page.test.tsx` | 「숙소 선택 시트 배선」 describe(옛 `.staysheet.integration`, node 버킷) — 카드 탭→시트→선택→지정 배선 — `useAssignBase` 인자 `{tripId,data:{savedStayId,dateFrom,dateTo}}` 완전일치 |
| `src/__tests__/liveLocationRoute.test.tsx` | i20·i21 라우트 얇은 위임 — `useLocalSearchParams` 값이 페이지에 도달하는지(한 쌍만 확인이라 하드코딩도 통과) |
| `src/pages/itinerary-draft/ui/GenerationFallbackScreen.test.tsx` | h07 폴백 인터스티셜 렌더 — 카피 완전일치·체크리스트·하드실패 변형(INV-3 렌더 스캔은 TRIP-1150 에서 지움 — 시간·거리 재료 없음). 지도는 `@/test-support/mapViewMock` |
| `src/pages/itinerary-generating/ui/GeneratingScreen.test.tsx` | 「단계 펄스」 describe — h07 3단계 원 펄스(TRIP-1046, 20ms 표본, 가짜 타이머·스파이는 그 describe 안에서만) — `jest.spyOn(NativeAnimatedHelper.default,'shouldUseNativeDriver').mockReturnValue(false)`로 JS 드라이버 강제(네이티브 드라이버 아래선 가짜 타이머로도 opacity가 안 움직임) + `Animated.timing` 스파이 인자로 `useNativeDriver:true` 설정을 별도 확인. 처음 움직인 표본 순서 1<2<3(엄격 증가)로 stagger 판정, 3~4초 창의 얼굴 종류 수(`Set.size>1`)로 loop 반복(1회성 펄스 회귀) 판정, 언마운트 뒤 애니메이션 값 불변 2건(응답 전/후 이탈). 세 원의 구조 서명(호스트+className, style 제외)이 같아야 함(⚑C 동일 얼굴) |
| `src/pages/itinerary-generating/ui/GeneratingPage.hookMock.test.tsx` | 「화면을 떠날 때 백그라운드 토스트」 describe — h09 이탈 토스트(TRIP-1046) — `leave()`(`rerender(null)`로 페이지만 트리에서 빼고 `ToastHost`는 유지, `unmount()`는 호스트까지 지워 못 씀) + `jest.spyOn(ToastModule,'showToast')` 호출횟수로 "정확히 1회" 판정(호스트는 1개만 그려 화면상으론 안 갈림). phase를 바꿔 `rerender`할 때 새 엘리먼트(`cloneElement`)를 넘겨야 재렌더됨(같은 JSX 참조면 React가 건너뜀). StrictMode 흉내 cleanup(mount 2·cleanup 1)에서 토스트 0건 단언 포함 |
| `src/__tests__/tabsItineraryRoute.test.tsx` | 일정 탭 "내 여행" 목록 — 카드 렌더·무리다이렉트(`Redirect` 목의 마커 부재가 트립와이어)·빈 상태·스켈레톤·최신순·**눌린 카드의** 목적지·카드별 itinerary GET 파생. 줄바꿈 부제는 `.props.children` 직단언(`toHaveTextContent`는 `\n`을 정규화) |
| `src/features/itinerary/model/itineraryDestination.test.ts` | `resolveItineraryDestination` 표 전수 `it.each`(404→method … CONFIRMED→live), 입력 타입은 함수 시그니처에 고정 |
| `src/pages/itinerary-method/ui/MethodPickerScreen.test.tsx` | h04 방식 선택 — 차단 사유(BR-U3-01)·안내 액션·뒤로 무회귀 |
| `src/pages/itinerary-plan/ui/ItineraryPlanPage.integration.test.tsx` | 「탈출구 — 뒤로·일정 만들기」 describe: h25 4얼굴 탈출구 — msw로 얼굴 강제(훅 목 금지) + `useRouter` 4메서드 목. 딥링크(`canGoBack()===false`)는 `replace('/(tabs)')` 완전일치(`/(tabs)/itinerary`는 리다이렉트 함정) |
| `src/features/edit-itinerary/model/itineraryEditStore.addSlot.test.ts` | `addSlot` 순수함수 — 비파괴 append + 읽기전용 5필드 키 완전일치(여분 키 누출 차단) |
| `src/pages/itinerary-manual/ui/ManualPlanPage.hookMock.test.tsx` | h19 배선 — 마운트 POST 1회·여분 키 0. 폴백 배너 부재 단언은 이 표면에 폴백 경로가 없어 지금은 공허 통과(미래 회귀 트립와이어) |
| `src/pages/itinerary-manual/ui/PlaceAddPage.integration.test.tsx` | h20 배선 — 검색·클라 필터·카테고리 재조회. **add→PUT 전체 플로우는 범위 밖**(캐시 무효화 회귀 심판 없음) |
| `src/entities/itinerary-slot/lib/categoryPlaceholder.test.ts` | `resolveCategoryPlaceholder` 매핑 — 7종 `tintClass` 완전일치·폴백·iconKey distinct. 프로토타입 키 입력은 다루지 않는다 |
| `src/pages/itinerary-list/ui/MyTripCard.test.tsx` | h37 카드 렌더 — 제목·메타·부가정보 완전일치 + 배지/resume 유무 짝. `metaLine` 조립 로직은 컨테이너 소관이라 여기서 안 돈다 |
| `src/__tests__/planbManualRoute.test.tsx` | i07 라우트가 `ItineraryEditPage`를 `tripId`+`inTrip=true`로 부르고 `variant`가 새지 않는지 |
| `src/pages/itinerary-edit/model/reorderKeepingLocked.test.ts` | 잠긴 칸 고정 재정렬 예시 + fast-check PBT(고정 index 불변·순열·상대 순서 보존). 이 규칙을 부르는 프로덕션 드래그 표면은 아직 없다 |
| `src/pages/itinerary-edit/ui/ItineraryEditPage.integration.test.tsx` | 「여행 중 직접 수정(i07)」 describe: h12·i07 페이지 계약 — 완료 알약 press는 시트 안 엶 · 드래그가 `reorderKeepingLocked` 경유 · CONFIRMED 409는 정직 안내(라우터 4메서드 0회) |
| `src/pages/itinerary-edit/ui/ItineraryEditPage.integration.test.tsx` | 「저장 성공 뒤 토스트·복귀」 describe: 저장 성공 뒤 복귀 계약 — 위반 없음→back/replace 폴백 · 위반(h12·i07·다른 날만)→머묾+배지 · 연타 PUT 1회 · 토스트 완전일치. 편집 통합 파일의 expo-router 목은 `canGoBack`이 있어야 한다(없으면 onSuccess TypeError가 삼켜짐) |
| `src/pages/stay/my-stays/model/stayTripLink.test.ts` | `buildStayTripLink` — 연결/미연결/혼합/first-wins/유령 base 배제/빈 입력 |
| `src/pages/stay/my-stays/ui/MyStaysScreen.test.tsx` | l04 뷰 — 행 표시·「출발점 변경」 press 1회(등록 행만, 미등록 행은 버튼 없음 — TRIP-1076)·좌표 미확정 disabled·empty + Figma l04 정합(옛 `.l04parity`, TRIP-1148 합본). 출발점 다이얼로그·chevron 색은 소스 옆 `features/settings/ui/{BaseToggleDialog,SettingsGlyphs}.test.tsx`로 갈라졌다 |
| `src/pages/stay/my-stays/ui/MyStaysPage.integration.test.tsx` | l04 페이지 배선 — 두 관점을 팩토리 안 스위치 `mockRealWiring` 하나로 가른다(TRIP-1148 합본): 화면 캡처 스텁(null 반환 props-캡처 목 + 조회 훅 `jest.fn`) / 실 화면 + msw(옛 `.release`). 실 화면 위임은 JSX 없이 `createElement`(NativeWind babel 함정 회피). 스텁 관점은 쓰기 훅을 보지 않고, 거점 쓰기 0회는 실 화면 관점이 msw 요청 로그(`writes`가 빈 배열)로 단언한다 — TRIP-1076 이후 이 페이지는 거점을 쓰지 않는다 |
| `src/pages/my-page/model/styleCardModel.test.ts` | `buildStyleCardModel` — official 매핑·insufficient는 preview 미유출·게이지 전수 |
| `src/pages/my-page/ui/StyleSummaryCard.test.tsx` | 스타일 카드 — 채움/빈 점을 서로 다른 testID로 세어 SVG fill 함정 차단 · 상세 진입 disabled degrade(INV-4) |
| `src/pages/my-page/ui/MyPage.test.tsx` | 마이 페이지 배선+배치(`layer-pages.md` `my-page` 행) — 옛 `.counts`·`.l03empty`·`.l03parity`·`.integration`·`.styleDetail.integration`을 describe 5개로 합침(TRIP-1154, MSW 0이라 node 버킷) |
| `src/pages/settings-notifications/ui/NotificationSettingsScreen.test.tsx` | 알림 설정 화면 — 행·토글·Figma 정합 + 계약 밖 kind(COMMUNITY·SYSTEM)를 주입받아도 렌더하지 않는지(`VISIBLE_ROWS` 자체 소유, 옛 `__tests__/notificationKindGuard` 흡수 — TRIP-1154) |
| `src/features/edit-preferences/model/preferenceDraft.test.ts` | 취향 역변환 — 안 만진 축은 omit(`toStrictEqual`로 여분 `undefined` 키까지) |
| `src/pages/settings-preferences/ui/PreferencesEditScreen.integration.test.tsx` | 취향 편집 MSW 통합 — 시드·한 축 PUT 바디·400 인라인(INV-4) + 저장 diff 기준선이 시드 시점으로 얼어 있는지(lost update 방지, 옛 `.baseline` 흡수 — 스위치 `mockFakePreferences`로 그 describe만 가짜 훅) |
| `src/pages/settings-personalization/model/personalizationCopy.test.ts` | 개인화 문구표 전수 + `NOT_ENOUGH_RECORDS`에 동의 유도 문구 없음(BR-U5-44) |
| `src/pages/settings-personalization/ui/PersonalizationScreen.test.tsx` | reason 3얼굴·목록 개수·토글 배선 — `NOT_ENOUGH_RECORDS`는 토글 ON 유지+동의 문구 부재 |
| `src/pages/settings-personalization/ui/PersonalizationPage.test.tsx` | 토글 → GRANT/REVOKE — `reason`이 아니라 `applied`로 판정하는 뮤턴트를 잡는 `NOT_ENOUGH_RECORDS` 케이스 포함 · termsVersion 필터 · `invalidateQueries` spy |
| `src/shared/api/patchConsent.test.ts` | `patchConsent` 와이어 계약 — URL에 termsType, body는 `{action, termsVersion}` 두 필드만 |
| `src/features/create-trip/model/tripWizardStore.periodFromNights.test.ts` | 시작·박수 재계산 예시 + fast-check 액션열 PBT(**매 단계 뒤** 끝−시작=Σnights, 오라클은 구현과 다른 계산 경로). `reset()`은 파일 최상위 `beforeEach`+`afterEach` 둘 다 |
| `src/pages/trip-records/model/stayAttribution.test.ts` | (TRIP-1155로 features/record에서 이사) 행동 테스트 + PBT(`baseStay`가 항상 그 날짜를 덮는 base의 함수) + dateTo 경계값 3종 |
| `src/pages/trip-records/model/photoAvailability.test.ts` | (TRIP-1155로 features/record에서 이사) 진리표 4행(deviceId×assetOk) |
| `src/pages/trip-records/model/useVisitAttachments.integration.test.tsx` | (TRIP-1155로 features/record에서 이사) msw — addPhoto→GET 재조회 · saveMemo 공백 무시 · savedMemo 시드·같은 값 PUT 0·실패 시 savedMemo 유지 |
| `src/pages/records-calendar/model/recordsCalendar.test.ts` | (TRIP-1155로 features/record에서 이사) 마킹·월 경계·겹침 유일·null 방어·필터/정렬·라벨 표 |
| `src/pages/trip-records/ui/VisitRecordCard.checkPop.test.tsx` | (TRIP-1155로 features/record에서 이사) 체크 튐 심판 — 전이 감지(`prevStatus`)·답 전 언마운트(C-4)·튐 도중 되돌림 `setValue(1)`(C-5). `Animated.timing`/`spring`을 스파이해 설정은 기록하고 실행은 JS로 돈다(`Animated.loop`은 판정 함수가 아니라 설정의 `useNativeDriver`를 본다) |
| `src/pages/trip-records/ui/VisitRecordCard.nameFit.test.tsx` | (TRIP-1155로 features/record에서 이사) 긴 이름 말줄임(TRIP-1086) — 머리 행 세 겹(바깥 `gap-sm`·왼쪽 묶음 `min-w-0 flex-1`·이름 Text `numberOfLines={1}`+`shrink`). RN은 `flexShrink` 기본 0이라 Text 자체에 `shrink`가 있어야 줄어든다. **jest는 토큰·prop까지만** — 실제 `…`·간격 픽셀은 6-b 육안 |
| `src/pages/trip-records/ui/VisitRecordCard.test.tsx` | (TRIP-1155로 features/record에서 이사) 4상태 present/absent 짝·upcoming 완료 불가·skip·시각 수정 버튼 유무. 슬롯 테스트는 `.wiring.test.tsx`로 격리(새 import가 이 파일을 오염시키지 않게) |
| `src/pages/trip-records/ui/VisitRecordCard.wiring.test.tsx` | (TRIP-1155로 features/record에서 이사) 슬롯 계약 testID 마커로 잠금 |
| `src/pages/trip-records/ui/VisitTimeSheet.test.tsx` | (TRIP-1155로 features/record에서 이사) 셀 선택·diff 저장·휠 초기 위치·정지 확정·완료 휠 disabled 배선(W6, 선택 집합 마스크 84셀 앵커)·onClose/key(W4·W5·P1~P4)·인라인 오류·INV-3 렌더 스캔(동적 `${m}분`까지) |
| `src/pages/trip-records/ui/SpontaneousVisitButton.test.tsx` | (TRIP-1155로 features/record에서 이사) 즉석 추가 UI |
| `src/pages/trip-records/ui/PhotoThumbStrip.test.tsx` | (TRIP-1155로 features/record에서 이사) 상태 present/absent 짝 + add + 다건 |
| `src/pages/daily-reflection/model/reflectionFallback.test.ts` | (TRIP-1155로 features/reflection에서 이사) PBT-U5-F1(CI 차단): 임의 `Reflection \| undefined`에도 표시본 `trim().length>0` + 폴백 순서 예제 |
| `src/pages/daily-reflection/model/statsCard.test.ts` | (TRIP-1155로 features/reflection에서 이사) undefined/null→0s · 완전 입력 통과 · 숫자 타입 |
| `src/pages/daily-reflection/model/missingParts.test.ts` | (TRIP-1155로 features/reflection에서 이사) 각 플래그 on/off 짝 |
| `src/pages/settings-notifications/model/channelAvailability.test.ts` | (TRIP-1155로 features/notification에서 이사) PBT-U6-F2 전용(node 버킷). `permissionArb`는 선언만 되고 미사용 |
| `src/pages/settings-notifications/model/useToggles.integration.test.tsx` | (TRIP-1155로 features/notification에서 이사) msw 통합 버킷. hitCount needle은 `GET ` 메서드 접두까지 포함해야 한다(복사 원본 대비 누락 시 어떤 구현으로도 통과 불가) |
