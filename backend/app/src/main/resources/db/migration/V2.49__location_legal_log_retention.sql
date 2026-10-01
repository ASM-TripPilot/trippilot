-- V2.49 위치 확인자료 보존기간 정합(TRIP-881) — 약관 "기록 시점부터 6개월"(위치정보법 제16조②)과
-- 코드를 맞춘다. 약관이 6개월이라 말하는데 테이블이 영구 보존이면 약관이 거짓말이 된다.
--
-- location_legal_log 는 append-only 다(V1.7 — app_user 의 UPDATE/DELETE 회수, INV-LL1).
-- 그 취지(앱은 증적을 임의로 지울 수 없다)를 깨지 않고 만료분만 정리하기 위해 **삭제 로직을
-- 고정한 SECURITY DEFINER 함수** 하나만 연다: 소유자(app_migrate) 권한으로 돌지만 지울 수 있는
-- 것은 "기록 6개월 경과" 행뿐이고, app_user 에게는 이 함수의 EXECUTE 만 준다. 함수에 조건
-- 인자가 없으므로 임의 조건 삭제는 여전히 불가능하다.
--
-- 6개월은 하드코딩이다 — 법정 기준값이라 설정으로 뺄 이유가 없고, 법이 바뀌면 마이그레이션으로
-- 바꾸는 것이 맞다(값의 변경 이력이 스키마 이력에 남는다).
--
-- SET search_path: SECURITY DEFINER 는 호출자의 search_path 를 물려받으므로 고정하지 않으면
-- 같은 이름의 객체를 끼워 넣는 공격 표면이 된다(정의자 함수 표준 위생).
CREATE OR REPLACE FUNCTION purge_expired_location_legal_log()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
    WITH purged AS (
        DELETE FROM location_legal_log
         WHERE occurred_at < now() - interval '6 months'
         RETURNING 1
    )
    SELECT count(*)::integer FROM purged;
$$;

REVOKE ALL ON FUNCTION purge_expired_location_legal_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_location_legal_log() TO app_user;
