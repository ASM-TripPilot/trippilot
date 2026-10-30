-- Executed only by the temporary RDS master Job. Never put passwords into this file.
\set ON_ERROR_STOP on
\set ECHO none
\getenv db_password DB_PASSWORD
\getenv migrate_password DB_MIGRATE_PASSWORD
\getenv ai_password AI_DB_PASSWORD

SELECT format('CREATE ROLE %I LOGIN', role_name)
FROM (VALUES ('app_user'), ('app_migrate'), ('ai_user')) AS roles(role_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) \gexec
SELECT format('ALTER ROLE app_user PASSWORD %L', :'db_password') \gexec
SELECT format('ALTER ROLE app_migrate PASSWORD %L', :'migrate_password') \gexec
SELECT format('ALTER ROLE ai_user PASSWORD %L', :'ai_password') \gexec

-- PostgreSQL 16 role administration does not implicitly grant SET ROLE.
SELECT format('GRANT app_migrate TO %I WITH SET TRUE', current_user) \gexec

-- RDS creates trippilot. Flyway remains the schema migration owner.
REVOKE CONNECT, TEMPORARY ON DATABASE trippilot FROM PUBLIC;
GRANT CONNECT ON DATABASE trippilot TO app_user, app_migrate;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate;
GRANT USAGE ON SCHEMA app TO app_user;
ALTER ROLE app_user IN DATABASE trippilot SET search_path = app;
ALTER ROLE app_migrate IN DATABASE trippilot SET search_path = app;
-- AI 장소 조회(도우미 NL2SQL): ai_user 는 app.poi_public 뷰 SELECT 만 — 뷰가 보여 줄 수 있는 열·행을 정한다(Flyway V2.77).
-- 읽기 전용·문장 시한은 롤에 박는다(AI 쪽 SQL 검사가 뚫려도 쓰기·장시간 조회가 여기서 막힌다). 뷰 GRANT 는 Flyway 도 하지만
-- 마이그레이션이 이 Job 보다 먼저 돈 환경(롤이 그때 없었다)을 위해 뷰가 있으면 여기서도 준다 — 순서와 무관하게 같은 결과.
GRANT CONNECT ON DATABASE trippilot TO ai_user;
GRANT USAGE ON SCHEMA app TO ai_user;
ALTER ROLE ai_user IN DATABASE trippilot SET search_path = app;
ALTER ROLE ai_user IN DATABASE trippilot SET default_transaction_read_only = on;
ALTER ROLE ai_user IN DATABASE trippilot SET statement_timeout = '2s';
SELECT 'GRANT SELECT ON app.poi_public TO ai_user' WHERE to_regclass('app.poi_public') IS NOT NULL \gexec

SELECT 'CREATE DATABASE ai_kb' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ai_kb') \gexec
REVOKE CONNECT, TEMPORARY ON DATABASE ai_kb FROM PUBLIC;
GRANT CONNECT ON DATABASE ai_kb TO ai_user;
\connect ai_kb
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS public.kb_vectors (
  collection text NOT NULL,
  item_id text NOT NULL,
  embedding vector(1024) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (collection, item_id)
);
GRANT USAGE ON SCHEMA public TO ai_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_vectors TO ai_user;
-- Assistant session memory (assistant-orchestrator FD DE §4). Same statements as the compose
-- canon ai/docker/vector-init/02-dialogue-memory.sql (deploy/eks/tests compares them); the
-- adapter does DML only, so this Job is the only place the table is created on EKS.
CREATE TABLE IF NOT EXISTS public.dialogue_memory (
  session_id            text PRIMARY KEY,      -- backend assistant_session.session_id
  account_ref           text,                  -- backend account id (opaque string, never logged)
  trip_id               text,
  summary               jsonb NOT NULL DEFAULT '[]',   -- <= 20 lines of <= 120 chars (LLM summary or deterministic compress)
  summarized_turn_index integer NOT NULL DEFAULT 0,    -- last turn_index this summary covers
  updated_at            timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL           -- updated_at + 90 days (same as backend DATA-U8-01, extended on write)
);
CREATE INDEX IF NOT EXISTS ix_dialogue_memory_account ON public.dialogue_memory (account_ref, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_dialogue_memory_trip ON public.dialogue_memory (trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialogue_memory TO ai_user;
-- Line embeddings of that memory (2026-10-23 — recall only the lines related to the utterance). Rows follow
-- dialogue_memory (ON DELETE CASCADE), so the three backend deletes and the TTL purge reach them too.
CREATE TABLE IF NOT EXISTS public.dialogue_memory_vectors (
  session_id text NOT NULL REFERENCES public.dialogue_memory (session_id) ON DELETE CASCADE,
  line       text NOT NULL,                 -- one line of that session's summary, verbatim
  model      text NOT NULL,                 -- embedding model id; a new model leaves old vectors unmatched until the next summary
  embedding  vector(1024) NOT NULL,
  PRIMARY KEY (session_id, line)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialogue_memory_vectors TO ai_user;
-- Assistant unknown-fact web lookups (UnknownHandlingAgent, 2026-10-22). DDL canon is shared with
-- ai/docker/vector-init/03-place-fact-cache.sql (deploy/eks/tests compares them); the adapter does DML only.
CREATE TABLE IF NOT EXISTS public.place_fact_cache (
  poi_id     text PRIMARY KEY,       -- registered POI id (backend poi.poi_id)
  facts      jsonb,                  -- {hours,last_entry,closed,fee,source_url,source_host,searched=fields looked up} | {searched} only = looked up, nothing sourced (null before 2026-10-30)
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL    -- found +7d | not found +1d
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.place_fact_cache TO ai_user;
