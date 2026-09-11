# PlanBAgent — RAG 설계

> 여행 중 변수 발생 시 기존 일정 + 사용자 페르소나를 기반으로 대안 일정을 생성하는 에이전트.
> 핵심 패턴: **RAG (Retrieval-Augmented Generation)**

> **개정 (2026-08-11, TRIP-332)** — 도구 소유권은 `agent-structure-v2.md`를 정본으로 채택 (근거: 최신 정본 + 도구 겹침 0 원칙). 결정 3항:
> ① PlanBAgent **전속 도구는 `kb.retrieve_schedule` + `llm.select_alternatives` 2개** — §10의 7개 할당표는 구판(이력 참고용). persona·situation 정보는 Provider→InfoBundle 봉투로 수령하고, 후보 풀·어셈블리는 각각 PlaceProvider(봉투 내 풀 참조)·4단 공통 관문 소속.
> ② KB-2(PERSONA)·KB-3(SITUATION)의 Provider 봉투 전환은 **InfoBundle 배선 후속 작업** — 그때까지 현행 retrieve 3종 구현(`ai/src/trippilot/agents/planb/kb_retrieval.py`)은 유지한다 (`KbHit` 이음매 덕에 전환 시 파이프라인 무영향).
> ③ KB-1 구조화 DB 조회·KB-3 실시간 API로의 실소스 전환은 실데이터 연동 시점에 수행 (1단계는 세 KB 모두 `VectorStorePort` 동형).
> §1~§9의 KB-1~3 구분·RAG 파이프라인·폴백 계단은 유효하다 — 바뀐 것은 "누가 그 정보를 가져오는가"(도구 소유권)뿐.

---

## 1. 왜 RAG인가

| 관점 | 일정 생성 (ScheduleAgent) | 변수 대응 (PlanBAgent) |
|---|---|---|
| 시작점 | 백지 | 기존 일정 + 히스토리 있음 |
| 패턴 | Generation (새로 만들기) | RAG (있는 거 꺼내서 + 적응) |
| 핵심 질문 | "뭘 넣을까?" | "뭘 바꿔야 하고, 대안은 뭐가 있지?" |
| 시간 압박 | 여행 전 (여유) | 여행 중 (지금 당장) |

Plan-B는 **이미 있는 정보를 꺼내 와서(Retrieve) + 상황에 맞게 재구성(Generate)**하는 게 핵심이라 RAG가 자연스러움.

---

## 2. Retrieve 대상 — 3가지 Knowledge Base

### KB-1: 기존 일정 컨텍스트

| 항목 | 내용 | 용도 |
|---|---|---|
| 현재 일정 (current) | 오늘/남은 날의 슬롯 + 시각 + POI 정보 | 뭘 바꿔야 하는지 파악 |
| 고정 블록 | 숙소·예약 확정 건 | 못 움직이는 것 식별 |
| 이미 방문한 곳 | 오늘 이미 간 POI | 중복 제외 |
| 변경 이력 (changelog) | 이전 편집·Plan-B 적용 기록 | 같은 제안 반복 방지 |

**저장 방식**: 구조화 데이터 (DB 조회, 벡터 불필요)

---

### KB-2: 사용자 페르소나

| 항목 | 내용 | 용도 |
|---|---|---|
| 저장 장소 | 사용자가 찜한 POI | 대안 후보 1순위 소싱 |
| 방문 이력 | 과거 여행에서 방문한 POI + 체류시간 + 평가 | 취향 파악 (카테고리·시간대 선호) |
| 선호 패턴 | 자주 가는 카테고리, 평균 체류, 시간대별 활동 유형 | LLM에 컨텍스트로 주입 |
| 취소/거절 이력 | 이전 Plan-B에서 거절한 대안 | 비슷한 제안 회피 |

**저장 방식**: 하이브리드
- 정형 데이터 (카테고리 빈도, 평균 체류) → DB 집계 쿼리
- 비정형 메모/리뷰 → 벡터 스토어 (유사도 검색)

---

### KB-3: 상황 데이터 (실시간)

