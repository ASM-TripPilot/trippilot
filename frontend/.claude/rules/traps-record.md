---
paths:
  - "src/features/record/**"
  - "src/pages/trip-records/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **react-query 캐시 알림을 읽는 통합테스트는 `act` 직후 곧바로 `result.current`를 읽지 마라 — flush 헬퍼로 순서를 기다린다.** `notifyManager`가 알림을 `setTimeout(cb, 0)`으로 예약해서 보내므로, `act` 직후 즉시 읽으면 재렌더 전(구값)을 관측할 확률적 flake가 난다(`useVisitCheck.integration.test.tsx` 11/20 재현 — 개념 [[테스트 워커 강제종료 flake (원인 미상)]]). 의심되면 `beforeAll`에 `notifyManager.setScheduler((cb) => setTimeout(cb, 5))`로 재현해 확인한다. 같은 모양인 `savedStays`(stay)·`savedPlaces`(explore)·`useToggles`(notification)·`useAdjustVisitTimes`(record, 이 파일)에 처방이 들어가 있고, 헬퍼는 공용 `src/test-support/flushNotifications.ts`다(스케줄러 잠금은 각 파일 인라인 유지 — 공용 setup으로 옮기면 100여 파일에 번진다). ⚠️ **롤백 단언(기대값=호출 전 값) 앞의 flush는 지워도 파일이 green으로 남는다** — 그 flush가 없으면 잠금 아래서 롤백 심판이 조용히 공허해지는데 기계가 못 잡아, "필요 없어 보이는 줄"로 정리하면 사고가 난다. ⚠️ **`waitFor(() => expect(hitCount).toBe(1))`은 "정확히 1회"를 보장하지 않는다** — 문(gate)은 응답만 막고 요청 카운트는 막지 않으므로, `waitFor`가 첫 시도에 1을 보고 끝난 뒤 지연된 두 번째 요청이 카운트를 올려도 못 잡는다.
- **월 그리드 순수 함수는 `shared/date/monthGrid.ts`가 유일한 정본이다**(`daysInMonth`·`firstWeekdayOfMonth`·`shiftMonth`·`isDateInRange`·`buildMonthGrid`) — stay·trip의 옛 사본은 삭제돼 한 벌로 통합됐다. 새 record 파일을 만들 때는 이 파일부터 확인한다. record 안에서 이 산술을 다시 짜면 다시 두 벌째가 된다.
- **`recordsCalendar.ts`의 `formatTripDateRange`·`nightsLabel` 정본은 `entities/trip/lib/{formatTripPeriod,formatNights}.ts`다** → 이 파일이 `buildPastTripCards` 내부에서도 그 함수를 쓰므로 옛 자리는 `import`+로컬 재수출이다(순수 `export … from`으로 바꾸면 내부 호출이 깨진다 — `layer-entities.md` entities/trip 절). `PastTripList.tsx`는 `entities/trip/ui/PastTripRow`에 위임하며 완성 `testID` 리터럴(`record-calendar-past-trip-{id}`)을 조립해 넘긴다 — `recordsCalendarStructure` G3 앵커가 이 리터럴을 문다.
- **`GET /trips/{tripId}/change-log`는 미개통이다(생산자 없음, 항상 빈 목록) — 변경 이력은 `GET /trips/{tripId}/records` 응답의 `TripRecord.changes[]`에 임베드돼 내려온다.** `openapi.yaml`도 "생산자 없어 항상 빈 목록, 붙이지 말 것"이라 적는다. 티켓 설명이나 aidlc 원문(BR-U5-29)이 `/change-log` 개통을 전제해도, 변경 이력을 조회하는 화면은 `/records.changes[]`를 쓴다.
