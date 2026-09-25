---
paths:
  - "src/features/notification/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`useToggles.integration.test.tsx`는 react-query 알림 경합 처방이 적용돼 있다(TRIP-953)** — `beforeAll`에 `notifyManager.setScheduler` 5ms 잠금 + `@/test-support/flushNotifications`로 `result.current`를 읽기 전 순서를 기다린다. 롤백 단언 앞 flush 1자리(`:262`)는 지워도 green으로 남는 무방비 지점이다(상세·이유는 `traps-record.md` 동일 항목의 react-query 알림 경합 절). 새 낙관 업데이트 테스트를 이 파일에 더할 때 flush 없이 `act` 직후 읽으면 같은 flake가 재발한다. U2(그 kind 푸시는 낙관에서 불변)는 제목에 맞는 단언이 아직 없다(단언 수 무변경 AC와 충돌해 이번 사이클은 미추가 — 새 티켓 후보).
