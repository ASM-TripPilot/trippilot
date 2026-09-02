# Agent Foundation — 비즈니스 로직 모델 (FD, 로드맵 스텝 ⓪)

## 0. 설계 축 — "봉투·포트·경계를 먼저, 에이전트는 나중에"

Edit·PlanB·Intent 3작업이 병렬 착수해도 충돌하지 않도록 **공유 규격(봉투 타입·벡터 포트·패키지 경계)만** 이 스텝에서 확정한다.
에이전트 구현 로직은 각 유닛 FD 소관 — 여기서는 자리(모듈 배치)와 규칙만 판다.

## 1. 모듈 배치 (신규 + 예약)

```
src/trippilot/
  domain/
    delegation.py      AgentTask·AgentResult·ContextRef·TaskConstraints·TaskError·TaskMetrics + spawn (본 스텝)
    freshness.py       FreshnessMeta·InfoPacket·InfoBundle·ProviderKind/Status (본 스텝)
  ports/
    embedding_port.py  EmbeddingPort (본 스텝)
    vector_store_port.py  VectorStorePort + VectorHit (본 스텝)
  agents/              ← 신규 상위 계층 (본 스텝: __init__ + base.py Protocol만. 구현은 각 유닛)
    base.py            Agent Protocol: handle(task: AgentTask) → AgentResult
    edit/ planb/ reflect/ schedule/     (각 유닛에서 추가 — 상호 import 금지)
  orchestrator/        (U5 예약 — InfoCollector 포함)
  providers/           (U5·U6 예약 — LLM 0회 계층)
  background/          (U6 예약 — 소싱 파이프라인·자율 트리거형, §5)
tests/fakes/
  fake_embedding.py    FakeEmbedding (본 스텝)
  in_memory_vector_store.py  InMemoryVectorStore (본 스텝)
```

## 2. parse_intent 소유권 충돌 해소

**충돌**: `agent-structure-v2.md` §3(85행)은 `llm.parse_intent`를 **Edit 전속 도구**로, `intent-matching-design.md` §4(124~126행)는
**Orchestrator의 3차 직접 분류 도구**로 배정 — 둘 다 유지하면 v2의 핵심 원칙(도구 겹침 0)이 깨진다.

| | 대안 A — 역할 분리 명문화 (추천) | 대안 B — Edit 전속 유지, Orchestrator 3차 제거 |
|---|---|---|
| 내용 | 의도 파악을 두 층으로 분리: **Orchestrator = 라우팅 의도 1회**(`llm.parse_intent` = feature `INTENT`, 3차 직접 분류) / **Edit = 편집 세부 해석 전용**(신규 도구 `llm.translate_edit` = feature `EDIT_TRANSLATION`) | Orchestrator는 질문뱅크 1·2차만 수행, UNKNOWN이면 즉시 Fallback(또는 EditAgent로 넘겨 해석) |
| 겹침 | 0 유지 — 도구·feature 모두 서로소 | 0이지만 LLM_DIRECT 경로(~10%) 상실 → FALLBACK율 급증, 또는 Edit가 라우팅 판단을 겸해 계층 침범 |
| DL-3 정합 | 정합 — Edit는 intent를 재해석하지 않고 이미 확정된 EDIT_SCHEDULE의 **세부만 번역** | 위반 소지 — "일단 Edit로 보내 해석"은 의도 해석 2회 |
| 비용 | feature 1종·프롬프트 1종 추가 | 없음 (대신 정확도 손실) |

**추천: 대안 A.** 명문화 문구 — "`llm.parse_intent`(feature INTENT)는 Orchestrator 전용 라우팅 도구, `llm.translate_edit`(feature
EDIT_TRANSLATION)는 EditAgent 전속 번역 도구. 전자는 의도 라벨+라우팅 슬롯을, 후자는 EditCommand 초안을 산출하며 서로의 출력을
덮어쓸 수 없다." → 정본 개정 필요 목록은 business-rules §4.

## 3. 봉투 수명 주기 (DL-1~5 재확인)

```
Orchestrator: 의도 파악 → 정보 요구표 조회 → Provider 병렬 수집(InfoBundle) → AgentTask 발행
Agent:        context_refs 재조회(D31) → 판단(전속 도구) → Proposal → AgentResult 회신
              정보 부족 → status=NEED_MORE_INFO (재수집·재위임 최대 1회 — 초과 시 업무 폴백)
Assembly 관문:  시각·순서 있는 Proposal만 통과 (Reflect 스킵) — 봉투 프로토콜 대상 아님 (delegation-design §8 [v2 보강])
```

- `context_refs` 재조회는 **Agent 소유**다 — 그래서 EditAgent가 호출하는 C1 워커(`EDIT_TRANSLATION`)는 ContextResolver를 거치지 않고 확정 입력만 받는다 (이중 재조회 금지, 워커별 소유 표는 u4 FD business-logic-model §3.1).
- 재위임(`spawn`)마다 deadline 차감이 타입에서 강제된다 (DeadlineExhaustedError) — SPEED-P1의 구조적 토대.
- Agent 경계에서 예외는 밖으로 나가지 않는다 — 전부 AgentResult 상태값으로 수렴 (DL-5). C1의 BR-U4-02와 동형.

## 4. EmbeddingPort / VectorStorePort + Fake (S1.2 확장)

