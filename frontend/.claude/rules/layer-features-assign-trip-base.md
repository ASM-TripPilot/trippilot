---
paths:
  - "src/features/assign-trip-base/**"
---
# `src/features/assign-trip-base/`

| 파일 | 역할 |
|---|---|
| `src/features/assign-trip-base/model/baseAssignPlan.ts` | (TRIP-1155로 features/trip에서 이사) `planBaseAssign(current, request)` — 거점 지정을 "교체"로 만드는 계획(겹치는 배정 DELETE + 남은 구간 재POST + 새 POST). 서버 `POST /bases`가 기존 배정을 안 보고 행을 추가하기 때문. 구간은 `[dateFrom, dateTo)`, ISO 문자열 비교. |
| `src/features/assign-trip-base/model/useTripBases.ts` | (TRIP-1155로 features/trip에서 이사) `useTripBases`(`enabled: tripId !== undefined`) · `useInvalidateBases`(`bases`·`coverage` 두 키만 — 인자 없는 `invalidateQueries()`는 `saved-stays`까지 헛돈다) · `useAssignBase`(`useMutation`+생성 요청 함수로 **409를 성공으로 접는다** — 생성 훅 반환 타입으로는 "409면 빈 값"을 표현 못 함). |
