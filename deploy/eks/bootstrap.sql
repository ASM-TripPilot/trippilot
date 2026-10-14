-- Executed only by the temporary RDS master Job. Never put passwords into this file.
\set ON_ERROR_STOP on
\set ECHO none
\getenv db_password DB_PASSWORD
\getenv migrate_password DB_MIGRATE_PASSWORD
\getenv ai_password AI_DB_PASSWORD
-- 배포 대상(prod·dev)의 DB·역할 이름(runtime.TARGETS). prod 는 출시 때 이름 그대로다.
-- Postgres 역할은 장비 단위라 대상마다 이름이 달라야 한다 — 개발 역할은 운영 DB 에 CONNECT 권한이 없다.
\getenv app_db APP_DB
\getenv kb_db KB_DB
\getenv app_user APP_USER
\getenv migrate_user MIGRATE_USER
\getenv ai_user AI_USER

SELECT format('CREATE ROLE %I LOGIN', role_name)
FROM (VALUES (:'app_user'), (:'migrate_user'), (:'ai_user')) AS roles(role_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app_user', :'db_password') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'migrate_user', :'migrate_password') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'ai_user', :'ai_password') \gexec

-- PostgreSQL 16 role administration does not implicitly grant SET ROLE.
SELECT format('GRANT %I TO %I WITH SET TRUE', :'migrate_user', current_user) \gexec

-- RDS creates trippilot (prod). Other targets' databases are created here. Flyway remains the schema migration owner.
SELECT format('CREATE DATABASE %I', :'app_db') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db') \gexec
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'app_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'app_db', :'app_user', :'migrate_user') \gexec
\connect :"app_db"
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION %I', :'migrate_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA app TO %I', :'app_user') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET search_path = app', :'app_user', :'app_db') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET search_path = app', :'migrate_user', :'app_db') \gexec

SELECT format('CREATE DATABASE %I', :'kb_db') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'kb_db') \gexec
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'kb_db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'kb_db', :'ai_user') \gexec
\connect :"kb_db"
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS public.kb_vectors (
  collection text NOT NULL,
  item_id text NOT NULL,
  embedding vector(1024) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (collection, item_id)
);
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'ai_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_vectors TO %I', :'ai_user') \gexec
