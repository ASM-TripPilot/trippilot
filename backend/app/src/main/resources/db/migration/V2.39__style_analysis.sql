-- 여행 스타일 분석(U5 정본 §4.3 · TRIP-555). **계정 단위**라 여행 생애주기와 다르다.
--
-- 번호 근거: 이 스택이 V2.36(회고)·V2.37/38(종료·요약)을 쓰고 있고, 열린 PR 중 마이그레이션을
-- 건드리는 것이 없다(실측).
--
-- ⚠ **임계 미만은 이 테이블에 들어오지 않는다**(INV-U5-09 · BR-U5-41). 누적 방문 10곳 미만이면
-- 임시 미리보기를 그리되 저장하지 않는다 — 저장하면 "정식 분석"과 "미리보기"가 한 테이블에 섞여
-- 이후 어느 쪽인지 구분할 근거가 사라진다. 도메인 생성자도 같은 임계를 막는다(타입이 존재할 수 없다).

CREATE TABLE style_analysis (
  -- 계정 단위 — 여행이 지워져도 남는다(INV-U5-08). 계정 유예 삭제에는 함께 파기된다.
  account_id          uuid PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  -- 대표 디스크립터(`#바다 #미식 #느긋`). **근거 안에서만** 만든다(BR-U5-31).
  descriptors         jsonb NOT NULL,
  -- dot 게이지 3축 {easygoing, foodAffinity, activeness} 각 0~5.
  -- ⚠ 산출식은 **잠정**이다(O-U5-9 미결) — U6 마이페이지 설계와 함께 확정한다.
  trait_gauges        jsonb NOT NULL,
  -- [{category, ratio, isOther}] — 상위 3 + `기타`. `category` 는 **화면 라벨이 아니라 `poi.category`
  -- 코드**다(O-U5-7). 라벨로 저장하면 라벨이 바뀔 때 저장된 과거 분석이 전부 틀린 말이 된다.
  category_breakdown  jsonb NOT NULL,
  avg_places_per_day  numeric(5,2) NOT NULL,
  avg_radius_km       numeric(6,2) NOT NULL,
  -- **소요시간 노출의 유일한 예외**(BR-U5-08a · DEC-U5-13 · PBT-U5-5). 사후 실적 통계라
  -- INV-3(솔버 미검증 예측 소요시간 금지)에 걸리지 않는다. 잴 수 없으면 NULL — 0 으로 채우지 않는다.
  avg_dwell_minutes   int,
  sample_trip_count   int NOT NULL,
  -- 임계 판정의 근거(BR-U5-40). CHECK 가 DB 에서도 임계를 지킨다 — 앱을 우회한 INSERT 도 막는다.
  sample_visit_count  int NOT NULL CHECK (sample_visit_count >= 10),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
