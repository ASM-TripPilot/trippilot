-- 도우미 장소 조회(NL2SQL)용 읽기 전용 뷰 — AI 가 읽을 수 있는 장소 표의 **유일한** 창.
--
-- V2.77 — 착수 시점 최신(V2.76) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-20).
--
-- 왜 뷰인가: 도우미가 "서울 요즘 핫한 곳" 같은 말을 LLM 이 쓴 SELECT 로 조회한다(2026-10-20 사용자 결정 — LLM 이 SQL 을 직접
-- 쓰되 인젝션 방어와 보여 줄 수 있는 범위를 정해 둔다). 보여 줄 수 있는 범위를 **DB 가** 정한다 — AI 롤(ai_user)은 이 뷰
-- 하나에만 SELECT 를 받고, 원본 poi·다른 표는 못 읽는다. 앱 쪽 SQL 검사(허용 열·키워드)가 뚫려도 여기서 막힌다.
--   · 뺀 열: opening_hours(시각 — INV-2, 사용자 시각은 조립 검증값만), source·source_ref(수집 내부값), image_url, data_status,
--     created_at·updated_at, lat·lng(좌표는 표시값이 아니다 — 거리는 AI 가 등록 좌표로 따로 잰다)
--   · ACTIVE 만 — 폐업·유실·미검증 행은 대답에 나오면 안 된다
--   · sido 는 주소 첫 낱말(서울특별시·제주특별자치도) — 시도 코드 표를 따로 두면 행정구역 개편(전남광주통합특별시)마다 어긋난다
-- security_barrier — 조회 쪽 함수가 뷰의 WHERE(ACTIVE)보다 먼저 돌아 걸러진 행을 엿보지 못하게 한다.
CREATE VIEW poi_public WITH (security_barrier) AS
SELECT poi_id,
       name_ko                    AS name,
       category,
       split_part(address, ' ', 1) AS sido,
       region                     AS sigungu,
       address,
       tags,
       saved_count
FROM poi
WHERE data_status = 'ACTIVE';

-- 운영 롤 생성·접속·읽기 전용·시한은 deploy/eks/bootstrap.sql(로컬은 backend/docker/init/00-roles.sql) 소관이다. 롤이 아직 없는
-- 환경(테스트 컨테이너 등)에서 이 마이그레이션이 깨지지 않게 있을 때만 준다 — 롤이 나중에 생기면 bootstrap 이 같은 GRANT 를 다시 한다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_user') THEN
    GRANT SELECT ON poi_public TO ai_user;
  END IF;
END
$$;
