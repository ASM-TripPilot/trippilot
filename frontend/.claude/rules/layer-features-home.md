---
paths:
  - "src/features/home/**"
---
# `src/features/home/` — 실구현 ③ (TRIP-170)


계층: `model`(순수 타입·상수) → `ui`(화면+전용 글리프, TRIP-173 FSD 완결 1/4에서 `screens`·`components` 2칸이 합류). **컨테이너·훅 없음** — 서버 API 부재로 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0).

| 파일 | 역할 |
|---|---|
| `src/features/home/model/homeTypes.ts` | prop 계약 타입 — 판별 유니온 `HomeSections`(`ready`/`empty`/`loading`) 포함 |
| `src/features/home/model/homeFixtures.ts` | 4상태 고정 목업(Q2 — Figma 표시값 그대로 상수화). `HOME_DEFAULT_PROPS`·`HOME_NO_TRIP_PROPS`·`HOME_EMPTY_PROPS`·`HOME_LOADING_PROPS` |
| `src/features/home/ui/HomeGlyphs.tsx` | 홈 전용 인라인 SVG 10종(AuthGlyphs/OnboardingGlyphs 패턴). raw hex 직박 — TRIP-173으로 `ui/`에서 `*Screen.tsx` 파일과 **같은 폴더가 됐다.** D-3 가드(`homeStructure.test.ts`)가 이제 디렉토리가 아니라 **`*Screen.tsx` 파일명 접미사로 필터**해 계속 미대상이다(`HOME_SCREEN_SOURCE_FILES` 동결목록으로 1건 고정, code-critic W-1 확인) — 필터가 조용히 넓어지면 이 파일도 스캔 대상이 될 수 있으니 그 필터를 건드릴 땐 이 파일부터 확인 |
| `src/features/home/ui/HomeScreen.tsx` | 4상태 프레젠테이션 화면. props만 받음 — `expo-router`·`@/shared/api`·타 feature import 0(homeStructure D-1이 기계 강제) |
