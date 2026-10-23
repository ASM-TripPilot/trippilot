-- 격자 예보 캐시의 날짜별 최저·최고(daily — TMN·TMX) 칸을 지운다 — 2단계(1단계 V2.81 은 기본값만 두었다).
--
-- V2.86 — 작성 시 origin/develop 최댓값 V2.85(share_card_copy_usage) + 1. 열린 PR 에 마이그레이션이 없다(2026-10-23).
--
-- 코드는 #1540(situation-awareness G-SA-15 결정 2026-10-20 — 한파·폭염은 시간별 TMP 만)부터 이 칸을 매핑하지 않는다 — 읽지도
-- 쓰지도 않는다. V2.81 과 그 코드가 운영까지 나간 뒤라(2026-10-23 운영 승격 — V2.78→V2.85) 이 칸을 아는 파드는 없다. 롤링 배포
-- 창의 옛 파드(V2.85 코드)도 이 칸을 모르므로 지워도 무해하다. 담긴 값은 캐시라 버려도 된다.
ALTER TABLE weather_grid_forecast DROP COLUMN daily;
