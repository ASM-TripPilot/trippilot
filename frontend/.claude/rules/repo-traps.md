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
- **라이브 홈=discovery 고정, phase 얼굴 CTA는 무심판** → `(tabs)/index.tsx`는 `phase`를 안 넘겨 실착지는 항상 discovery다. `HomeScreen.test.tsx`의 버튼-집합 동치(370-AC-4)도 discovery만 렌더해서 잰다 — collecting의 `home-spots-more`, planning/postTrip의 `home-saved-places-cta`는 `accessibilityRole="button"`+`onPress=undefined`(무동작 버튼)로 남아도 전 심판 green. phase CTA를 배선할 때(U6/U7) 이 사각을 함께 잠가야 한다(TRIP-370 03b 참고-1).

## stay 검색

- **`useStaySearch` 기본 파라미터·오류 정규화** → **없다**(D6 이연). params를 그대로 넘기기만 한다.
- **숙소 목록 무한 스크롤** → `/stays/search`에 **페이지네이션 파라미터가 없다**. `onEndReached`류를 붙이면 같은 1페이지를 반복 요청하는 함정인데, 그 "없음"을 잠그는 단언이 **어느 심판에도 없다**.

## stay 등록

- **세그먼트 레이아웃·핀 힌트 탭 소속은 jest 무심판** → `StayRegisterScreen.tsx`의 세그먼트 3탭 고정 높이(`h-11`+`numberOfLines={1}`+캡션 분리)를 전부 되돌려도 전 스위트 green(프리즈 `toHaveTextContent(/준비 중/)`는 집계 매치라 결합/분리 Text를 구분 못 함) — 픽셀 정합은 원리적으로 6-b 실기 전용. 핀 힌트(`stay-register-pin-hint`)가 "핀 탭에서만" 뜨는 것도 `PinPanel` 중첩에만 의존해 무심판(현재 코드는 맞음, tab 축을 잠그는 심판이 없다는 뜻).

## 라우팅 · 셸

- **미인증 딥링크 노출** → `stays/`·`stays/register`·`trips/new/**`는 전부 `(tabs)` 밖의 파일시스템 라우트라 `SplashGate`의 `Stack.Protected` guard 어디에도 안 걸린다 — 미인증에서도 딥링크로 열린다(API가 401을 주므로 데이터 노출은 없다). 새 라우트를 이 그룹들 밖에 추가할 때 guard 안에 넣을지는 아무도 안 물어본다 — 고치려면 라우트 위치 자체를 바꾸는 결정이 선행돼야 한다.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.

## 글리프 · 심판 사정거리

- **raw hex 스캔은 `*Glyphs.tsx` 제외** (SVG `stroke`/`fill`은 className을 못 받는 리포 전체 관례). AC-7 스텁 잠금의 `cardFingerprint`는 testID·className·텍스트만 굳히고 **`fill` 변화는 안 본다** — 저장 하트를 `StayGlyphs.tsx`로 옮겨 `useState` 토글을 걸면 5개 심판이 전부 green인 채로 "저장됐다는 거짓말"이 통과한다.
- **`LocationOffGlyph`가 두 벌이다** → `shared/location/LocationGlyphs.tsx`와 `features/itinerary/ui/ItineraryGlyphs.tsx`에 같은 이름·같은 그림이 각각 있고 색만 다르다(공용=`mutedSoft` 고정, h35=`primary`). grep하면 두 벌이 나오고 정본을 코드만으로는 알 수 없다.

## 지도 (`shared/map`)

- **`react-native-webview`는 네이티브 모듈** → 코드만 머지하고 재빌드를 안 하면 기존 dev build엔 웹뷰가 없다(`pnpm expo prebuild` → `pnpm expo run:ios`). 카카오 콘솔은 지도 JS SDK가 보는 명부가 `[앱 키]→JavaScript 키→JavaScript SDK 도메인`이고, `[플랫폼]→웹 도메인`은 공유용 — 두 자리를 헷갈리기 쉽다.
- **지도 제스처 차단(`viewOnly`)은 실기로만 확인된다 — 자동 심판이 없다** → `draggable`·`disableDoubleClickZoom`·`setZoomable`을 지우거나 오타로 바꿔도 jest 전수가 green이다(가짜 SDK가 `Proxy`라 무슨 이름이든 받아 기록만 함). 실명 여부·실제 차단은 시뮬레이터에서 손으로 확인.

## 바텀시트 (`@gorhom/bottom-sheet`)

- **딤 전면 커버·시트 실제 열림은 자동 심판이 없다** → `__mocks__/@gorhom/bottom-sheet.tsx`는 `BottomSheet`를 어떤 prop을 줘도 children을 무조건 렌더하는 통과 컴포넌트로 대체한다. 딤의 `bg-scrim/40` 색 토큰은 렌더 트리에 className으로 남아 잡히지만, 실제로 화면을 덮는 `absolute inset-0`(위치)와 시트의 실제 열림/닫힘(`snapPoints`·gorhom 런타임)은 jest가 원리적으로 못 본다 — 지도 제스처 차단(viewOnly)과 같은 함정 계열. 이 목을 공유하는 화면(로그인 시트 3종·`SlotTimeSheet`·`TripBaseFixSheet`·`PinDetailSheet`·`MustVisitTimeScreen`·`TripDateSheet`) 전부 해당, 실기 스모크가 유일한 그물.