| 항목 | 내용 | 용도 |
|---|---|---|
| 트리거 사유 | 날씨(강수 **80%**+ — 2026-08-25 정정), 휴무, 이동 지연, 체류 초과 | 대안 방향 결정 |
| 현재 위치 | GPS 좌표 | 대안 POI 반경 필터 |
| 현재 시각 | 남은 가용 시간 계산 | 시간창(HC4) 제약 |
| 날씨 예보 | 시간대별 강수확률·기온 | 실내/실외 필터 |
| POI 실시간 상태 | 영업 중/휴무/혼잡도 | 대안 유효성 확인 |

**저장 방식**: 실시간 API 호출 (캐싱 짧음)

---

## 3. RAG 파이프라인 — PlanBAgent 흐름

```
트리거 발생
    |
    v
[1. Retrieve — 상황 파악]
    +→ KB-1: 현재 일정에서 영향받는 슬롯 추출
    +→ KB-3: 트리거 사유 + 현재 위치 + 시각 + 날씨
    |
    v
[2. Retrieve — 대안 후보 소싱]
    +→ KB-2: 저장 장소 (사용자 찜 목록, 1순위)
    +→ M7: 현재 위치 반경 내 POI (조건에 맞는 것)
    |       - 비 오면: 실내 카테고리 필터
    |       - 시간 부족하면: 체류 짧은 POI 우선
    |       - 이미 간 곳/거절한 곳 제외
    +→ KB-2: 사용자 선호 패턴 (어떤 카테고리를 좋아하는지)
    |
    v
[3. Augment — 컨텍스트 조립]
    프롬프트에 주입:
    - 트리거 사유 요약
    - 영향받는 슬롯 (뭘 바꿔야 하는지)
    - 대안 후보 목록 (closed-set)
    - 사용자 선호 패턴
    - 제약 조건 (남은 시간, 고정 블록)
    |
    v
[4. Generate — LLM 판단]
    "이 상황에서 이 후보들 중 뭘 넣으면 좋을지" 점수+선택
    (closed-set 안에서만 선택 — INV-1 유지)
    |
    v
[5. Validate — 어셈블리 검증]
    +→ assembly.solve(대안 A) — 병렬
    +→ assembly.solve(대안 B) — 병렬
    +→ assembly.solve(대안 C) — 병렬
    |
    HC1~HC4 통과한 것만 생존
    |
    v
[6. Return — 제안]
    재계획안 1안(일정 전체) 또는 슬롯 교체 후보 3개 → Orchestrator → 사용자
    (전/후 비교는 적용 후 화면 `i08` 소유 — §11)
```

---

## 4. 벡터 스토어 설계

### 인덱싱 대상

| 문서 유형 | 임베딩 단위 | 메타데이터 |
|---|---|---|
| 사용자 저장 장소 메모 | 메모 단위 (짧은 텍스트) | user_id, poi_id, saved_at |
| 과거 방문 리뷰/감상 | 리뷰 단위 | user_id, poi_id, visit_date, rating |
| POI 설명 (M7) | POI당 1청크 | poi_id, category, region, tags |
| 과거 Plan-B 결과 | 제안당 1청크 | user_id, trip_id, accepted/rejected |

### 벡터 스토어 선택지

| 옵션 | 장점 | 단점 |
|---|---|---|
| **Amazon OpenSearch Serverless** | AWS 네이티브, 관리형, Bedrock 연동 | 비용 (DAU 1천에 과할 수 있음) |
| **pgvector (PostgreSQL)** | 기존 DB에 추가, 단순, 저비용 | 대규모 시 성능 한계 |
| **Amazon Bedrock Knowledge Base** | 완전 관리형 RAG, S3 연동 | 커스터마이징 제한 |

**권고**: 1차는 **pgvector** (규모 작으니 충분). 추후 스케일 시 OpenSearch로 이전.

### 임베딩 모델

> **해소 (2026-08-25, TRIP-530)** — 아래 표·권고는 폐기다. **임베딩 정본은 로컬 `nlpai-lab/KURE-v1`**
> (1024차원 유지 → pgvector 스키마 무변경). AI-D06 부기(2026-08-23)·TRIP-514로 확정·배선 완료
> (`llm_gateway/adapters/sentence_transformer_embedding.py`). `TitanEmbeddingAdapter` 는 선택적 경로로
> 잔존하지만 기본값이 아니다(`main.py` 의 `titan|local` 선택, 기본 `local`).
> Titan v2 는 Bedrock 전용이라 AI-D06(Anthropic 직접) 하에서는 기본 경로가 될 수 없었다.

