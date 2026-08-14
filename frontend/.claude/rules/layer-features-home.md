---
paths:
  - "src/features/home/**"
---
# `src/features/home/` — 실구현 ③ (TRIP-170, TRIP-316에서 계약·화면 통째 재작성)


계층: `model`(순수 타입·상수) → `ui`(화면+전용 글리프, TRIP-173 FSD 완결 1/4에서 `screens`·`components` 2칸이 합류). **컨테이너·훅 없음** — 서버 API 부재로 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0).

**TRIP-316(2026-08-14)**: 구 세대 "여행 상태 대시보드"(`trip`·`nextPlan`·`resume`·`taste` 계약)를 신 세대 "발견·영감 피드"(`hero`+`sections` 계약, 라이브 Figma 2091:1357)로 폐기·재작성. no-trip 픽셀 정본이 신 프레임에 없어 `HOME_NO_TRIP_PROPS`는 `HOME_DEFAULT_PROPS`와 바이트 동일(가정 B, 상태 5종 별도 티켓 몫).

| 파일 | 역할 |
|---|---|
| `src/features/home/model/homeTypes.ts` | prop 계약 타입(TRIP-316 재작성) — `HomeScreenProps{hero: HomeMagazineHero; sections: HomeSections}`. `HomeSections`는 판별 유니온(`ready`/`empty`/`loading`, 3섹션을 한 덩어리로 묶어 부분 실패 시 전 섹션 동시 전환). 카드 타입 `HomeCollectionCard`·`HomeSpotCard`·`HomeItineraryCard`·`HomeMagazineHero` 신규. **TRIP-317 추가**: `HomeScreenProps.phase?: HomePhase`(옵셔널 additive) — `HomePhase`는 `discovery`(폴백, payload 없음)·`collecting`·`planning`·`upcoming`·`postTrip` 5종 판별 유니온. 페이로드 타입 `TripHeroData`·`HomeStatTile`·`NextStop`·`NearbyCard`·`RecapCard`·`PastTrip`·`HomeSoftNote` 7종 신규(컴파일용, 런타임 로직 0). `HomeCollectionCard.savedAtLabel?`도 신규(collecting 저장일 메타, discovery엔 없음) |
| `src/features/home/model/homeFixtures.ts` | 4상수 고정 목업(Q2 — 신 프레임 Figma 표시값 그대로 상수화, TRIP-316 재작성). `HOME_DEFAULT_PROPS`·`HOME_NO_TRIP_PROPS`(≡DEFAULT)·`HOME_EMPTY_PROPS`·`HOME_LOADING_PROPS`. **TRIP-317 추가**: `HOME_COLLECTING_PROPS`·`HOME_PLANNING_PROPS`·`HOME_UPCOMING_PROPS`·`HOME_POST_TRIP_PROPS` 4상수 — discovery 기저(`hero`·`sections`) 위에 `phase`만 주입, 프리뷰(`_dev/preview.tsx`) 전용 진입점(실착지 `(tabs)/index.tsx`는 서버가 단계를 줄 계약이 없어 discovery 유지, 가정 E) |
| `src/features/home/ui/HomeGlyphs.tsx` | 홈 전용 인라인 SVG **6종**(TRIP-316에서 10종→6종 — 신규 3: `SearchGlyph`·`SparkleGlyph`·`LocationPinGlyph`, 톤 변경 2: `HeartOutlineGlyph`·`PlusGlyph`, 유지 1: `BellGlyph`. 고아 7삭제: `ClockGlyph`·`PencilGlyph`·`ChevronRightGlyph`·`FlameGlyph`·`LikeHeartGlyph`·`CommentGlyph`·`RouteDotsGlyph`, home 밖 참조 0 확인 후 제거). raw hex 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일과 **같은 폴더가 됐다.** D-3 가드(`homeStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`HOME_SCREEN_SOURCE_FILES` 동결목록으로 1건 고정, code-critic W-1 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
| `src/features/home/ui/HomeScreen.tsx` | **3상태**(`ready`/`empty`/`loading`) 발견·영감 피드 프레젠테이션 화면(TRIP-316 재작성, 구 4상태 대시보드 폐기). props만 받음 — `expo-router`·`@/shared/api`·타 feature import 0(homeStructure D-1이 기계 강제). softNote 배경 `bg-[#fff7f8]`는 raw-hex 가드(D-3) 13색 밖 사각지대(`repo-traps.md` 대상 아님 — 06-b 실기 스모크로만 담보, TRIP-316 04b SKIP 인수인계). **TRIP-317 추가**: 내부 `PhaseBody` 순수 스위치 함수가 `phase.kind`(미전달/`discovery`→316 얼굴 그대로, 나머지 4종→단계 얼굴)로 조립 — 여행 데이터를 뜯어 단계를 스스로 도출하는 코드 0줄. 공유 부품(`GreetingHeader`·`SoftNote`·`CollectionCard`·`CollectionStrip`·`TripHero`·`MiniMapCard`·`DashRow`·`NextStopCard`·`PastTripsSection`)을 파라미터화해 조립 — 얼굴별 신규 export 0, 전부 파일 내부 `function`(`HOME_SCREEN_SOURCE_FILES` 동결목록 1건 무변경). 신 testID 5종: `home-trip-hero`·`home-next-stop`·`home-dash-itinerary`·`home-recap-card`·`home-saved-count-chip`. INV-3 렌더 가드 `DURATION_RENDER`(`HomeScreen.test.tsx`)는 "24시간 개방" 거짓매치는 막지만 "이동시간 15분"류 진짜 소요시간 일부를 놓치는 과교정 상태(현 동결 데이터엔 트리거 없음 — 후속 티켓 후보, 아래 W1) |
