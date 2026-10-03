---
paths:
  - "src/features/check-visit/**"
---
# `src/features/check-visit/`

| 파일 | 역할 |
|---|---|
| `src/features/check-visit/model/visitStatus.ts` | (TRIP-1155로 features/record에서 이사) `deriveVisitStatus({arrivedAt, completedAt, skippedAt}) → 'UPCOMING'\|'IN_PROGRESS'\|'COMPLETED'\|'SKIPPED'` — 세 timestamp 유무만으로 매번 계산(INV-U5-01). 입력 타입에 `status` 자리가 없어 저장된 상태를 읽는 경로가 구조적으로 봉쇄된다. 우선순위 `skipped > completed > arrived > upcoming`. `OPTIMISTIC_VISIT_ID_PREFIX`·`isOptimisticVisit(id)`(TRIP-1069)도 여기 — 낙관 id 판정 단일 지점, `useVisitCheck.arrive`가 id 생성에·카드·페이지가 판정에 쓴다(카드가 이미 이 순수 모듈을 import해 전이 로드 없음, `useVisitCheck.ts`에 두면 생성 API 클라이언트가 전이 로드된다). 개념 [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]] |
| `src/features/check-visit/model/visitStatus.test.ts` | (TRIP-1155로 features/record에서 이사) PBT + 진리표 + INV 잠금(가짜 `status` 필드를 섞어도 무시). `fc.date`에는 `noInvalidDate: true`가 필요하다 — 없으면 Invalid Date가 구현 호출 전에 throw해 flaky |
| `src/features/check-visit/model/useVisitCheck.ts` | (TRIP-1155로 features/record에서 이사) `arrive`/`complete`/`skip` 낙관 갱신 + 레코드 단위 롤백(통짜 스냅숏 아님). 실패는 판별 유니온 `VisitCheckOutcome`으로 반환(INV-4). `settleRollback()`은 react-query v5 배치 통지가 매크로태스크로 밀리는 것을 한 틱 양보해 브리지한다. arrive는 무효화 대신 응답 레코드로 낙관 레코드를 교체한다(재조회가 즉석 삽입을 덮지 않게). 개념 [[낙관적 갱신과 롤백 (optimistic update)]] · [[낙관적 락 기준버전 (updatedAt)]] |
| `src/features/check-visit/model/useVisitCheck.integration.test.tsx` | (TRIP-1155로 features/record에서 이사) msw + 실 QueryClient — 409 롤백·즉석 2건 append·skip·동시 두 도착 중 하나 실패해도 다른 낙관 생존. ⚠️ "plan 미접촉"(`/itinerary` 히트 0) 단언은 이 셋업에서 항상 참이다 — 진짜 보장은 G2 구조 스캔 |
| `src/features/check-visit/model/spontaneousNames.ts` | (TRIP-1155로 features/record에서 이사) (TRIP-1072 신규) TanStack Query 캐시를 "세션 메모장"으로 쓴다 — `rememberSpontaneousName(qc, tripId, poiId, nameKo)`는 `setQueryDefaults(['record','spontaneous-names',tripId], {gcTime: Infinity, staleTime: Infinity})`를 **먼저** 건 뒤 `setQueryData`로 병합(관찰자 없이 만들어진 쿼리가 기본 gcTime으로 곧 지워지는 것 방지). `useSpontaneousNames(tripId)`는 `initialData: {}` + staleTime Infinity로 첫 렌더부터 빈 표를 주고 마운트 조회를 안 돈다(이미 있는 이름을 안 덮음). 서버에 이름 필드가 없어(`VisitCheck`에 `nameKo` 없음) 화면 사이 공유 상태를 Zustand가 아니라 Query 캐시로 둔 이유는 README "서버 응답을 스토어에 복사하지 않는다" 규칙 — Zustand는 이 리포에서 서버 파생값을 못 담는다. ⚠️ **영구 아님** — 앱 재시작하면 poiId(UUID)로 되돌아간다(BE `VisitCheck.nameKo` 신설 또는 `GET /places/{poiId}` 신설 전까지 미충족, 새 티켓 후보). 소비처: `pages/record/record-add-visit` · `pages/record/trip-records` |
| `src/features/check-visit/model/spontaneousNames.test.tsx` | (TRIP-1155로 features/record에서 이사) 여행별 격리·병합(덮어쓰지 않음)·관찰자 없이 20ms 뒤에도 생존(gcTime Infinity 잠금) |
