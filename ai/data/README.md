# ai/data — 의도 매칭 질문뱅크 데이터

`intent_question_bank.yaml`은 **최종 검수 전 seed 초안(v0.2 — 1차 검수 반영)**이다 — 검수 완료 전에는 임베딩·뱅크 편입 금지 (`reviewed: false` 유지).
검수 절차: 의도별 문장을 사람이 확인 → 의도 간 경계 문장 제거 → 뱅크 편입 시 타 의도 엔트리와 유사도 ≥ 0.90 중복 검사 통과 필수 (intent-matching-design §3.3).
평가셋과는 **완전 분리**한다: 여기 실린 문장(및 그 augment 변형)은 평가셋에 절대 재사용하지 않는다 — leak 금지 (intent-matching-design §6).
의도 라벨 정본은 `orchestrator-delegation-design.md` §5 라우팅 테이블 (closed-set 13종, CONFIRM/CANCEL/UNDO 제외).
