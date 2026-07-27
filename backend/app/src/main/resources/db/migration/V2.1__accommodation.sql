-- V2.1 accommodation-search (C3 · 밴드 e) — 최저가 스냅숏
-- 숙소 정적 콘텐츠는 Redis 조회 캐시(PG 테이블 없음). 정확 1박가는 미저장(LivePriceGateway·캐싱 금지).
-- PG에는 배치 일1회 최저가('부터 가격') 스냅숏만 영속(확정).

CREATE TABLE stay_price_snapshot (
  external_source varchar(40)  NOT NULL,              -- 공급자
  external_id     varchar(120) NOT NULL,             -- 공급자 내 숙소 ID
  lowest_amount   bigint,                             -- NULL=가격 미확인(INV-U1-06)
  currency        varchar(3)   NOT NULL DEFAULT 'KRW',
  captured_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (external_source, external_id)
);
