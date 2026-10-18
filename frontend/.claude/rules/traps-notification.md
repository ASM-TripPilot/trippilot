---
paths:
  - "src/features/notification/**"
  - "src/pages/settings/notification-inbox/**"
  - "src/pages/settings/settings-notifications/**"
---

이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`useToggles.integration.test.tsx`는 react-query 알림 경합 처방이 적용돼 있다** — `beforeAll`에 `notifyManager.setScheduler` 5ms 잠금 + `@/test-support/flushNotifications`로 `result.current`를 읽기 전 순서를 기다린다. 롤백 단언 앞 flush는 지워도 green으로 남는 무방비 지점이다(상세·이유는 `traps-record.md` 동일 항목의 react-query 알림 경합 절). 새 낙관 업데이트 테스트를 이 파일에 더할 때 flush 없이 `act` 직후 읽으면 같은 flake가 재발한다.
- **푸시 열을 여는 쪽은 개통됐지만 실수신은 별개다** — 알림 설정 푸시 열은 TRIP-1442로 열렸는데, iOS 푸시 자격·`PUSH_MODE`가 꺼져 있으면 켜도 실제 수신은 안 된다(심판 지적 TRIP-939 잔존). 열이 보인다고 푸시가 도는 것이 아니다.
