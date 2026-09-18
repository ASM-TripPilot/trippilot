-- 날씨 스냅숏 캐시(TRIP-273 · C11 · U4 정본 §4.1 · P-PERF-U4-1).
--
-- 키를 **발표 주기에 맞춘다**: (격자, 발표시각). 기상청 단기예보가 3시간 간격이므로 TTL 을 임의로 정하지 않고
-- **다음 발표까지**로 둔다 — 새 발표시각이 곧 새 키라 캐시 무효화 로직 자체가 필요 없다.
-- 동시 사용자가 늘어도 외부 호출은 격자 수만큼만 는다(COST-U4-03).
CREATE TABLE weather_snapshot (
  -- 격자 좌표(기상청 nx·ny) 또는 지역 키. 벤더 어댑터가 좌표→격자 변환을 소유한다.
  grid_key           varchar(40)  NOT NULL,
  base_at            timestamptz  NOT NULL,
  precip_probability int          NOT NULL CHECK (precip_probability BETWEEN 0 AND 100),
  warning            varchar(200),
  fetched_at         timestamptz  NOT NULL,
  -- 다음 발표 시각. 이 시각을 넘기면 **발화에는 쓸 수 없다**(INV-U4-09).
  expires_at         timestamptz  NOT NULL,
  PRIMARY KEY (grid_key, base_at),
  CONSTRAINT chk_weather_snapshot_window CHECK (expires_at > base_at)
);

-- 조회는 "이 격자의 가장 최근 발표분"이라 발표시각 역순 인덱스가 그대로 쓰인다.
CREATE INDEX ix_weather_snapshot_grid ON weather_snapshot (grid_key, base_at DESC);

-- INV-U4-09: 조회 **실패 시 행을 만들지 않는다.** 만료된 스냅숏으로 트리거를 발화하지 않는다.
-- (표시에는 만료분도 쓰되 "확인 불가"로 표기 — P-RES-U4-2 의 역방향 예외.)