| 옵션 | 차원 | 용도 |
|---|---|---|
| **`nlpai-lab/KURE-v1` (로컬, MIT)** | 1024 | **확정 정본** — 한국어 품질, 외부 호출 0 |
| ~~Amazon Titan Embeddings v2~~ | 1024 | ~~AWS 네이티브, Bedrock 통합~~ — 선택적 어댑터로만 잔존 |
| ~~OpenAI text-embedding-3-small~~ | 1536 | ~~품질 좋음, 비용 효율적~~ — 미채택 |

---

## 5. Retrieve 전략 상세

### 5.1 사용자 저장 장소 (1순위)

```python
def retrieve_saved_places(user_id, current_location, radius_km, excluded_ids, trigger_context):
    """
    1순위: 사용자가 직접 찜한 곳 → 가장 신뢰도 높음
    필터: 반경 내 + 영업 중 + 미방문 + 상황 부합
    """
    saved = db.query(SavedPlace).filter(
        user_id=user_id,
        distance(location, current_location) <= radius_km,
        poi_id not in excluded_ids,
    )
    # 상황 필터 (비 → 실내, 시간 부족 → 체류 짧은 것)
    return apply_situation_filter(saved, trigger_context)
```

### 5.2 유사도 검색 (2순위 — 저장 장소 부족 시)

```python
def retrieve_similar_pois(user_preference_embedding, current_location, radius_km, trigger_context):
    """
    사용자 선호 패턴과 유사한 POI를 벡터 검색
    쿼리: 사용자의 과거 선호 임베딩 + 상황 키워드
    """
    query_text = f"{trigger_context.situation} {user_preference_summary}"
    query_embedding = embed(query_text)

    results = vector_store.similarity_search(
        query_embedding,
        filter={"region": current_region, "category": allowed_categories},
        top_k=DEFAULT_TOP_K,  # 값의 정본은 `agents/planb/kb_retrieval.py` (§9 미결 #4)
    )
    return results
```

### 5.3 선호 패턴 집계 (Augment에 사용)

```python
def get_user_preference_summary(user_id):
    """
    정형 데이터 집계 — 벡터 검색 아님
    LLM 프롬프트에 컨텍스트로 주입
    """
    return {
        "top_categories": ["cafe", "park", "museum"],  # 빈도 상위
        "avg_stay_minutes": {"cafe": 50, "park": 40},
        "time_preference": "morning_active",            # 오전형
        "budget_level": "mid",
        "rejected_recently": ["poi_123", "poi_456"],    # 최근 거절
    }
```

---

## 6. Augmented Prompt 구조

> **상호참조 (2026-08-11, TRIP-349)**: 본 절 골격의 구현·feature 스펙(OutputSchema·게이트·폴백)은 `ai-prompt-design.md` §2.6(ALTERNATIVE_SELECTION, `ai/prompts/alternative_selection.yaml` v0.1.0) — 아래 예시는 설계 시점 원안이다.

```
[System]
너는 여행 중 변수 대응 전문가야.
사용자의 기존 일정에서 문제가 생겼을 때, 대안을 제안해.
반드시 아래 후보 목록 안에서만 선택해. (closed-set)

[Context — Retrieved]
## 트리거 사유
- 14시부터 비 예보 (강수확률 80%)
- 영향받는 슬롯: 14:00 한강공원, 16:00 남산타워

## 사용자 선호
- 선호 카테고리: 카페 > 박물관 > 쇼핑
- 평균 체류: 카페 50분, 박물관 90분
- 최근 거절: 국립현대미술관 (2일 전 Plan-B에서 거절)

## 대안 후보 (closed-set, 이 안에서만 선택)
1. poi_789: 을지로 카페 (실내, 체류 45분, 도보 10분)
2. poi_012: 전쟁기념관 (실내, 체류 120분, 대중교통 20분)
3. poi_345: 코엑스몰 (실내, 체류 90분, 대중교통 25분)
...

## 제약
- 남은 가용 시간: 14:00~20:00 (6시간)
- 고정 블록: 18:30 저녁 예약 (불변)
- 숙소 복귀: 21:00까지

[Task]
대안 A, B, C 3개를 만들어줘.
각각 {선택 POI, 순서, 이유}를 JSON으로.
```

