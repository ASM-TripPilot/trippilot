# LangChain 부분 도입 — 적용 범위 및 이유

> LangChain을 전체 적용하지 않고, **도움이 되는 부분에만** 국한하여 사용한다.
> 나머지는 직접 구현하여 프레임워크 종속을 방지한다.

---

## ⚠️ 실측 후 판정 (2026-09-02, TRIP-522) — **아래 "적용 O" 는 구현되지 않았다**

이 문서는 INCEPTION 단계의 계획이다. CONSTRUCTION 에서 실제로 넣어 보고 **재봤더니
값이 없어서 되돌렸다.** 현재 코드에 LangChain 의존성은 **0** 이다.

| 계획 | 실제 | 왜 |
|---|---|---|
| `RetrievalQA` 로 RAG 파이프라인 | **미적용** | 우리 파이프라인에는 `closed_set_filter`(INV-1 2겹)·3단 결정론 폴백(INV-4)·reason 강등·저장장소 우선이 들어 있다. `RetrievalQA` 에는 이 다섯을 끼울 자리가 없다 — **불변식을 강제하는 코드가 프레임워크 안으로 숨으면 그게 설계 붕괴다.** "직접 짜면 100줄+, LangChain이면 5줄"은 평범한 RAG 기준이고 우리는 그 모양이 아니다 |
| `PGVector` 로 벡터 스토어 | **미적용** | 자기 테이블(`langchain_pg_*`)을 만들어 전량 재적재 + `load_kb.py`·`smoke_vector.py`·테스트 재작성이 따라오는데, 검색은 이미 돌고 있어 얻는 게 없다 |
| `HuggingFaceEmbeddings` | **미적용** | `SentenceTransformerEmbeddingAdapter` + 별도 임베딩 컨테이너(TRIP-517)로 해결 |
| `ChatAnthropic` (LLM·Reflect 호출) | **미적용** | 게이트웨이(C1)가 이미 파싱·게이트·폴백·관측(`LlmCallRecord`·`GateDropEvent`·`FallbackEvent`)을 소유한다. 감싸면 그걸 잃거나 중복한다 |
| 검색기 이음매 + MMR | **시도했고 되돌렸다** | 실측: 평균 정밀도 **0.708 → λ0.7 0.625 → λ0.5 0.458**. MMR 은 중복 억제 도구인데 KB 검수(TRIP-508)에서 중복을 이미 걷어내, "다양성"이 곧 다른 reason 버킷 유입이 됐다. PR #434 로 만들었다가 닫음 |

**LangGraph 도 같은 판정이다.** PlanB 는 `retrieve → augment → generate → filter` 직선이라 순환·상태 그래프가 맞지 않는다. 아래 "적용 X" 표가 Orchestrator 에 대해 이미 같은 결론을 냈다.

실측 근거는 PR #434 본문과 그 커밋의 `ai/docs/langchain-도입-측정.md`. **다시 도입을 검토할 만한 시점**은 하이브리드 검색(BM25+벡터)이나 리랭커가 필요해질 때 — 둘 다 KB 가 100건대로 커진 뒤 의미가 있다.

---

## 적용 원칙

- LangChain은 **LLM 연동 보일러플레이트 제거 도구**로만 사용
- 결정론 로직(어셈블리, DB 조회, 라우팅)에는 적용하지 않음
- 성능 민감 구간(3초 제한)에는 적용하지 않음

---

## 적용 범위

### 적용 O — LangChain 사용

| 적용 부분 | 사용하는 LangChain 모듈 | 적용 이유 |
|---|---|---|
| **PlanBAgent RAG 파이프라인** | `langchain.chains.RetrievalQA`, `langchain.retrievers` | 벡터 검색 → 프롬프트 주입 → LLM 호출의 정형화된 RAG 패턴. 직접 짜면 보일러플레이트 100줄+, LangChain이면 5줄 |
| **LLM 호출 (Anthropic — AI-D06)** | `langchain_anthropic.ChatAnthropic` | SDK 직접 쓰면 JSON 파싱·재시도·스트리밍·에러 핸들링을 매번 작성. LangChain은 이걸 내장하고 있음 |
| **벡터 스토어 연동 (pgvector)** | `langchain_community.vectorstores.PGVector` | 임베딩 생성 → pgvector 저장 → 유사도 검색의 연결 코드를 추상화. DB 스키마·인덱스 관리도 내장 |
| **임베딩 생성** | 로컬 오픈소스 (`HuggingFaceEmbeddings`) | AI-D06: Titan은 Bedrock 전용이라 불가 → 로컬 임베딩(잠정 multilingual-e5-large). 배치 + 캐싱 동일 |
| **ReflectAgent LLM 호출** | `langchain_anthropic.ChatAnthropic` | 회고 생성도 동일 LLM을 쓰므로 동일한 이유. 호출 인터페이스 통일 |

### 적용 X — 직접 구현

