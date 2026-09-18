-- 여행 요약(U5 정본 §4.2 · TRIP-554). 여행당 하나.

CREATE TABLE trip_summary (
  -- 여행당 하나 — PK 가 곧 그 보장이다. 재생성이 두 장을 만들면 화면이 어느 것을 보일지 못 정한다.
  trip_id      uuid PRIMARY KEY REFERENCES trip(trip_id) ON DELETE CASCADE,
  narrative    text NOT NULL,
  -- 날짜별 하이라이트(`j04` 의 "Day N · 5곳 · 광안리→감천"). 배열이라 jsonb.
  highlights   jsonb NOT NULL,
  -- {totalVisits, totalDistanceKm, distanceSource, totalPhotos}. **비어 있을 수 없다**(PBT-U5-1) —
  -- 방문 0곳 여행도 이 값으로 요약이 그려진다.
  stats        jsonb NOT NULL,
  -- AI | RULE | BASIC. **항상 싣는다**(BR-U5-33) — 회고와 같은 규약을 쓴다.
  source       varchar(8) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
