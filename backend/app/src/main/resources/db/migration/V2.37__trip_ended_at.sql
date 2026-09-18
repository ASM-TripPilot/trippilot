-- 여행 종료 **시점 기록**(TRIP-554 · U5 정본 §6).
--
-- ## 왜 컬럼이 필요한가 — 실측으로 드러난 것
--
-- `TripStatus.ENDED` 는 **저장되지 않는다.** `Trip.statusAt(today)` 가 날짜에서 파생하고, 저장된
-- `status` 는 `PLANNED` 에서 움직이지 않는다(그 코드 주석이 명시한다). 즉 **여행이 끝나는 "순간"이
-- 어디에도 없다.**
--
-- 사건(`trip.TripEnded`)에는 순간이 필요하고, 순간은 기록돼야 한다 — 파생 상태로는 이벤트를 만들 수
-- 없다. 매번 "지금 끝난 여행"을 훑어 발행하면 폴링마다 같은 여행에 이벤트가 또 나간다.
-- 이 컬럼이 **한 번만 발행됐다는 표식**이다(`ended_at IS NULL` 조건부 UPDATE).
--
-- ⚠ `status` 컬럼은 건드리지 않는다. 그쪽은 U1 소유이고 파생 판정을 저장값으로 되돌리면
-- `statusAt` 과 두 개의 사실이 생긴다.

ALTER TABLE trip ADD COLUMN ended_at timestamptz;

-- 종료 스위퍼가 보는 유일한 조회(ix_outbox_unpublished 와 같은 꼴). 이미 발행한 여행은 다시 보지 않는다.
CREATE INDEX ix_trip_pending_end ON trip (end_date) WHERE ended_at IS NULL AND deleted_at IS NULL;
