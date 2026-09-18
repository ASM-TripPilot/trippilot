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
