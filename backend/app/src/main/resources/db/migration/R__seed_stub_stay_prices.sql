-- R__ (repeatable) 스텁 숙소 최저가 시드 — StubJejuContentAdapter 의 제주 5곳 '부터 가격'.
-- 스텁 단계 한정: 실 벤더 가격 배치(LC-U1-2)가 붙으면 이 시드와 스텁 어댑터를 함께 제거한다.
-- (기동 시 ApplicationRunner DB write는 @SpringBootTest 컨텍스트를 깨므로 마이그레이션 시드로 대체 — anti-patterns.md)
-- 실행 주체 app_migrate. 멱등(ON CONFLICT).

INSERT INTO stay_price_snapshot (external_source, external_id, lowest_amount, currency, captured_at) VALUES
  ('STUB', 'jeju-001', 220000, 'KRW', now()),   -- 제주 오션 리조트
  ('STUB', 'jeju-002',  45000, 'KRW', now()),   -- 성산 게스트하우스
  ('STUB', 'jeju-003', 180000, 'KRW', now()),   -- 중문 비치 호텔
  ('STUB', 'jeju-004', 130000, 'KRW', now()),   -- 애월 감성 펜션
  ('STUB', 'jeju-005',  95000, 'KRW', now())    -- 제주시 시티 호텔
ON CONFLICT (external_source, external_id) DO UPDATE
  SET lowest_amount = EXCLUDED.lowest_amount,
      currency      = EXCLUDED.currency,
      captured_at   = EXCLUDED.captured_at;
