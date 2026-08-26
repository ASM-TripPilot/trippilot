-- 방문 메모(U5 · TRIP-542). 한 방문에 **한 개**(BR-U5-13).
--
-- 번호 근거: V2.33 주석 참조.
--
-- **왜 `visit_check` 컬럼이 아니라 별도 테이블인가.** 메모는 방문보다 늦게 오고 자주 고쳐진다.
-- 실적 행에 붙이면 메모를 고칠 때마다 `visit_check.updated_at` 이 갱신돼 **오프라인 충돌 판정이 오염된다**
-- (BR-U5-22). "언제 방문 사실이 바뀌었나"와 "언제 감상을 고쳤나"는 다른 질문이다.

CREATE TABLE visit_memo (
  visit_check_id uuid PRIMARY KEY REFERENCES visit_check(visit_check_id) ON DELETE CASCADE,
  text           varchar(2000) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
