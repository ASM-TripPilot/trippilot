---
paths:
  - "src/features/apply-replan/**"
---
# `src/features/apply-replan/`

| 파일 | 역할 |
|---|---|
| `src/features/apply-replan/model/useApplyReplan.ts` | (TRIP-1155로 features/planb에서 이사) codegen apply를 감싸는 유일 seam(`PlanbDiffPage` 1곳 — 구조가드로 봉인). 성공 시 itinerary 캐시 무효화(확정이 원 일정을 바꾸는 유일 지점, INV-U4-05) + 그 여행 트리거 캐시 무효화(적용이 트리거를 소비 — BR-SA-14, 상황 감지 FE-A). 실패(409 등)면 둘 다 건드리지 않는다. 무효화는 `useApplyReplan.integration.test.tsx`(MSW apply 왕복 → 캐시 `isInvalidated`)가 본다 — 페이지 통합 테스트는 이 seam 을 목으로 바꿔 끼워 못 본다 |
