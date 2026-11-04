---
paths:
  - "src/**/*Glyphs.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(전역 "raw hex 스캔은 `*Glyphs.tsx` 제외" 항목은 코어 `repo-traps.md`에 남아 무조건 로드된다.)

## 동명 글리프 (TRIP-1773 로 0 — ESLint 가 지킨다)

- **글리프 파일(`*Glyphs.tsx`) 사이에 같은 이름을 export 하면 lint error 다** → `eslint.config.js` 의 `no-restricted-exports` 블록이 파일마다 "다른 글리프 파일이 이미 정의한 이름"을 막는다. 금지 목록은 `scripts/glyphExportBlocks.cjs`(순수 함수, `glyphExportBlocks.test.ts` 가 지킨다)가 디스크의 `*Glyphs.tsx` 에서 계산한다 — "전체 − 내 이름"으로 바꾸면 두 파일이 같은 이름을 정의할 때 서로 자기 이름이라 영영 안 울린다(단위 테스트 6건이 이걸 잡는다). **새 글리프 파일은 이름이 `*Glyphs.tsx` 여야 가드에 든다.**
- **이름 규칙: 접두 없는 이름(`ChevronRightGlyph`·`CheckGlyph`)은 `shared/ui/glyphs` 공용만 갖는다. 슬라이스 것은 `<Slice><Name>Glyph`**(`StayBedGlyph`·`RecordChevronRightGlyph`·`ExploreSearchGlyph`). 같은 도형이면 공용을 직접 import 하고, 래퍼·재수출로 이름을 남기지 않는다(가드가 막는다). 어댑터가 필요한 곳은 컴포넌트를 *값*으로 넘기는 6곳뿐이다(`Category*`·`Onboarding*`·`AmenityGlyph`).
- **가드가 못 보는 것**: `export * from`(이름이 없다) · `export type/interface` · ALL_CAPS 상수 · `export { X, // 주석 \n Y }` 처럼 목록 안 주석 뒤 이름(글리프 파일엔 현재 0개). 알려진 오탐: 공용 이름을 import 해 `export { X }` 로 되내보내면 양쪽 파일이 error 다(안전하게 실패, 재수출은 `export { X } from` 으로).
- **토큰 밖 색 2묶음은 같은 도형인데도 합치지 않았다** → `#C2CCD6`(Slot `PhotoGlyph`↔Execution `HeroPhotoGlyph`)·`#C2C7CE`(`RecordChevronRightGlyph`↔공용 `ChevronRight`) — `GLYPH_COLORS` 에 없는 색이라 공용으로 합치면 색이 바뀐다. viewBox 만 달라 그림이 같은 사본(스케일 정규화 20묶음 → 10묶음 남음)도 획폭·안티에일리어싱 때문에 픽셀이 달라질 수 있어 남겼다. 합치려면 픽셀 변화를 허용하는 제품 판단이 먼저다.
