# 리포 함정 (지금 작업하려면)

리포를 읽어도·테스트를 돌려도·그래프를 봐도 **알 수 없는 것만** 적는다. **밟기 전에 읽는다.**
이 파일은 `paths` 없는 무조건 규칙이라 메인·서브에이전트에 시작 시 로드된다(그래서 짧게 유지한다).

**여기 적지 않는 것**: 미해결 부채·후속 티켓·"다음 사이클 후보"는 옵시디언 **문제로그** 소관(닫히면 사라질 것). 파일 목록·export·스텁은 `structure.md`(+`--check`) 소관. 테스트가 red로 잡는 것도 아니다. 남는 것은 **부정 사실·지금 어디까지·기계 강제 없는 계약**뿐.

## auth · onboarding

- **온보딩 완료자 라우팅** → `useOnboardingProgress`가 **하드코딩 `false`**(FW1). 실 progress는 `onboardingCompleted`인데 `features/auth`에만 있고 importBoundary가 막는다 — `shared` 승격이 선행돼야 한다.
- **세션 만료 UX** → 토큰만 clear하고 **즉시 리다이렉트는 없다**(FW2, 다음 부트스트랩이 자가치유).
- **apple 소셜 로그인** → `oauthConfig`에 **빈 슬롯**(백엔드 fail-closed, 범위 밖). kakao·naver는 채워졌고, naver는 `usePKCE:false`+`state` 필수인 비표준 갈래라 다시 만질 땐 `realAuthorize.ts` 조건부 분기부터 본다.
- **약관 라벨(`TERMS_LABELS`)은 신규 타입에 자동 대응 안 한다** → `useTermsConsent.ts`의 `ONBOARDING_TERMS_TYPES`(순회 대상)와 `TERMS_LABELS`(라벨 맵)는 **두 상수를 손으로 맞추는 관례일 뿐 구조적 강제가 아니다**(TRIP-366 커밋 a064e97 메시지의 "구조적 불가"는 부정확 — TRIP-375에서 정정). 폴백 `TERMS_LABELS[type] ?? term.termsType`이 있어 라벨을 안 채우면 원시 코드가 그대로 화면에 노출된다. TRIP-375가 **기존 3종을 지우는** 뮤테이션은 잠갔지만(TermsPage.integration), **새 약관 타입을 추가하고 라벨을 안 채우는** 케이스(A2/`missingRequiredLabels` 경로)는 렌더 소비자가 없어 여전히 못 잡는다(YAGNI 보류, 03_impl-notes 참조).
- **c08 위치 라우트는 이제 `(onboarding)`에 존재한다(D7 반전, TRIP-459)** — 예전엔 `onboardingStructure.test.ts`가 "위치 라우트 0건"을 강제(D2·D7, BR-U0-30 스코프 축소 반영)했으나, 이 사이클로 `nickname→location→pref1` 체인이 실배선됐다. **마운트 시 기존 denied 감지 전이는 무심판** — `LocationPage.tsx`의 `useEffect`(`getForegroundPermissionsAsync` 조회)를 통째로 지우거나 조건을 뒤집어도 승인 테스트 7/7이 green이다(Q2-② 경로, AC 번호 없어 심판 미생성). 이 파일을 다시 만질 때 회귀가 소리 없이 날 수 있다. 조건 자체도 code-critic 경고-1로 안드로이드 `canAskAgain=true`(재요청 가능) 상태를 설정-강제 화면으로 오분류할 수 있음이 지적됨(5-c로 조건은 `status==='denied' && !canAskAgain`으로 정정됐으나 그 전이를 지키는 심판은 여전히 없다).

## home

