---
paths:
  - "src/app/**"
---
# `src/app/` — 라우트 (expo-router 파일시스템 라우트)

- **라우트 파일은 얇은 래퍼다** — params만 읽어 `@/pages/<슬라이스>` 배럴(무배럴 페이지는 딥 경로)로 위임한다. 조회·조립·마크업은 페이지 소관. 이 forward 자체는 라우트를 렌더하는 테스트가 없으면 무심판이다.
- **`(tabs)` 밖 라우트는 `SplashGate`의 어떤 `Stack.Protected` guard에도 안 걸린다** — expo-router가 파일시스템 라우트를 자동 등록하므로 미인증 딥링크로 열린다(`stays/*`·`trips/new/**` 실기 확인, 데이터 노출은 서버 401이 막음). 새 라우트를 `(tabs)` 밖에 두면 같은 구조를 공유한다.

| 파일 | 역할 |
|---|---|
| `src/app/_layout.tsx` | 루트 레이아웃 — 폰트 로드 게이팅·네이티브 스플래시·`GestureHandlerRootView`·`SafeAreaProvider`·`QueryClientProvider`(`SplashGate` 바깥)·`SplashGate`. 전역 쿼리 retry는 `retryUnlessNotFound`(404 즉시 error, 그 외 기본 3회) — **같은 쿼리 키를 먼저 요청한 관찰자의 retry 규칙이 이긴다**(TanStack이 요청 시작 시점에 고정)라 페이지 로컬로 걸면 무력화될 수 있어 전역 기본값에 둔다. |
| `src/app/force-update.tsx` | 강제 업데이트 분기 화면 |
| `src/app/reconsent.tsx` | 재동의 분기 화면 |
| `src/app/_dev/preview.tsx` | **개발 전용 정적 프리뷰** — 네트워크 없이 시각 상태 전환. 진입은 딥링크 `trippilot://_dev/preview?state=<키>` 하나뿐. 키 목록·개수의 정본은 `PREVIEW_STATES`와 `src/__tests__/devPreviewBandNav.test.tsx`의 `toHaveLength`(키를 더하거나 빼면 이 카운트 가드도 같은 사이클에 갱신 — test-designer 몫). 계약: ① `useLocalSearchParams`를 지연 초기화자로 **최초 마운트 1회만** 읽는다 — 이미 열린 프리뷰에서 딥링크만 바꾸면 전환되지 않으니 **키마다 앱을 재기동**한다(실측 오캡처 있음). 부재·오타 키는 splash 폴백. ② 렌더하는 화면은 `@/shared/api` 값 import 0인 순수 뷰여야 한다 — 컨테이너를 import하면 네트워크 계층을 전이 로드한다(`devPreviewMap.test.tsx`가 잡는다). ③ 밴드 2단 UI는 비선택 밴드를 `display:'none'`이 아니라 `{width:0,height:0,overflow:'hidden'}`로 **시각적으로만** 접는다(show-not-mount — RNTL이 findable에서 빼는 것은 `display:none`·`aria-hidden`뿐이라 다른 밴드 칩을 누르는 테스트가 산다). ④ `@gorhom/bottom-sheet` 통과형 목 계열 키는 실제 개폐·딤을 못 보고, `Tabs` 밖 단독 렌더라 탭바 오버레이도 검증 못 한다. ⑤ `_dev/preview`는 expo-router 라우팅 제외 대상이 아니라 **릴리스 빌드에서도 열리고**, `require`된 픽스처 에셋은 무조건 번들에 실린다(`CREDITS.md`). |
| `src/app/(auth)/_layout.tsx` | 미인증 스택 |
| `src/app/(auth)/login.tsx` | 소셜 로그인 화면 진입점 |
| `src/app/(onboarding)/_layout.tsx` | 온보딩 스택 + **완료자만 홈으로 방어** |
| `src/app/(onboarding)/index.tsx` | **진입 단계 리다이렉트** (미완 → terms) |
| `src/app/(onboarding)/terms.tsx` | 약관 라우트 — 컨테이너를 꽂는 얇은 래퍼 |
| `src/app/(onboarding)/nickname.tsx` | 닉네임 라우트 — 얇은 래퍼 |
| `src/app/(onboarding)/location.tsx` | c08 위치 권한 프리프롬프트 라우트 — `LocationPage` 얇은 래퍼. 체인상 nickname과 pref1 사이(`onboardingStructure.test.ts`) |
| `src/app/(onboarding)/pref1.tsx` | 취향 1/2 라우트(c09) — `PrefStep1Page` 얇은 래퍼 |
| `src/app/(onboarding)/pref2.tsx` | 취향 2/2 라우트(c09b) — `PrefStep2Page` 얇은 래퍼 |
| `src/app/(tabs)/_layout.tsx` | 탭 네비게이터 — `tabBar` 렌더프롭 + `BottomTabBar` 어댑터(`routeNameToTabKey` index→home · `handlePressTab` home→index). `screenOptions.tabBarStyle`의 `position:'absolute'` 등은 **커스텀 `tabBar` 렌더프롭엔 무효**(react-navigation이 적용 안 함)인 죽은 문자열 — 실제 오버레이는 `shared/ui/BottomTabBar.tsx` 루트의 `absolute bottom-0`이 진다. |
| `src/app/(tabs)/index.tsx` | 홈 탭 **실배선** — `useGetTrips`·`useSavedPlaces`·`useSavedStays`를 물어 `resolveHomePhase`로 판정하고 항법 콜백을 `HomeScreen`에 주입(`today`·포맷터는 라우트가 조립해 순수 함수에 주입 — `features/home` 경계 회피 DI). `isPending`→loading(phase 미전달), `isError`→discovery. planning 단계는 조건부 자식 `PlanningHome`에서만 itinerary 훅을 부른다 — **최상위에 두면 여행 없는 렌더에서도 훅이 돌아 목 없는 형제 테스트가 크래시**한다. 미정착(로딩·비-404 오류)이면 push 안 함(INV-4), 정착 시 목적지를 한 번 계산해 push와 CTA 라벨에 같이 쓴다. ⚠️ 새 훅을 물면 이 라우트를 렌더하는 형제 테스트(`tabsHomeRoute`·`tabsShell`·`tabsHomeItineraryCta`) **전부**에 목이 필요하다. **'지금 뜨는 장소' 실데이터(TRIP-1049)**: `resolveHomePhase` 호출을 early return 위로 옮겨 여행 지역을 먼저 판정 → 여행 중이면 그 지역, 아니면 전국으로 `useGetPlaces({region?, limit:200})`(`enabled: !trips.isPending` — 대기 중엔 끄되 **`isError`일 때는 켜 둠**, 안 그러면 discovery 폴백에서도 스팟이 영원히 스켈레톤. 03b 경고-2 처리) → `pickTrendingPlaces(items, 4)` → `usePlaceSaveToggle`로 `spotsLane` 완성. 계획 중·여행 후 얼굴도 전국 조회가 나가는 잔여 비용은 남겨둠(새 티켓 후보, BR-U1-53과 충돌 — 정본엔 "1차 계약만, 비움"이라 적혀 있음). `useGetPlaces`를 렌더하는 형제 테스트 3곳(`tabsHomeRoute`·`tabsShell`·`tabsHomeItineraryCta`)도 목 필요. |
| `src/app/(tabs)/explore.tsx` | 탐색 탭 실배선 — `useStaySearch`·`useSavedPlaces`·`useGetPlaces`를 물어 `StayCardVM[]`·`placeLane`을 조립해 순수 `ExploreLandingScreen`에 내린다(조합은 화면이 아니라 라우트 — `placeExploreStructure`가 화면 디렉토리의 훅·zustand·`@/features/stay` import 0을 강제). 항법 목적지는 이 파일의 `router.push`가 정본. `isAuthed` 게이팅 인자는 심판이 안 본다. 렌더 테스트는 `useGetPlaces`도 목해야 한다. **`usePlaceSaveToggle`(TRIP-1049)을 게스트/로그인 분기 위에서 한 번 호출**해 `placeLane`에 스프레드한다. |
| `src/app/(tabs)/itinerary.tsx` | 일정 탭 — `<MyTripsListPage/>`만 렌더(리다이렉트 없음). 조회·정렬·카드별 목적지 판정은 `pages/itinerary-list` 소관. |
| `src/app/(tabs)/records.tsx` | 기록 탭 — `<RecordsCalendarPage/>`만 렌더. 조회·조립·항법은 `pages/records-calendar` 소관 |
| `src/app/(tabs)/my.tsx` | 마이 탭 — `<MyPage/>`만 렌더. 조회·분류·조합은 `pages/my-page` 소관 |
| `src/app/my/stays.tsx` | `/my/stays` — `@/pages/my-stays` 얇은 래퍼. 마이 페이지에서 진입 |
| `src/app/settings/notifications.tsx` | `/settings/notifications` — `@/pages/settings-notifications` 얇은 래퍼. 설정 화면에서 진입 |
| `src/app/notifications.tsx` | `/notifications` 알림함 — `@/pages/notification-inbox` 얇은 래퍼. 홈에서 진입 |
| `src/app/stays/index.tsx` | `/stays` 숙소 검색 — `@/pages/stay-search` 얇은 래퍼 |
| `src/app/stays/register.tsx` | `/stays/register` — `@/pages/stay-register` 얇은 래퍼. 구조 가드가 `useState`·`useGetStaysGeocode`·`FlatList` 0건을 잠근다 |
| `src/app/stays/saved.tsx` | `/stays/saved` e04 저장한 숙소 — `@/pages/stay-saved` 얇은 래퍼 |
| `src/app/explore/region.tsx` | d1b·e00 지역 선택 — `@/pages/region-picker` 얇은 래퍼. 목적은 쿼리 `?purpose=trip`(기본 `stay`) |
| `src/app/explore/destination/[region].tsx` | d03 목적지 상세 — `DestinationDetailPage` 얇은 래퍼(`region` params는 페이지가 읽는다) |
| `src/app/explore/places.tsx` | d04 장소 탐색 — `@/pages/place-explore` 얇은 래퍼 |
| `src/app/explore/places/[poiId].tsx` | d06 **explore** 장소 상세 — poiId만 읽어 `PlaceDetailPage`에 위임(`canGoBack` 폴백은 페이지 소관). 여행 중 장소 상세(`live/place/[poiId]`)와 다른 슬라이스 |
| `src/app/explore/saved-places.tsx` | d02 담은 장소 — `@/pages/saved-places` 얇은 래퍼 |
| `src/app/trips/new/_layout.tsx` | 여행 생성 위저드 셸 — 네이티브 헤더만 끄고, **마운트 시에만** 시드 초기화(`resetMustVisits` 등). step1↔step2 왕복은 재마운트가 아니라 편집이 살고, `push('/trips/new/step1')` 재진입은 초기화된다 — 실제 재마운트 여부는 jest가 못 본다(expo-router 통째 목). |
| `src/app/trips/new/step1.tsx` | g01 위저드 1/2 — `@/pages/trip-new-step1` 얇은 래퍼 |
| `src/app/trips/new/step2.tsx` | g02 위저드 2/2 거점 숙소 — `@/pages/trip-new-step2` 얇은 래퍼 |
| `src/app/trips/[tripId]/itinerary/must-visits/index.tsx` | 필수 방문지 목록 — `@/pages/itinerary-mustvisit` 얇은 래퍼 |
| `src/app/trips/[tripId]/itinerary/must-visits/[poiId].tsx` | 필수 방문지 시각 지정 — 같은 배럴. `poiId`는 그 방문지의 `sourcePoiId` |
| `src/app/trips/[tripId]/itinerary/generating.tsx` | 생성 진행 — `tripId`·`mode`·`successRoute` params를 `GeneratingPage`에 forward(없으면 페이지 기본값 FULLY_AI/draft) |
| `src/app/trips/[tripId]/itinerary/draft.tsx` | AI 추천안 초안 — `@/pages/itinerary-draft` 얇은 래퍼 |
| `src/app/trips/[tripId]/itinerary/index.tsx` | 완성 일정 — `tripId`만 읽어 `@/pages/itinerary-plan` 얇은 래퍼 |
| `src/app/trips/[tripId]/itinerary/edit.tsx` | 일정 편집 — `@/pages/itinerary-edit` 얇은 래퍼 |
| `src/app/trips/[tripId]/itinerary/manual/index.tsx` | 직접 짜기 — `@/pages/itinerary-manual` 얇은 래퍼. **`fresh` 쿼리 파라미터를 읽어 `startFresh={fresh === '1'}`로 내린다**(TRIP-1038, 값은 항상 문자열). `fresh`는 URL에 남아 재마운트(딥링크·상태 복원) 시 다시 비운다 — `firedRef`는 마운트 단위라 막지 못한다 |
| `src/app/trips/[tripId]/itinerary/manual/add.tsx` | 장소 추가 — 같은 배럴 얇은 래퍼 |
| `src/app/trips/[tripId]/live/index.tsx` | 여행 중 허브(i01) — `tripId`만 읽어 `@/pages/live-itinerary` 얇은 래퍼 |
| `src/app/trips/[tripId]/live/place/[poiId].tsx` | 여행 중 장소 상세 — `tripId`·`poiId`만 읽어 `@/pages/live-place` 얇은 래퍼 |
| `src/app/trips/[tripId]/planb/index.tsx` | 재계획 요청 — `tripId`·`scope`·`triggerId` params를 그대로 `PlanbRequestPage`에 내린다(scope 시드는 페이지 소관). 이 라우트의 `Stack.Screen`은 `SplashGate`에서 `presentation:'transparentModal'`로 선언돼 허브 위에 겹친다(실제 겹침은 6-b 몫) |
| `src/app/trips/[tripId]/planb/solving.tsx` | 재계획 로딩 — `tripId`·`sessionId`만 읽어 `@/pages/planb-draft` 얇은 래퍼 |
| `src/app/trips/[tripId]/planb/diff.tsx` | 재계획 확정/취소 — `tripId`·`sessionId`만 읽어 `@/pages/planb-diff` 얇은 래퍼 |
| `src/app/trips/[tripId]/planb/manual.tsx` | 여행 중 일정 편집 — `tripId`만 꺼내 `ItineraryEditPage`에 리터럴 `inTrip={true}`로 위임(params를 통째로 펼치지 않는다 — `planbManualRoute.test.tsx` RT1) |
| `src/app/trips/[tripId]/records/index.tsx` | j01 방문 기록 — `tripId`·`day`만 읽어 `@/pages/trip-records` 얇은 래퍼 |
| `src/app/trips/[tripId]/records/add-visit.tsx` | j01 즉석 방문 장소 피커(TRIP-1072) — `tripId`·`day`만 읽어 `@/pages/record-add-visit` 얇은 래퍼(RT1) |
| `src/app/trips/[tripId]/records/reflection/[date].tsx` | j03 오늘의 회고 — `tripId`·`date`만 읽어 `@/pages/daily-reflection` 얇은 래퍼(G3 스캔이 `@/features/reflection`·조회 훅 직접 import 0을 잠금) |
| `src/app/trips/[tripId]/records/summary.tsx` | j04 여행 요약 — `tripId`만 읽어 `@/pages/trip-summary` 얇은 래퍼 |
| `src/app/trips/[tripId]/records/share.tsx` | j06 공유 카드(전체화면, 탭바 없음) — `tripId`만 읽어 `@/pages/share-card` 얇은 래퍼. j04·j03에서 push |
| `src/app/records/style.tsx` | j05 여행 스타일 — **계정 단위**라 `[tripId]` 밖(INV-U5-08). params 없이 `@/pages/travel-style` 위임. `app/records/index.tsx`는 두지 않는다 — `(tabs)/records.tsx`의 `/records`와 충돌 |
| `src/app/trips/[tripId]/planb/draft.tsx` | 재계획 초안 — `tripId`·`sessionId`만 읽어 `@/pages/planb-draft` 얇은 래퍼 |
| `src/app/trips/[tripId]/live/location.tsx` | 위치 폴백(수동 입력·권한 거부) — `tripId`·`state`를 `LiveLocationPage`에 위임(`?state=`로 얼굴 선택) |
| `src/app/settings/preferences.tsx` | l05 취향 전체 수정 — `@/pages/settings-preferences` 얇은 래퍼. 설정 화면에서 진입 |
| `src/app/settings/personalization.tsx` | l05 개인화 동의 — `@/pages/settings-personalization` 얇은 래퍼. 설정 화면에서 진입 |
| `src/app/magazine.tsx` | a02 매거진 목록 — `@/pages/magazine/ui/MagazinePage` **딥 경로** 직참조(무배럴 페이지). 홈 매거진 히어로에서 push, 실앱은 탭바 미렌더(프리뷰만 `withShellTabBar`) |
