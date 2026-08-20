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

-- 소급이 끝났으니 이제 비어 있을 수 없다. 세션은 여행에서 CASCADE 로 매달려 있어 계정 없는 행이 생기지 않는다.
-- NULL 을 허용하면 그 행이 조회에서 조용히 빠져 **제한을 우회한다**.
ALTER TABLE generation_session ALTER COLUMN account_id SET NOT NULL;

-- **UNIQUE 다.** 앱 가드만으로는 동시 요청 둘이 읽고-검사-쓰기 사이를 함께 통과할 수 있다 —
-- 이 규칙이 막으려는 것이 바로 "연타"라 그 자리에서 뚫리면 규칙이 없는 것과 같다.
-- 같은 여행 재생성은 이전 세션을 닫고 INSERT 하므로 이 인덱스에 걸리지 않는다(`saveAndFlush` 로 순서 보장).
-- 여행 단위 `ux_generation_session_running`(V2.22)과 같은 방식·같은 상태 집합이다.
CREATE UNIQUE INDEX ux_generation_session_account_running
    ON generation_session (account_id)
 WHERE status IN ('RUNNING', 'DAY1_READY');

-- 조회는 최신순으로 하나만 집는다.
CREATE INDEX ix_generation_session_account ON generation_session (account_id, started_at DESC);
