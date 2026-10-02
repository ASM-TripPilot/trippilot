---
paths:
  - "src/features/home/**"
---
# `src/features/home/` — 홈 발견·영감 피드(a01)


계층: `lib`(순수 함수) → `model`(타입·상수·판정) → `ui`(화면+전용 글리프). **컨테이너·훅 없음** — 프레젠테이션 전용 슬라이스(props/상수 구동, 네트워크·라우팅 0 — 기계 강제 없음 — TRIP-1145에서 스캔 삭제). 라우팅·데이터 배선은 `pages/home`. a02 매거진 뷰·모델은 TRIP-1147로 `pages/magazine/`로 이사했다(행은 `layer-pages.md`).

| 파일 | 역할 |
|---|---|
| `src/assets/home/` | 생성 플레이스홀더 이미지(단색/그라디언트 `.jpg` + `CREDITS.md`) — **실사진 아님**. 홈·매거진 카드가 `toUri` 헬퍼로 uri 변환해 쓴다 |
| `src/features/home/ui/HomeGlyphs.tsx` | 홈 전용 인라인 SVG(raw hex 직박). stroke 색은 렌더 트리 host 노드의 `props.stroke.payload`로 잴 수 있지만 지금 심판은 없다(TRIP-1145에서 소스 스캔 삭제, 개념 [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]]) |
