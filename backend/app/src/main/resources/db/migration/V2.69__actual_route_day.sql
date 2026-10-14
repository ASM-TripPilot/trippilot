-- 하루치 실제 경로(U10 M-U10-b · DEC-U10-4·5·7 · TRIP-1405).
--
-- V2.69 — V2.68(#1168, 자동화 구간) 다음. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-14).
--
-- **서버가 갖는 위치 형태의 데이터는 이것뿐이다**(INV-U10-2) — 기기가 다운샘플한 인코딩 폴리라인. 원시 표본·정확도·
-- 표본별 시각은 받지 않는다. GPS 기록 동의(L3)를 철회하면 그 계정의 행을 즉시 전부 지운다(DEC-U10-7) — 그래서 앱 롤에
-- DELETE 가 있어야 하는 표다(V1.7 기본 권한이 준다. append-only 회수 대상이 아니다).
CREATE TABLE actual_route_day (
  -- 법정 로그 `COLLECTION(STORE)` 의 subjectId. 같은 날 재업로드는 행을 바꾸지 않고 내용만 교체한다.
  route_day_id        uuid        PRIMARY KEY,
  trip_id             uuid        NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- 여행지 기준 날짜.
  local_date          date        NOT NULL,
  -- 인코딩 폴리라인(정밀도 1e-5) 배열. 기록이 끊긴 곳에서 나뉜다 — 세그먼트끼리 잇지 않는다(INV-U10-9).
  segments            text[]      NOT NULL,
  -- 클램프 후 값(BR-U10-38). 클램프했으면 distance_clamped.
  distance_m          integer     NOT NULL CHECK (distance_m >= 0),
  distance_clamped    boolean     NOT NULL,
  -- 다운샘플 전·후 점 수 — 최소화의 증적.
  raw_point_count     integer     NOT NULL CHECK (raw_point_count >= 0),
  stored_point_count  integer     NOT NULL CHECK (stored_point_count >= 0),
  -- 기록 구간. 검증 전용 — 화면에 기간으로 내보내지 않는다(INV-U10-7). 기기가 안 보내면 비어 있다.
  recorded_from       timestamptz,
  recorded_to         timestamptz,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  CONSTRAINT ux_actual_route_day UNIQUE (trip_id, local_date),
  CONSTRAINT chk_actual_route_day_points CHECK (stored_point_count <= raw_point_count),
  CONSTRAINT chk_actual_route_day_window CHECK (recorded_from IS NULL OR recorded_to IS NULL OR recorded_to >= recorded_from)
);
