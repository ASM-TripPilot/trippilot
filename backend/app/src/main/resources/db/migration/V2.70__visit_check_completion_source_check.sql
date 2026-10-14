-- 방문 실적 완료 출처 **2단계** — 재백필 + CHECK(U10 M-U10-a, TRIP-1408).
--
-- V2.70 — 최신(V2.69) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-14).
--
-- 1단계(V2.67)는 CHECK 없이 나갔다 — 롤링 창의 옛 파드가 출처 없이 완료를 쓰기 때문이다. 그 배포(develop 94fd896f, 2026-10-14
-- 성공)가 끝나 옛 파드는 없다. 그 창에 옛 파드가 쓴 완료를 MANUAL 로 다시 채우고(V2.67 과 같은 문), 그다음 INV-U10-3 을 DB 로 건다.
-- 이 배포의 롤링 창에 남는 파드는 V2.67 이후 코드라 완료마다 출처를 채운다(I-U10-2) — CHECK 가 그 쓰기를 거절하지 않는다.

UPDATE visit_check SET completion_source = 'MANUAL' WHERE completed_at IS NOT NULL AND completion_source IS NULL;

-- 완료 ⇔ 출처(INV-U10-3). 되돌리기(BR-U10-31)는 둘을 함께 비운다.
-- ponytail: 표 전체를 잠그고 한 번 훑는다 — 방문 실적은 작다. 커지면 NOT VALID 로 걸고 VALIDATE 를 따로 돌린다.
ALTER TABLE visit_check ADD CONSTRAINT visit_check_completion_source_iff_completed
  CHECK ((completed_at IS NULL) = (completion_source IS NULL));
