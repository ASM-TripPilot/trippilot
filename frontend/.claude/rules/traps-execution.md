---
paths:
  - "src/features/execution/**"
  - "src/pages/live/live-*/**"
  - "src/shared/location/**"
  - "src/features/planb/**"
  - "src/pages/live/planb-*/**"
  - "src/features/request-replan/**"
  - "src/features/apply-replan/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(전역 불변식 INV-3 "소요시간 비표시, 거리만"은 코어 `repo-traps.md`에 남아 무조건 로드된다.)

- **react-query 캐시 알림을 읽는 통합테스트는 `act` 직후 곧바로 `result.current`를 읽지 마라 — flush 헬퍼로 순서를 기다린다.** `notifyManager`가 알림을 `setTimeout(cb, 0)`으로 예약해서 보내므로, `act` 직후 즉시 읽으면 재렌더 전(구값)을 관측할 확률적 flake가 난다(`useVisitCheck.integration.test.tsx` 11/20 재현 — 개념 [[테스트 워커 강제종료 flake (원인 미상)]]). 의심되면 `beforeAll`에 `notifyManager.setScheduler((cb) => setTimeout(cb, 5))`로 재현해 확인한다.
- **동기 제출을 비동기(await 뒤 mutate)로 바꾸면 "대기 중 언마운트" 창이 새로 생긴다 — `mountedRef`류 가드 없이는 화면이 사라져도 POST가 나간다.** 실제 TanStack에서는 언마운트 뒤 호출별 `onSuccess`/`onError`가 안 불리므로(`mutationObserver.js`) 이동도 오류 안내도 없이 조용히 서버 세션만 하나 더 생긴다(`ReplanSessionService.start`가 기존 열린 세션을 취소하고 새 세션을 연다). jest 목은 언마운트와 무관하게 콜백을 부르므로 이 창을 원리적으로 못 잡는다 — 재현하려면 대기 중 언마운트 → 콜백 미호출을 단언하는 통합 테스트를 따로 심는다. 이 도메인 밖에서도 "누름→await→mutate" 패턴을 새로 들이면 같은 사각이 반복된다.
- **측위는 `shared/location/readDevicePosition.ts` 하나로 부른다** → expo-location의 Android 기본값은 `mayShowUserSettingsDialog:true`라, 옵션 없이 `getCurrentPositionAsync()`를 직접 부르면 기기 위치가 꺼져 있을 때 시스템 "위치 사용" 대화상자가 뜬다. 떠 있는 채로 5초 타임아웃 POST가 나가면 사용자가 뒤늦게 "사용"을 눌러도 좌표는 버려진다. 인자를 잠그는 테스트는 `readDevicePosition.test.ts`뿐이라 다른 자리에서 직접 부르면 무심판이다(iOS는 옵션 자체가 없어 무해, 확인은 Android 실기).

## 여행 중 실행 (execution, i01~i05)
⚠️ 이 절의 `i01`·`i05` 등은 **코드 라우트·프리뷰 키가 쓰는 옛 Figma 코드**다. 라이브 Figma i 밴드는 i01~i10으로 재번호됐다(옛 i05 현재 장소 상세 = 새 i10) — 대조는 `spec-perception/reference/figma-structure.md`의 매핑 포인터로.

