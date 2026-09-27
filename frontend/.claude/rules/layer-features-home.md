---
paths:
  - "src/features/home/**"
---
# `src/features/home/` — 홈 발견·영감 피드(a01)와 매거진 목록(a02)


계층: `lib`(순수 함수) → `model`(타입·상수·판정) → `ui`(화면+전용 글리프). **컨테이너·훅 없음** — 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0, `homeStructure` D-1이 기계 강제). 라우팅·데이터 배선은 `(tabs)/index.tsx`.

| 파일 | 역할 |
|---|---|
| `src/assets/home/` | 생성 플레이스홀더 이미지(단색/그라디언트 `.jpg` + `CREDITS.md`) — **실사진 아님**. 홈·매거진 카드가 `toUri` 헬퍼로 uri 변환해 쓴다 |
| `src/features/home/model/homeTypes.ts` | prop 계약 타입 — `HomeScreenProps{hero: readonly HomeMagazineHero[]; sections: HomeSections; phase?; …콜백}`. `HomeSections`는 `ready`/`loading` 판별 유니온(3섹션을 한 덩어리로 전환). `HomePhase`는 `discovery`(폴백)·`planning`·`postTrip`. 콜백은 전부 옵셔널 — 테스트·프리뷰가 콜백 없이 호출하므로 필수화 금지. ⚠️ `hero`가 빈 배열이면 planning·postTrip의 `hero[0]`가 `undefined`라 `MagazineHero`가 크래시한다(방어 없음, `traps-home.md`) |
| `src/features/home/model/homeFixtures.ts` | 고정 목업 — `HOME_DEFAULT_PROPS`·`HOME_LOADING_PROPS`·`HOME_PLANNING_PROPS`·`HOME_TRAVELING_PROPS`·`HOME_POST_TRIP_PROPS`. 단계 상수는 discovery 기저 위에 `phase`만 주입(프리뷰 진입점). 내부 `toUri`(`Image.resolveAssetSource(require(...)).uri ?? null`)를 카드 배열이 공유 |
| `src/features/home/ui/HomeGlyphs.tsx` | 홈 전용 인라인 SVG(raw hex 직박). D-3 가드(`homeStructure.test.ts`)는 `*Screen.tsx` 접미사(`HOME_SCREEN_SOURCE_FILES`)로 필터해 이 파일은 미대상 — 필터를 넓히면 걸린다. stroke 색은 jest 사각이라 `homeGlyphColorStructure.test.ts`(소스 스캔)가 유일한 그물(개념 [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]]) |
| `src/features/home/model/homePhase.ts` | 홈 라우트의 순수 판정 — `formatDday`(UTC epoch-day 산술)·`resolveHomePhase`(비-ENDED 중 가장 이른 startDate가 지배 여행 → `planning` + `dominantTripId`, 0건 → `undefined`)·`isTraveling`(오늘이 `[start,end]` 안이면 '여행 중' — dday와 같은 소스라 모순 없음)·`ctaLabelForStatus`·`applyItineraryTarget`(라우트가 계산한 목적지로 CTA 라벨을 덮어씀, null이면 폴백). **경계 회피 DI**: 다른 feature 포매터를 import 못 해 `formatTripMeta`를 라우트가 주입하고, `HomeTripInput`·`HomeItineraryTarget`은 서버/itinerary 타입의 로컬 구조 복제다 — D-1이 `@/shared/api` 문자열을 주석까지 raw 스캔하기 때문. ⚠️ `applyItineraryTarget`은 여행 중 판정에 `phase.showSpots`를 빌려 쓴다(의미가 다른 필드 — 갈라지면 A1·A4 테스트가 red) |
| `src/features/home/ui/HomeScreen.tsx` | `ready`/`loading` 발견 피드 화면 — props만 받고 내부 `PhaseBody`가 `phase.kind`로 얼굴을 고른다(단계를 스스로 도출하지 않는다). 공유 부품은 전부 파일 내부 `function`(새 export 0 — `HOME_SCREEN_SOURCE_FILES` 동결목록 무변경). discovery 버튼 집합은 `HomeScreen.test.tsx`의 `WIRED_CTA_TEST_IDS`가 정본 — 목적지 없는 컨트롤은 role을 주지 않는다(`SectionHeader`·`SoftNote`·`MagazineHero`의 `asButton`은 구조로 고정, 콜백 유무로 파생 금지). 딤 백드롭은 `CreateTripFab` 뒤·`SavedMenuFab` 앞에 렌더(개념 [[z-order = 렌더 순서 (RN absolute 형제는 나중 렌더가 위)]]). 담은 곳 배지는 `CountBadge`(`count < 1`이면 미렌더). softNote 배경 raw hex는 D-3 사각(6-b 실기 전용). INV-3 가드 `DURATION_RENDER`는 "이동시간 15분"류 일부를 놓친다 |
| `src/features/home/lib/formatCountBadge.ts` | 순수 함수 `formatCountBadge(n)` — `n<=0→''`·`1~99→String(n)`·`n>=100→'99+'`(단위+PBT). 이 파일 때문에 `fsdStructure.test.ts`의 home 세그먼트가 `['lib','model','ui']` |
| `src/features/home/ui/MagazineScreen.tsx` | a02 매거진 목록 순수 뷰 — 앱바·필터 칩(정확히 1선택)·에디토리얼·2열 매서너리([[매서너리 고정높이 2열]])·시각 전용 FAB. `HOME_SCREEN_SOURCE_FILES`에 반드시 있어야 D-3·D-4 자기검사가 통과한다. `onSearch`·`onPressCard`는 컨테이너 미배선이라 role 없음 |
| `src/features/home/model/magazineFixtures.ts` | `MAGAZINE_DEFAULT_PROPS` — 서버 매거진 API가 없어 픽스처 구동, 이미지는 `@/assets/home/*` 재사용. ⚠️ 주석에 `@/shared/api`·axios·`expo-router` 문자열을 쓰면 D-1 raw 스캔이 red(`traps-home.md`) |
| `src/features/home/model/magazineTypes.ts` | `MagazineScreen` prop 계약(순수 타입) — 칩·선택·에디토리얼·카드(`height` 고정)·옵셔널 콜백 |