- **홈 실 데이터** → 서버 API가 **아직 없다**(TRIP-170 범위 밖). `homeFixtures.ts`를 API 훅으로 교체하는 자리.
- **라이브 홈=discovery/planning만, collecting·upcoming·postTrip은 여전히 phase 무심판** → (TRIP-401로 갱신) `(tabs)/index.tsx`는 더 이상 phase를 안 넘기지 않는다 — 지배(비-ENDED 중 가장 이른) 여행이 있으면 실제로 `planning` 얼굴로 착지하고, 그때만 조건부-자식 `PlanningHome`이 그 여행의 itinerary GET으로 카드 CTA 목적지를 정해 push한다(`resolveHomePhase.dominantTripId`). `HomeScreen.test.tsx`의 버튼-집합 동치(370-AC-4)도 TRIP-401부터 discovery+**planning** 2얼굴을 잰다(T3 AC-6/AC-7) — planning의 hero CTA·브릿지 CTA 죽은 버튼은 닫혔다. **여전히 열려 있는 것**: collecting/upcoming/postTrip 단계는 서버가 그 단계를 줄 계약이 없어(가정 E) 라이브에 결코 안 나오고, 그 얼굴들의 CTA(`home-spots-more`(collecting) 등)는 픽스처 전용 프리뷰에서만 존재 — `SpotsSection`이 `asButton`을 구조적으로 항상 넘겨 collecting에서도 role="button"+onPress=undefined(무동작 버튼)인 채 무심판. phase CTA를 collecting/upcoming/postTrip으로 확장할 때(U6/U7) 이 잔여 사각을 잠가야 한다(TRIP-370 03b 참고-1 잔여).

## stay 검색

- **`useStaySearch` 기본 파라미터·오류 정규화** → **없다**(D6 이연). params를 그대로 넘기기만 한다.
- **숙소 목록 무한 스크롤** → `/stays/search`에 **페이지네이션 파라미터가 없다**. `onEndReached`류를 붙이면 같은 1페이지를 반복 요청하는 함정인데, 그 "없음"을 잠그는 단언이 **어느 심판에도 없다**.
- **이름·지역 검색(TRIP-469)은 회귀 심판이 0이다** → `StaySearchScreen.tsx`의 `nameQuery`/`onChangeNameQuery`(필터링)와 `StaySearchPage.tsx`의 `nameQuery` state(소유)를 잇는 흐름을 누르는 `StaySearchPage.*.integration.test.tsx`가 없다(`StaySearchScreen.nameSearch.test.tsx`는 화면 단위 테스트뿐). `filterByNameQuery`를 지우거나 페이지가 다른 prop 이름으로 잘못 넘겨도 통합 스위트 전부 green이다.

## stay 등록

- **세그먼트 레이아웃·핀 힌트 탭 소속은 jest 무심판** → `StayRegisterScreen.tsx`의 세그먼트 3탭 고정 높이(`h-11`+`numberOfLines={1}`+캡션 분리)를 전부 되돌려도 전 스위트 green(프리즈 `toHaveTextContent(/준비 중/)`는 집계 매치라 결합/분리 Text를 구분 못 함) — 픽셀 정합은 원리적으로 6-b 실기 전용. 핀 힌트(`stay-register-pin-hint`)가 "핀 탭에서만" 뜨는 것도 `PinPanel` 중첩에만 의존해 무심판(현재 코드는 맞음, tab 축을 잠그는 심판이 없다는 뜻).

## stay 저장 (하트, TRIP-417)

- **동시에 다른 두 카드를 토글하면 스냅숏 롤백이 서로를 지운다** (savedPlaces W-2 동형, code-critic 참고-1) → `savedStays.ts`의 `save`/`remove`(`:80·108`/`:118·134`)는 롤백 시 `previous` **통째 스냅숏**으로 되돌린다. A press(진행중, prev=`[]`) → B press(prev=`[A_opt]`) → A가 404 → `setQueryData([])` 롤백이 아직 진행 중인 B의 낙관 담기까지 지운다. 양쪽 다 실패하면 실패한 A가 optimistic 표식째 유령으로 남아 재진입 refetch 전까진 해제도 안 된다. `pendingKeys`는 **같은** 카드 연타만 막고 다른 두 카드 동시 토글은 심판이 없다. 단일 카드·성공 경로는 무해.
- **`useSavedStays`가 두 벌이다** → `features/stay/model/savedStays.ts`(TRIP-417, POST/DELETE 토글)와 `features/trip/model/useSavedStays.ts`(읽기전용 재수출)가 같은 이름으로 각각 존재한다. features 간 직접 import 금지라 통합 불가 — grep하면 두 벌이 나오고 어느 쪽이 "토글이 되는지"는 파일을 열어야 안다.

## 라우팅 · 셸

