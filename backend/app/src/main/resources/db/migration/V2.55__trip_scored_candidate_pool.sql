-- 생성 시점 점수 후보 풀 (TRIP-969) — 슬롯 교체를 LLM 없이 즉답하기 위한 재료.
--
-- V2.55 인 이유: 열린 PR 중 db/migration 은 없으나(2026-09-27 확인), 같은 시각 숙소 트랙
-- 세션이 V2.54(affiliate_click) 초안을 선점했다 — 로컬 Flyway 가 중복 2.54 로 깨져 비켜 줬다.
-- 저쪽이 늦게 머지되면 저쪽이 다시 채번한다(번호는 머지 시점의 커밋 상태가 정한다).
--
-- **왜 저장하나.** 슬롯 교체 후보(/alternatives)가 버튼마다 후보 풀을 다시 만들고 LLM 으로
-- 다시 점수를 낸다(예산 25초·상위 티어 1회). 그런데 그 판단은 생성 때 이미 끝나 있다 —
-- AI 의 pick_slot_alternatives 가 "같은 카테고리 → 점수 내림 → 거리 오름"으로 골라 두었다.
-- 그 산출 중 슬롯당 ≤2건만 남기고 점수를 버려서, 사용자가 2건을 다 거절하면 매번 느린 경로였다.
--
-- **티켓의 "itinerary 컬럼"에서 이탈해 별도 테이블이다(정본 이탈 기록).** itinerary 컬럼이면
-- 애그리거트 생성자 전체에 200건 풀이 실려 다니고, 리비전 스냅숏마다 ~8KB 사본이 함께 쌓인다.
-- 풀은 되돌리기 대상이 아니라 최신 생성의 파생물이므로 여행당 1행으로 분리한다(수명은 아래).
--
-- candidates jsonb = [{"poi_id": uuid, "score": number, "category": text}, ...] 상위 200건.
-- 배치된 슬롯의 점수도 포함한다 — 교체 대상 슬롯의 카테고리를 여기서 찾는다.
-- radius_m 는 저장 시점 탐색 반경 — 요청 반경이 이보다 크면 저장 풀이 그 반경을 안 덮는다(전개 조건).
CREATE TABLE trip_scored_candidate_pool (
  trip_id    uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  radius_m   int         NOT NULL CHECK (radius_m > 0),
  candidates jsonb       NOT NULL,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id)
);

COMMENT ON TABLE trip_scored_candidate_pool IS
  '생성 시점 점수 후보 풀(TRIP-969). 최신 생성이 통째로 갈아끼운다 — 직접 만들기 전환 시 삭제. 슬롯 교체 즉답(LLM 0회)의 재료.';
