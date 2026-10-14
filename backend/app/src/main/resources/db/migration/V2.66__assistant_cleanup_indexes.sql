-- 도우미 보존 청소·월 합계가 타는 인덱스 둘(TRIP-1380).
--
-- V2.66 — 착수 시점 최신(V2.65) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-14).
-- 두 테이블 모두 아직 운영에 나간 적이 없어(V2.64 와 같은 배포에 실린다) 비어 있는 테이블에 만드는 인덱스다.

-- 제안이 지워질 때(대화 삭제의 CASCADE) 그 제안을 가리키던 메시지의 `proposal_id` 를 NULL 로 돌린다(ON DELETE SET NULL).
-- 인덱스가 없으면 지워지는 제안 하나마다 메시지 테이블 전체를 훑는다 — 보존 청소가 처음으로 대화를 묶어서 지운다.
CREATE INDEX ix_assistant_message_proposal ON assistant_message (proposal_id) WHERE proposal_id IS NOT NULL;

-- PK 가 (account_id, day) 라 날짜만으로 고르는 조회 — 전역 월 합계(COST-U8-04)와 40일 청소(DATA-U8-04) — 는 인덱스를 못 탄다.
CREATE INDEX ix_assistant_usage_daily_day ON assistant_usage_daily (day);
