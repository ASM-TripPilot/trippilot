---
paths:
  - "src/**/*Glyphs.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(전역 "raw hex 스캔은 `*Glyphs.tsx` 제외" 항목은 코어 `repo-traps.md`에 남아 무조건 로드된다.)

## 동명 글리프 복제

- **`LocationOffGlyph`가 세 벌이다** → `shared/location/LocationGlyphs.tsx`·`features/itinerary/ui/ItineraryGlyphs.tsx`·`features/reflection/ui/ReflectionGlyphs.tsx`에 같은 이름·같은 그림이 각각 있고 색만 다르다(공용=`mutedSoft` 고정, h35=`primary`; reflection 사본은 features 간 import 금지라 복제된 것으로 그 파일이 자인). grep하면 세 벌이 나오고 정본을 코드만으로는 알 수 없다.