- **i01 active 카드의 유일한 진입로는 수동 [도착]이다** → `LiveItineraryPage.tsx`가 `GET /visits/days/{day}` → `deriveVisitProgress` → `projectSlotProgress(activeSlots, {completedPoiIds, activePoiId})`로 방문 기록을 주입하고, `SlotProgressCard`의 upcoming 얼굴이 세 겹 게이트(페이지 `activeDate===today && visits.data!==undefined` → 뷰 `관람 중 없음` → 카드 upcoming 얼굴) 뒤에서 `POST /trips/{tripId}/visits`를 `source:'MANUAL'`로 부른다. 지오펜스(`shared/location/geofence.ts`)는 `armed:false` degrade 스텁이라 실발화하지 않는다. 건너뛰기는 없다(도착 전 슬롯엔 서버 레코드가 없어 `/skip`을 못 부름). `nextNav.ts`(딥링크 폴백 사다리)는 `LiveItineraryPage.tsx`가 `resolveSlotDests`·`openNextNav`로 쓴다(슬롯별 [길찾기], TRIP-1189) — 데드코드가 아니다. 딥링크 스킴 미등록 문제(`kakaomap`, 개념 [[딥링크 스킴 미등록 — canOpenURL이 항상 false]])는 이 호출 경로에 그대로 걸린다.
- **`geofence.ts` 4함수(shared/location)는 호출자가 0이다** → (`dwellMinutes.ts`는 서버가 체류를 스스로 도출해 클라→서버 dwell 필드가 계약에 없어 TRIP-1191 로 삭제됐다.) `geofence.ts`는 실 네이티브 발화(`startGeofencingAsync`)가 없어 `armed:false`만 반환한다 — expo-task-manager 미설치·"항상 허용" background 권한·네이티브 리빌드가 선행돼야 한다. PBT/유닛 테스트로 정확성만 잠겨 있다.
- **지오펜스 태스크 재무장 루프는 TRIP-1511 로 해결됐다 — 단 해결책이 남긴 사각이 둘 있다** → `native.armGeofences` 가 직전에 등록한 리전 집합(slotKey·lat·lng·radiusM 순서 무관 키, 모듈 변수 `armedKey`)과 같으면 `startGeofencingAsync` 를 부르지 않는다(등록 성공 뒤에만 기억, `disarmGeofences` 가 지움). 기억을 비우는 `forgetArmedRegions` 는 `useLocationAutomation` 의 **포그라운드 복귀 refresh 에서만** 부른다 — 태스크 경로에서 부르면 루프가 되살아난다(시뮬 실측 분당 5천~1만 → 4~5회, 복귀 뒤 60초 0회). **남은 사각**: (1) 실기기에서 OS 가 등록을 잃는 경우(Android 위치 서비스 끔/켬·Play 서비스 비움) 포그라운드 복귀 전까지 복구되지 않고, 앱 프로세스가 죽으면 기억이 비어 콜드 wake 마다 1회 재등록한다 — 6-b 미확인. (2) 재등록이 throw 하면 옛 키가 남는데 expo 가 실패 시 이전 등록을 유지하는지 미확인이라 `handleGeofence`·`handleLocations` 경로(반환값을 버림)에서 옛 등록이 비었을 가능성이 있다. 둘 다 jest 가 원리적으로 못 본다 — 근거: TRIP-1511 구현 결정(03·03b).
- **포그라운드 wake 는 i01 허브(`useLocationAutomation` 마운트)에서만 들어간다 — 홈 등 허브 밖에선 자동 도착이 안 뜬다** → 진입 후 정지한 채 앱을 홈에 둬도 확정은 다음 경로 표본·지오펜스 이벤트·i01 진입 때까지 미뤄진다(TRIP-1517, `handleWake`). 앱 루트로 올리는 건 설계 선택지로만 남아 있다. 6-b 에서 "4분 정지했는데 안 뜬다" 하면 화면부터 확인한다. 근거: TRIP-1517 구현 결정(03·04b, 요구사항 근거로 인용 금지)
- **시뮬 `arrive` 재생은 자정을 넘기면 무효다 — 무장 리전이 그날 슬롯으로 바뀐다** → 어제 일차 슬롯 좌표로 재생하면 로그에 아무것도 안 남는다(TRIP-1517 04b 1차 재생 00:26 실측). 자정 근처 재생 전 i01 의 오늘 일차와 슬롯 좌표를 먼저 본다. 근거: 04b_smoke_1 실측
- **`live-place`(i05 코드 라우트, 라이브 i10) 분기 순서** → `LivePlacePage.tsx`는 `query.isPending` → 404 아닌 에러(오류 얼굴 `execution-place-error` + `execution-place-retry`) → 404(`-notfound`) → 데이터 순으로 가르고, 옛 캐시+404는 `notFound ? null : buildPlaceDetailView(...)`가 막는다. 그 옛 캐시+404 분기는 `LivePlacePage.integration` I14가 단언한다(TRIP-1152 뮤턴트 PL3 red). 자매 화면 d06의 오류 접기는 `traps-explore.md` 참고.
- **`triggerLabel.ts`(planb/model) 라벨 문자열에 소요시간이 섞여도 잡는 심판이 없다** → INV-3 소스 스캔은 TRIP-1145에서 지웠다(회귀는 QA). 형제 feature import(`execution/ui`→`planb/model`)는 `eslint.config.js` 층 zone이 잡지만, `TriggerChip.test.tsx`류 "props만으로 완전 렌더" 그물은 **훅 import**(throw로 걸림)만 잡고 순수 node-safe 모듈 import는 green으로 통과시킨다.
- **reanimated 애니메이션 스타일은 jest에서 `props.style`로 읽으면 첫 렌더 값에 굳어 있다** → `LiveHubView` FAB 앵커(TRIP-1083, 리포 첫 reanimated 코드)가 시트를 안 따라가도 첫 값만 맞으면 green이 된다. 관측은 `getAnimatedStyle(node)`(reanimated export)로만 하고, **가짜 타이머**가 있어야 갱신된다(매퍼 등록이 타이머로 미뤄짐). **원인 act 안에서 타이머를 흘리면 무효**다 — onLayout처럼 React 상태를 바꾸는 원인은 리렌더 끝(act 종료)에 매퍼를 다시 등록하므로, 타이머 흘림(`flushFrames`)은 **별도 `act`** 로 부른다(올바른 구현도 red로 오판, 실측). 시트 위치 상자는 통과형 gorhom 목이 `...props`를 host View에 펼치는 덕에 `snapPoints` 가진 노드의 `props.animatedPosition`으로 꺼내 `.value`를 써서 흉내 낸다. `Animated.View`의 `className`은 NativeWind 인터롭이 RN 코어만 등록해 기기에서 무시될 수 있으나 jest는 raw prop으로 남겨 통과시킨다 — 그래서 앵커는 className 부재를 단언한다.
- **FAB 앵커의 첫 프레임·리렌더 튐과 실제 터치는 jest 사각이고 6-b 미검증이다** → gorhom이 처음 쓰는 값은 `창 높이+topInset`이라 초기값(`창 높이`)과 노치 기기에서 한 프레임 다를 수 있고, 메뉴 여닫기 리렌더가 앵커 `top`을 첫 값으로 되돌리는지(reanimated 4 커밋 훅이 덮을 것으로 추정)는 원리적으로 못 본다. 하한은 오버레이 줄만 보므로 긴 트리거 알약(메뉴 닫힘)과 겹침은 미확인이고, 폭 338pt 미만 기기의 열린 알약 줄 왼쪽 넘침도 기준이 없다.
- **`LiveItineraryPage.integration.test.tsx`는 끝난 뒤에도 프로세스가 안 끝나고(열린 핸들), 공백이 든 `-t` 패턴은 pnpm이 쪼개 파일 패턴으로 읽는다** → 통합 버킷은 `pnpm test:integration <파일> --forceExit`로, 이름 필터는 공백 없이 `--testNamePattern='PS[1-6] '` 꼴로 준다(`-t "U10 자동 기록"`은 "자동"·"기록"을 파일 패턴으로 읽어 0건이 된다). 원인은 이번 변경과 무관한 기존 핸들(실측 1건, TRIP-1486 02a·03). 이 셸엔 `timeout` 명령도 없다.
