# LangChain 부분 도입 — 적용 범위 및 이유

> LangChain을 전체 적용하지 않고, **도움이 되는 부분에만** 국한하여 사용한다.
> 나머지는 직접 구현하여 프레임워크 종속을 방지한다.

---

## 적용 원칙

- LangChain은 **LLM 연동 보일러플레이트 제거 도구**로만 사용
- 결정론 로직(솔버, DB 조회, 라우팅)에는 적용하지 않음
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
| **Solver (OR-Tools)** | LLM이 아닌 결정론 알고리즘. LangChain이 관여할 부분 없음 |
| **Solver (LLM 2차)** | 솔버 폴백 체인은 자체 HybridSolverFacade로 제어. LangChain Agent로 감쌀 이유 없음 |
| **M7 후보 풀 생성** | 단순 DB 쿼리 + 필터 파이프라인. LangChain Retriever로 감싸면 오히려 복잡도 증가 |
| **ScheduleAgent** | LLM 호출 자체는 ChatAnthropic을 쓰되, 에이전트 로직(판단·폴백·병렬)은 직접 구현. LangChain Agent의 ReAct 패턴이 우리 흐름과 안 맞음 |
| **EditAgent** | 엔티티 해소 + 솔버 검증이 핵심. LLM은 의도 파싱 한 번뿐이라 LangChain Agent로 감쌀 가치 없음 |
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

        # 솔버 호출 (LangChain 아님)
        solution = await toolbox.solver.solve(problem)

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
  Orchestrator, Solver, M7, 에이전트 로직, 병렬 실행, HC 검증
  → LLM이 아닌 부분 / 성능 민감 / 커스텀 로직이 핵심인 부분
```
