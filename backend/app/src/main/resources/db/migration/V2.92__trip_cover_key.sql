-- 사용자가 고른 여행 커버(TRIP-1789) — 앱 번들 지역 그림 키. NULL = 첫 목적지로 자동(지금까지의 동작).
-- 번호 근거: V2.91 다음. TRIP-1801 이 V2.93 을 쓴다(같은 배치, 뒤집히면 Flyway 순서가 깨진다).
-- 키 목록은 앱이 소유한다(frontend regionCovers.ts) — 서버는 형식만 본다. 복제하면 그림을 더할 때마다 서버를 함께 내야 한다.
ALTER TABLE trip ADD COLUMN cover_key varchar(40);
