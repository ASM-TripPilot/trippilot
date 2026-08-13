---
paths:
  - "src/features/home/**"
---
# `src/features/home/` — 실구현 ③ (TRIP-170, TRIP-316에서 계약·화면 통째 재작성)


계층: `model`(순수 타입·상수) → `ui`(화면+전용 글리프, TRIP-173 FSD 완결 1/4에서 `screens`·`components` 2칸이 합류). **컨테이너·훅 없음** — 서버 API 부재로 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0).

**TRIP-316(2026-08-14)**: 구 세대 "여행 상태 대시보드"(`trip`·`nextPlan`·`resume`·`taste` 계약)를 신 세대 "발견·영감 피드"(`hero`+`sections` 계약, 라이브 Figma 2091:1357)로 폐기·재작성. no-trip 픽셀 정본이 신 프레임에 없어 `HOME_NO_TRIP_PROPS`는 `HOME_DEFAULT_PROPS`와 바이트 동일(가정 B, 상태 5종 별도 티켓 몫).

| 파일 | 역할 |
|---|---|
| `src/features/home/model/homeTypes.ts` | prop 계약 타입(TRIP-316 재작성) — `HomeScreenProps{hero: HomeMagazineHero; sections: HomeSections}`. `HomeSections`는 판별 유니온(`ready`/`empty`/`loading`, 3섹션을 한 덩어리로 묶어 부분 실패 시 전 섹션 동시 전환). 카드 타입 `HomeCollectionCard`·`HomeSpotCard`·`HomeItineraryCard`·`HomeMagazineHero` 신규 |
| `src/features/home/model/homeFixtures.ts` | 4상수 고정 목업(Q2 — 신 프레임 Figma 표시값 그대로 상수화, TRIP-316 재작성). `HOME_DEFAULT_PROPS`·`HOME_NO_TRIP_PROPS`(≡DEFAULT)·`HOME_EMPTY_PROPS`·`HOME_LOADING_PROPS` |
| `src/features/home/ui/HomeGlyphs.tsx` | 홈 전용 인라인 SVG **6종**(TRIP-316에서 10종→6종 — 신규 3: `SearchGlyph`·`SparkleGlyph`·`LocationPinGlyph`, 톤 변경 2: `HeartOutlineGlyph`·`PlusGlyph`, 유지 1: `BellGlyph`. 고아 7삭제: `ClockGlyph`·`PencilGlyph`·`ChevronRightGlyph`·`FlameGlyph`·`LikeHeartGlyph`·`CommentGlyph`·`RouteDotsGlyph`, home 밖 참조 0 확인 후 제거). raw hex 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일과 **같은 폴더가 됐다.** D-3 가드(`homeStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`HOME_SCREEN_SOURCE_FILES` 동결목록으로 1건 고정, code-critic W-1 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
| `src/features/home/ui/HomeScreen.tsx` | **3상태**(`ready`/`empty`/`loading`) 발견·영감 피드 프레젠테이션 화면(TRIP-316 재작성, 구 4상태 대시보드 폐기). props만 받음 — `expo-router`·`@/shared/api`·타 feature import 0(homeStructure D-1이 기계 강제). softNote 배경 `bg-[#fff7f8]`는 raw-hex 가드(D-3) 13색 밖 사각지대(`repo-traps.md` 대상 아님 — 06-b 실기 스모크로만 담보, TRIP-316 04b SKIP 인수인계) |
