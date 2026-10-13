---
paths:
  - "src/features/add-must-visit/**"
---
# `src/features/add-must-visit/`

| 파일 | 역할 |
|---|---|
| `src/features/add-must-visit/model/mustVisitTimeForm.ts` | (TRIP-1155로 features/itinerary에서 이사) h03 폼 — `tripDayChips`·`startTimeOptions`(30분 간격 48개)·`DWELL_OPTIONS`(30·60·120분, 발명값)·`canSubmitMustVisitTime`(OFF는 값 무관 `true`, BR-U1-48 기본 ANYTIME) · `buildFixedMustVisitRequest`(검증 실패 시 `null` — 되돌릴 수 없는 DELETE를 검증 전에 못 내보낸다) · `buildAnytimeMustVisitRequest`(`{poiId, type:'ANYTIME'}` 최소본, 여분 키가 솔버 힌트가 되지 않게). |
