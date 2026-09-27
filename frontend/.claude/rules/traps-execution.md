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

- **react-query 캐시 알림을 읽는 통합테스트는 `act` 직후 곧바로 `result.current`를 읽지 마라 — flush 헬퍼로 순서를 기다린다.** `notifyManager`가 알림을 `setTimeout(cb, 0)`으로 예약해서 보내므로, `act` 직후 즉시 읽으면 재렌더 전(구값)을 관측할 확률적 flake가 난다(`useVisitCheck.integration.test.tsx` 11/20 재현 — 개념 [[테스트 워커 강제종료 flake (원인 미상)]]). 의심되면 `beforeAll`에 `notifyManager.setScheduler((cb) => setTimeout(cb, 5))`로 재현해 확인한다.
- **동기 제출을 비동기(await 뒤 mutate)로 바꾸면 "대기 중 언마운트" 창이 새로 생긴다 — `mountedRef`류 가드 없이는 화면이 사라져도 POST가 나간다.** 실제 TanStack에서는 언마운트 뒤 호출별 `onSuccess`/`onError`가 안 불리므로(`mutationObserver.js`) 이동도 오류 안내도 없이 조용히 서버 세션만 하나 더 생긴다(`ReplanSessionService.start`가 기존 열린 세션을 취소하고 새 세션을 연다). jest 목은 언마운트와 무관하게 콜백을 부르므로 이 창을 원리적으로 못 잡는다 — 재현하려면 대기 중 언마운트 → 콜백 미호출을 단언하는 통합 테스트를 따로 심는다. 이 도메인 밖에서도 "누름→await→mutate" 패턴을 새로 들이면 같은 사각이 반복된다.
- **측위는 `shared/location/readDevicePosition.ts` 하나로 부른다** → expo-location의 Android 기본값은 `mayShowUserSettingsDialog:true`라, 옵션 없이 `getCurrentPositionAsync()`를 직접 부르면 기기 위치가 꺼져 있을 때 시스템 "위치 사용" 대화상자가 뜬다. 떠 있는 채로 5초 타임아웃 POST가 나가면 사용자가 뒤늦게 "사용"을 눌러도 좌표는 버려진다. 인자를 잠그는 테스트는 `readDevicePosition.test.ts`뿐이라 다른 자리에서 직접 부르면 무심판이다(iOS는 옵션 자체가 없어 무해, 확인은 Android 실기).

## 여행 중 실행 (execution, i01~i05)
⚠️ 이 절의 `i01`·`i05` 등은 **코드 라우트·프리뷰 키가 쓰는 옛 Figma 코드**다. 라이브 Figma i 밴드는 i01~i10으로 재번호됐다(옛 i05 현재 장소 상세 = 새 i10) — 대조는 `spec-perception/reference/figma-structure.md`의 매핑 포인터로.

- **i01 active 카드의 유일한 진입로는 수동 [도착]이다** → `LiveItineraryPage.tsx`가 `GET /visits/days/{day}` → `deriveVisitProgress` → `projectSlotProgress(activeSlots, {completedPoiIds, activePoiId})`로 방문 기록을 주입하고, `SlotProgressCard`의 upcoming 얼굴이 세 겹 게이트(페이지 `activeDate===today && visits.data!==undefined` → 뷰 `관람 중 없음` → 카드 upcoming 얼굴) 뒤에서 `POST /trips/{tripId}/visits`를 `source:'MANUAL'`로 부른다. 지오펜스(`shared/location/geofence.ts`)는 `armed:false` degrade 스텁이라 실발화하지 않는다. 건너뛰기는 없다(도착 전 슬롯엔 서버 레코드가 없어 `/skip`을 못 부름). `nextNav.ts`("다음 예정지" 딥링크 폴백 사다리)는 파일만 남고 신 화면(`LiveHubView`·`SlotProgressCard`) 어디서도 import하지 않는 데드코드다 — 딥링크 스킴 미등록 문제(`kakaomap`, 개념 [[딥링크 스킴 미등록 — canOpenURL이 항상 false]])도 호출자가 없다.
- **`dwellMinutes.ts`(execution/model)·`geofence.ts` 4함수(shared/location)는 호출자가 0이다** → `dwellMinutes`는 만들었으나 서버가 `arrivedAt`/`completedAt`로 체류를 스스로 도출해 **클라→서버로 dwell을 넘기는 API 필드가 계약에 없다**(BR-U4-37 "DELAY 트리거 입력으로 넘긴다"의 실제 창구 부재). `geofence.ts`는 실 네이티브 발화(`startGeofencingAsync`)가 없어 `armed:false`만 반환한다 — expo-task-manager 미설치·"항상 허용" background 권한·네이티브 리빌드가 선행돼야 한다. 둘 다 PBT/유닛 테스트로 정확성만 잠겨 있다.
- **`live-place`(i05 코드 라우트, 라이브 i10)는 캐시에 옛 상세가 남은 채 재조회가 404인 분기에 심판이 없다** → `LivePlacePage.tsx`는 `query.isPending` → 404 아닌 에러(오류 얼굴 `execution-place-error` + `execution-place-retry`) → 404(`-notfound`) → 데이터 순으로 가르고, 옛 캐시+404는 `notFound ? null : buildPlaceDetailView(...)`가 막는다. 통합 테스트가 매번 빈 캐시로 시작해 이 분기는 무방비다. 자매 화면 d06의 오류 접기는 `traps-explore.md` 참고.
- **`features/execution/**` 신규 파일은 `liveTimeStructure`·`executionDurationStructure` 두 가드에 자동 편입된다** → 재귀 스캔이라 파일을 새로 추가하는 순간부터 사정거리에 들어간다. `liveTimeStructure`는 `startAt`/`endAt` 식별자에 **인접한** 산술 연산자·`new Date`/`.getTime`/`.getHours`/`.getMinutes`·날짜라이브러리 import를 금지(합법 형태: `"HH:mm:ss".split(':')`로 쪼개 다른 이름 변수로 옮긴 뒤 함수 호출 사이에서 빼기 — `dwellMinutes.ts`·`features/planb/model/slackTime.ts`의 split 우회 선례.). `executionDurationStructure`(ui/** 한정)는 `\d+분`·`\d+시간`·`소요` 문자열을 금지 — 정성 라벨(예 "여유 있음")은 자연 회피한다.
- **`triggerLabel.ts`(planb/model)는 INV-3 내용 가드 밖이다** → `executionDurationStructure`는 `ui/**` 디렉토리만, `liveTimeStructure`는 `features/execution` 전수 + 명시 편입 파일 목록(`HUB_FILES`)만 봐서 `triggerLabel.ts`는 둘 다 사정거리 밖이다 — 라벨 문자열에 소요시간이 섞여도 잡는 심판이 없다. 형제 feature import(`execution/ui`→`planb/model`)는 `eslint.config.js` 층 zone이 잡지만, `TriggerChip.test.tsx`류 "props만으로 완전 렌더" 그물은 **훅 import**(throw로 걸림)만 잡고 순수 node-safe 모듈 import는 green으로 통과시킨다.
