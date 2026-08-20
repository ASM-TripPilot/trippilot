# 리포 함정 (지금 작업하려면)

리포를 읽어도·테스트를 돌려도·그래프를 봐도 **알 수 없는 것만** 적는다. **밟기 전에 읽는다.**
이 파일은 `paths` 없는 무조건 규칙이라 메인·서브에이전트에 시작 시 로드된다(그래서 짧게 유지한다).

**여기 적지 않는 것**: 미해결 부채·후속 티켓·"다음 사이클 후보"는 옵시디언 **문제로그** 소관(닫히면 사라질 것). 파일 목록·export·스텁은 `structure.md`(+`--check`) 소관. 테스트가 red로 잡는 것도 아니다. 남는 것은 **부정 사실·지금 어디까지·기계 강제 없는 계약**뿐.

## auth · onboarding

- **온보딩 완료자 라우팅** → `useOnboardingProgress`가 **하드코딩 `false`**(FW1). 실 progress는 `onboardingCompleted`인데 `features/auth`에만 있고 importBoundary가 막는다 — `shared` 승격이 선행돼야 한다.
- **세션 만료 UX** → 토큰만 clear하고 **즉시 리다이렉트는 없다**(FW2, 다음 부트스트랩이 자가치유).
- **apple 소셜 로그인** → `oauthConfig`에 **빈 슬롯**(백엔드 fail-closed, 범위 밖). kakao·naver는 채워졌고, naver는 `usePKCE:false`+`state` 필수인 비표준 갈래라 다시 만질 땐 `realAuthorize.ts` 조건부 분기부터 본다.
- **약관 라벨(`TERMS_LABELS`)은 신규 타입에 자동 대응 안 한다** → `useTermsConsent.ts`의 `ONBOARDING_TERMS_TYPES`(순회 대상)와 `TERMS_LABELS`(라벨 맵)는 **두 상수를 손으로 맞추는 관례일 뿐 구조적 강제가 아니다**(TRIP-366 커밋 a064e97 메시지의 "구조적 불가"는 부정확 — TRIP-375에서 정정). 폴백 `TERMS_LABELS[type] ?? term.termsType`이 있어 라벨을 안 채우면 원시 코드가 그대로 화면에 노출된다. TRIP-375가 **기존 3종을 지우는** 뮤테이션은 잠갔지만(TermsPage.integration), **새 약관 타입을 추가하고 라벨을 안 채우는** 케이스(A2/`missingRequiredLabels` 경로)는 렌더 소비자가 없어 여전히 못 잡는다(YAGNI 보류, 03_impl-notes 참조).

## home

- **홈 실 데이터** → 서버 API가 **아직 없다**(TRIP-170 범위 밖). `homeFixtures.ts`를 API 훅으로 교체하는 자리.
- **라이브 홈=discovery/planning만, collecting·upcoming·postTrip은 여전히 phase 무심판** → (TRIP-401로 갱신) `(tabs)/index.tsx`는 더 이상 phase를 안 넘기지 않는다 — 지배(비-ENDED 중 가장 이른) 여행이 있으면 실제로 `planning` 얼굴로 착지하고, 그때만 조건부-자식 `PlanningHome`이 그 여행의 itinerary GET으로 카드 CTA 목적지를 정해 push한다(`resolveHomePhase.dominantTripId`). `HomeScreen.test.tsx`의 버튼-집합 동치(370-AC-4)도 TRIP-401부터 discovery+**planning** 2얼굴을 잰다(T3 AC-6/AC-7) — planning의 hero CTA·브릿지 CTA 죽은 버튼은 닫혔다. **여전히 열려 있는 것**: collecting/upcoming/postTrip 단계는 서버가 그 단계를 줄 계약이 없어(가정 E) 라이브에 결코 안 나오고, 그 얼굴들의 CTA(`home-spots-more`(collecting) 등)는 픽스처 전용 프리뷰에서만 존재 — `SpotsSection`이 `asButton`을 구조적으로 항상 넘겨 collecting에서도 role="button"+onPress=undefined(무동작 버튼)인 채 무심판. phase CTA를 collecting/upcoming/postTrip으로 확장할 때(U6/U7) 이 잔여 사각을 잠가야 한다(TRIP-370 03b 참고-1 잔여).

