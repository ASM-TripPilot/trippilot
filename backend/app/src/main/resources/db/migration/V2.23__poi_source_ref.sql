-- poi.source_ref — 외부 출처의 원본 식별자(TourAPI contentId 등). AI 수집 제안 수신(INV-1)의 멱등 키.
--
-- V2.22 다음 번호. 열린 PR 중 db/migration 을 건드리는 것이 없어 충돌 없음(2026-08-18 확인).
--
-- **왜 필요한가**: 수집은 매일 돈다(ai-poi-collect, KST 04:00). 같은 장소가 매번 새 행이 되면
-- 후보 풀에 중복이 쌓이고, AI 가 하루 일정에 같은 곳을 두 번 넣는 형태로 사용자에게 드러난다.
-- "이미 아는 장소인가"를 판정할 키가 필요하고, 그 키는 이름·좌표가 아니라 **출처가 준 식별자**여야 한다
-- — 이름은 표기가 흔들리고 좌표는 벤더가 미세하게 바꾼다.
--
-- nullable 인 이유: 기존 행(R__seed_stub_pois 의 MANUAL 시드)은 외부 출처가 없다. 값을 지어내지 않는다.
ALTER TABLE poi ADD COLUMN source_ref varchar(64);

COMMENT ON COLUMN poi.source_ref IS '외부 출처 원본 식별자(TourAPI contentId 등). 수동 등록분은 NULL.';

-- (source, source_ref) 가 같은 두 행은 같은 장소다 — 수신이 재실행돼도 행이 늘지 않아야 한다.
-- source 를 함께 묶는 이유: 식별자 체계는 벤더마다 독립이라 다른 벤더의 같은 숫자가 충돌할 수 있다.
--
-- **부분 인덱스**인 이유: 수동 등록분은 source_ref 가 NULL 이고 여러 건이다.
-- (Postgres 는 NULL 을 서로 다르게 보지만, 의도를 인덱스에 적어 두는 편이 다음 사람에게 분명하다 —
--  visit_check 의 ux_visit_check_slot 과 같은 관례.)
CREATE UNIQUE INDEX ux_poi_source_ref ON poi (source, source_ref) WHERE source_ref IS NOT NULL;
