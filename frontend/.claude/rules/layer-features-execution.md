---
paths:
  - "src/features/execution/**"
---
# `src/features/execution/` — 여행 중 현장 표면(i01 허브의 모델·트리거 알약·글리프, i10은 조회 훅만 — 화면 뷰는 `pages/live-*`)

오늘 일정을 실시간으로 보여준다. BR-U4-34~46·PBT-U4·INV-3(소요시간 비표시) 소관 — 시각은 계획값만 통과하고 재추정하지 않는다(BR-U4-34 — 기계 강제 없음 — TRIP-1145에서 스캔 삭제). TRIP-1155로 `slotProgress`·`visitProgress`는 `entities/itinerary-slot/lib/`, `liveState`·`TriggerChip`·`useVisitCheck`는 `pages/live-itinerary`, `usePlaceDetail`은 `pages/live-place`로 이사했다(행은 `layer-entities.md`·`layer-pages.md`).

| 파일 | 역할 |
|---|---|
| `src/features/execution/model/dwellMinutes.ts` | `dwellMinutes(arrivedAt, completedAt): number\|null` — 체류 분(한쪽 null→null, 역전→0). BR-U4-37·INV-U4-03(화면 비표시, 트리거 입력 전용). `new Date` 없이 `"HH:mm:ss".split(':')`로 쪼갠 지역 변수로만 연산한다. ⚠️ 프로덕션 소비처 0 — 서버가 dwell을 스스로 도출하고 클라→서버 dwell 필드가 없다 |
| `src/features/execution/model/useLiveItinerary.ts` | `useGetTripsTripIdItinerary` 얇은 래퍼(로직 0) — 판정은 `pages/live-itinerary/model/liveState.ts`, 조립은 `pages/live-itinerary` |
| `src/features/execution/ui/ExecutionGlyphs.tsx` | 레일 3종·뒤로·공유·날씨·경고·히어로 핀/사진 글리프. 히어로 글리프는 벡터·선 두께가 달라 `shared`/`entities` 판을 쓰지 않고 복제했다. ⚠️ `WeatherCloudGlyph`는 프로덕션 소비처 0 — 통합 테스트가 "0개 그려짐"을 단언하려고 import하므로 지우면 그 심판이 깨진다. 흰 글리프 색은 SVG fill이라 jest 사각(6-b 실기 전용) |
| `src/features/execution/model/nextNav.ts` | 다음 예정지 딥링크 폴백 사다리 — `buildAppNavUrl`(`kakaomap://`)·`buildWebNavUrl`·`resolveNextDest`·`openNextNav`(앱→웹→`fallback`). `expo-router` import 0(라우터 미개입을 구조로 보장). ⚠️ 프로덕션 호출자 0 |

**규칙**: 이 디렉토리에서 `new Date`류(BR-U4-34)·소요시간 표기(INV-3)·걸음수 심볼(BR-U4-41)을 피한다 — 기계 강제 없음 — TRIP-1145에서 스캔 삭제, 회귀는 QA.

**6-b 실기 전용(jest 원리적 무심판)**: 시트 헤더·타임라인 레일·상태별 카드 픽셀·핀 배치·네이버 기본 줌 컨트롤·3스냅 실전환·수정 알약 딤 없음. 눈으로 보는 자리는 `_dev/preview.tsx`의 `live-hub-{closed,half,expanded}`.
