---
paths:
  - "src/features/request-replan/**"
---
# `src/features/request-replan/`

| 파일 | 역할 |
|---|---|
| `src/features/request-replan/model/replanScope.ts` | (TRIP-1155로 features/planb에서 이사) 범위 카탈로그 — `REPLAN_SCOPES`(`PARTIAL_SLOTS`·`FULL_DAY`)·`DEFAULT_REPLAN_SCOPE`. 와이어값은 ASCII key, 한글은 라벨. |
| `src/features/request-replan/model/replanMapCenter.ts` | (TRIP-1155로 features/planb에서 이사) `deriveReplanMapAnchor({sessionOrigin?, days?, preferredDate?})` — 사다리 `세션 origin(lat·lng 둘 다) ?? 기준 날짜 첫 좌표 슬롯 ?? 일정 첫 좌표 슬롯 ?? REPLAN_MAP_FALLBACK_CENTER`. 슬롯에서 골랐으면 `placeName`도 돌려준다("{장소} 인근(추정)" 라벨 재료). `PlanbSolvingPage`·`PlanbDraftPage`·`LiveLocationPage` 공용(G3 소스 가드가 호출을 강제) |
| `src/features/request-replan/model/replanRequest.ts` | (TRIP-1155로 features/planb에서 이사) `buildStartReplanRequest(values, origin?)` — 폼 값을 `StartReplanRequest` 7키로. 위치 미입력이어도 **`originKind: null`을 반드시 명시**(codegen required·nullable). `origin`이 없으면 `originLat/originLng` **키 자체가 없다**(값 null과 다름), 있으면 9키([[후방호환 옵셔널 파라미터 (additive prop)]]) |
| `src/features/request-replan/model/replanOrigin.ts` | (TRIP-1155로 features/planb에서 이사) `buildManualOrigin`·`buildGpsOrigin`(`{originKind, originLat, originLng}` 정확히 3키)·`isEstimatedOrigin(originKind)`(`!== 'GPS'` — GPS만 실측, 나머지는 전부 "추정"). 파일 헤더의 "test-designer 스텁 — red 유도용" 주석은 낡았다 |
| `src/features/request-replan/model/replanFormStore.ts` | (TRIP-1155로 features/planb에서 이사) Zustand 폼 스토어 `useReplanFormStore` — `scope`·`reasons`(Set)·`directives`(Set)·`freeText`·`sheetOpen`. 시트↔페이지 상태 공유 때문에 페이지 로컬 `useState`가 아니다 |
| `src/features/request-replan/model/useStartReplan.ts` | (TRIP-1155로 features/planb에서 이사) codegen 세션 생성 훅의 얇은 래퍼 — 통합 테스트가 이 심볼을 목 seam으로 잠그므로 페이지가 codegen 훅을 직접 부르지 않는다 |
