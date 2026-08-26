-- 회고(U5 정본 §4.1 · TRIP-552). 하루 한 장.
--
-- 번호 근거: V2.31·V2.32(TRIP-547 알림) · V2.33·V2.34(TRIP-542 사진·메모) · V2.35(TRIP-548 토글) 다음.
-- 정본은 V2.35 를 제안했으나 그 표가 "머지 시점 재배정"을 명시한다. V2.29·V2.30 은 비워 둔다 —
-- 앞 번호를 뒤늦게 채우면 이미 V2.31 을 적용한 환경에서 Flyway 가 거부한다.

CREATE TABLE reflection (
  reflection_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  day_date         date NOT NULL,
  -- 생성된 원문. 사용자가 고치면 edited_narrative 에 따로 쌓는다 — 초안을 덮어쓰면
  -- "AI 가 뭐라고 했었나"가 사라지고, 화면의 2열 비교(INV-U5-06)가 성립하지 않는다.
  draft_narrative  text NOT NULL,
  edited_narrative text,
  -- AI | RULE | BASIC. **항상 싣는다**(BR-U5-33) — 화면이 구분해 그리지 않더라도 품질을 관측하려면
  -- 어느 단에서 나온 문장인지가 남아야 한다. CHECK 를 걸지 않는다: 단이 늘 때 마이그레이션이 붙지 않게.
  source           varchar(8) NOT NULL,
  -- {visitCount, distanceKm, distanceSource, photoCount}. **비어 있을 수 없다**(INV-U5-07) —
  -- 방문 0곳이어도 0으로 채운다. 기본 카드가 이 값만으로 그려진다.
  stats            jsonb NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- 하루 한 장(BR-U5-35). 재생성이 두 장을 만들면 화면이 어느 것을 보일지 못 정한다.
  CONSTRAINT ux_reflection_trip_day UNIQUE (trip_id, day_date)
);

CREATE INDEX ix_reflection_trip_day ON reflection (trip_id, day_date);