---

## 7. 폴백 계단

| 단계 | 실패 조건 | 폴백 |
|---|---|---|
| 저장 장소 검색 | 저장 장소 0개 | M7 일반 후보로 진행 |
| 벡터 검색 | 유사 POI 0개 or 벡터 스토어 장애 | M7 카테고리 필터만으로 |
| LLM 점수 매기기 | 타임아웃 / 파싱 실패 | 규칙 점수 (카테고리+거리+평점) |
| 어셈블리 배치 | 3개 대안 모두 HC 위반 | 남은 슬롯 건너뛰기 + 휴식 모드 제안 |
| 전체 실패 | 위 모두 실패 | "수동으로 일정을 수정하세요" + 수동 편집 화면 |

**원칙**: 어떤 경로든 반드시 응답. 침묵 실패 금지 (INV-4).

---

## 8. ScheduleAgent와의 분리 포인트

| 항목 | ScheduleAgent | PlanBAgent |
|---|---|---|
| Retrieve 패턴 | M7 후보 풀 (넓게) | RAG: 기존 일정 + 페르소나 + 상황 (좁게, 맥락 있게) |
| LLM 역할 | 선호 점수 (처음부터 매기기) | 상황 맞는 대안 선택 (이미 있는 정보 기반) |
| 어셈블리 역할 | 전체 일정 최적화 | 부분 재배치 (남은 슬롯만) |
| 벡터 스토어 | 사용 안 함 | 사용 (페르소나 유사도) |
| 시간 예산 | 20초 | 10초 (급함) |

**공유하는 도구**: M7 후보 조회, assembly.solve/validate, LLM 호출
**공유하지 않는 것**: RAG 파이프라인, 벡터 스토어, 프롬프트 구조, 판단 기준

---

## 9. 미결 사항

| # | 항목 | 현재 | 결정 시점 |
|---|---|---|---|
| 1 | ~~벡터 스토어 확정~~ | **해소 (2026-08-20)** — pgvector. 구현이 이미 그것이다(`ai-vectordb` 전용 컨테이너, TRIP-426). 선택 근거는 **운영 면적을 안 늘린 것**이지 성능 비교가 아니다 — OpenSearch·Bedrock KB 와 벤치마크한 적이 없으므로, 규모가 커져 재검토할 때 그 비교가 새로 필요하다 | 완료 |
| 2 | ~~임베딩 모델 확정~~ | **해소 (2026-08-23)** — 로컬 `KURE-v1` 확정·배선 완료 (AI-D06 부기, TRIP-514) | 완료 |
| 3 | ~~유사도 임계값~~ | **해소 (2026-09-01)** — 비율 컷 `min_score_ratio=0.85`(최고점 대비) + 절대 바닥 `min_score=0.0`. 절대값만 쓰면 임베딩 모델 전환 시 조용히 잘못 자른다 (TRIP-522) | 완료 |
| 4 | ~~retrieve top_k~~ | **해소 (2026-09-01)** — `DEFAULT_TOP_K=4`. 20 은 KB 총량보다 커서 한 건도 안 거르는 no-op 이었다. 재현: `ai/scripts/measure_kb_topk.py` (TRIP-508) | 완료 |
| 5 | ~~Plan-B 최대 제안 수~~ | **해소 (2026-09-11, Figma 실관측)** — 화면이 두 층이라 답도 둘이다: **재계획안(일정 전체) 1안**(`i06` — A/B/C 라벨도 비교 캐러셀도 없다) · **슬롯 교체 후보 3개**(`h08` 다른 후보 시트 + 장소 검색). 현행 `max_alternatives=3` 은 후자와 일치한다. 자세한 것은 §11 | 완료 |

---

## 10. PlanBAgent 전용 Tool 정의

