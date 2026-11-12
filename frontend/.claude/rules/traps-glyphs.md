---
paths:
  - "src/**/*Glyphs.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(raw hex 는 ESLint `trippilot/no-raw-hex` 가 막는다 — 서술은 코어 `repo-traps.md` 「글리프 · 심판 사정거리」에 있고 무조건 로드된다.)

## 동명 글리프 (TRIP-1773 로 0 — ESLint 가 지킨다)

- **글리프 파일(`*Glyphs.tsx`) 사이에 같은 이름을 export 하면 lint error 다** → `eslint.config.js` 의 `no-restricted-exports` 블록이 파일마다 "다른 글리프 파일이 이미 정의한 이름"을 막는다. 금지 목록은 `scripts/glyphExportBlocks.cjs`(순수 함수, `glyphExportBlocks.test.ts` 가 지킨다)가 디스크의 `*Glyphs.tsx` 에서 계산한다 — "전체 − 내 이름"으로 바꾸면 두 파일이 같은 이름을 정의할 때 서로 자기 이름이라 영영 안 울린다(단위 테스트 6건이 이걸 잡는다). **새 글리프 파일은 이름이 `*Glyphs.tsx` 여야 가드에 든다.**
- **이름 규칙: 접두 없는 이름(`ChevronRightGlyph`·`CheckGlyph`)은 `shared/ui/glyphs` 공용만 갖는다. 슬라이스 것은 `<Slice><Name>Glyph`**(`StayBedGlyph`·`RecordChevronRightGlyph`·`ExploreSearchGlyph`). 같은 도형이면 공용을 직접 import 하고, 래퍼·재수출로 이름을 남기지 않는다(가드가 막는다). 어댑터가 필요한 곳은 컴포넌트를 *값*으로 넘기는 6곳뿐이다(`Category*`·`Onboarding*`·`AmenityGlyph`).
- **가드가 못 보는 것**: `export * from`(이름이 없다) · `export type/interface` · ALL_CAPS 상수 · `export { X, // 주석 \n Y }` 처럼 목록 안 주석 뒤 이름(글리프 파일엔 현재 0개). 알려진 오탐: 공용 이름을 import 해 `export { X }` 로 되내보내면 양쪽 파일이 error 다(안전하게 실패, 재수출은 `export { X } from` 으로).
- **도형이 같아 보여도 합치면 그림이 바뀌는 짝이 남아 있다** → `RecordChevronRightGlyph`↔공용 `ChevronRight` 는 도형·획폭(prop)은 맞출 수 있지만 기본색 `#C2C7CE` 가 `GLYPH_COLORS` 밖이라 색이 바뀐다. Slot `PhotoGlyph`↔Execution `HeroPhotoGlyph` 는 색(`#C2CCD6`)만이 아니라 **획폭 하드코딩이 2 vs 1.6(같은 vb16)이라 색을 맞춰도 다른 그림**이다. `TripHeartGlyph`↔공용 18 `HeartOutlineGlyph` 도 획 2 vs 1.5. 면접관이 "접두사만 다른 복제"로 든 Plus·오른쪽 Chevron·Check 도 획폭÷viewBox 비율이 갈려(0.083~0.125) 다른 그림이다 — 하나로 만들려면 아이콘 굵기 표준화라는 디자인 결정이 먼저다.
- **viewBox 만 달라 그림이 같은 사본(T2)은 TRIP-1829 에서 ✕·경고 삼각·↻ 를 공용으로 합쳤다** → 수치는 viewBox 를 맞추면 같지만(최대 차 0.0097) 실화면 경계 픽셀이 1~2/255 다르다(안티에일리어싱, ✕ 8px·↻ 12px·삼각 5px). 이 차이를 받아들일지는 끝 보고 결정 1 로 사람에게 넘겼다 — **렌더 트리 덤프는 T2 를 "같다"고 증명하지 못한다**(viewBox·strokeWidth 숫자가 바뀐다), 남는 그물은 픽셀 대조뿐이다. 남은 스케일 정규화 묶음은 비율 방식(`_workspace/20261108-trip1829-glyphs/01_ratio.cjs`, 획 글리프만)으로 10묶음이고 그중 그림이 같은(비율 같음) 것은 1 — 실소비 0 `AuthWarningTriangleGlyph`↔공용 `WarningTriangleGlyph` 뿐이다(체크 묶음 안 Onboarding·Trip·Toast 3개는 서로 비율 0.125 로 같지만 공용에 같은 비율이 없다). 합칠 때 공용 기본값(`CloseGlyph` 기본 색 `onPrimary`=흰색 등)이 사본과 다르면 소비처에 size·color 를 적어야 한다 — 빠뜨리면 흰 ✕ 가 된다.
