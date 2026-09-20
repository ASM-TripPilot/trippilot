---
paths:
  - "src/features/stay/**"
  - "src/pages/stay-*/**"
  - "src/app/stays/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## stay 검색

- **`useStaySearch` 기본 파라미터·오류 정규화** → **없다**(D6 이연). params를 그대로 넘기기만 한다.
- **숙소 목록 무한 스크롤** → `/stays/search`에 **페이지네이션 파라미터가 없다**. `onEndReached`류를 붙이면 같은 1페이지를 반복 요청하는 함정인데, 그 "없음"을 잠그는 단언이 **어느 심판에도 없다**.
- **이름·지역 검색(TRIP-469)은 회귀 심판이 0이다** → `StaySearchScreen.tsx`의 `nameQuery`/`onChangeNameQuery`(필터링)와 `StaySearchPage.tsx`의 `nameQuery` state(소유)를 잇는 흐름을 누르는 `StaySearchPage.*.integration.test.tsx`가 없다(`StaySearchScreen.nameSearch.test.tsx`는 화면 단위 테스트뿐). `filterByNameQuery`를 지우거나 페이지가 다른 prop 이름으로 잘못 넘겨도 통합 스위트 전부 green이다.

## stay 등록

- **세그먼트 레이아웃·핀 힌트 탭 소속은 jest 무심판** → `StayRegisterScreen.tsx`의 세그먼트 3탭 고정 높이(`h-11`+`numberOfLines={1}`+캡션 분리)를 전부 되돌려도 전 스위트 green(프리즈 `toHaveTextContent(/준비 중/)`는 집계 매치라 결합/분리 Text를 구분 못 함) — 픽셀 정합은 원리적으로 6-b 실기 전용. 핀 힌트(`stay-register-pin-hint`)가 "핀 탭에서만" 뜨는 것도 `PinPanel` 중첩에만 의존해 무심판(현재 코드는 맞음, tab 축을 잠그는 심판이 없다는 뜻).

## stay 담기 (coordConfirmed, TRIP-600)

- **`buildSaveStayRequest`의 출력값을 잠그는 심판이 단위·통합 두 층에 나뉘어 있고, 서로를 갱신시키는 기계가 없다** → `buildSaveStayRequest.test.ts`(단위, 함수 반환값)와 `src/pages/stay-search/ui/StaySearchPage.save.integration.test.tsx`(배선층, `EXPECTED_POST_A` 리터럴로 같은 값을 한 번 더 못 박음)가 같은 `coordConfirmed` 값을 각자 리터럴로 굳힌다. 단위 테스트만 갱신하고 통합 테스트를 빠뜨려도 lint·tsc는 안 잡고 `pnpm test:node`도 green이다 — `pnpm test:integration`(또는 `pnpm test` 전체)을 돌려야만 드러난다(TRIP-600 04#1·#2 FAIL 실측, 처방은 04#3). 이 함수의 반환 필드를 다시 바꿀 때는 두 파일을 함께 grep한다.

## 하트 글리프 사본 분기 (TRIP-807, 6-b 시각 전용)

- **e02 카드 하트와 e03·e04 하트가 서로 다른 모양이다** → TRIP-807이 e02(`StaySearchScreen`)만 `@/shared/ui/HeartGlyphs`(18-viewBox, 옛 `PlaceGlyphs` 모양)로 이관했고, e03(`StayDetailScreen`)·e04(`SavedStayListScreen` trailing)는 여전히 `features/stay/ui/StayGlyphs`(22-viewBox)를 쓴다. jest는 SVG path·viewBox를 원리적으로 못 봐(글리프 fill/모양 사각) 배선·testID·selected·press는 전수 green이어도 실기에서 두 하트 모양이 섞여 보인다(04b_smoke_1_PASS 확인). 통일은 후속 티켓(entities 카드 도입 전엔 e02·e03·e04 셋이 전부 `StayGlyphs`로 일관돼 있었다).
- **검색 카드는 명시적 testID 계약을 쓴다(접두사 주입 아님)** → `entities/stay/ui/StaySearchCard`는 `testIDPrefix` 하나로 하위 testID를 조립하지 않고 완성 문자열(root/photo/save/filled/outline)을 prop으로 받는다 — e02(`stay-card-save-{key}-filled`)와 d01(`explore-stay-heart-filled-{key}`)의 저장/글리프 testID 스킴이 서로 달라 단일 접두사로는 재현 불가했기 때문(개념 [[명시 testID 계약 — 소비처마다 스킴이 갈리면 접두 주입이 깨진다]]).

## stay 등록 세대 병합 (TRIP-730, e05)

- **default 얼굴(확정 콘텐츠)의 고유 콘텐츠(선택 숙소 카드)를 무는 심판이 0개다** → `StayRegisterScreen.tsx`의 `showConfirmedContent` 블록(캡션+`stay-register-selected-card`+이름/주소)을 통째로 주석 처리해도 `pnpm test` 전 스위트 green(code-critic 경고-1 실측, `grep -rn "selected-card\|핀 위치를 확인" *.test.tsx` = 0건). CTA 텍스트(R-16, "✓ 이 숙소 등록")는 `flow.coordConfirmed` 분기라 이 블록과 독립이라 카드가 사라져도 안 걸린다 — "green이니 확정 콘텐츠가 렌더된다"가 성립하지 않는다. 프리뷰 키 `stay-register-default`가 유일한 6-b 육안 그물.
- **multi-candidate 얼굴에 coordnotice가 함께 뜨는 것은 Figma엔 없는 조합이지만 동결 계약이 강제한다** → `showCoordNotice = !flow.coordConfirmed`가 후보 리스트 표시 조건과 독립이라, 후보 2건+미확정 상태(multi-candidate)에서도 coordnotice가 같이 보인다. Figma 1354(multi-candidate)엔 이 블록이 없지만, 동결 P-6(핀 탭·selectedCandidate null에서 coordnotice 요구)이 이 조건을 강제해 뗄 수 없다 — 무해 판정이나 6-b 육안 대조 시 "Figma와 다르네?"로 오인하기 쉽다.

## stay 저장 (하트, TRIP-417)

- **동시에 다른 두 카드를 토글하면 스냅숏 롤백이 서로를 지운다** (savedPlaces W-2 동형, code-critic 참고-1) → `savedStays.ts`의 `save`/`remove`(`:80·108`/`:118·134`)는 롤백 시 `previous` **통째 스냅숏**으로 되돌린다. A press(진행중, prev=`[]`) → B press(prev=`[A_opt]`) → A가 404 → `setQueryData([])` 롤백이 아직 진행 중인 B의 낙관 담기까지 지운다. 양쪽 다 실패하면 실패한 A가 optimistic 표식째 유령으로 남아 재진입 refetch 전까진 해제도 안 된다. `pendingKeys`는 **같은** 카드 연타만 막고 다른 두 카드 동시 토글은 심판이 없다. 단일 카드·성공 경로는 무해.
- **`useSavedStays`가 두 벌이다** → `features/stay/model/savedStays.ts`(TRIP-417, POST/DELETE 토글)와 `features/trip/model/useSavedStays.ts`(읽기전용 재수출)가 같은 이름으로 각각 존재한다. features 간 직접 import 금지라 통합 불가 — grep하면 두 벌이 나오고 어느 쪽이 "토글이 되는지"는 파일을 열어야 안다.
