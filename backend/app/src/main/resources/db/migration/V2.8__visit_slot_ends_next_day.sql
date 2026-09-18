-- V2.8 자정 넘김 슬롯(HC4) — ends_next_day 플래그 (TRIP-279)
-- AI 원천=tz-aware datetime → 와이어 (a) start_at/end_at(time) + ends_next_day 로 결정론 사영(경계 계약, PR #76).
-- HC4 귀속: 자정 넘긴 활동은 시작일에 귀속(슬롯이 속한 itinerary_day 가 결정).

ALTER TABLE visit_slot ADD COLUMN ends_next_day boolean NOT NULL DEFAULT false;

-- CHECK 완화: 자정 넘김(ends_next_day)이면 end_at < start_at 허용(익일 시각). 아니면 기존대로 end>=start.
ALTER TABLE visit_slot DROP CONSTRAINT chk_visit_slot_time;
ALTER TABLE visit_slot ADD CONSTRAINT chk_visit_slot_time CHECK (ends_next_day OR end_at >= start_at);
