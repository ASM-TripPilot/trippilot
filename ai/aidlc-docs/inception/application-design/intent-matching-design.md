# 의도 파악 고도화 — 유사 질문 매칭 하이브리드 설계

> **배선 상태 (2026-08-25 기준): 본 설계는 구현돼 있으나 프로덕션 경로에 미배선이다.**
> `orchestrator/intent_router.py`(`IntentRouter`)·`orchestrator/question_bank.py`·
> `data/intent_question_bank.yaml`·프롬프트 `intent.yaml`/`paraphrase.yaml`·게이트 2종은 실재하고
> 테스트도 green 이지만, **프로덕션 호출자가 0이다** — `api/wiring.py` 는 `IntentRouter` 를 import 하지
> 않고, 열려 있는 경계 3종(`/ai/v1/itinerary/{generate,validate,repair}`)은 의도를 인자로 받지 않는다.
> 즉 아래 3단 파이프라인은 **어느 요청 경로에서도 실행되지 않는다.**
> 자연어 진입점(도우미 대화 경계)이 열릴 때 배선된다. `agents/planb/kb_retrieval.py`·`agents/planb/rag.py`
> 의 `IntentRouter`·`question_bank` 언급은 **구조를 본떴다는 주석 인용**이지 호출이 아니다.

> 사용자가 AI 도우미에 자연어를 입력했을 때, **의도별 대표 질문 뱅크와의 유사도 매칭(1차)** + **저신뢰 시 LLM 유사 질문 생성·투표(2차)** 로 의도 파악 정확도를 높인다.
> Orchestrator의 "의도 파악" 단계(`orchestrator-delegation-design.md` §4.1의 1번)를 구체화하는 설계.

---

## 1. 문제와 접근

현재 설계의 의도 파악은 `llm.parse_intent`(경량 LLM) 단발 호출이다. 문제:

1. **표현 다양성** — "일정 좀 바꿔줘 / 오늘 계획 수정 / 지금 스케줄 갈아엎자"가 같은 의도임을 LLM 1회 판단에만 의존
2. **경계 모호** — EDIT_SCHEDULE vs REPLAN vs GENERATE_SCHEDULE의 경계 사례에서 오라우팅 → 엉뚱한 에이전트 위임(비싼 실패)
3. **개선 불가** — 오분류가 발생해도 축적·보정하는 구조가 없음

**접근**: 의도마다 "그 의도로 확정된 질문들"의 뱅크를 만들고, 입력 질문을 뱅크와 임베딩 유사도로 대조한다. 유사도가 확실하면 LLM 없이 즉시 라우팅(빠르고 저렴), 애매하면 LLM이 입력의 유사 질문 여러 개를 생성해 각각 재대조하고 투표로 결정한다.

---

## 2. 전체 파이프라인

```
사용자 자연어 입력
      |
      v
[0. 전처리] 정규화 (공백·이모지·오타 경량 교정)
      |
      v
[1차. 질문뱅크 매칭 — 임베딩 유사도]
      입력 임베딩(Titan v2) → pgvector 질문뱅크 top-k(k=5) 검색
      |
      +-- top1 유사도 ≥ T_high(0.88) 그리고 top1·top2 의도 일치
      |        → 의도 확정 (LLM 0회, ~수십 ms)          [CONFIDENT]
      |
      +-- top1 유사도 ≥ T_mid(0.75) 그러나 상위권 의도 혼재
      |        → 2차로                                   [AMBIGUOUS]
      |
      +-- top1 유사도 < T_mid
               → 3차로 (뱅크에 없는 새 유형)              [UNKNOWN]
      |
      v
[2차. LLM 유사 질문 생성 + 재매칭 투표]  (AMBIGUOUS 전용)
      llm.paraphrase_query: 입력과 같은 뜻의 질문 N=3개 생성 (경량 모델, 1회 호출)
      → 원문 + 유사질문 3개 = 4개를 각각 뱅크 재매칭
      → 의도별 가중 투표 (유사도를 가중치로)
      |
      +-- 최다 득표 의도의 득표율 ≥ 60% → 의도 확정      [VOTED]
      +-- 미달 → 3차로
      |
      v
[3차. LLM 직접 분류]  (UNKNOWN / 투표 실패)
      llm.parse_intent: 의도 라벨 + 슬롯 직접 추출 (closed-set 라벨 강제 — INV-1과 동형)
      |
      +-- 성공 → 의도 확정 + **뱅크 보강 후보로 로깅**    [LLM_DIRECT]
      +-- 실패/타임아웃 → Orchestrator Fallback 모드      [FALLBACK]
                          (기본 응답 + 수동 편집 안내, INV-4)
      |
      v
[슬롯 추출]
      CONFIDENT/VOTED: 매칭된 대표 질문의 슬롯 패턴 + 정규식/규칙 추출
                       (부족하면 llm.parse_intent를 슬롯 전용으로 1회)
      LLM_DIRECT: 이미 함께 추출됨
      |
      v
AgentTask 발행 (intent + slots + confidence + match_route)
```

### 경로별 특성

| 경로 | LLM 호출 | 예상 지연 | 예상 비중(목표) |
|---|---|---|---|
| CONFIDENT (1차) | 0회 | < 50ms | ≥ 70% |
| VOTED (2차) | 1회 (경량) | ~1s | ~20% |
| LLM_DIRECT (3차) | 1회 (경량) | ~1.5s | ~10% |
| FALLBACK | — | 즉시 | < 1% |

AI 도우미 첫 응답 예산 3초(D38) 안에 전 경로가 수렴한다. 2차와 3차가 연쇄되는 최악 경로도 경량 모델 2회 ≈ 2s.

---

## 3. 질문뱅크 (Intent Question Bank)

### 3.1 스키마

