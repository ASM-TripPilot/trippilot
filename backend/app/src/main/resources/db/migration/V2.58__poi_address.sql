-- V2.58 POI 주소 컬럼(TRIP-1062 · 1003 F · 824 의 address 몫) — 수집 provenance.address 를
-- 지역 코드 해석에만 쓰고 버려서 화면(탐색 목록·d06 상세)이 보일 주소가 없었다(QA #021 표기 모호).
-- 번호: V2.57 은 TRIP-1059(PR #791)가 쓴다. 기존 행은 null 로 남고 매일 도는 수집(ai-poi-collect)의
-- 갱신 경로가 재수집분부터 채운다 — 재수집 없이 채울 원천이 서버에 없다(지어내지 않는다).
ALTER TABLE poi ADD COLUMN address varchar(300);