| 미적용 부분 | 미적용 이유 |
|---|---|
| **Orchestrator (라우팅·디스패치)** | 우리만의 Fast Path + 복잡도 판단 + 에이전트 선택 로직. LangGraph에 끼우면 억지 맞춤이 됨 |
| **Assembly (OR-Tools)** | LLM이 아닌 결정론 알고리즘. LangChain이 관여할 부분 없음 |
| **Assembly (LLM 2차)** | 어셈블리 폴백 체인은 자체 HybridAssemblyFacade로 제어. LangChain Agent로 감쌀 이유 없음 |
| **M7 후보 풀 생성** | 단순 DB 쿼리 + 필터 파이프라인. LangChain Retriever로 감싸면 오히려 복잡도 증가 |
| **ScheduleAgent** | LLM 호출 자체는 ChatAnthropic을 쓰되, 에이전트 로직(판단·폴백·병렬)은 직접 구현. LangChain Agent의 ReAct 패턴이 우리 흐름과 안 맞음 |
| **EditAgent** | 엔티티 해소 + 어셈블리 검증이 핵심. LLM은 의도 파싱 한 번뿐이라 LangChain Agent로 감쌀 가치 없음 |
| **HC1~HC4 검증** | 순수 함수. LangChain과 무관 |
| **에이전트 병렬 실행** | asyncio.gather로 직접 제어. LangGraph 없이도 단순 |

---

## 구현 예시

### PlanBAgent RAG (LangChain 적용)

```python
from langchain_anthropic import ChatAnthropic
from langchain_huggingface import HuggingFaceEmbeddings  # 로컬 임베딩 (AI-D06)
from langchain_community.vectorstores import PGVector
from langchain.chains import RetrievalQA
from langchain.prompts import ChatPromptTemplate

# 1. LLM (Anthropic 직접 — AI-D06)
llm = ChatAnthropic(
    model_id="anthropic.claude-3-sonnet",
    model_kwargs={"max_tokens": 1000, "temperature": 0},
)

# 2. 임베딩 + 벡터 스토어
embeddings = HuggingFaceEmbeddings(model_name="intfloat/multilingual-e5-large")  # 로컬 (AI-D06)
vectorstore = PGVector(
    embedding_function=embeddings,
    connection_string=DB_URL,
    collection_name="user_persona",
)

# 3. RAG 체인
retriever = vectorstore.as_retriever(
    search_kwargs={"k": 20, "filter": {"user_id": user_id}}
)

prompt = ChatPromptTemplate.from_template("""
너는 여행 중 변수 대응 전문가야.
반드시 아래 후보 목록 안에서만 선택해.

## Retrieved Context
{context}

## 대안 후보 (closed-set)
{candidates}

## Task
대안 A, B, C 3개를 만들어줘.
""")

chain = RetrievalQA.from_chain_type(
    llm=llm,
    retriever=retriever,
    chain_type_kwargs={"prompt": prompt},
)
```

### ScheduleAgent (직접 구현, ChatAnthropic만 사용)

```python
from langchain_anthropic import ChatAnthropic

class ScheduleAgent:
    def __init__(self):
        # LLM 호출만 LangChain으로 (편의)
        self.llm = ChatAnthropic(model="claude-sonnet-5")  # model은 설정값으로 주입 (BR-U4-08)

    async def execute(self, request, toolbox):
        # 로직은 전부 직접 구현
        candidates = await toolbox.m7.get_candidates(request)

        if len(candidates) < THRESHOLD:
            await toolbox.m7.source_web(request.region)

        # LLM 호출 (ChatAnthropic 사용)
        scores = await self.llm.ainvoke(self._build_score_prompt(candidates))

        # 어셈블리 호출 (LangChain 아님)
        solution = await toolbox.assembly.solve(problem)

        return solution
```

---

## 의존성

```toml
# pyproject.toml
[project.dependencies]
langchain-anthropic = ">=0.2"    # LLM 호출 (AI-D06)
langchain-huggingface = ">=0.1"  # 로컬 임베딩
langchain-community = ">=0.3"    # PGVector 벡터 스토어
langchain-core = ">=0.3"         # 기본 추상화 (Chain, Retriever)
# langchain 전체(langchain>=0.3)는 설치하지 않음 — 필요한 서브패키지만
```

---

## 정리

```
LangChain 적용 영역:
  PlanBAgent RAG ← 벡터 검색 + 프롬프트 주입 + LLM = LangChain의 핵심 유스케이스
  LLM 호출 전체 ← 파싱·재시도·스트리밍 내장으로 보일러플레이트 제거
  pgvector 연동 ← 임베딩 저장·검색 연결 코드 추상화

직접 구현 영역:
  Orchestrator, Assembly, M7, 에이전트 로직, 병렬 실행, HC 검증
  → LLM이 아닌 부분 / 성능 민감 / 커스텀 로직이 핵심인 부분
```
