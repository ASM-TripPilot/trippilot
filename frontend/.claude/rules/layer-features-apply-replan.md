---
paths:
  - "src/features/apply-replan/**"
---
# `src/features/apply-replan/`

| 파일 | 역할 |
|---|---|
| `src/features/apply-replan/model/useApplyReplan.ts` | (TRIP-1155로 features/planb에서 이사) codegen apply를 감싸는 유일 seam(`PlanbDiffPage` 1곳 — 구조가드로 봉인). 성공 시 itinerary 캐시 무효화(확정이 원 일정을 바꾸는 유일 지점, INV-U4-05). 무효화 정확성은 jest 사각(문자열 실재만 확인) |
