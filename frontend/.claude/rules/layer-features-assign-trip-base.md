---
paths:
  - "src/features/assign-trip-base/**"
---
# `src/features/assign-trip-base/`

| 파일 | 역할 |
|---|---|
| `src/features/assign-trip-base/model/baseAssignPlan.ts` | (TRIP-1155로 features/trip에서 이사) `planBaseAssign(current, request)` — 거점 지정을 "교체"로 만드는 계획(겹치는 배정 DELETE + 남은 구간 재POST + 새 POST). 서버 `POST /bases`가 기존 배정을 안 보고 행을 추가하기 때문. 구간은 `[dateFrom, dateTo)`, ISO 문자열 비교. |
| `src/features/assign-trip-base/model/useTripBases.ts` | (TRIP-1155로 features/trip에서 이사) `useTripBases`(`enabled: tripId !== undefined`) · `useInvalidateBases`(`bases`·`coverage` 두 키만 — 인자 없는 `invalidateQueries()`는 `saved-stays`까지 헛돈다) · `useAssignBase`(`useMutation`+생성 요청 함수로 **409를 성공으로 접는다** — 생성 훅 반환 타입으로는 "409면 빈 값"을 표현 못 함. 교체 중 **DELETE 404도 접는다**(이미 지워짐, TRIP-1235) — DELETE 그 밖 실패·POST 404는 그대로 throw). 지금 배정은 캐시에서 읽되 **캐시가 비었거나 `isInvalidated`면 `fetchQuery(getGetTripsTripIdBasesQueryOptions)`로 받아 온다**(TRIP-1749 — 관찰자 없는 화면은 무효화돼도 다시 받지 않는다). 404는 `[]`(POST가 404로 끝남), 그 밖 실패는 DELETE·POST 전에 throw(INV-4). 캐시가 신선하면 추가 GET 0. 전역 retry가 걸려 500이면 약 7초 뒤 실패. |