## itinerary

- **INV-3: 소요시간 비표시, 거리만.** DTO·화면 어디에도 `duration` 필드를 두지 않는다.
- **h05 CTA·건너뛰기는 아직 아무도 안 부른다** → `MustVisitPickerScreen`의 `onProceed`·`onSkip`은 생산자가 0이다(h09 미착수, 배선이 `proceedBlockedReason`을 항상 넘겨 활성 분기가 프로덕션 경로에서 도달 불가). 로직을 추가해도 지금은 아무 화면에서도 실행되지 않는다.
- **h09 생성 중 화면의 무심판 3곳** (TRIP-305, 코드는 현재 옳음 — 회귀 방지 심판만 없음) → ① **마운트 POST "1회" 가드 무심판**: `GeneratingPage.tsx`의 `firedRef`를 지워도 승인 통합 테스트 전부 green(목이 컴포넌트를 pending→settled로 재렌더 안 시킴). 실 react-query는 재렌더돼 **생성 POST 2회=일정 2개** 생성 가능. jest·tsc·자체검증 어느 층도 못 봄. ② **체크리스트 정직성 무심판**(⚑C): `GeneratingScreen`의 3단계에 `<Text>완료</Text>`/`<Text>대기</Text>` 가짜 진척을 넣어도 5심판 green(S1은 3행·라벨만, S2는 `%`·`초`·`분/시간`만 봄) — in-flight엔 세션 데이터가 없어 단계 완료를 알 수 없다는 불변식이 기계 강제 없음. ③ **[백그라운드로] 목적지 무심판**: 통합 테스트가 "draft·generating 아님"만 봐서 엉뚱한 forward(`/(tabs)/records` 등)로 바꿔도 green. 목적지 자체(`/(tabs)/itinerary`)는 `AFTER_WIZARD_ROUTE` 재사용이라 의도적이나, 그 탭이 `trips[0]`(첫 여행)으로 리다이렉트해 **기존 여행 있는 재방문자는 생성 중인 여행이 아닌 옛 일정에 착지**(일정 탭의 기존 한계, h09 신규 결함 아님).
- **h09 비결정형 진행바 애니메이션은 자동 심판 사각** → `IndeterminateBar`(RN `Animated`)는 jest에서 `onLayout` 미발화로 폭 0 → 정지. testID(`itinerary-generating-progress`)는 present라 순수 `<View/>`로 바꿔도 green. 6-b 실기가 세그먼트 **실렌더**만 확인하고 "좌→우로 흐르는지"는 정지 스크린샷이라 못 봄 — 지도 제스처(`viewOnly`)·바텀시트류와 같은 실기 전용 계열.

## features 경계

- **`features` 간 import 금지에 기계 강제가 없는 feature가 있다** → `eslint.config.js`의 `FEATURES` 배열이 `['onboarding','home']`뿐이라 `itinerary`·`trip`·`explore`는 zone 검사 밖이다. 관례(조합은 `pages` 전담)로 지켜질 뿐, 어겨도 lint는 안 걸린다.

## 여행 만들기 위저드 (g01)

- **`TripWizardStep1Screen`의 confirm은 검색으로 좁혀진 목록이 아니라 항상 원본 `regions`(6개)에서 지역을 찾아야 한다** → `confirmDestination`(~:632) 안 `regions.find(...)`를 `sheetChipRegions.find(...)`(검색 결과)로 바꾸면 confirm이 조용히 무동작(선택한 지역이 좁힌 목록을 벗어났을 때 아무것도 안 담기고 시트도 안 닫힘)한다. 재현: 시트 열기 → 검색 `부`로 부산 선택 → 검색어를 `여수`로 바꿈(부산 칩이 시트에서 사라짐, 선택 상태는 유지) → confirm. **이 성질은 `TripWizardStep1Screen.test.tsx`의 `★확정은 full regions로 지역을 되찾는다` 테스트가 잠근다**(TRIP-387 게이트①-2, 뮤테이션 실측 — 위 뮤테이션이 그 테스트를 red로 만든다). 이 파일을 재편집할 때(예: 시트·검색·박수 스테퍼) 그 테스트를 지우면 blind spot이 재개방된다. 개념: [[좁힌 목록과 원본 목록의 소비처 분리]].

## 작업 관례

- **엣지 케이스 화면을 눈으로 보려면** 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다.
- **화면 비주얼**은 `figma-screen-impl` 스킬 절차를 따른다(밴드 맵은 `spec-perception/reference/figma-structure.md`).

## 유지

scribe가 [기록]에서 새 함정을 여기 추가한다(structure.md 아님). **항목이 12건을 넘으면** 위 「여기 적지 않는 것」 배제가 새는 것이므로 초과분이 무엇인지 개발로그에 적는다. *유지 판정: 6사이클 관찰 — path-scoped 규칙이 서브에이전트에 로드됨이 확인되면 파일을 층별로 쪼개 `paths:`를 붙인다(지금은 전파 불확실이라 무조건 로드). 또한 이 파일이 실제로 함정 회피에 인용된 건수 0이면 structure.md 절로 되돌린다.*