- **미인증 딥링크 노출** → `stays/`·`stays/register`·`trips/new/**`는 전부 `(tabs)` 밖의 파일시스템 라우트라 `SplashGate`의 `Stack.Protected` guard 어디에도 안 걸린다 — 미인증에서도 딥링크로 열린다(API가 401을 주므로 데이터 노출은 없다). 새 라우트를 이 그룹들 밖에 추가할 때 guard 안에 넣을지는 아무도 안 물어본다 — 고치려면 라우트 위치 자체를 바꾸는 결정이 선행돼야 한다.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.

## 글리프 · 심판 사정거리

- **raw hex 스캔은 `*Glyphs.tsx` 제외** (SVG `stroke`/`fill`은 className을 못 받는 리포 전체 관례). AC-7 스텁 잠금의 `cardFingerprint`는 testID·className·텍스트만 굳히고 **`fill` 변화는 안 본다** — 저장 하트를 `StayGlyphs.tsx`로 옮겨 `useState` 토글을 걸면 5개 심판이 전부 green인 채로 "저장됐다는 거짓말"이 통과한다.
- **`LocationOffGlyph`가 두 벌이다** → `shared/location/LocationGlyphs.tsx`와 `features/itinerary/ui/ItineraryGlyphs.tsx`에 같은 이름·같은 그림이 각각 있고 색만 다르다(공용=`mutedSoft` 고정, h35=`primary`). grep하면 두 벌이 나오고 정본을 코드만으로는 알 수 없다.

## 지도 (`shared/map`)

