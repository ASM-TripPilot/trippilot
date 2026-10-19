-- 격자 시간별 예보 캐시(situation-awareness · C11 · domain-entities §8.1 · tech-stack 델타 3).
-- 번호: 작성 시점 origin/develop 최댓값 V2.73(plan_b_situation) + 1 — 머지 직전에 다시 본다(설계서 CD13).
--
-- 상황 감시 스윕의 단기예보 감지기가 **슬롯 좌표의 격자**를 시간별로 본다. 이름 키 캐시(weather_snapshot · V2.19)는
-- 하루 강수확률 최댓값 하나라 시간별·변형별 판정을 못 하고 키(목적지 이름)도 달라 섞지 않는다 — 그쪽은 날씨 확인·도우미 카드가 그대로 쓴다.
-- 격자당 1행(덮어쓰기)이라 행 수가 '서로 다른 격자 수'에 묶인다 — 정리 잡이 필요 없다.
--
-- INV-U4-09 승계: **정상 결과(코드 00)만 저장한다.** 실패·자료 없음(03)·게이트웨이 거절은 행을 만들지 않는다.
-- 권한은 기본 권한(V1.7)이 덮는다. 확장형(새 표)이라 롤링 창의 옛 파드에 무해하다.
CREATE TABLE weather_grid_forecast (
  -- 기상청 격자 "nx,ny"(예 제주 "53,38").
  grid_key   varchar(16) PRIMARY KEY,
  -- 발표 시각. 판정은 이 뒤의 예보 시각만 본다.
  base_at    timestamptz NOT NULL,
  -- KST 정시 → {pop, pty, sky, tmp, wsd} (오늘·내일만). 모르는 칸은 키가 없다. 수는 읽을 때 정규화한다(정수·실수 혼재).
  hourly     jsonb       NOT NULL,
  -- 날짜 → {tmn, tmx} (응답에 있을 때만).
  daily      jsonb       NOT NULL,
  fetched_at timestamptz NOT NULL,
  -- 발표 + 3시간 + 10분 = 다음 발표가 실제로 제공되는 시각. 이 시각부터는 발화에 쓰지 않는다.
  expires_at timestamptz NOT NULL,
  CONSTRAINT chk_weather_grid_forecast_window CHECK (expires_at > base_at)
);