## stay 검색

- **`useStaySearch` 기본 파라미터·오류 정규화** → **없다**(D6 이연). params를 그대로 넘기기만 한다.
- **숙소 목록 무한 스크롤** → `/stays/search`에 **페이지네이션 파라미터가 없다**. `onEndReached`류를 붙이면 같은 1페이지를 반복 요청하는 함정인데, 그 "없음"을 잠그는 단언이 **어느 심판에도 없다**.

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

## itinerary

- **INV-3: 소요시간 비표시, 거리만.** DTO·화면 어디에도 `duration` 필드를 두지 않는다.
- **h05 CTA·건너뛰기는 아직 아무도 안 부른다** → `MustVisitPickerScreen`의 `onProceed`·`onSkip`은 생산자가 0이다(h09 미착수, 배선이 `proceedBlockedReason`을 항상 넘겨 활성 분기가 프로덕션 경로에서 도달 불가). 로직을 추가해도 지금은 아무 화면에서도 실행되지 않는다.
- **h09 생성 중 화면의 무심판 3곳** (TRIP-305, 코드는 현재 옳음 — 회귀 방지 심판만 없음) → ① **마운트 POST "1회" 가드 무심판**: `GeneratingPage.tsx`의 `firedRef`를 지워도 승인 통합 테스트 전부 green(목이 컴포넌트를 pending→settled로 재렌더 안 시킴). 실 react-query는 재렌더돼 **생성 POST 2회=일정 2개** 생성 가능. jest·tsc·자체검증 어느 층도 못 봄. ② **체크리스트 정직성 무심판**(⚑C): `GeneratingScreen`의 3단계에 `<Text>완료</Text>`/`<Text>대기</Text>` 가짜 진척을 넣어도 5심판 green(S1은 3행·라벨만, S2는 `%`·`초`·`분/시간`만 봄) — in-flight엔 세션 데이터가 없어 단계 완료를 알 수 없다는 불변식이 기계 강제 없음. ③ **[백그라운드로] 목적지 무심판**: 통합 테스트가 "draft·generating 아님"만 봐서 엉뚱한 forward(`/(tabs)/records` 등)로 바꿔도 green. 목적지 자체(`/(tabs)/itinerary`)는 `AFTER_WIZARD_ROUTE` 재사용이라 의도적이나, 그 탭이 `trips[0]`(첫 여행)으로 리다이렉트해 **기존 여행 있는 재방문자는 생성 중인 여행이 아닌 옛 일정에 착지**(일정 탭의 기존 한계, h09 신규 결함 아님).
- **h09 비결정형 진행바 애니메이션은 자동 심판 사각** → `IndeterminateBar`(RN `Animated`)는 jest에서 `onLayout` 미발화로 폭 0 → 정지. testID(`itinerary-generating-progress`)는 present라 순수 `<View/>`로 바꿔도 green. 6-b 실기가 세그먼트 **실렌더**만 확인하고 "좌→우로 흐르는지"는 정지 스크린샷이라 못 봄 — 지도 제스처(`viewOnly`)·바텀시트류와 같은 실기 전용 계열.
- **h10 게이지 다중일차(dayCount≥2 PARTIAL) 도출은 무심판** (TRIP-337, 코드는 현재 옳음) → `buildGenerationGauge`(`draftView.ts`)는 `tabs.hasData`에서 옳게 일반 도출하지만, 승인 테스트는 day1만 도착한 단일 조합(`[done, active, waiting]`)만 잰다. 인덱스 하드코딩 뮤테이션(`i===0?'done':i===1?'active':'waiting'`)도 이 조합에서 우연히 같은 값을 내 살아남는다 — 3일 여행에 day1·day2 동시 도착(dayCount:2) PARTIAL이면 옳은 도출은 `[done, done, active]`인데 그 뮤테이션은 여전히 `[done, active, waiting]`(이미 도착한 day2를 "생성 중"으로 거짓 표시)을 낸다. 단 계약상 서버가 day1을 먼저 주는 순서를 보장해(01b) dayCount≥2 PARTIAL이 실서비스에 아직 등장하지 않아 현재는 결함이 아니라 무심판(도달 불가, 03b W1). 게이지 채움비율·스켈레톤 애니메이션은 정지 스크린샷 한계로 원리상 실기도 못 보는 h09 IndeterminateBar 계열.
- **확정 예방 잠금은 draft PARTIAL 분기의 확정 CTA 하나뿐** (TRIP-337) → `isConfirmLocked`(`planState.ts`)가 잠그는 건 h25 확정 CTA뿐이다. 편집(edit)은 이미 반응형 잠금(TRIP-302 IS5)이 따로 있어 중복 없음, 그러나 "다른후보 고르기"·"되돌리기" 두 표면은 애초에 미구현이라 PARTIAL 중 눌러도 잠글 대상이 없다(범위 밖 관측). 새 표면이 생기면 이 CTA 하나만 잠긴 걸 전체가 잠긴 걸로 착각하기 쉽다.
- **h20 add→PUT 전체 플로우(SlotTimeSheet 경유)는 자동 심판이 없다** (TRIP-338) → `PlaceAddPage.tsx`의 add 버튼을 누르는 테스트가 승인 5파일 중 0개(P1~P3는 검색·필터만 봄). 이 사각에 실결함 2건(캐시 무효화 누락으로 추가한 장소가 h19에 영영 안 보임 · 콜드/에러 캐시에서 add가 조용히 소실)이 실제로 있었고 5-c로 코드는 봉합했으나(무효화 배선·notReady 가드), **회귀 심판(통합 테스트)은 여전히 없다** — 이 플로우를 다시 만지면 W-1·W-2가 말없이 재발할 수 있다.
- **MANUAL(직접 짜기)은 `solveMode=MINIMAL`인데 `isFallback=false`다** — 실패가 아니라 선택이라 폴백 배너를 띄우면 거짓말이 된다(TRIP-304와 신호가 겹쳐 헷갈리기 쉬움). `ManualPlanPage`/`Screen`엔 애초에 폴백 배너 코드 경로가 0이라 `ManualPlanPage.integration.test.tsx`의 "폴백 배너 부재" 단언은 지금 **공허 통과**(무엇을 바꿔도 green) — 실판정은 `draftView.fallback.test.ts` F-7이 이 표면 밖에서 진다. 이 화면에 폴백 로직을 새로 얹으면 그 순간부터가 진짜 트립와이어다.
- **`notReady?`/`saveError?`/`demoted?` 류 후방호환 옵셔널 prop 추가는 게이트①을 재개봉하지 않는다** — 동결 심판이 그 prop·testID를 안 물면(기본값=기존 동작 불변) additive 확장으로 간주해 5-c에서 바로 반영한다(TRIP-338 W-2, 리포 선례 `confirmLocked?`·`saveError?`·`demoted?`와 동형). 단 이 판단은 "기존 seam을 안 건드렸다"는 사람 확인에 기대므로, seam을 리네임·재배치하면서 같은 논리를 쓰면 안 된다.