```python
@dataclass
class IntentBankEntry:
    entry_id: str
    intent: str                  # 라우팅 테이블의 closed-set 라벨 (orchestrator-delegation-design.md §5)
    question: str                # 대표 질문 원문
    embedding: list[float]       # Titan v2, 1024차원 (pgvector)
    slot_pattern: dict | None    # 이 질문형에서 슬롯을 뽑는 규칙 (예: {"date": "regex:오늘|내일|모레"})
    origin: str                  # seed | augmented | mined  (수집 경로)
    hit_count: int               # 런타임 매칭 횟수 (뱅크 관리용)
    created_at: str
    active: bool                 # 오분류 유발 엔트리 비활성화
```

- 저장소: **pgvector** — PlanB RAG와 동일 인프라 재사용 (신규 컴포넌트 없음)
- 임베딩: **Titan Embeddings v2** — 기존 선택 그대로

### 3.2 구축 3단계

| 단계 | 방법 | 규모(초기 목표) |
|---|---|---|
| ① Seed | 라우팅 테이블의 intent별로 설계자가 대표 질문 5~10개 수기 작성 (Fast Path 의도 포함 전부) | 의도 13종 × ~8개 ≈ 100개 |
| ② Augment (오프라인) | LLM으로 seed당 변형 5~10개 생성 — 존댓말/반말, 축약, 오타형, 방언 톤. **생성 후 사람 검수 필수** (오염 방지) | ≈ 500~1,000개 |
| ③ Mine (운영) | 런타임 LLM_DIRECT로 확정된 입력 + 오분류 신고 건을 후보 큐에 적재 → 주기 검수 → 뱅크 편입 | 지속 성장 |

③이 **의도 파악의 성장 루프**다: 뱅크가 커질수록 CONFIDENT 비중이 올라 LLM 비용·지연이 줄어든다. 운영 절차는 `mlops-llmops-design.md`(평가·재학습 루프)에 통합.

### 3.3 뱅크 위생 규칙

- **의도 간 중복 검사**: 신규 엔트리 추가 시 다른 의도의 기존 엔트리와 유사도 ≥ 0.90이면 편입 거부(경계 오염 방지)
- **혼동 유발 엔트리 격리**: 오분류 로그에서 반복 등장하는 엔트리는 `active=false`
- **버전 관리**: 뱅크 스냅샷에 버전 부여 — 평가셋 성능 회귀 시 롤백 (프롬프트 버전 관리와 동일 체계)

---

## 4. 신규 도구 정의

| 도구 | 소유 | 설명 |
|---|---|---|
| `intent.match_bank` | Orchestrator 전용 | 입력 임베딩 → pgvector top-k → {intent, similarity, entry_id}[] |
| `llm.paraphrase_query` | C1 (경량) | 입력과 동일 의미의 질문 N개 생성. OutputSchema 강제(JSON 배열), 타임아웃 1.5s |
| `llm.parse_intent` | C1 (경량) | (기존) 3차 직접 분류 + 슬롯 추출. 의도 라벨은 closed-set 강제 |

`llm.paraphrase_query` 프롬프트 요건: 의미 보존(정보 추가 금지), 여행 도메인 어휘 유지, 길이 ±50% 이내 — 상세 프롬프트는 `ai-prompt-design.md`에 추가할 것(P2 후속).

---

## 5. 판정 파라미터 (초기값 — 평가셋으로 튜닝)

| 파라미터 | 초기값 | 설명 |
|---|---|---|
| `k` | 5 | 뱅크 top-k |
| `T_high` | 0.88 | 1차 즉시 확정 임계 |
| `T_mid` | 0.75 | 2차 진입 하한 |
| `N_paraphrase` | 3 | 유사 질문 생성 수 |
| `vote_ratio` | 0.60 | 가중 투표 확정 임계 |

임계값은 하드코딩하지 않고 설정으로 분리 — 오프라인 평가셋(§6)에서 정확도/지연 트레이드오프를 보고 조정한다.

---

## 6. 평가 — 의도 파악 자체의 품질 게이트

| 항목 | 내용 |
|---|---|
| 평가셋 | 의도별 라벨링 질문 (seed와 분리 수집, 뱅크 미포함 질문으로 구성 — leak 금지) |
| 핵심 지표 | intent accuracy(전체/의도별), 경로별 비중(CONFIDENT/VOTED/LLM_DIRECT), FALLBACK율, p95 지연 |
| 혼동 행렬 | EDIT vs REPLAN vs GENERATE 경계 3종을 중점 추적 |
| 게이트 | 뱅크·임계값·프롬프트 변경 시 평가셋 재실행 → accuracy 회귀하면 머지 불가 (CI, D37: LLM은 fake/기록 재생) |
| PBT 연계 | "매칭 결과 intent는 항상 closed-set 라벨" 속성 추가 (기존 PBT 19속성에 +1) |

---

## 7. 불변식·기존 설계와의 정합

| 항목 | 정합성 |
|---|---|
| INV-1 | 의도 라벨도 closed-set — 뱅크·parse_intent 모두 라우팅 테이블 라벨만 반환 가능 |
| INV-4 | 3차까지 실패 → Orchestrator Fallback 모드(기존 경로). 침묵 실패 없음 |
| Fast Path | CONFIDENT로 확정된 단순 의도는 그대로 Fast Path 진입 — 오히려 Fast Path 판정이 빨라짐 |
| D31 | 매칭은 의도만 결정 — 데이터는 여전히 context_refs 재조회 |
| M16(AI 도우미) 부재 | 현재 자연어 진입점은 EditAgent 자연어 편집뿐. 본 설계는 진입점과 무관하게 Orchestrator 앞단에 위치하므로, M16(타 팀) 합류 시 그대로 적용 |
