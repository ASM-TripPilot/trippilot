---
paths:
  - "src/features/execution/**"
---
# `src/features/execution/` — 여행 중 현장 표면(i01 허브·i10 장소 상세)

오늘 일정을 실시간으로 보여준다. BR-U4-34~46·PBT-U4·INV-3(소요시간 비표시) 소관 — 시각은 계획값만 통과하고 재추정하지 않는다(BR-U4-34 — 기계 강제 없음 — TRIP-1145에서 스캔 삭제).

| 파일 | 역할 |
|---|---|
| `src/features/execution/model/slotProgress.ts` | `projectSlotProgress(slots, {completedPoiIds?, activePoiId?}) → ProjectedSlot[]` — 슬롯에 `done`\|`active`\|`upcoming`을 붙이는 순수 사영. **`startAt`/`endAt`을 읽지도 연산하지도 않고 통과**시킨다(PBT-U4-F1 — 시계로 도착 시각을 재추정하지 않는다, BR-U4-34). 완료가 진행 중보다 우선, 빈 progress는 전부 `upcoming` |
| `src/features/execution/model/dwellMinutes.ts` | `dwellMinutes(arrivedAt, completedAt): number\|null` — 체류 분(한쪽 null→null, 역전→0). BR-U4-37·INV-U4-03(화면 비표시, 트리거 입력 전용). `new Date` 없이 `"HH:mm:ss".split(':')`로 쪼갠 지역 변수로만 연산한다. ⚠️ 프로덕션 소비처 0 — 서버가 dwell을 스스로 도출하고 클라→서버 dwell 필드가 없다 |
| `src/features/execution/model/visitProgress.ts` | `deriveVisitProgress(list, date, planOrder) → {completedPoiIds, activePoiId, visitCheckIdByPoiId}` — 그날 slotKey를 가진 계획 레코드만 센다(즉석·다른 날·깨진 키는 완료로도 active로도 안 셈, poi는 slotKey 파싱값). 완료(`completedAt≠null && skippedAt==null`)가 진행 중을 이기고, active 후보가 여럿이면 `planOrder` 앞 1곳(도착 시각 비교는 BR-U4-34로 금지·문자열 비교는 소수초/Z 없는 낙관 레코드에서 뒤집힘). 입력 순서 불변, planOrder 밖 후보는 active 불가. `projectSlotProgress`에 주입되는 것이 유일한 소비 경로 |
| `src/features/execution/model/useVisitCheck.ts` | `useVisitCheck({tripId, day})` — 도착(`POST /visits`)·완료 imperative 낙관 갱신(promise 반환 계약이 필요해 raw 함수 호출). **롤백이 슬롯키(레코드) 단위**라 동시 두 카드 조작이 서로의 롤백을 지우지 않는다(통짜 스냅숏 롤백의 결함을 고친 형태). 도착 낙관 리터럴의 `updatedAt`(BR-U5-22)은 `new Date` 없이 자리표시자로 채운다(BR-U4-34). 개념: [[react-query tracked-props — 관찰자가 읽은 속성만 재렌더된다]] · [[낙관적 락 기준버전 (updatedAt)]] |
| `src/features/execution/model/liveState.ts` | `resolveLiveState(input) → LiveState`(`loading`\|`notFound`\|`error`\|`active`, 이 순서로 우선) — 오늘이 일정 밖이어도 막지 않는다. `isNotFound`는 page가 `isNotFound(query.error)`로 계산해 주입(404를 5xx·네트워크와 분리). `active.todayIndex`는 오늘이 `days`에 있으면 그 인덱스, 여행 전이면 0, 여행 후면 마지막(`'YYYY-MM-DD'` 사전순=시간순). 이 분기의 심판은 **3일 이상 일정의 가운데 날**이어야 판정력이 있다(2일 일정은 폴백과 `findIndex`가 항상 같은 답) |
| `src/features/execution/model/useLiveItinerary.ts` | `useGetTripsTripIdItinerary` 얇은 래퍼(로직 0) — 판정은 `liveState.ts`, 조립은 `pages/live-itinerary` |
| `src/features/execution/model/placeDetailView.ts` | `buildPlaceDetailView(slots, poiId) → PlaceDetailView \| null`(매칭 실패 시 null) + `buildPlaceShareMessage(view)`(주소 있으면 `장소명\n주소` — 운영 주소가 항상 null이라 단위 테스트가 이 분기를 전담). 결측은 `nameKo ?? '미확인'`(BR-U4-40). 갤러리·피치·주소·입장료는 운영 null이고 프리뷰 픽스처만 채운다(INV-1, 지어내지 않는다) |
| `src/features/execution/model/usePlaceDetail.ts` | `useGetTripsTripIdItinerary` 얇은 래퍼(로직 0) — 매칭·조립은 page(`live-place`)와 `placeDetailView.ts` |
| `src/features/execution/ui/TriggerChip.tsx` | i02 지도 위 트리거 알약(`label`·`onPressAlternative`) — 흰 알약 + `WarningFilledGlyph` + 라벨(`numberOfLines=1`) + `›`. 그림자는 `BACK_SHADOW`와 같은 값의 로컬 상수(pages 상수는 층 방향상 import 불가). testID `execution-live-trigger-chip`·`-alternative` |
| `src/features/execution/ui/ExecutionGlyphs.tsx` | 레일 3종·뒤로·공유·날씨·경고·히어로 핀/사진 글리프. 히어로 글리프는 벡터·선 두께가 달라 `shared`/`entities` 판을 쓰지 않고 복제했다. ⚠️ `WeatherCloudGlyph`는 프로덕션 소비처 0 — 통합 테스트가 "0개 그려짐"을 단언하려고 import하므로 지우면 그 심판이 깨진다. 흰 글리프 색은 SVG fill이라 jest 사각(6-b 실기 전용) |
| `src/features/execution/model/nextNav.ts` | 다음 예정지 딥링크 폴백 사다리 — `buildAppNavUrl`(`kakaomap://`)·`buildWebNavUrl`·`resolveNextDest`·`openNextNav`(앱→웹→`fallback`). `expo-router` import 0(라우터 미개입을 구조로 보장). ⚠️ 프로덕션 호출자 0 |
| `src/features/execution/ui/PlaceDetailScreen.tsx` | i10 현재 장소 상세 — 무상태(`view` + 옵셔널 콜백만). 풀블리드 갤러리 히어로 + 원형 뒤로·공유(콜백 없으면 미렌더) + 추천 카피(둘 다 null이면 칸째 미표시) + 정보 카드 3행(영업시간·주소·입장료, 결측은 `-unknown-{field}` testID, BR-U4-40) + 실지도(`viewOnly`, 핀 1개) + "이곳의 사진"(3장 이상일 때만). 저장 하트는 없다(저장 계약 부재 — 반응 없는 버튼 금지). "다음 일정까지" 행은 없다 — US-ONTRIP-02와 정본 드리프트(사용자 수용), 되살리기 전 `PlaceDetailScreen.test.tsx`의 부재 단언을 먼저 확인 |

**규칙**: 이 디렉토리에서 `new Date`류(BR-U4-34)·소요시간 표기(INV-3)·걸음수 심볼(BR-U4-41)을 피한다 — 기계 강제 없음 — TRIP-1145에서 스캔 삭제, 회귀는 QA.

**6-b 실기 전용(jest 원리적 무심판)**: 시트 헤더·타임라인 레일·상태별 카드 픽셀·핀 배치·네이버 기본 줌 컨트롤·3스냅 실전환·수정 알약 딤 없음. 눈으로 보는 자리는 `_dev/preview.tsx`의 `live-hub-{closed,half,expanded}`.
