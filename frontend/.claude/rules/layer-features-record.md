---
paths:
  - "src/features/record/**"
---
# `src/features/record/` — j01 방문 기록 · j07 캘린더 model

j07 화면 뷰(`RecordsCalendarScreen`·`TripCalendarMonth`·`PastTripList`)는 TRIP-1153으로 `pages/records-calendar/ui`로 이사했다(`layer-pages.md`). 여기 남은 j07 몫은 page와 화면이 함께 쓰는 `model/recordsCalendar`·page 전용 `model/useRecordsCalendar`·공용 `ui/RecordGlyphs`다. TRIP-1155로 j07 model 2개는 `pages/records-calendar/model/`로, j01 방문 기록 파일은 `pages/trip-records`·`features/check-visit`·`features/attach-visit-media`·`pages/live-itinerary`(`MemoSheet`)로 이사해 여기엔 `model/conflict`·`ui/RecordGlyphs`만 남았다.

`features/execution`과 목적이 겹쳐 보이지만(둘 다 `visit_check` 실적) shape가 다르다 — execution의 `deriveVisitProgress`는 poi 단위 **집계**, 이쪽은 per-record 4상태다. 그래서 재사용하지 않는다.

**경계**: `features/record`는 다른 `features/*`를 import할 수 없다(특히 `execution` — 같은 이름 `useVisitCheck`가 있어 혼동하기 쉽다). eslint 층 zone이 막는다(개념 [[기능 간 조합은 pages 층 전담 (기계 강제 없음)]]).

| 파일 | 역할 |
|---|---|
| `model/conflict.ts` | `isVisitConflict(localBaseUpdatedAt, serverUpdatedAt)` — base가 서버보다 이르면 충돌(BR-U5-22). ISO 문자열 사전식 비교라 ⚠️ **같은 포맷(소수 자리·`Z`)일 때만 안전**하다. 소비처 0. `Conflict*` 타입도 여기 산다 |
| `model/conflict.test.ts` | base<server→true, ==→false, base>server→false |
| `ui/RecordGlyphs.tsx` | 체크서클·즉석추가·Chevron·Calendar 등 벡터(features 간 import 금지라 로컬). 다음(›) 화살표는 `BackArrowGlyph`를 `scaleX:-1`로 뒤집어 쓴다. `NoteGlyph`(TRIP-1088)는 j01 「오늘의 회고」 FAB의 문서 아이콘(20-viewBox·기본 흰색·선 4개) — `SettingsGlyphs.DocumentGlyph`는 형제 feature라 import 못 하고 색이 고정이라 새로 그렸다. `LegendChevronGlyph`(TRIP-1120)는 j07 legend 줄 끝 `›` — 14 슬롯에 `viewBox="5 5 14 14"`로 24 박스 벡터의 가운데만 잘라 담는다(줄 높이 32를 안 늘림). 색 muted-soft hex는 이 파일 안에만. 기존 `ChevronRightGlyph`(20 박스·#C2C7CE·stroke 1.7)와 모양·굵기가 달라 재사용 안 함 |
| `__tests__/recordPhotoBinaryGuard.test.ts` | `src/__tests__/` 소재(`layer-test.md`) — INV-U5-03(사진 바이너리 서버 미전송)은 계약이 구조적으로 만족하고, 이 가드는 새 업로드 경로를 짓지 않게 소스 그래프를 잠근다([[계약이 구조적으로 막는다]]) |

## 관련

- 페이지 배선·j01 조립 뷰(옛 `TripRecordsScreen` 후임 `TripRecordsView`, 이 폴더가 아니라 pages): `frontend/.claude/rules/layer-pages.md`(`trip-records` 행).
- 개념: [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[판별 유니온]] · [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]] · [[뮤테이션 테스팅]] · [[낙관적 락 기준버전 (updatedAt)]] · [[의존성 주입 (DI)]] · [[조회시점 파생·미저장]] · [[UTC 사전식 날짜 경계 (타임존 안전)]] · [[키 부재 vs 값 undefined]] · [[seed-once 파생 상태]] · [[INV-4 조용한 실패 금지]] · [[순간(instant)을 여행지 시각으로 — readFromInstant의 UTC 트릭]] · [[셀-press 시각 입력 (휠 회피)]] · [[disabled prop과 accessibilityState]] · [[제자리 정렬과 입력 불변]].