> ⚠️ **[구판 — agent-structure-v2 §3으로 대체됨 (2026-08-11, TRIP-332)]**
> 전속 도구는 `kb.retrieve_schedule` · `llm.select_alternatives` **2개**. `kb.retrieve_persona`·`kb.retrieve_situation` → Provider→InfoBundle 봉투 수령, `m7.get_candidates` → PlaceProvider(봉투 내 풀 참조), `assembly.solve`·`assembly.validate` → 4단 공통 관문. 아래 표·시그니처는 이력 참고용 (전환 일정은 문서 상단 개정 기록 참조).

PlanBAgent의 LLM에는 아래 tool만 할당한다. 토큰 절감 + 역할 경계 강제.

### 할당 Tool (7개)

| Tool | 설명 | 용도 |
|---|---|---|
| `kb.retrieve_schedule` | 현재 일정에서 영향받는 슬롯·고정 블록·방문이력 조회 | KB-1 Retrieve |
| `kb.retrieve_persona` | 저장 장소 + 선호 패턴 + 거절 이력 조회 (벡터 검색 포함) | KB-2 Retrieve |
| `kb.retrieve_situation` | 트리거 사유 + 현재 위치 + 시각 + 날씨 + POI 상태 조회 | KB-3 Retrieve |
| `m7.get_candidates` | 현재 위치 반경 내 대안 POI 후보 조회 (closed-set) | 대안 소싱 |
| `llm.select_alternatives` | 후보 중 상황에 맞는 대안 선택 + 점수 + 이유 (closed-set 안에서만) | Generate 단계 |
| `assembly.solve` | 대안 배치 최적화 (부분 재배치, 남은 슬롯만) | Validate 단계 |
| `assembly.validate` | 대안 배치의 HC1~HC4 검증 | Validate 단계 |

### 미할당 Tool (나머지 전부)

| Tool | 미할당 이유 |
|---|---|
| `llm.score_preferences` | PlanB는 상황 기반 선택이지 처음부터 점수 매기기가 아님 |
| `llm.explain_slot` | 대안 제안에 설명은 `llm.select_alternatives` 응답에 포함 |
| `llm.generate_reflection` | 회고는 ReflectAgent 업무 |
| `llm.parse_intent` | 의도 파악은 Orchestrator 업무 |
| `m7.source_web` | 여행 중 10초 제한에 웹 소싱은 부적합 |
| `m7.resolve_entity` | Plan-B는 엔티티 해소 불필요 (시스템 트리거 기반) |
| `assembly.repair` | Plan-B는 새로 배치하지 기존 수리가 아님 |

### Tool 시그니처

```python
# --- KB Retrieve Tools ---

def kb_retrieve_schedule(trip_id: str, trigger_time: datetime) -> ScheduleContext:
    """
    반환: 영향받는 슬롯, 남은 슬롯, 고정 블록, 이미 방문한 POI, 변경 이력
    소스: DB (구조화 데이터)
    """

def kb_retrieve_persona(user_id: str, region: str) -> PersonaContext:
    """
    반환: 저장 장소(반경 내), 선호 카테고리 top-3, 평균 체류, 거절 이력
    소스: DB 집계 + 벡터 스토어 (유사도 검색)
    """

def kb_retrieve_situation(trip_id: str, current_location: GeoPoint) -> SituationContext:
    """
    반환: 트리거 사유, 현재 위치, 현재 시각, 시간대별 날씨, POI 영업 상태
    소스: 실시간 API (날씨, POI 상태)
    """

# --- Generate Tool ---

def llm_select_alternatives(
    candidates: list[Poi],          # closed-set 후보 (M7에서 조회된 것만)
    schedule_context: ScheduleContext,
    persona_context: PersonaContext,
    situation_context: SituationContext,
    max_alternatives: int = 3,
) -> list[Alternative]:
    """
    LLM이 상황+페르소나+후보를 보고 대안 A/B/C를 선택.
    반환: [{selected_pois, order, reason}] — closed-set 안에서만 (INV-1)
    """

# --- Assembly Tools ---

def assembly_solve(problem: PartialItineraryProblem) -> ItinerarySolution | None:
    """
    남은 슬롯만 대상으로 부분 재배치.
    고정 블록은 불변 (HC3).
    시간 제한: 3초.
    """

def assembly_validate(itinerary: ItineraryLike) -> list[Violation]:
    """HC1~HC4 검증. 빈 리스트 = 유효."""
```

