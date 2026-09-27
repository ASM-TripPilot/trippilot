---
paths:
  - "src/features/stay/**"
  - "src/pages/stay-*/**"
  - "src/app/stays/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`savedStays.integration.test.tsx`는 react-query 알림 경합 처방이 적용돼 있다** — `beforeAll`에 `notifyManager.setScheduler` 5ms 잠금 + `@/test-support/flushNotifications`로 `result.current`를 읽기 전 순서를 기다린다. 롤백 단언 앞 flush는 지워도 green으로 남는 무방비 지점이다(상세·이유는 `traps-record.md` 동일 항목). 새 낙관 업데이트 테스트를 이 파일에 더할 때 flush 없이 `act` 직후 읽으면 같은 flake가 재발한다.

## stay 검색

- **`useStaySearch` 기본 파라미터·오류 정규화** → **없다**(D6 이연). params를 그대로 넘기기만 한다.
- **숙소 목록 무한 스크롤** → `/stays/search`에 **페이지네이션 파라미터가 없다**. `onEndReached`류를 붙이면 같은 1페이지를 반복 요청하는 함정인데, 그 "없음"을 잠그는 단언이 **어느 심판에도 없다**.
- **이름·지역 검색은 통합 회귀 심판이 0이다** → `StaySearchScreen.tsx`의 `nameQuery`/`onChangeNameQuery`(필터링)와 `StaySearchPage.tsx`의 `nameQuery` state(소유)를 잇는 흐름을 누르는 `StaySearchPage.*.integration.test.tsx`가 없다(`StaySearchScreen.nameSearch.test.tsx`는 화면 단위뿐). `filterByNameQuery`를 지우거나 페이지가 다른 prop 이름으로 넘겨도 통합 스위트 전부 green이다.

## stay 등록

- **핀 힌트 탭 소속은 jest 무심판** → 핀 힌트(`stay-register-pin-hint`)가 "핀 탭에서만" 뜨는 것은 `PinPanel` 중첩에만 의존하고 tab 축을 잠그는 심판이 없다(현재 코드는 맞음). 세그먼트 픽셀 정합은 원리적으로 6-b 실기 전용.

## stay 담기 (coordConfirmed)

- **`buildSaveStayRequest`의 출력값을 잠그는 심판이 단위·통합 두 층에 나뉘어 있고, 서로를 갱신시키는 기계가 없다** → `buildSaveStayRequest.test.ts`(단위, 함수 반환값)와 `src/pages/stay-search/ui/StaySearchPage.save.integration.test.tsx`(배선층, `EXPECTED_POST_A` 리터럴)가 같은 `coordConfirmed` 값을 각자 리터럴로 굳힌다. 단위 테스트만 갱신하고 통합 테스트를 빠뜨려도 lint·tsc·`pnpm test:node`는 green이다 — `pnpm test:integration`(또는 `pnpm test` 전체)을 돌려야만 드러난다(실측 2건). 이 함수의 반환 필드를 바꿀 때는 두 파일을 함께 grep한다.

## e03 숙소 상세 GET

- **`GET /stays/{stayId}`는 인증 필요인데 401을 별도로 안 가르고 통합 테스트 목 서버는 무조건 200이다** → `pages/stay-detail/ui/StayDetailPage.tsx`의 `resolveDetailState`는 404(notFound)·400(invalid)만 가르고 401은 나머지(`error`, 재시도 버튼)로 접힌다. 401은 다시 물어도 안 풀리므로 세션 만료 사용자는 재시도를 눌러도 같은 얼굴이 반복된다. `StayDetailPage.integration.test.tsx`의 `beforeEach` 기본 핸들러가 Authorization 헤더를 안 보고 200을 주기 때문에, 게스트 동선 케이스(I7·I8·G1·G2·`affiliateNoticeOneTruth`)가 green이어도 **실서버의 게스트/세션만료 경로는 보장되지 않는다**(정책 미결: 공개 API로 열지 FE가 401 얼굴을 만들지).

