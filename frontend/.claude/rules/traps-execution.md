---
paths:
  - "src/features/execution/**"
  - "src/pages/live-*/**"
  - "src/shared/location/**"
  - "src/features/planb/**"
  - "src/pages/planb-*/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(전역 불변식 INV-3 "소요시간 비표시, 거리만"은 코어 `repo-traps.md`에 남아 무조건 로드된다.)

## 여행 중 실행 (execution, i01~i05)
⚠️ 이 절의 `i01`·`i05` 등은 **코드 라우트·프리뷰 키가 쓰는 옛 Figma 코드**다. 라이브 Figma i 밴드는 2026-09-11에 i01~i10으로 재번호됐다(옛 i05 현재 장소 상세 = 새 i10) — 대조는 `spec-perception/reference/figma-structure.md`의 매핑 포인터로.

- **i01 active 카드는 이제 프로덕션에 뜬다(TRIP-396으로 해소) — 단 실앱에서 그 카드까지 도달할 경로가 TRIP-746으로 다시 끊겼다.** `LiveItineraryPage.tsx`가 `GET /visits/days/{day}` → `deriveVisitProgress` → `projectSlotProgress(activeSlots, {completedPoiIds, activePoiId})`로 실제 방문 기록을 주입하는 판정 로직 자체는 무변경. 그런데 TRIP-746이 수동 [도착] 버튼(옛 `LiveSlotCard`의 upcoming 얼굴)을 UI에서 지웠고, 대체 경로인 지오펜스(`shared/location/geofence.ts`)는 `armed:false` degrade 스텁이라 아직 실발화하지 않는다 — 그래서 지금 빌드는 active 카드를 **그릴 수는 있어도 실기기에서 그 상태로 진입할 방법이 없다**(새 티켓 후보, 지오펜스 실배선 선행 필요). `nextNav.ts`(TRIP-399 "다음 예정지" 딥링크 폴백 사다리)는 TRIP-746 이후에도 파일은 남았지만 신 화면(`LiveHubView`·`SlotProgressCard`) 어디서도 import하지 않는 완전 데드코드가 됐다(옛 소비처 `LiveItineraryScreen.tsx`가 파일째 삭제) — 딥링크 스킴 미등록 문제(`kakaomap`, 개념: [[딥링크 스킴 미등록 — canOpenURL이 항상 false]])는 그대로지만 이제 호출자가 아예 없다.
- **`dwellMinutes.ts`(execution/model)·`geofence.ts` 4함수(shared/location)는 만들었으나 호출자가 0이다**(TRIP-396, `nextNav.ts`와 동형 계열) → `dwellMinutes`는 AC-1 요구로 빌드했으나 서버가 `arrivedAt`/`completedAt`로 체류를 스스로 도출해 **클라→서버로 dwell을 넘기는 API 필드가 계약에 없다**(BR-U4-37 "DELAY 트리거 입력으로 넘긴다"의 실제 창구 부재). `geofence.ts`의 등록/해제·순수 매핑 4함수는 실 네이티브 발화(`startGeofencingAsync`)가 이번 범위 밖이라 `armed:false` degrade 스텁만 반환 — expo-task-manager 미설치·"항상 허용" background 권한·네이티브 리빌드 선행 필요. 둘 다 PBT/유닛 테스트로 정확성만 잠겨 있고, 배선 자체는 후속 티켓(클라 dwell 소비 창구 또는 지오펜스 실배선) 대기 상태다.
- **`live-place`(i05)는 loading·오류·미도착을 전부 notFound로 접는다** (TRIP-398, 5-b 경고-2·★9, AC 없어 미룸) → `LivePlacePage.tsx`의 얼굴은 `-loading`/`-notfound`/`detail` 셋뿐이라 itinerary GET이 5xx·네트워크로 실패해도 `data` 미도착→`slots=[]`→`buildPlaceDetailView([],poiId)=null`→`-notfound`("장소를 찾을 수 없어요")로 조회 실패가 "부재"로 오표시된다. 형제 `LiveItineraryPage`는 `resolveLiveState`로 `error`와 `notFound`를 분리하는 선례가 있어 대비된다 — `live-place`에 오류 얼굴을 추가할 때 이 선례를 복제한다.
- **`features/execution/**` 신규 파일은 `liveTimeStructure`·`executionDurationStructure` 두 가드에 자동 편입된다** → 재귀 스캔이라 파일을 새로 추가하는 순간부터 사정거리에 들어간다. `liveTimeStructure`는 `startAt`/`endAt` 식별자에 **인접한** 산술 연산자·`new Date`/`.getTime`/`.getHours`/`.getMinutes`·날짜라이브러리 import를 금지(합법 형태: `"HH:mm:ss".split(':')`로 쪼개 다른 이름 변수로 옮긴 뒤 함수 호출 사이에서 빼기 — `placeDetailView.ts`의 `resolveSlackLabel` 선례). `executionDurationStructure`(ui/** 한정)는 `\d+분`·`\d+시간`·`소요` 문자열을 금지 — 정성 라벨(예 "여유 있음")은 자연 회피한다.
- **`triggerLabel.ts`(planb/model)는 INV-3 내용 가드 밖이다** → `executionDurationStructure`는 `ui/**` 디렉토리만, `liveTimeStructure`는 `features/execution` 전수 + 명시 편입 파일 목록(`HUB_FILES`)만 봐서 `triggerLabel.ts`는 둘 다 사정거리 밖이다 — 라벨 문자열에 소요시간이 섞여도 잡는 심판이 없다. 형제 feature import(`execution/ui`→`planb/model`)는 `eslint.config.js` 층 zone이 전 feature에 error로 잡지만, `TriggerChip.test.tsx`류 "props만으로 완전 렌더" 그물은 **훅 import**(throw로 걸림)만 잡고 RN 런타임을 안 쓰는 순수 node-safe 모듈 import는 green으로 통과시킨다(TRIP-561 실측).
- **`ScrollView` 세로 중앙정렬은 짝(pair)이다 — `contentContainer`의 `grow`+`justify-center`만으론 무효할 수 있다**(TRIP-652, `features/planb/ui/ReplanSolvingScreen.tsx`, 03b 경고-1 실측) → 리포 관례(래핑 ScrollView 6/6)는 ScrollView **본체**의 `flex-1`(뷰포트 높이를 채움) + `contentContainer`의 `flexGrow:1`+`justifyContent:center`(그 안에서 중앙 배치) 두 짝으로 이뤄진다. 후자만 주면 ScrollView 프레임이 콘텐츠 높이로 접혀 채울 뷰포트가 없어 `justify-center`가 no-op이 될 수 있다. **`planbSafeAreaStructure.test.ts`의 G6 가드는 `contentContainerClassName` 정규식만 보고 ScrollView 본체 `className`은 사정거리 밖** — 이 fix의 핵심(`flex-1`)을 지워도 소스 스캔조차 못 잡는다(qa-verifier 04 2차 실측). 실제 중앙정렬 확정은 6-b 실기 전용. 개념 [[반쪽 방어 (half-applied guard)]].
- **(TRIP-749로 해소) 글리프의 kind→아이콘 매핑 jest 사각** — 옛 `TriggerWatchlistScreen.tsx`(i09 감시 목록, `iconFor(kind)`가 3종 글리프를 고름)가 파일째 삭제되며 이 사각도 함께 사라짐. 흡수처 `RiskDetailSheet.tsx`(i03 시트)는 kind별 아이콘을 그리지 않는다(배지는 색상 상자+글자뿐, 개념 [[사영 (projection) — 같은 데이터 다른 접기]] 계열은 `layer-features-planb.md` 참고) — 새 화면이 kind별 아이콘 분기를 다시 들이면 이 함정이 재발할 수 있다.
