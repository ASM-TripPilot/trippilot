---
paths:
  - "src/features/apply-replan/**"
---
# `src/features/apply-replan/`

| 파일 | 역할 |
|---|---|
| `src/features/apply-replan/model/useApplyReplan.ts` | (TRIP-1155로 features/planb에서 이사) codegen apply를 감싸는 유일 seam(`PlanbDiffPage` 1곳 — 구조가드로 봉인). 성공 시 itinerary 캐시 무효화(확정이 원 일정을 바꾸는 유일 지점, INV-U4-05) + 그 여행 트리거 목록 다시 받기(상황 감지 FE-A) + 그 여행 기회 캐시 무효화(상황 감지 FE-C — 키 앞부분 일치라 모든 날짜. 기회 카드 [넣어서 다시 짜기]로 넣은 장소는 서버가 '이미 일정에 있음'으로 빼는데, `dismissTo`로 돌아온 같은 허브는 다시 마운트되지 않아 스스로 다시 받지 않는다 — 테스트 C1~C3). ⚠️ **서버의 트리거 소비(BR-SA-14)는 적용 응답보다 늦다** — 적용은 `ItineraryRecalculated`를 아웃박스에 쌓기만 하고 CONSUMED 전환은 릴레이(2초 주기) 뒤 `ReplanAppliedSubscriber`가 한다. 그래서 무효화만 하면 다시 받은 소비 전 목록이 새것으로 남아 쓴 알약이 그대로다 → 응답의 `triggerId`·`targetDate`로 **서버 소비 조건 그대로**(같은 id ∧ affectedDate==targetDate) 그 트리거를 다시 받기 전·후 모두 캐시에서 뺀다(`withoutConsumed`). `refetchType: 'all'` — 트리거 진입(푸시·알림함→i04→i06)은 적용 순간 목록을 보는 화면이 없다(i04는 solving으로 replace). 뺀 목록이 새것(전역 staleTime 30초)이라 곧 열릴 허브가 소비 전 목록을 다시 받지 않는다. **남는 구멍**: 트리거 목록을 한 번도 받지 않은 채 적용하면(캐시 없음) 허브 첫 조회가 릴레이 전이면 알약이 보인다 — 서버 쪽 동기 소비가 근본 해법(설계 소유자 결정). 실패(409 등)면 아무것도 안 한다. `useApplyReplan.integration.test.tsx`가 MSW(소비 전 목록을 돌려주는 가짜 서버)로 허브가 읽는 생성 훅 data를 본다(B1 스택의 허브·B2 트리거 진입·B3 다른 날은 안 뺌·B4 409) — 페이지 통합 테스트는 이 seam 을 목으로 바꿔 끼워 못 본다 |