- **`react-native-webview`는 네이티브 모듈** → 코드만 머지하고 재빌드를 안 하면 기존 dev build엔 웹뷰가 없다(`pnpm expo prebuild` → `pnpm expo run:ios`). 카카오 콘솔은 지도 JS SDK가 보는 명부가 `[앱 키]→JavaScript 키→JavaScript SDK 도메인`이고, `[플랫폼]→웹 도메인`은 공유용 — 두 자리를 헷갈리기 쉽다.
- **지도 제스처 차단(`viewOnly`)은 실기로만 확인된다 — 자동 심판이 없다** → `draggable`·`disableDoubleClickZoom`·`setZoomable`을 지우거나 오타로 바꿔도 jest 전수가 green이다(가짜 SDK가 `Proxy`라 무슨 이름이든 받아 기록만 함). 실명 여부·실제 차단은 시뮬레이터에서 손으로 확인.
- **`KakaoMapView`(WebView) 위 `absolute` 오버레이는 터치를 먹는다** → WebView가 자기 위에 얹힌 형제/자식 Pressable의 터치를 흡수해 안 눌린다(TRIP-397 결함#2 실측 — `LiveMapScreen`의 계획\|실제 토글이 이렇게 막혔다). 인터랙티브 요소는 지도의 **형제 노드**로 배치해야 한다. `liveMapStructure.test.ts`가 `LiveMapScreen.tsx` 한 파일만 잠근다 — 다른 화면이 `KakaoMapView` 위에 새 오버레이를 얹으면 이 가드 사정거리 밖이라 jest가 못 잡는다.

## 바텀시트 (`@gorhom/bottom-sheet`)

- **딤 전면 커버·시트 실제 열림은 자동 심판이 없다** → `__mocks__/@gorhom/bottom-sheet.tsx`는 `BottomSheet`를 어떤 prop을 줘도 children을 무조건 렌더하는 통과 컴포넌트로 대체한다. 딤의 `bg-scrim/40` 색 토큰은 렌더 트리에 className으로 남아 잡히지만, 실제로 화면을 덮는 `absolute inset-0`(위치)와 시트의 실제 열림/닫힘(`snapPoints`·gorhom 런타임)은 jest가 원리적으로 못 본다 — 지도 제스처 차단(viewOnly)과 같은 함정 계열. 이 목을 공유하는 화면(로그인 시트 3종·`SlotTimeSheet`·`TripBaseFixSheet`·`PinDetailSheet`·`MustVisitTimeScreen`·`TripDateSheet`) 전부 해당, 실기 스모크가 유일한 그물.
- **`TripBaseFixSheet`는 인터랙티브 지도를 바텀시트 안에 넣은 유일 사례라 제스처 prop 회귀가 조용히 재발할 수 있다** (TRIP-455) → 같은 통과형 목이라 `enableContentPanningGesture={false}`를 주든 안 주든 렌더 결과가 동일하다(jest가 이 prop의 유무를 원리적으로 구분 못 함). 이 prop이 "이 위치로 확인" 무반응의 **진짜 원인 수정**(콘텐츠 pan 제스처가 WebView 롱프레스를 삼키는 것을 막음)인데, 지우면 51/51 그대로 green이라 아무 심판도 못 잡는다(code-critic 경고-1 실측). 이 파일을 다시 만질 때 이 줄을 실수로 지우지 않았는지는 6-b 실기(`trip-new-step2-fixsheet-map` 프리뷰, 롱프레스→핀)로만 확인된다.

## itinerary

- **INV-3: 소요시간 비표시, 거리만.** DTO·화면 어디에도 `duration` 필드를 두지 않는다.
- **h09 생성 중 화면의 무심판 3곳** (TRIP-305, 코드는 현재 옳음 — 회귀 방지 심판만 없음) → ① **마운트 POST "1회" 가드 무심판**: `GeneratingPage.tsx`의 `firedRef`를 지워도 승인 통합 테스트 전부 green(목이 컴포넌트를 pending→settled로 재렌더 안 시킴). 실 react-query는 재렌더돼 **생성 POST 2회=일정 2개** 생성 가능. jest·tsc·자체검증 어느 층도 못 봄. ② **체크리스트 정직성 무심판**(⚑C): `GeneratingScreen`의 3단계에 `<Text>완료</Text>`/`<Text>대기</Text>` 가짜 진척을 넣어도 5심판 green(S1은 3행·라벨만, S2는 `%`·`초`·`분/시간`만 봄) — in-flight엔 세션 데이터가 없어 단계 완료를 알 수 없다는 불변식이 기계 강제 없음. ③ **[백그라운드로] 목적지 무심판**: 통합 테스트가 "draft·generating 아님"만 봐서 엉뚱한 forward(`/(tabs)/records` 등)로 바꿔도 green. 목적지 자체(`/(tabs)/itinerary`)는 `AFTER_WIZARD_ROUTE` 재사용이라 의도적이나, 그 탭이 `trips[0]`(첫 여행)으로 리다이렉트해 **기존 여행 있는 재방문자는 생성 중인 여행이 아닌 옛 일정에 착지**(일정 탭의 기존 한계, h09 신규 결함 아님).
- **h09 비결정형 진행바 애니메이션은 자동 심판 사각** → `IndeterminateBar`(RN `Animated`)는 jest에서 `onLayout` 미발화로 폭 0 → 정지. testID(`itinerary-generating-progress`)는 present라 순수 `<View/>`로 바꿔도 green. 6-b 실기가 세그먼트 **실렌더**만 확인하고 "좌→우로 흐르는지"는 정지 스크린샷이라 못 봄 — 지도 제스처(`viewOnly`)·바텀시트류와 같은 실기 전용 계열.
- **h10 게이지 다중일차(dayCount≥2 PARTIAL) 도출은 무심판** (TRIP-337, 코드는 현재 옳음) → `buildGenerationGauge`(`draftView.ts`)는 `tabs.hasData`에서 옳게 일반 도출하지만, 승인 테스트는 day1만 도착한 단일 조합(`[done, active, waiting]`)만 잰다. 인덱스 하드코딩 뮤테이션(`i===0?'done':i===1?'active':'waiting'`)도 이 조합에서 우연히 같은 값을 내 살아남는다 — 3일 여행에 day1·day2 동시 도착(dayCount:2) PARTIAL이면 옳은 도출은 `[done, done, active]`인데 그 뮤테이션은 여전히 `[done, active, waiting]`(이미 도착한 day2를 "생성 중"으로 거짓 표시)을 낸다. 단 계약상 서버가 day1을 먼저 주는 순서를 보장해(01b) dayCount≥2 PARTIAL이 실서비스에 아직 등장하지 않아 현재는 결함이 아니라 무심판(도달 불가, 03b W1). 게이지 채움비율·스켈레톤 애니메이션은 정지 스크린샷 한계로 원리상 실기도 못 보는 h09 IndeterminateBar 계열.
- **확정 예방 잠금은 draft PARTIAL 분기의 확정 CTA 하나뿐** (TRIP-337) → `isConfirmLocked`(`planState.ts`)가 잠그는 건 h25 확정 CTA뿐이다. 편집(edit)은 이미 반응형 잠금(TRIP-302 IS5)이 따로 있어 중복 없음, 그러나 "다른후보 고르기"·"되돌리기" 두 표면은 애초에 미구현이라 PARTIAL 중 눌러도 잠글 대상이 없다(범위 밖 관측). 새 표면이 생기면 이 CTA 하나만 잠긴 걸 전체가 잠긴 걸로 착각하기 쉽다.
- **h20 add→PUT 전체 플로우(SlotTimeSheet 경유)는 자동 심판이 없다** (TRIP-338) → `PlaceAddPage.tsx`의 add 버튼을 누르는 테스트가 승인 5파일 중 0개(P1~P3는 검색·필터만 봄). 이 사각에 실결함 2건(캐시 무효화 누락으로 추가한 장소가 h19에 영영 안 보임 · 콜드/에러 캐시에서 add가 조용히 소실)이 실제로 있었고 5-c로 코드는 봉합했으나(무효화 배선·notReady 가드), **회귀 심판(통합 테스트)은 여전히 없다** — 이 플로우를 다시 만지면 W-1·W-2가 말없이 재발할 수 있다.
- **MANUAL(직접 짜기)은 `solveMode=MINIMAL`인데 `isFallback=false`다** — 실패가 아니라 선택이라 폴백 배너를 띄우면 거짓말이 된다(TRIP-304와 신호가 겹쳐 헷갈리기 쉬움). `ManualPlanPage`/`Screen`엔 애초에 폴백 배너 코드 경로가 0이라 `ManualPlanPage.integration.test.tsx`의 "폴백 배너 부재" 단언은 지금 **공허 통과**(무엇을 바꿔도 green) — 실판정은 `draftView.fallback.test.ts` F-7이 이 표면 밖에서 진다. 이 화면에 폴백 로직을 새로 얹으면 그 순간부터가 진짜 트립와이어다.
- **`notReady?`/`saveError?`/`demoted?` 류 후방호환 옵셔널 prop 추가는 새 티켓이 아니다** — 기존 테스트가 그 prop·testID를 안 물면(기본값=기존 동작 불변) additive 확장으로 간주해 5-c에서 바로 반영한다(TRIP-338 W-2, 리포 선례 `confirmLocked?`·`saveError?`·`demoted?`와 동형). 단 이 판단은 "기존 seam을 안 건드렸다"는 사람 확인에 기대므로, seam을 리네임·재배치하면서 같은 논리를 쓰면 안 된다.
- **h37 일정 탭 카드 메타줄(`~`·박수 조립)은 어느 승인 심판도 안 잰다** (TRIP-468, 03b 경고-1, 코드는 현재 옳음) → `TripCardContainer.tsx:38-39,64`가 공용 `formatConfirmedDateRange`(en-dash `–`)를 `.replace(' – ', ' ~ ')`로 로컬 치환해 Figma 구분자 `~`를 맞추는데, `MyTripCard.test.tsx`는 `metaLine`을 하드코딩 VM 문자열로 받아 조립을 안 타고 `tabsItineraryRoute.test.tsx`는 `my-trip-meta-*`를 아예 단언하지 않는다. `.replace(' – ', ' ~ ')`를 `.replace(' - ', ' ~ ')`(en-dash→하이픈-마이너스)로 바꿔 치환이 조용히 실패해도 12/12 green. `formatNightsLabel`(박수) 자리를 상수로 바꾸거나 ` · ` 구분자를 깨도 동일하게 안 잡힌다. 회귀는 6-b 실기/프리뷰(`my-trips-list` 키)만 잡는다.
- **h37 일정 탭이 `trips.isError`를 "아직 만든 여행이 없어요"(empty)로 접는다** (TRIP-468, 03b 경고-2, INV-4 선재 갭 — 이 티켓 신규 회귀 아님) → `MyTripsListPage.tsx:32-43`은 `isPending`(loading)과 `list.length===0`(empty) 두 갈래만 봐서, `useGetTrips`가 500·네트워크로 실패해도(`isError:true, data:undefined`) `list=[]→empty` 얼굴로 조회 실패가 "여행 없음"으로 오표시된다. 구 라우트도 `?? []`로 같은 degrade를 물려받았던 선재 갭(형제 홈 라우트 `(tabs)/index.tsx`는 `isError→discovery`로 이 축을 분리한 선례가 있어 대비됨). 오류 얼굴 신설은 후속 티켓 후보(범위 확장이라 이번 사이클 미처리).
- **h12 슬롯 교체 트리거가 PARTIAL(2차 생성 중)에도 라이브라 day1-only 전체교체 PUT을 서버 409에만 기대 막는다** (TRIP-467, 03b 경고-1) → `DraftScreen.tsx`의 트리거 렌더 조건과 `DraftPage.tsx`의 `onPressSlot` 배선이 `generationState`를 안 본다. 3일 여행이 PARTIAL(day1만 도착)일 때 day1 비고정 슬롯의 "다른 후보 ›"를 눌러 후보를 고르면, `SlotCandidateSheetContainer`의 콜드캐시 가드(`itinerary.data===undefined`만 차단)를 통과해 day1-only `days`로 `PUT /itinerary`가 나간다 — day2·day3가 아직 생성 중인데 없는 일정으로 덮어쓸 위험. 막는 것은 서버 409(생성중 거절) 하나뿐이고 FE에 이 경로를 타는 심판이 0. TRIP-467 전까지 `SlotCandidateSheetContainer`가 죽은 코드(UI 도달 불가)였어서 이번이 이 경로를 처음 프로덕션에 연다. 데이터 손실은 아님(서버가 막음, UX 이슈) — **후속 티켓 후보**: 트리거를 `generationState==='PARTIAL'`일 때 gate(h25 `isConfirmLocked`와 같은 결).
- **`ALT_LABEL='다른 후보 ›'`이 `DraftScreen.tsx`·`ItineraryEditScreen.tsx` 두 화면에 각자 로컬 상수로 있다** (TRIP-467, 03b 참고-1) → 둘 다 미export라 재사용 불가(리포의 글리프 로컬 복제 관례와 동형), 값은 현재 일치. 한쪽만 라벨을 바꿔도 각 화면 테스트가 자기 값만 exact-match해 h11↔h24 크로스스크린 드리프트를 어느 심판도 안 잡는다 — 육안 대조(6-b 실기)로만 드러남.

## 여행 중 실행 (execution, i01~i05)

- **i01 active 카드 "다음 예정지" 섹션·`openNextNav` 딥링크 사다리는 이 빌드에서 프로덕션 데드코드다** (TRIP-399, 코드는 현재 옳음 — 승인 AC 부합·회귀 아님) → `LiveItineraryPage.tsx:133`이 `projectSlotProgress(activeSlots)`를 progress 인자 없이 호출해 `activePoiId`가 항상 null → 전 슬롯이 `upcoming`으로 사영되어 active 카드 자체가 프로덕션에 안 생긴다(TRIP-395 선재 공백, 이 티켓 회귀 아님). 설령 active 카드가 떠도 page가 `onPressNextNav`를 안 넘겨 CTA press는 no-op(`_dev/preview.tsx`도 `onPressNextNav={noop}`). `nextNav.ts`의 `openNextNav`(딥링크 폴백 사다리, 이 티켓의 헤드라인 산출)는 코드 전역에 실 호출자가 0(순수 함수·카드 계약은 뮤테이션에 견고히 잠겨 있으나 — 03b 긍정확인 — 사용자 표면 도달은 별개 문제). 실사용 활성화 = `activePoiId` 런타임 신호 배선 + `LiveItineraryPage`가 `onPressNextNav` 연결(신규 회귀 테스트 필요, 후속 티켓 후보). 딥링크 자체도 `app.config.ts`에 `kakaomap` 스킴이 iOS `LSApplicationQueriesSchemes`(+안드 `queries`)에 미등록이라 실기기 `canOpenURL`이 항상 false → 폴백이 항상 웹으로 샌다(스킴 등록+네이티브 리빌드 선행 필요, 개념: [[딥링크 스킴 미등록 — canOpenURL이 항상 false]]).
- **`live-place`(i05)는 loading·오류·미도착을 전부 notFound로 접는다** (TRIP-398, 5-b 경고-2·★9, AC 없어 미룸) → `LivePlacePage.tsx`의 얼굴은 `-loading`/`-notfound`/`detail` 셋뿐이라 itinerary GET이 5xx·네트워크로 실패해도 `data` 미도착→`slots=[]`→`buildPlaceDetailView([],poiId)=null`→`-notfound`("장소를 찾을 수 없어요")로 조회 실패가 "부재"로 오표시된다. 형제 `LiveItineraryPage`는 `resolveLiveState`로 `error`와 `notFound`를 분리하는 선례가 있어 대비된다 — `live-place`에 오류 얼굴을 추가할 때 이 선례를 복제한다.
- **`features/execution/**` 신규 파일은 `liveTimeStructure`·`executionDurationStructure` 두 가드에 자동 편입된다** → 재귀 스캔이라 파일을 새로 추가하는 순간부터 사정거리에 들어간다. `liveTimeStructure`는 `startAt`/`endAt` 식별자에 **인접한** 산술 연산자·`new Date`/`.getTime`/`.getHours`/`.getMinutes`·날짜라이브러리 import를 금지(합법 형태: `"HH:mm:ss".split(':')`로 쪼개 다른 이름 변수로 옮긴 뒤 함수 호출 사이에서 빼기 — `placeDetailView.ts`의 `resolveSlackLabel` 선례). `executionDurationStructure`(ui/** 한정)는 `\d+분`·`\d+시간`·`소요` 문자열을 금지 — 정성 라벨(예 "여유 있음")은 자연 회피한다.

## features 경계

- **`features` 간 import 금지에 기계 강제가 없는 feature가 있다** → `eslint.config.js`의 `FEATURES` 배열이 `['onboarding','home']`뿐이라 `itinerary`·`trip`·`explore`는 zone 검사 밖이다. 관례(조합은 `pages` 전담)로 지켜질 뿐, 어겨도 lint는 안 걸린다.

## 여행 만들기 위저드 (g01)

- **`TripWizardStep1Screen`의 confirm은 검색으로 좁혀진 목록이 아니라 항상 원본 `regions`(6개)에서 지역을 찾아야 한다** → `confirmDestination`(~:632) 안 `regions.find(...)`를 `sheetChipRegions.find(...)`(검색 결과)로 바꾸면 confirm이 조용히 무동작(선택한 지역이 좁힌 목록을 벗어났을 때 아무것도 안 담기고 시트도 안 닫힘)한다. 재현: 시트 열기 → 검색 `부`로 부산 선택 → 검색어를 `여수`로 바꿈(부산 칩이 시트에서 사라짐, 선택 상태는 유지) → confirm. **이 성질은 `TripWizardStep1Screen.test.tsx`의 `★확정은 full regions로 지역을 되찾는다` 테스트가 잠근다**(TRIP-387 게이트①-2, 뮤테이션 실측 — 위 뮤테이션이 그 테스트를 red로 만든다). 이 파일을 재편집할 때(예: 시트·검색·박수 스테퍼) 그 테스트를 지우면 blind spot이 재개방된다. 개념: [[좁힌 목록과 원본 목록의 소비처 분리]].
- **`TripNewStep1Page`의 poiCount→위저드 prop 어댑터 배선(TRIP-363)에 통합 회귀 심판이 없다** → 어댑터가 서버 `region.poiCount`를 위저드 `regions`/`sheetRegions` prop으로 additive 전달해 poiCount=0 지역에 "준비 중" 배지(`trip-wizard-destination-coming-soon-{code}`)를 띄운다. `TripWizardStep1Screen.test.tsx`(화면 단위, poiCount를 목 데이터로 직접 주입)만 이 배지를 잰다 — `TripNewStep1Page.test.tsx`·`.budget.test.tsx`·`.mustVisit.test.tsx`·`.stayImport.test.tsx` 어느 것도 poiCount=0 케이스로 배지 노출을 통합 검증하지 않는다(`coming-soon` grep 결과 화면 파일·화면 테스트 2개뿐). 어댑터의 poiCount 매핑을 지워도 이 무심판 지대에서는 안 걸린다 — h20 add→PUT·d06 un-save와 동형 계열(어댑터/페이지 배선 무심판).

## 지역 카탈로그 (explore/region, TRIP-445)

- **`TripNewStep1Page`·`RegionPickerScreen`을 렌더하는 node-버킷 테스트는 `useRegions`를 목해야 크래시 안 남** → 두 화면 모두 `useRegions()`(react-query)를 물어 `QueryClientProvider` 없는 node 버킷에서 렌더하면 `No QueryClient set` throw. 승인 테스트는 목을 걸었지만 sibling 테스트(`.budget`·`.mustVisit`·`.stayImport`·`tripWizardEntryReset`)는 처음엔 안 걸려 있었다(qa n=1 FAIL 실측) — 이 화면들을 렌더하는 새 테스트 파일을 추가할 때마다 같은 목이 필요하다는 사실을 기계가 강제하지 않는다.
- **`regionTint` 팔레트 hex는 어느 raw-hex 스캔에도 안 걸린다** → `placeExploreStructure.test.ts`의 raw-hex 가드(AC-G7)는 `PlaceExploreScreen.tsx` 한 파일만 대상이고 `RegionPickerScreen.tsx`를 주석으로 명시 제외한다. `regionCatalogStructure.test.ts`도 hex 값 자체는 안 본다(URL·zustand·duration만 스캔). `regions.ts`의 `TINT_PALETTE`를 임의 hex로 바꿔도 어떤 심판도 안 잡는다.

## 탐색 랜딩 (explore/d01, TRIP-470)

- **`ExploreLandingScreen`을 렌더하는 node-버킷 테스트는 `useGetPlaces`도 목해야 크래시 안 남** → TRIP-470이 가볼 곳 레인을 복원하며 `(tabs)/explore.tsx`가 `useGetPlaces()`(react-query)를 새로 문다. `QueryClientProvider` 없는 node 버킷에서 이 라우트를 렌더하는 새 테스트 파일은 지역 카탈로그의 `useRegions` 함정(위 절)과 동형으로 이 목이 필요하다는 걸 기계가 강제하지 않는다.

## 장소 상세 (explore, d06, TRIP-456)

- **d06 조회 오류가 notFound로 접힌다** → `PlaceDetailPage.tsx`는 `GET /places`가 5xx·네트워크로 실패해도 별도 오류 얼굴이 없어 "장소를 찾을 수 없어요"로 접는다(`live-place`/i05와 동형 한계, 위 execution 절 참고). 콜드 딥링크+조회 실패에서만 발동, 웜 캐시 주 동선(d04→d06·d02→d06)은 무해. 오류 얼굴을 붙일 땐 `LiveItineraryPage`의 `resolveLiveState`(error/notFound 분리) 선례를 복제한다.
- **d06 하트 해제(un-save) 경로에 회귀 심판이 없다** → `PlaceDetailPage.tsx`의 `remove(poiId)` 분기(이미 담긴 하트 press)를 누르는 통합테스트가 0이라, `remove` 인자를 잘못 바꾸거나 조건을 반전해도 승인 6스위트 전부 green. 코드는 현재 옳다(`remove(poiId)`가 내부에서 `findSavedPlaceId`로 역인덱스, d02와 같은 함수) — 지적 대상은 동작이 아니라 보호 심판 부재(h20 add→PUT 무심판과 동형 계열).

## 작업 관례

- **엣지 케이스 화면을 눈으로 보려면** 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다.
- **화면 비주얼**은 `figma-screen-impl` 스킬 절차를 따른다(밴드 맵은 `spec-perception/reference/figma-structure.md`).

## 유지

scribe가 [기록]에서 새 함정을 여기 추가한다(structure.md 아님). **항목이 12건을 넘으면** 위 「여기 적지 않는 것」 배제가 새는 것이므로 초과분이 무엇인지 개발로그에 적는다. *유지 판정: 6사이클 관찰 — path-scoped 규칙이 서브에이전트에 로드됨이 확인되면 파일을 층별로 쪼개 `paths:`를 붙인다(지금은 전파 불확실이라 무조건 로드). 또한 이 파일이 실제로 함정 회피에 인용된 건수 0이면 structure.md 절로 되돌린다.*
