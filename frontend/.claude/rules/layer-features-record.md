---
paths:
  - "src/features/record/**"
---
# `src/features/record/` — j01 방문 기록 · j07 캘린더 model

j07 화면 뷰(`RecordsCalendarScreen`·`TripCalendarMonth`·`PastTripList`)는 TRIP-1153으로 `pages/records-calendar/ui`로 이사했다(`layer-pages.md`). 여기 남은 j07 몫은 page와 화면이 함께 쓰는 `model/recordsCalendar`·page 전용 `model/useRecordsCalendar`·공용 `ui/RecordGlyphs`다.

`features/execution`과 목적이 겹쳐 보이지만(둘 다 `visit_check` 실적) shape가 다르다 — execution의 `deriveVisitProgress`는 poi 단위 **집계**, 이쪽은 per-record 4상태다. 그래서 재사용하지 않는다.

**경계**: `features/record`는 다른 `features/*`를 import할 수 없다(특히 `execution` — 같은 이름 `useVisitCheck`가 있어 혼동하기 쉽다). eslint 층 zone이 막는다(개념 [[기능 간 조합은 pages 층 전담 (기계 강제 없음)]]).

| 파일 | 역할 |
|---|---|
| `model/conflict.ts` | `isVisitConflict(localBaseUpdatedAt, serverUpdatedAt)` — base가 서버보다 이르면 충돌(BR-U5-22). ISO 문자열 사전식 비교라 ⚠️ **같은 포맷(소수 자리·`Z`)일 때만 안전**하다. 소비처 0. `Conflict*` 타입도 여기 산다 |
| `model/conflict.test.ts` | base<server→true, ==→false, base>server→false |
| `model/photoAttach.ts` | `photoAttach(asset, gpsConsent) → AddPhotoRequest` — 동의가 없거나 좌표가 없으면 `exifLat`/`exifLng` **키 자체를 안 만든다**(`undefined`로도 안 싣는다 — [[키 부재 vs 값 undefined]]). 동의는 boolean DI로 받는다 |
| `model/photoAttach.test.ts` | PBT + 긍정 짝(consent=true→실림) |
| `model/pickPhotoForVisit.ts` | `pickPhotoForVisit()`(TRIP-1070 신규) — `shared/photo`의 `pickPhotoAsset()`을 부르고 결과가 `picked`가 아니면 문구표(`PICK_NOTICE`)로 `{notice}`를 접는다(취소는 `null` — 무안내). `picked`면 **그때** `getMeLocationConsent()`를 1회 조회해 `gpsRecordingOptIn === true`일 때만 좌표 키를 살린다. 화면을 열 때가 아니라 고른 뒤 읽는 이유는 마운트 조회를 없애고 누른 순간의 최신 동의값을 쓰기 위함(02a §2-6) — "형제 통합 테스트가 red가 된다"는 초기 근거는 03b가 반증(이 리포 MSW `onUnhandledRequest:'error'`는 콘솔 에러만 찍고 테스트를 실패시키지 않는다) |
| `ui/RecordGlyphs.tsx` | 체크서클·즉석추가·Chevron·Calendar 등 벡터(features 간 import 금지라 로컬). 다음(›) 화살표는 `BackArrowGlyph`를 `scaleX:-1`로 뒤집어 쓴다. `NoteGlyph`(TRIP-1088)는 j01 「오늘의 회고」 FAB의 문서 아이콘(20-viewBox·기본 흰색·선 4개) — `SettingsGlyphs.DocumentGlyph`는 형제 feature라 import 못 하고 색이 고정이라 새로 그렸다. `LegendChevronGlyph`(TRIP-1120)는 j07 legend 줄 끝 `›` — 14 슬롯에 `viewBox="5 5 14 14"`로 24 박스 벡터의 가운데만 잘라 담는다(줄 높이 32를 안 늘림). 색 muted-soft hex는 이 파일 안에만. 기존 `ChevronRightGlyph`(20 박스·#C2C7CE·stroke 1.7)와 모양·굵기가 달라 재사용 안 함 |
| `ui/MemoInline.tsx` | **`BottomSheetTextInput`**(TRIP-1085 — j01이 셸 시트 안으로 들어가 키보드가 시트를 밀어 올려야 해서 교체. ⚠️ **시트 밖에서 그리면 실기 throw** — jest 목은 시트 문맥을 요구하지 않아 못 잡는다 — 실기 스모크가 유일한 그물) `maxLength=2000`(서버 권위의 UX 사본 — `fireEvent.changeText`는 maxLength를 우회하므로 prop 값으로 잠금). 공백이면 무발화. **저장 경로는 `onBlur` 하나**(`submitBehavior="blurAndSubmit"` — return=키보드 내림→blur→1회; `onSubmitEditing` 저장 금지, 병행하면 이중 저장). jest는 이 연쇄를 흉내 못 내 return 실기는 6-b. ⚠️ **seed-once 파생 상태**(`useState(text ?? '')`) — 리스트에서 `key` 없이 재활용되면 다른 카드 메모가 잔류한다([[seed-once 파생 상태]]) |
| `ui/MemoInline.test.tsx` | maxLength 잠금·공백 게이트·blur 저장·submitEditing 0회(M5)·submitEditing+blur 1회(M6) |
| `__tests__/recordPhotoBinaryGuard.test.ts` | `src/__tests__/` 소재(`layer-test.md`) — INV-U5-03(사진 바이너리 서버 미전송)은 계약이 구조적으로 만족하고, 이 가드는 새 업로드 경로를 짓지 않게 소스 그래프를 잠근다([[계약이 구조적으로 막는다]]) |

## 관련

- 페이지 배선·j01 조립 뷰(옛 `TripRecordsScreen` 후임 `TripRecordsView`, 이 폴더가 아니라 pages): `frontend/.claude/rules/layer-pages.md`(`trip-records` 행).
- 개념: [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[판별 유니온]] · [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]] · [[뮤테이션 테스팅]] · [[낙관적 락 기준버전 (updatedAt)]] · [[의존성 주입 (DI)]] · [[조회시점 파생·미저장]] · [[UTC 사전식 날짜 경계 (타임존 안전)]] · [[키 부재 vs 값 undefined]] · [[seed-once 파생 상태]] · [[INV-4 조용한 실패 금지]] · [[순간(instant)을 여행지 시각으로 — readFromInstant의 UTC 트릭]] · [[셀-press 시각 입력 (휠 회피)]] · [[disabled prop과 accessibilityState]] · [[제자리 정렬과 입력 불변]].