## 하트 글리프 사본 분기 (6-b 시각 전용)

- **e02 카드 하트와 e03·e04 하트가 서로 다른 모양이다** → e02(`StaySearchScreen`)는 `@/shared/ui/HeartGlyphs`(18-viewBox)를, e03(`StayDetailScreen`)·e04(`SavedStayListScreen` trailing)는 `features/stay/ui/StayGlyphs`(22-viewBox)를 쓴다. jest는 SVG path·viewBox를 원리적으로 못 봐 배선·testID·selected·press가 green이어도 실기에서 두 하트 모양이 섞여 보인다.
- **검색 카드는 명시적 testID 계약을 쓴다(접두사 주입 아님)** → `entities/stay/ui/StaySearchCard`는 `testIDPrefix` 하나로 하위 testID를 조립하지 않고 완성 문자열(root/photo/save/filled/outline)을 prop으로 받는다 — e02(`stay-card-save-{key}-filled`)와 d01(`explore-stay-heart-filled-{key}`)의 저장/글리프 testID 스킴이 서로 달라 단일 접두사로는 재현 불가했기 때문(개념 [[명시 testID 계약 — 소비처마다 스킴이 갈리면 접두 주입이 깨진다]]).

## stay 등록 (e05)

- **multi-candidate 얼굴에 coordnotice가 함께 뜨는 것은 Figma엔 없는 조합이지만 동결 계약이 강제한다** → `showCoordNotice = !flow.coordConfirmed`가 후보 리스트 표시 조건과 독립이라, 후보 2건+미확정 상태(multi-candidate)에서도 coordnotice가 같이 보인다. Figma 1354(multi-candidate)엔 이 블록이 없지만, 동결 P-6(핀 탭·selectedCandidate null에서 coordnotice 요구)이 이 조건을 강제해 뗄 수 없다 — 무해 판정이나 6-b 육안 대조 시 "Figma와 다르네?"로 오인하기 쉽다.

## e05 프리뷰 키 (렌더 얼굴 무심판)

- **`stay-register-pin`·`stay-register-calendar`·`stay-filter-sheet` 3키의 "렌더된 얼굴"은 어떤 jest 심판도 안 본다** → `devPreviewBandNav.test.tsx`는 `PREVIEW_STATES` 키 존재·개수(정본은 그 파일의 `toHaveLength`)·라벨만 잰다. `preview.tsx`의 `STAY_REGISTER_PIN_FLOW.activeTab`을 `'pin'`→`'mapsearch'`로 바꾸거나 `stay-filter-sheet` 픽스처에 `amenities:[] stayTypes:[]`를 넘겨도(빈 시트) 전 스위트가 green이다 — 6-b 육안 전까지는 "코드상 맞다"이지 "화면이 맞게 뜬다"가 아니다.

## stay 저장 (하트)

- **동시에 다른 두 카드를 토글하면 스냅숏 롤백이 서로를 지운다** (savedPlaces 동형) → `savedStays.ts`의 `save`/`remove`는 롤백 시 `previous` **통째 스냅숏**으로 되돌린다. A press(진행중, prev=`[]`) → B press(prev=`[A_opt]`) → A가 404 → `setQueryData([])` 롤백이 아직 진행 중인 B의 낙관 담기까지 지운다. 양쪽 다 실패하면 실패한 A가 optimistic 표식째 유령으로 남아 재진입 refetch 전까진 해제도 안 된다. `pendingKeys`는 **같은** 카드 연타만 막고 다른 두 카드 동시 토글은 심판이 없다. 단일 카드·성공 경로는 무해.
- **`useSavedStays`가 두 벌이다** → `features/stay/model/savedStays.ts`(POST/DELETE 토글)와 `features/trip/model/useSavedStays.ts`(읽기전용 재수출)가 같은 이름으로 각각 존재한다. features 간 직접 import 금지라 통합 불가 — grep하면 두 벌이 나오고 어느 쪽이 "토글이 되는지"는 파일을 열어야 안다.