```python
class EmbeddingPort(Protocol):
    dim: int                                                    # 1024 고정 (AI-D06 — e5-large/BGE-M3)
    def embed(self, text: str) -> tuple[float, ...]: ...        # len == dim 보장
    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]: ...

class VectorStorePort(Protocol):
    def upsert(self, collection: str, item_id: str, vector: tuple[float, ...], payload: dict) -> None: ...
    def search(self, collection: str, vector: tuple[float, ...], top_k: int) -> tuple[VectorHit, ...]: ...
    def delete(self, collection: str, item_id: str) -> None: ...
```

- collection 초기 3종: `intent_bank`(EP-8) · `persona`(KB-2) · `poi_desc`. 실 구현은 pgvector (U6) — 포트는 stdlib만 (아키텍처 테스트 기존 규칙이 자동 커버).
- **FakeEmbedding — 결정론 해시 벡터**: `sha256(text)` → `random.Random(seed)` → 가우시안 `dim`개 → L2 정규화.
  성질: ① 같은 텍스트 → 같은 벡터 ② 차원 = dim(기본 1024) ③ 단위 노름 ④ 외부 의존 0 (stdlib만, D37).
  **한계 명시**: 해시 기반이라 의미 유사도 없음 — 유사도 시나리오 테스트(질문뱅크 T_high/T_mid 판정 등)는
  InMemoryVectorStore에 **벡터를 직접 주입**해 구성한다. FakeEmbedding은 "동일 텍스트 매칭·왕복·차원" 검증 전용.
- **InMemoryVectorStore**: dict 보관 + 코사인 전수 스캔. top-k는 score 내림차순, 동점은 item_id 사전순 — 결정론.

## 5. Background Agent 유형 정의 (자율 트리거형)

대상: 소싱 파이프라인(U6, AI-D03 — 정본에 존재) + TripReadiness·FreshnessCurator(팀 로드맵 유래 — **요구사항 정본 부재**, 미결 #6).

**지위 (제안)**: v2의 "Agent 4종" 제한은 **Orchestrator 라우팅 테이블의 대화형 위임 대상**에 한정된 규칙으로 재해석하고,
자율 트리거형은 **별도 범주 "Background(자율 트리거형)"** 로 둔다. Agent 4종에 편입하지 않는 이유:
사용자 발화로 기동되지 않으므로 라우팅 테이블·의도 파악 대상이 아니고, 편입 시 v2 용어 규칙(4종)과 정보 요구표가 오염된다.

| 항목 | Background 규칙 |
|---|---|
| 기동 | 스케줄/이벤트 트리거 — 라우팅 테이블 밖. `issued_by=BACKGROUND_TRIGGER`, `priority=BACKGROUND` |
| 봉투 | AgentTask/AgentResult **재사용** (DL-1) — 재시도 1회 허용(delegation-design §6 background 정책 기존 그대로) |
| LLM | 허용하되 LlmFeature closed-set 한정 (현행 `PLACE_EXTRACTION` 1종. 추가는 §1 개정 절차 — 상한은 미결 #5) |
| INV-1 | 소싱 게이트 5단 경유 후 M7 등록분만 후보 자격 (v2 §2 그대로) |
| INV-2 | 해당 없음 — 사용자 표시 시각·순서를 만들지 않는다. 만들게 되는 순간 Assembly 관문 필수로 승격 |
| 패키지 | `src/trippilot/background/` — agents/와 분리 (라우팅 대상 아님을 구조로 표현) |

## 6. agents/ 패키지 경계 규칙 + 아키텍처 테스트 추가

기존 `c1 ↛ c2·m7`(BR-U4-09)은 "C1은 판단 재료 제공자"라는 경계였다 — **그 조립 지점이 agents다.**
agents는 c1·c2·m7·domain·ports를 모두 조립할 수 있는 유일한 상위 계층이며, 역방향은 금지.

| # | 규칙 | 구조적 의미 |
|---|---|---|
| L-1 | domain·ports·c1·c2·m7 → `trippilot.agents`(및 orchestrator/providers/background) import 금지 | 하위 계층은 상위를 모른다 |
| L-2 | agents/<a> ↛ agents/<b> (형제 상호 import 금지, 공용은 agents/base 또는 domain으로) | Agent 간 직접 호출 금지 — Orchestrator 경유만 |
| L-3 | agents → `trippilot.ports.llm_port` 직접 import 금지 | LLM은 C1 게이트웨이 경유만 — 4겹 장치 우회 차단 |
| L-4 | agents → providers import 금지 (예약) | 정보는 InfoBundle 봉투로만 (v2 §3 "Provider 직접 호출 금지") |
| L-5 | providers → `trippilot.c1` import 금지 (예약) | Provider LLM 0회를 구조로 강제 (v2 §1) |

`tests/test_architecture.py` 보강 (기존 AST 검사 패턴 재사용):
`test_lower_layers_do_not_import_agent_layer`(L-1) · `test_agents_do_not_cross_import`(L-2) ·
`test_agents_do_not_import_llm_port`(L-3). L-4·L-5는 해당 패키지 생성 유닛(U5·U6)에서 활성화하되 규칙 번호는 본 문서가 정본.
기존 규칙(ortools→c2 한정, anthropic→c1/adapters 한정, yaml→c1/prompts 한정)은 rglob 기반이라 agents에도 자동 적용된다.

## 7. 테스트 전략

| 대상 | 도구 |
|---|---|
| 봉투 직렬화 왕복·불변식 | hypothesis generator 신규 (`tests/generators/delegation.py`) — U5-P10 패턴 재사용 |
| deadline 차감 (SPEED-P1) | spawn 반복 적용 PBT — 단조 감소·소진 시 예외 |
| FakeEmbedding·InMemoryVectorStore | 결정론·차원·노름·top-k 정렬 PBT |
| 경계 | test_architecture.py 보강 3종 (§6) |
