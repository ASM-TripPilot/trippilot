---
paths:
  - "src/features/record/**"
---
# `src/features/record/` — j01 방문 기록·j07 여행 캘린더

`features/execution`과 목적이 겹쳐 보이지만(둘 다 `visit_check` 실적) shape가 다르다 — execution의 `deriveVisitProgress`는 poi 단위 **집계**, 이쪽은 per-record 4상태다. 그래서 재사용하지 않는다.

**경계**: `features/record`는 다른 `features/*`를 import할 수 없다(특히 `execution` — 같은 이름 `useVisitCheck`가 있어 혼동하기 쉽다). eslint 층 zone과 `recordsStructure.test.ts` G2(소스 재귀 스캔)가 이중으로 막는다(개념 [[기능 간 조합은 pages 층 전담 (기계 강제 없음)]]).

| 파일 | 역할 |
|---|---|
| `model/visitStatus.ts` | `deriveVisitStatus({arrivedAt, completedAt, skippedAt}) → 'UPCOMING'\|'IN_PROGRESS'\|'COMPLETED'\|'SKIPPED'` — 세 timestamp 유무만으로 매번 계산(INV-U5-01). 입력 타입에 `status` 자리가 없어 저장된 상태를 읽는 경로가 구조적으로 봉쇄된다. 우선순위 `skipped > completed > arrived > upcoming`. 개념 [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]] |
| `model/visitStatus.test.ts` | PBT + 진리표 + INV 잠금(가짜 `status` 필드를 섞어도 무시). `fc.date`에는 `noInvalidDate: true`가 필요하다 — 없으면 Invalid Date가 구현 호출 전에 throw해 flaky |
| `model/useVisitCheck.ts` | `arrive`/`complete`/`skip` 낙관 갱신 + 레코드 단위 롤백(통짜 스냅숏 아님). 실패는 판별 유니온 `VisitCheckOutcome`으로 반환(INV-4). `settleRollback()`은 react-query v5 배치 통지가 매크로태스크로 밀리는 것을 한 틱 양보해 브리지한다. arrive는 무효화 대신 응답 레코드로 낙관 레코드를 교체한다(재조회가 즉석 삽입을 덮지 않게). 개념 [[낙관적 갱신과 롤백 (optimistic update)]] · [[낙관적 락 기준버전 (updatedAt)]] |
| `model/useVisitCheck.integration.test.tsx` | msw + 실 QueryClient — 409 롤백·즉석 2건 append·skip·동시 두 도착 중 하나 실패해도 다른 낙관 생존. ⚠️ "plan 미접촉"(`/itinerary` 히트 0) 단언은 이 셋업에서 항상 참이다 — 진짜 보장은 G2 구조 스캔 |
| `model/useTripRecords.ts` | 생성 훅 얇은 래퍼(로직 0) — 방문 목록·`useRecordBases`·`useRecordSavedStays`. `features/trip`이 이미 감싼 훅을 경계 때문에 다시 감쌌다(개념 [[생성훅 직접 사용 (cross-feature 우회)]]) |
| `model/stayAttribution.ts` | `deriveStayAttribution({visits, bases, savedStays?}) → DayAttribution[]` — 날짜별로 묶고 그 날짜를 덮는 base(`dateFrom≤D<dateTo`, [[base 구간 커버리지 판정]])로 숙소명을 해소. 반환 타입에 저장 자리가 없어 매번 재계산(BR-U5-25, [[조회시점 파생·미저장]]). 날짜는 `'YYYY-MM-DD'` 슬라이스+사전식 비교만. ⚠️ 즉석 방문 `arrivedAt` 슬라이스의 "여행지 기준 날짜" 정확성은 백엔드 직렬화(UTC vs 로컬)에 달려 미확인 |
| `model/stayAttribution.test.ts` | 행동 테스트 + PBT(`baseStay`가 항상 그 날짜를 덮는 base의 함수) + dateTo 경계값 3종 |
| `model/adjustTimesDraft.ts` | `adjustTimesDraft({arrivedAt, completedAt, now}) → {ok:true}\|{ok:false, reason}` — 시계를 안 읽고 `now`를 인자로 받는다(DI). 규칙 순서: 도착 없는 완료 `'completed-without-arrived'` → 역전 `'order'` → 미래 `'future'`(BR-U5-05) |
| `model/useAdjustVisitTimes.ts` | `PATCH /trips/{tripId}/visits/{visitCheckId}` 낙관 뮤테이션 — 스냅숏 → 바뀐 필드만 반영 → `expectedUpdatedAt=before.updatedAt` 전송 → 200은 서버 레코드로 교체, 409 `VISIT_CONFLICT`는 그 레코드만 롤백 + 그 날 재조회, 그 외는 롤백만. 성공 경로에도 `settle()`이 필요하다(없으면 동기 캐시 읽기가 배치 flush보다 먼저 돈다). ⚠️ 프로덕션 소비처 0(`VisitTimeSheet`와 함께 미배선) |
| `model/conflict.ts` | `isVisitConflict(localBaseUpdatedAt, serverUpdatedAt)` — base가 서버보다 이르면 충돌(BR-U5-22). ISO 문자열 사전식 비교라 ⚠️ **같은 포맷(소수 자리·`Z`)일 때만 안전**하다. 소비처 0. `Conflict*` 타입도 여기 산다 |
| `model/conflict.test.ts` | base<server→true, ==→false, base>server→false |
| `model/photoAttach.ts` | `photoAttach(asset, gpsConsent) → AddPhotoRequest` — 동의가 없거나 좌표가 없으면 `exifLat`/`exifLng` **키 자체를 안 만든다**(`undefined`로도 안 싣는다 — [[키 부재 vs 값 undefined]]). 동의는 boolean DI로 받는다 |
| `model/photoAttach.test.ts` | PBT + 긍정 짝(consent=true→실림) |
| `model/photoAvailability.ts` | `photoAvailability(photo, currentDeviceId, assetOk) → 'available'\|'other-device'\|'unavailable'` — **deviceId가 assetOk를 이긴다**(BR-U5-15, 진리표가 순서를 잠근다) |
| `model/photoAvailability.test.ts` | 진리표 4행(deviceId×assetOk) |
| `model/useVisitAttachments.ts` | 생성 클라이언트 3함수(GET/POST photos·PUT memo)만 재사용(새 HTTP 0, `recordsStructure` G5). `addPhoto`는 `photoAttach` 경유 후 POST → 재조회(낙관 아님). `saveMemo`는 공백이면 PUT 0회 |
| `model/useVisitAttachments.integration.test.tsx` | msw — addPhoto→GET 재조회 · saveMemo 공백 무시 |
| `model/recordsCalendar.ts` | j07 순수 조립 — `markedDaysOfMonth`(그 달에 걸친 모든 여행의 날, `shared/date/monthGrid` 경유)·`buildPastTripCards`(`ENDED` 또는 `endDate<today`, 최신순)·`formatTripDateRange`·`nightsLabel`(가짜 "0박" 금지, 못 만들면 null). null 입력에 던지지 않는다([[반쪽 방어 (half-applied guard)]]) |
| `model/recordsCalendar.test.ts` | 마킹·월 경계·겹침 유일·null 방어·필터/정렬·라벨 표 |
| `model/useRecordsCalendar.ts` | `useGetTrips()` 얇은 래퍼(`trips`·`isPending`·`isError`) — 페이지가 `error > loading > (empty\|calendar)` 순으로 얼굴을 가른다(로딩·에러를 빈 상태로 접으면 INV-4 침묵 실패) |
| `ui/RecordGlyphs.tsx` | 체크서클·즉석추가·Chevron·Calendar 등 벡터(features 간 import 금지라 로컬). 다음(›) 화살표는 `BackArrowGlyph`를 `scaleX:-1`로 뒤집어 쓴다 |
| `ui/VisitRecordCard.tsx` | 상태는 `deriveVisitStatus(card)`로 내부 파생(prop으로 안 받음). **fill 함정 방어**: 상태별 서로 다른 testID(`record-visit-check-{done\|active\|upcoming\|skipped}-{id}`)로 렌더하고 완료 Pressable은 IN_PROGRESS에만 존재한다 — `fireEvent.press`는 `disabled`를 안 막으므로 "핸들러 부재"로 막는다([[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]]). `onPressEditTime?`·`photoSlot?`·`memoSlot?`은 옵셔널 — 안 주면 기존 스캐폴딩 유지 |
| `ui/VisitRecordCard.test.tsx` | 4상태 present/absent 짝·upcoming 완료 불가·skip·시각 수정 버튼 유무. 슬롯 테스트는 `.wiring.test.tsx`로 격리(새 import가 이 파일을 오염시키지 않게) |
| `ui/VisitRecordCard.wiring.test.tsx` | 슬롯 계약 testID 마커로 잠금 |
| `ui/VisitTimeSheet.tsx` | 방문 시각 수정 시트 — 셀-press 피커(시트 안 휠은 `enableContentPanningGesture` 회귀 위험, [[enableContentPanningGesture]]), 시각은 `slice`로만(`new Date` 금지), 저장은 바뀐 필드만(BR-U5-04). ⚠️ 완료 컬럼 비활성이 도착 유무만 봐 IN_PROGRESS에서 완료 입력이 조용히 폐기되고, diff가 raw 문자열 비교라 서버 포맷이 다르면 스퍼리어스 PATCH가 난다. 프로덕션 미배선 |
| `ui/VisitTimeSheet.test.tsx` | 셀 선택·diff 저장·완료 비활성·인라인 오류·INV-3 렌더 스캔(동적 `${m}분`까지) |
| `ui/SpontaneousVisitButton.tsx` | 즉석 방문 추가(`record-trip-spontaneous-add`) |
| `ui/SpontaneousVisitButton.test.tsx` | 즉석 추가 UI |
| `ui/TripRecordsScreen.tsx` | 무상태 j01 화면 — appbar·일자 탭·지도 히어로(`MapView viewOnly`, 250px 블록)·카드 목록·즉석 추가. 지도 위 인터랙티브는 absolute 오버레이가 아니라 형제 노드로 둔다(repo-traps 지도 절). `itineraryMapSurfaceStructure`의 `LOCKED_CALLERS`에 등재([[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]]). 귀속 헤더는 숙소 유무를 색이 아니라 상호배타 testID(`record-trip-attribution-stay`/`-date`)로 가른다. 카드는 `visitCheckId` key로 리마운트해 seed-once 메모 잔류를 막는다 |
| `ui/PhotoThumbStrip.tsx` | 상태별 distinct testID(`record-photo-{available\|other-device\|unavailable}-{id}`). 실 `<Image>`는 available+uri일 때만 존재 — "깨진 썸네일 0"을 present/absent 짝으로 잠근다. `+` 타일 → `onPressAdd` |
| `ui/PhotoThumbStrip.test.tsx` | 상태 present/absent 짝 + add + 다건 |
| `ui/MemoInline.tsx` | `TextInput maxLength=2000`(서버 권위의 UX 사본 — `fireEvent.changeText`는 maxLength를 우회하므로 prop 값으로 잠금). 공백이면 무발화. ⚠️ **seed-once 파생 상태**(`useState(text ?? '')`) — 리스트에서 `key` 없이 재활용되면 다른 카드 메모가 잔류한다([[seed-once 파생 상태]]) |
| `ui/MemoInline.test.tsx` | maxLength 잠금·공백 게이트·onSubmitEditing |
| `__tests__/recordPhotoBinaryGuard.test.ts` | `src/__tests__/` 소재(`layer-test.md`) — INV-U5-03(사진 바이너리 서버 미전송)은 계약이 구조적으로 만족하고, 이 가드는 새 업로드 경로를 짓지 않게 소스 그래프를 잠근다([[계약이 구조적으로 막는다]]) |
| `ui/RecordsCalendarScreen.tsx` | j07 props-only 허브 — `isEmpty`면 `StateNotice`(`record-calendar-empty`), 아니면 `TripCalendarMonth`+legend+`PastTripList`. 상태·네트워크·라우팅을 모른다 |
| `ui/TripCalendarMonth.tsx` | 월 그리드(`record-calendar-month`, prev/next chevron). 마킹은 fill이 아니라 `accessibilityState={{selected}}`로 관찰 가능하게 그린다(`toBeSelected()`). 코랄 pill은 연속 구간 양 끝만 둥글린다 |
| `ui/PastTripList.tsx` | `record-calendar-past-trip-{tripId}` 카드 = 제목+날짜범위(+박수)만 — 사진·통계는 `Trip` 계약에 필드가 없어 안 그린다. 날짜범위·박수는 별개 `<Text>` leaf(완전일치 매치) |

## 관련

- 페이지 배선: `frontend/.claude/rules/layer-pages.md`(`trip-records` 행).
- 개념: [[per-record 상태 파생 (세 timestamp에서 우선순위로 계산)]] · [[낙관적 갱신과 롤백 (optimistic update)]] · [[판별 유니온]] · [[글리프 fill 색 사각 (SVG 단일 노드는 값 변화를 못 잰다)]] · [[뮤테이션 테스팅]] · [[낙관적 락 기준버전 (updatedAt)]] · [[의존성 주입 (DI)]] · [[조회시점 파생·미저장]] · [[UTC 사전식 날짜 경계 (타임존 안전)]] · [[키 부재 vs 값 undefined]] · [[seed-once 파생 상태]] · [[INV-4 조용한 실패 금지]].
