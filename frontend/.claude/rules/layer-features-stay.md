---
paths:
  - "src/features/stay/**"
---
# `src/features/stay/` — 숙소 탐색(e02)·상세(e03)·저장(e04)·등록(e05)


판정은 순수 함수(`model/`), 화면은 무상태 프레젠테이션(`ui/`) — `features/stay/ui`는 `useState`를 두지 않으므로(기계 강제 없음) 시트 개폐·선택 초안 같은 상태는 페이지가 쥔다(개념 [[상태 끌어올리기 (lifting state up)]]). 다른 feature 글리프·훅은 import하지 않고 재작성한다. 화면 뷰 4개(e02·e03·e04·e05)와 그 전용 부품(`PartialFailureBanner`·`SkeletonList`·`filterReasonLabel`·`amenityIcons`)은 TRIP-1148로 `pages/stay-*`로 이사했다(`layer-pages.md`) — 여기엔 판정 model·시트 3종·글리프·`affiliateNotice`만 남는다.

| 파일 | 역할 |
|---|---|
| `src/features/stay/model/useStaySearch.ts` | 생성 훅(`useGetStaysSearch`)을 도메인 이름으로 감싼 얇은 층 — 생성물 경로를 한 곳에 가두는 것이 존재 이유다. `options?.enabled`를 생성 훅의 `{ query: { enabled } }`로 매핑한다 — 이 매핑의 실효는 `useStaySearch.integration.test.tsx`(`{enabled:false}`→요청 0건)만 잠근다(`{query:{}}`로 깨져도 tsc는 green) |
| `src/features/stay/ui/StayGlyphs.tsx` | 숙소 화면 글리프 전부(Figma 벡터 실측, `tone` prop으로 색 변형). 다른 feature 글리프를 재사용하지 않는다. raw hex 소스 스캔은 없다(TRIP-1145에서 삭제) — 저장 하트 같은 상태 신호를 여기 fill로만 두면 jest가 못 본다(`repo-traps.md` 「글리프」) |
