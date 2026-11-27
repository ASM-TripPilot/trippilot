-- 이전 전후 대조용 — 스키마의 모든 테이블 행 수. psql -v schema=app -At -f counts.sql
SELECT table_name || ' ' || (xpath('/row/c/text()',
         query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = :'schema' AND table_type = 'BASE TABLE'
ORDER BY 1;
