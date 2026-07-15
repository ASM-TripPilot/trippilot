# aidlc-docs — AI-DLC 워크플로우 산출물

이 디렉토리는 AI-DLC(AI-Driven Development Life Cycle) 프로세스의 **모든 문서 산출물**을 보관합니다.
절대로 이 폴더에 application code를 넣지 마세요.

## 구조

- `aidlc-state.md` — 현재 워크플로우 진행 상태 (세션 재개 시 이것부터 읽기)
- `audit.md` — 전체 인터랙션 감사 로그
- `inception/` — INCEPTION Phase 산출물 (설계·요구사항·계획)
- `construction/` — CONSTRUCTION Phase 산출물 (유닛별 상세 설계·코드 요약)
- `operations/` — OPERATIONS Phase (placeholder)

## 규칙

- 새 파일 생성 전 `aidlc-state.md`의 현재 단계를 확인
- 모든 변경은 `audit.md`에 타임스탬프와 함께 기록
- 단계별 승인 없이 다음 단계로 넘어가지 않음
