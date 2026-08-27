---
paths:
  - "src/features/execution/**"
  - "src/pages/live-*/**"
  - "src/shared/location/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(전역 불변식 INV-3 "소요시간 비표시, 거리만"은 코어 `repo-traps.md`에 남아 무조건 로드된다.)

## 여행 중 실행 (execution, i01~i05)

- **i01 active 카드는 이제 프로덕션에 뜬다(TRIP-396으로 해소, TRIP-399 항목 갱신)** — `LiveItineraryPage.tsx`가 `GET /visits/days/{day}` → `deriveVisitProgress` → `projectSlotProgress(activeSlots, {completedPoiIds, activePoiId})`로 실제 방문 기록을 주입해, 예전엔 progress 인자가 항상 비어 전 슬롯이 `upcoming`으로 사영되던 갭(TRIP-395 선재 공백)이 닫혔다. **다만 `execution-arrive-next-nav`(TRIP-399 "다음 예정지" CTA·`openNextNav` 딥링크 폴백 사다리)는 여전히 데드코드다** — active 카드는 뜨지만 `LiveItineraryScreen`이 `onPressNextNav`를 요구해도 `LiveItineraryPage`가 그 콜백을 안 넘겨 press가 no-op으로 남는다(TRIP-396 03b 참고-1 실측, `_dev/preview.tsx`도 `onPressNextNav={noop}`). 이 배선은 **117-A 소관**이라 TRIP-396이 확장하지 않았다. 딥링크 자체도 `app.config.ts`에 `kakaomap` 스킴이 iOS `LSApplicationQueriesSchemes`(+안드 `queries`)에 미등록이라 실기기 `canOpenURL`이 항상 false → 폴백이 항상 웹으로 샌다(스킴 등록+네이티브 리빌드 선행 필요, 개념: [[딥링크 스킴 미등록 — canOpenURL이 항상 false]]).
- **`dwellMinutes.ts`(execution/model)·`geofence.ts` 4함수(shared/location)는 만들었으나 호출자가 0이다**(TRIP-396, `nextNav.ts`와 동형 계열) → `dwellMinutes`는 AC-1 요구로 빌드했으나 서버가 `arrivedAt`/`completedAt`로 체류를 스스로 도출해 **클라→서버로 dwell을 넘기는 API 필드가 계약에 없다**(BR-U4-37 "DELAY 트리거 입력으로 넘긴다"의 실제 창구 부재). `geofence.ts`의 등록/해제·순수 매핑 4함수는 실 네이티브 발화(`startGeofencingAsync`)가 이번 범위 밖이라 `armed:false` degrade 스텁만 반환 — expo-task-manager 미설치·"항상 허용" background 권한·네이티브 리빌드 선행 필요. 둘 다 PBT/유닛 테스트로 정확성만 잠겨 있고, 배선 자체는 후속 티켓(클라 dwell 소비 창구 또는 지오펜스 실배선) 대기 상태다.
- **`live-place`(i05)는 loading·오류·미도착을 전부 notFound로 접는다** (TRIP-398, 5-b 경고-2·★9, AC 없어 미룸) → `LivePlacePage.tsx`의 얼굴은 `-loading`/`-notfound`/`detail` 셋뿐이라 itinerary GET이 5xx·네트워크로 실패해도 `data` 미도착→`slots=[]`→`buildPlaceDetailView([],poiId)=null`→`-notfound`("장소를 찾을 수 없어요")로 조회 실패가 "부재"로 오표시된다. 형제 `LiveItineraryPage`는 `resolveLiveState`로 `error`와 `notFound`를 분리하는 선례가 있어 대비된다 — `live-place`에 오류 얼굴을 추가할 때 이 선례를 복제한다.
- **`features/execution/**` 신규 파일은 `liveTimeStructure`·`executionDurationStructure` 두 가드에 자동 편입된다** → 재귀 스캔이라 파일을 새로 추가하는 순간부터 사정거리에 들어간다. `liveTimeStructure`는 `startAt`/`endAt` 식별자에 **인접한** 산술 연산자·`new Date`/`.getTime`/`.getHours`/`.getMinutes`·날짜라이브러리 import를 금지(합법 형태: `"HH:mm:ss".split(':')`로 쪼개 다른 이름 변수로 옮긴 뒤 함수 호출 사이에서 빼기 — `placeDetailView.ts`의 `resolveSlackLabel` 선례). `executionDurationStructure`(ui/** 한정)는 `\d+분`·`\d+시간`·`소요` 문자열을 금지 — 정성 라벨(예 "여유 있음")은 자연 회피한다.
