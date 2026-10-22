-- 도우미 미확인 장소 정보 웹 확인 결과 (UnknownHandlingAgent, 2026-10-22) — 컨테이너 최초 기동 1회.
-- DDL 정본은 둘이다: 여기(compose initdb)와 deploy/eks/bootstrap.sql(EKS 마스터 Job). 문장이 같아야 하며
-- deploy/eks/tests/test_runtime.py 가 둘을 대조한다. PgPlaceFactStore(agents/adapters/pg_place_fact_store.py)는 DML 만 소유한다.
-- 기존 볼륨에는 initdb 가 다시 돌지 않는다 — 이 파일을 ai-vectordb 에 수동 적용. GRANT 를 두지 않는 이유는 02 와 같다.
CREATE TABLE IF NOT EXISTS public.place_fact_cache (
  poi_id     text PRIMARY KEY,       -- 등록 POI id (BE poi.poi_id)
  facts      jsonb,                  -- {hours,last_entry,closed,fee,source_url,source_host} · null = 찾아봤지만 출처 있는 값 없음
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL    -- 찾음 +7일 · 못 찾음 +1일
);