---

## 11. 산출물은 두 층이다 — Figma 실관측 (2026-09-11)

> **이 절이 §3·§7 의 "대안"이 무엇인지 확정한다.** 그전까지 구현은 "슬롯 교체 후보 목록"
> 한 층만 만들었는데, 화면은 두 층을 요구한다. 관측 대상은 라이브 Figma
> (파일 `1MTF3dtptIrbg8gld5IdO2`, 밴드 `i` 17프레임 · 단일 세대).

| 층 | 화면 | 산출물 | 개수 |
|---|---|---|---|
| **A. 재계획안** | `i06-[Plan-B] 재계획안 · 펼침` (`4314:1923`) | **하루 일정 전체** — 방문한 곳은 그대로, 나머지를 다시 짠 것 | **1안** |
| **B. 슬롯 교체 후보** | `h08-[완전AI] 다른 후보 시트` (`4298:1998`) | **POI 1개** 교체 후보 목록 + 장소 검색 | **3개** |

**A 가 화면에 싣는 것**: 헤더 `AI 재계획안 · 2일차 · 6월 11일(목)` / `5곳 · 6.3km`, 그 아래
번호 붙은 카드 5장과 카드 사이 이동 구간(1.4km · 3.2km · 600m · 1.1km). 카드마다
**시각과 순서가 보인다**(`09:30` · `15:00–16:30` …). 바뀐 카드에만 `다른 후보 ›` 링크가
붙고 그게 B 로 들어간다. CTA 는 `직접 수정` / `적용하기`.

**그래서 A 는 반드시 어셈블리를 지난다** — 시각·순서·이동거리가 사용자에게 보이므로
INV-2 상 솔버가 정한 값이어야 한다. §3 의 `[5] Validate` 가 이음매가 아니라 **필수 단계**가
되는 근거가 여기다.

**`DEC-U4-1` 과의 관계**: "일정 단위 2~3안을 만들지 않는다"는 여전히 유효하다 —
금지된 것은 **복수 안**이지 일정 단위 재계획 자체가 아니었다. 구현이 그동안 이것을
"슬롯 후보만 만든다"로 읽어 온 것이 과독이다(`docs/conventions/anti-patterns.md` 의
"inception 만 보고 판정하지 말 것"과 같은 계열의 실수 — 이번엔 **화면을 안 보고** 판정했다).

### 주변 화면이 요구하는 것 (현행 계약에 없는 것들)

| 화면 | 요구 | 현행 |
|---|---|---|
| `i04` 재계획 요청 시트 | 이유 칩 6종 · **범위**(지금 이후 / 오늘 전체) · **조건 칩 12종**(실내로 · 이동 짧게 · 예산 유지 · 저녁은 그대로 · 숙소 근처에서 끝내기 …) · 자유 입력 | `trigger`·`reason` 뿐 |
| `i05` 다시 짜는 중 | **부분 결과 스트리밍** — "방문한 3곳 그대로" + 확정된 앞 카드부터 + 취소 | 단발 응답 |
| `i06` 대안 없음 | 사유가 문장으로 — "17시 이후 실내 후보가 근처에 없어요" | `empty_reason` 이 더 거칠다 |
| `i08` 변경 반영 | diff(추가/삭제) · 요약 칩 `바뀐 곳 1` `방문지 5→5` `이동 −6.9km` · 되돌리기 | 전/후 비교·이동거리 델타 없음 |

`i04` 의 조건 칩 12종은 **사용자가 명시한 판별 신호**라 KB 검색 질의에 실을 수 있다 —
TRIP-509(질의 자연문화)가 "질의에 넣을 신호가 없다"로 막혀 있던 곳의 열쇠다.

> 관측 한계: `i03`·`h08`·`i09` 는 렌더를 직접 못 보고 메타데이터 텍스트로 읽었다.
> 밴드 `i` 에는 `[보관]` 프레임이 없고 x 간격이 균등해 세대 혼입은 없다고 판단했다.
