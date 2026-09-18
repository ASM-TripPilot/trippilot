-- 슬롯별 차선책(TRIP-873) — 생성 시점에 AI 가 같이 준 "다른 선택지".
--
-- 번호 근거: 확인 시점(2026-09-16) 최신이 V2.47 이고, 열린 PR 중 db/migration 을 건드리는 것이 없다.
--
-- jsonb 인 이유: 슬롯당 최대 2건이라 별도 테이블의 조인 비용이 값어치를 못 한다. 그리고 이 값은
-- **조회 대상이 아니다** — 슬롯을 읽을 때 같이 나올 뿐, 차선책만 따로 검색하는 경로가 없다.
-- 검색해야 할 일이 생기면 그때 테이블로 승격한다(지금 쪼개면 안 쓰는 인덱스만 남는다).
--
-- NOT NULL DEFAULT '[]' — 기존 행과 "AI 가 안 준 슬롯"이 **같은 모양**이 되게 한다. null 을 허용하면
-- 읽는 쪽이 "없음"과 "모름"을 가르려 들고, 둘을 가를 근거가 실제로는 없다.
ALTER TABLE visit_slot ADD COLUMN alternatives jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN visit_slot.alternatives IS
    '슬롯별 차선책 ≤2건(TRIP-873). [{poi_id, rationale, distance_range}] — 시각·순서 없음(INV-2), 소요시간 없음(INV-3).';
