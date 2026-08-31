---
paths:
  - "src/features/record/**"
  - "src/pages/trip-records/**"
  - "src/pages/records-compare/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`GET /trips/{tripId}/change-log`는 여전히 미개통이다(생산자 없음, 항상 빈 목록) — 변경 이력은 `GET /trips/{tripId}/records` 응답의 `TripRecord.changes[]`에 임베드돼 내려온다.** TRIP-570 티켓 원문은 "TRIP-275로 `/change-log`가 개통돼 실제 변경 행이 내려온다"고 적었으나, origin/develop `openapi.yaml`(1405–1424행)은 그대로 "생산자 없어 항상 빈 목록, 붙이지 말 것"이다. j02 비교 화면(`useCompareRecords`)은 `/records`만 호출하고 standalone `/change-log`는 붙이지 않는다 — 붙였다면 항상 빈 배열만 받았을 것. `aidlc` 정본 BR-U5-29 원문("읽을 진입점이 아직 없다, G-U5-12")도 이 드리프트만큼 낡아 있으나 3-a 사용자 선택 없이는(자율 세션) 미반영 상태다(관측만, 2026-09-01). 다음에 변경 이력을 조회하는 화면을 또 만들 때 티켓 설명만 보고 `/change-log`를 잡으면 이 함정을 재발한다 — 실제 데이터 원천은 `/records.changes[]`다.
