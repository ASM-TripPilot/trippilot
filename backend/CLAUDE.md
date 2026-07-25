# backend/CLAUDE.md — 백엔드 코딩 규율

> `backend/`에서 작업할 때 루트 `CLAUDE.md`에 **더해** 로드된다(더 구체적인 이 파일이 우선).
> 출처: Andrej Karpathy 관찰 기반 LLM 코딩 규율 — https://github.com/multica-ai/andrej-karpathy-skills. 우리 스택(Kotlin·Spring·hexagonal·PBT)에 맞춰 반영.
> **트레이드오프**: 속도보다 신중함으로 치우친 규율. 사소한 작업엔 판단으로.

## 1. Think Before Coding — 짐작 말고, 헷갈리면 멈춰라
- 가정을 **명시**한다. 불확실하면 묻는다.
- 해석이 여럿이면 **다 제시**하고, 조용히 하나 고르지 않는다.
- 더 단순한 방법이 있으면 말한다. 필요하면 반박한다.
- 불명확하면 멈추고, 무엇이 헷갈리는지 이름 붙여 묻는다.

## 2. Simplicity First — 문제만 푸는 최소 코드
- 요청 범위 밖 기능 금지 · 단일 사용처에 추상화 금지.
- 요청 안 한 "유연성·설정화" 금지 · 불가능한 시나리오 방어 코드 금지.
- 200줄인데 50줄이면 다시 쓴다. "시니어가 과하다 할까?" → 그렇다면 단순화.
- (우리 맥락) 모듈 경계·포트·이벤트는 **설계상 실제로 필요할 때만**. 스텁에 캐시·서킷 미리 붙이지 않는다(→ `anti-patterns.md`).

## 3. Surgical Changes — 필요한 것만 건드린다
- 인접 코드·주석·포맷 "개선" 금지 · 안 깨진 것 리팩터 금지.
- **기존 스타일에 맞춘다**(내 취향과 달라도) — 주변 모듈(auth/profile)의 관례를 따른다.
- 무관한 dead code는 **삭제 말고 언급**.
- 내 변경이 만든 orphan(안 쓰게 된 import/변수/함수)만 정리.
- 테스트: **바뀐 모든 줄이 요청에 직접 추적**되는가.

## 4. Goal-Driven Execution — 검증가능 목표로 바꿔 루프  ★우리 강화 포인트
작업을 검증가능한 목표로 변환한다:
- "검증 추가" → "잘못된 입력에 대한 테스트를 쓰고 통과시킨다"
- "버그 수정" → "재현 테스트를 먼저 쓰고 통과시킨다"
- "X 리팩터" → "전·후로 테스트가 통과함을 보장한다"

다단계 작업은 짧은 계획 + 각 단계 verify:
```
1. [단계] → verify: [확인]
2. [단계] → verify: [확인]
```
(우리 맥락) verify의 실체 = **Kotest PBT 게이트 · ArchUnit/Konsist · SchemaMigrationIT · 전체 컨텍스트 부팅(JPA validate)**. 강한 성공기준이 있어야 독립적으로 루프한다("동작하게 해줘" 같은 약한 기준은 계속 되묻게 만든다).

---
## 우리 규칙과의 관계 (충돌 아님)
- **1~3은 루트 `CLAUDE.md`의 "Coding behavior baseline"과 같은 취지 — 더 구체화**한 것.
- **4가 순수 추가분** — 목표를 테스트로 바꿔 검증 루프. 우리 PBT 게이트·8단계 워크플로우(3 테스트시나리오 · 6·7 테스트)와 정합.
- 세부: `docs/conventions/anti-patterns.md`(하지 말 것) · `workflow-8steps.md`(절차) · 모듈 경계 R1~R6(ArchUnit/Konsist) · `backend/docs/design/`(설계 정본).
