-- 자동화 구간 종료 사유에 USER_PAUSE 를 더한다(TRIP-1486 · 여행 중 자동 기록 일시 중지).
--
-- 사용자가 여행 중 허브에서 "이 여행" 자동 기록을 잠깐 끈다 — 동의 철회가 아니라 지오펜스만 내린다. 기기는 열린 구간을
-- END(USER_PAUSE)로 닫고, 다시 켜면 새 intervalId 로 START 한다. 법정 로그(USE/COLLECTION END)에 사유가 그대로 실린다.
-- 이 값을 모르면 END 가 CHECK 위반(500)이 되어 구간이 SERVER_TIMEOUT 까지 열린 채 남는다 — 무장 판정(isAutomationArmed)이 틀린다.
--
-- V2.68 의 이름 없는 CHECK(PostgreSQL 자동 이름 `location_automation_interval_end_reason_check`)를 같은 이름으로 바꿔 단다.
-- 넓히기만 하므로 기존 행은 모두 통과한다. 롤링 배포 창의 옛 파드는 USER_PAUSE 를 enum 으로 못 읽어 400 을 낸다(기기는 그 END 를
-- 버린다 — 서버 스위퍼가 닫는다). 새 파드가 다 뜬 뒤에는 정상.
ALTER TABLE location_automation_interval
  DROP CONSTRAINT location_automation_interval_end_reason_check;

ALTER TABLE location_automation_interval
  ADD CONSTRAINT location_automation_interval_end_reason_check CHECK (end_reason IN
    ('CLIENT_STOP','PERMISSION_DOWNGRADE','ACCURACY_REDUCED','CONSENT_REVOKED','TRIP_ENDED','USER_PAUSE','SERVER_TIMEOUT'));
