-- 재계획 세션을 누가 열었나 — 미리 짜 둔 대안(situation-awareness BR-SA-18·19 · DEC-SA-4).
--
-- USER   = 사용자 진입(i04 제출 · 원탭 다시 짜기 · 도우미).
-- SYSTEM = 일정을 막는 위험 알림 사건(planb.PlanBTriggered)으로 서버가 미리 연 세션.
-- **적용은 여전히 사용자만 한다**(INV-U4-05 · INV-SA-1) — 이 칸은 '누가 계산을 시작했나'일 뿐이다.
--
-- 번호: origin/develop 최신이 V2.73(plan_b_situation)이다 — 머지 직전에 다시 맞춘다(설계서 CD13).
-- 확장형이다: 상수 기본값이라 기존 행은 USER 로 채워지고(그 전엔 사용자 진입뿐이었다 — 사실과 같다), 롤링 배포 창의
-- 옛 파드 INSERT 도 USER 가 된다(옛 파드는 사용자 진입만 만든다). V2.60 의 볼러틸 기본값 함정과 무관하다 — 상수다.
ALTER TABLE replan_session
  ADD COLUMN initiated_by varchar(6) NOT NULL DEFAULT 'USER'
    CONSTRAINT chk_replan_session_initiated_by CHECK (initiated_by IN ('USER', 'SYSTEM'));

-- 선계산은 늘 위험 트리거에서 출발한다 — 근거 없는 시스템 세션은 '왜 이 대안인가'를 잃는다(도메인 init 과 같은 규칙).
ALTER TABLE replan_session
  ADD CONSTRAINT chk_replan_session_system_trigger CHECK (initiated_by <> 'SYSTEM' OR trigger_id IS NOT NULL);

-- 트리거당 선계산은 한 번 — 아웃박스 재배달(at-least-once) 멱등의 마지막 방어선이다.
-- 사용자 세션은 같은 트리거로 몇 번이고 열 수 있다(앱이 다시 들어올 때마다) — 그래서 SYSTEM 에만 건다.
-- 열린 세션 1개(ux_replan_session_open · INV-U4-06)는 건드리지 않는다 — SYSTEM 도 그 1개에 든다.
CREATE UNIQUE INDEX ux_replan_session_system_trigger
  ON replan_session (trigger_id)
  WHERE initiated_by = 'SYSTEM';
