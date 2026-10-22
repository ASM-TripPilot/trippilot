-- 여행 요약 AI 회고 시도 기록(TRIP-1488) — 맡긴 회고 문장이 사라져도(대기열 넘침·AI 행·종료·크래시) 스윕이 다시 맡게.
--
-- V2.84 — 작성 시 origin/develop 최댓값 V2.81(weather_grid_forecast_daily_default)이고 V2.82·V2.83 은 열린 PR(#1528·#1529)이
-- 쥐고 있다(2026-10-22). 먼저 머지되는 쪽이 번호를 갖는다 — 이 PR 이 그 둘보다 먼저 들어가면 그대로 둬도 된다(Flyway 는 빈 번호를
-- 건너뛴다). 뒤에 들어가는데 그 사이 develop 에 V2.84 이상이 생기면 머지 직전 최댓값 + 1 로 다시 맞춘다.
--
-- 엔티티는 이 두 칸을 매핑하지 않는다 — 선점(UPDATE … RETURNING)과 스윕 조회만 네이티브 쿼리로 읽고 쓴다. 그래서 요약을 덮어쓰는
-- 생성·경로 갱신이 시도 기록을 지우지 않는다. 확장형이라 롤링 배포 창의 옛 파드는 이 칸을 모른 채 그대로 쓴다(기본값이 채운다).
ALTER TABLE trip_summary
  -- AI 회고를 부르러 간 횟수(선점마다 +1). 상한에 닿으면 더 맡지 않는다 — 결정적으로 실패하는 여행이 매 스윕 AI 를 부르지 않게.
  ADD COLUMN ai_attempts     integer     NOT NULL DEFAULT 0,
  -- 마지막 선점 시각. 다른 파드의 진행 중 호출을 중복하지 않으려고, 이 시각에서 요약 호출 read 상한이 지나기 전에는 다시 선점하지 않는다.
  ADD COLUMN ai_attempted_at timestamptz;
