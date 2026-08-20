-- TRIP-403 동시 생성 1건 제한 — 세션에 계정을 남긴다.
-- 번호 근거: V2.26 까지 사용 중이고 열린 PR 중 V* 를 쓰는 것이 없다(2026-08-21 gh 실측).
--
-- **왜 비정규화하나.** 제한 단위가 계정이라 "이 계정에 진행 중인 생성이 있는가"를 물어야 하는데,
-- 세션은 trip_id 만 들고 있다. 여행을 거쳐 가려면 itinerary-generation 이 trip 의 테이블을 조인해야 하고
-- 그건 모듈 경계(R1) 위반이다 — 다른 모듈의 내부를 SQL 로 잡는 셈이다.
-- 세션을 여는 쪽이 이미 accountId 를 알고 있으므로 그때 함께 적는다.

ALTER TABLE generation_session ADD COLUMN account_id uuid REFERENCES account(account_id) ON DELETE CASCADE;

-- 기존 행은 여행에서 채운다(한 번뿐인 소급). 이후로는 세션 생성 시 적힌다.
UPDATE generation_session s SET account_id = t.account_id FROM trip t WHERE t.trip_id = s.trip_id;

-- "이 계정에 살아 있는 세션" 조회가 유일한 접근 경로다. 끝난 세션은 대상이 아니라 부분 인덱스로 좁힌다.
CREATE INDEX ix_generation_session_active
    ON generation_session (account_id, started_at DESC)
 WHERE status IN ('RUNNING', 'DAY1_READY');