## 여행 중 실행 (execution, i01~i05)

- **`live-place`(i05)는 loading·오류·미도착을 전부 notFound로 접는다** (TRIP-398, 5-b 경고-2·★9, AC 없어 미룸) → `LivePlacePage.tsx`의 얼굴은 `-loading`/`-notfound`/`detail` 셋뿐이라 itinerary GET이 5xx·네트워크로 실패해도 `data` 미도착→`slots=[]`→`buildPlaceDetailView([],poiId)=null`→`-notfound`("장소를 찾을 수 없어요")로 조회 실패가 "부재"로 오표시된다. 형제 `LiveItineraryPage`는 `resolveLiveState`로 `error`와 `notFound`를 분리하는 선례가 있어 대비된다 — `live-place`에 오류 얼굴을 추가할 때 이 선례를 복제한다.
- **`features/execution/**` 신규 파일은 `liveTimeStructure`·`executionDurationStructure` 두 가드에 자동 편입된다** → 재귀 스캔이라 파일을 새로 추가하는 순간부터 사정거리에 들어간다. `liveTimeStructure`는 `startAt`/`endAt` 식별자에 **인접한** 산술 연산자·`new Date`/`.getTime`/`.getHours`/`.getMinutes`·날짜라이브러리 import를 금지(합법 형태: `"HH:mm:ss".split(':')`로 쪼개 다른 이름 변수로 옮긴 뒤 함수 호출 사이에서 빼기 — `placeDetailView.ts`의 `resolveSlackLabel` 선례). `executionDurationStructure`(ui/** 한정)는 `\d+분`·`\d+시간`·`소요` 문자열을 금지 — 정성 라벨(예 "여유 있음")은 자연 회피한다.

## features 경계

- **`features` 간 import 금지에 기계 강제가 없는 feature가 있다** → `eslint.config.js`의 `FEATURES` 배열이 `['onboarding','home']`뿐이라 `itinerary`·`trip`·`explore`는 zone 검사 밖이다. 관례(조합은 `pages` 전담)로 지켜질 뿐, 어겨도 lint는 안 걸린다.

## 여행 만들기 위저드 (g01)

- **`TripWizardStep1Screen`의 confirm은 검색으로 좁혀진 목록이 아니라 항상 원본 `regions`(6개)에서 지역을 찾아야 한다** → `confirmDestination`(~:632) 안 `regions.find(...)`를 `sheetChipRegions.find(...)`(검색 결과)로 바꾸면 confirm이 조용히 무동작(선택한 지역이 좁힌 목록을 벗어났을 때 아무것도 안 담기고 시트도 안 닫힘)한다. 재현: 시트 열기 → 검색 `부`로 부산 선택 → 검색어를 `여수`로 바꿈(부산 칩이 시트에서 사라짐, 선택 상태는 유지) → confirm. **이 성질은 `TripWizardStep1Screen.test.tsx`의 `★확정은 full regions로 지역을 되찾는다` 테스트가 잠근다**(TRIP-387 게이트①-2, 뮤테이션 실측 — 위 뮤테이션이 그 테스트를 red로 만든다). 이 파일을 재편집할 때(예: 시트·검색·박수 스테퍼) 그 테스트를 지우면 blind spot이 재개방된다. 개념: [[좁힌 목록과 원본 목록의 소비처 분리]].

## 지역 카탈로그 (explore/region, TRIP-445)

- **`TripNewStep1Page`·`RegionPickerScreen`을 렌더하는 node-버킷 테스트는 `useRegions`를 목해야 크래시 안 남** → 두 화면 모두 `useRegions()`(react-query)를 물어 `QueryClientProvider` 없는 node 버킷에서 렌더하면 `No QueryClient set` throw. 승인 테스트는 목을 걸었지만 sibling 테스트(`.budget`·`.mustVisit`·`.stayImport`·`tripWizardEntryReset`)는 처음엔 안 걸려 있었다(qa n=1 FAIL 실측) — 이 화면들을 렌더하는 새 테스트 파일을 추가할 때마다 같은 목이 필요하다는 사실을 기계가 강제하지 않는다.
- **`regionTint` 팔레트 hex는 어느 raw-hex 스캔에도 안 걸린다** → `placeExploreStructure.test.ts`의 raw-hex 가드(AC-G7)는 `PlaceExploreScreen.tsx` 한 파일만 대상이고 `RegionPickerScreen.tsx`를 주석으로 명시 제외한다. `regionCatalogStructure.test.ts`도 hex 값 자체는 안 본다(URL·zustand·duration만 스캔). `regions.ts`의 `TINT_PALETTE`를 임의 hex로 바꿔도 어떤 심판도 안 잡는다.

## 작업 관례

- **엣지 케이스 화면을 눈으로 보려면** 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다.
- **화면 비주얼**은 `figma-screen-impl` 스킬 절차를 따른다(밴드 맵은 `spec-perception/reference/figma-structure.md`).

## 유지

scribe가 [기록]에서 새 함정을 여기 추가한다(structure.md 아님). **항목이 12건을 넘으면** 위 「여기 적지 않는 것」 배제가 새는 것이므로 초과분이 무엇인지 개발로그에 적는다. *유지 판정: 6사이클 관찰 — path-scoped 규칙이 서브에이전트에 로드됨이 확인되면 파일을 층별로 쪼개 `paths:`를 붙인다(지금은 전파 불확실이라 무조건 로드). 또한 이 파일이 실제로 함정 회피에 인용된 건수 0이면 structure.md 절로 되돌린다.*
