# Agent Foundation — 도메인 엔티티 (FD, 로드맵 스텝 ⓪)

> Edit·PlanB·Intent 병렬 착수를 위한 **공유 기반**. 근거 정본: `agent-structure-v2.md`(4상자·도구 배타·Agent 4종),
> `orchestrator-delegation-design.md`(AgentTask/AgentResult·DL-1~6), `agent-io-contracts.md`(IO-1~7·FreshnessMeta),
> `intent-matching-design.md`(의도 파악 3단), epics S1.5·S1.6, AI-D06(로컬 임베딩 1024차원).
> 표기: 확신 없는 지점은 "미결 #n", PR #76 계약(ACTIVITY·동기판정) 회신을 전제하는 부분은 "결정 대기".

## 0. 재사용 — 변경 0

U1~U4가 만든 규격을 소비만 한다: `TypedResult[T]`·`CandidatePool`·`ScoredPoi`(llm.py),
`Principal`/`ResourceRef`/`PermissionDeniedError`(context.py), `to_iso`/`from_iso`(serialization.py),
`LlmPort` 4형제, `LlmCallRecord`/`FallbackEvent`/`GateDropEvent`, `C1Config`. **기존 필드·불변식 개정 없음.**

## 1. LlmFeature 확장 — `EDIT_TRANSLATION` 1종 추가

`domain/llm.py`의 `LlmFeature`에 편집 번역용 값 1종을 추가한다 (기존 8종 → 9종).

| 값 | 티어 | 소유 | 역할 |
|---|---|---|---|
| `EDIT_TRANSLATION` | 경량(LIGHT) | **EditAgent 전속** | 자연어 편집 발화 → `EditCommand` 초안 번역 (라우팅 의도 재해석 아님 — DL-3) |

- 이름 근거: "해석(parse)"이 아니라 **이미 확정된 EDIT_SCHEDULE 의도의 세부를 명령으로 번역**한다는 역할 한정.
  대안으로 `EDIT_COMMAND_PARSING`을 검토했으나 기존 `INTENT`(Orchestrator 라우팅용)와 "parse" 어감이 겹쳐 기각.
- 티어는 경량 제안 (INTENT·PARAPHRASE와 동급 과업) — 복잡 편집 발화 정확도는 K-2 실모델 검증에서 확정 (미결 #4).
- **closed-set 개정 절차 (BR-U4-05 정합)** — enum 자체가 closed-set이므로 값 추가는 반드시 다음 5종 세트로:
  1. FD 문서 개정 (본 문서 + u4 FD domain-entities §1 티어 표) — 코드 단독 enum 확장 금지
  2. `C1Config.default_tier_map()` 항목 추가 — "전 feature가 tier_map에 존재" 테스트가 누락을 잡는다
  3. `prompts/{feature}.yaml` v0.1.0 등록 (BR-U4-06 — PromptRef 없는 호출은 타입상 불가. **등록 시점은 해당 feature를 호출하는 워커 구현 시** — enum 선행 추가는 1·2·4·5만으로 가능, 기존 4종 선등록 선례와 동일)
  4. ROUTE-P1(전 feature 스윕 PBT)이 자동으로 신규 값 포함 — 별도 조치 불요, green 확인만
  5. `audit.md` 기록 (AI-DLC append-only)

## 2. 위임 봉투 타입 — `domain/delegation.py` (S1.5)

전부 `@dataclass(frozen=True, slots=True)` + `to_dict`/`from_dict` 왕복 (U5-P10). dict 필드는 JSON 원시 타입만 담는다 (규칙 BR-AF-12).

```
TaskPriority (Enum): INTERACTIVE · BACKGROUND
TaskIssuer  (Enum): ORCHESTRATOR · SCHEDULE_AGENT · PLANB_AGENT · REFLECT_AGENT · EDIT_AGENT · BACKGROUND_TRIGGER
AgentStatus (Enum): SUCCESS · FALLBACK · PARTIAL · FAILED · TIMEOUT · NEED_MORE_INFO   ← v2 보강 반영

ContextRef      (frozen): kind: str · ref_id: str            # 타입 목록 = delegation-design §2 표 (trip/itinerary/…/poi)
Requester       (frozen): user_id: str · locale: str
TaskConstraints (frozen): max_llm_calls: int · allow_web_sourcing: bool · apply_mode_ceiling: str | None
TaskError       (frozen): code: str · message: str · retryable: bool
TaskMetrics     (frozen): elapsed_ms: int · llm_calls: int · tokens_in: int · tokens_out: int · tools_used: tuple[str, ...]

AgentTask (frozen):
  task_id · trace_id: str                 # 비어있음 금지
  parent_task_id: str | None
  issued_by: TaskIssuer
  intent: str                             # 라우팅 테이블 closed-set 라벨 (라벨 정본은 delegation-design §5)
  slots: dict                             # JSON-safe
  utterance: str | None                   # 뉘앙스 참고 전용 — 재해석 금지 (DL-3, BR-AF-02)
  context_refs: tuple[ContextRef, ...]    # 데이터가 아니라 참조 (DL-2, D31)
  requester: Requester
  inline_context: dict                    # 휘발 데이터만 (현재 위치·클라 시각)
  info: InfoBundle | None                 # v2 보강 — Orchestrator 수집분 동봉
  deadline_ms: int                        # > 0 강제 (post-init)
  priority: TaskPriority
  constraints: TaskConstraints
  idempotency_key: str
```

- **DL-4 구조 강제**: `spawn(elapsed_ms, *, task_id, issued_by, intent, slots, …) → AgentTask` —
  자식은 `parent_task_id=self.task_id`, `trace_id` 상속(불변), `deadline_ms = self.deadline_ms − elapsed_ms`.
  잔여 ≤ 0이면 `DeadlineExhaustedError` — 자식이 부모보다 오래 사는 봉투는 생성 자체가 불가능.
- **DL-3은 타입으로 강제 불가** → BR-AF-02 + "Agent 구현이 utterance로 intent를 덮어쓰지 않는다" 테스트 규칙으로 커버.

```
AgentResult (frozen):
  task_id · trace_id: str
  status: AgentStatus
  payload: dict | None
  fallback_level: int                     # 0=정상, 1..n=폴백 계단
  freshness: FreshnessMeta | None
  error: TaskError | None
  metrics: TaskMetrics
```

**post-init 불변식 (DL-5 — 예외가 아니라 상태값):**

| 조건 | 강제 |
|---|---|
| status ∈ {FAILED, TIMEOUT} | error ≠ None (그 외 status는 error = None) |
| status = SUCCESS | payload ≠ None ∧ fallback_level = 0 |
| status = FALLBACK | fallback_level ≥ 1 |
| status = NEED_MORE_INFO | payload에 `missing`(비어있지 않은 목록)·`reason` 필수 — 재수집은 최대 1회 (BR-AF-05, Orchestrator 정책) |
| 공통 | fallback_level ≥ 0, task_id/trace_id 비어있음 금지 |

## 3. FreshnessMeta + InfoBundle — `domain/freshness.py` (S1.6)

```
FreshnessMeta (frozen):
  source: str          # KMA | KAKAO_MOBILITY | NAVER | M7_CACHE | PGVECTOR | …
  fetched_at: datetime # tz-aware 강제 (naive → ValueError, serialization.py 규칙)
  cache_hit: bool
  ttl_sec: int         # ≥ 0
  stale: bool          # TTL 초과분을 폴백으로 반환했는가

ProviderKind   (Enum): PLACE · WEATHER · TRANSIT · PERSONA · EVENT
ProviderStatus (Enum): OK · LOW · NO_CANDIDATES · WEATHER_UNKNOWN · COLD_START · UNAVAILABLE   # LOW=부분 성공(충분성 신호), OK·LOW 외가 실패 상태값 (IO-7)

InfoPacket (frozen):
  provider: ProviderKind
  status: ProviderStatus
  data: dict                     # JSON-safe — Provider별 상세 스키마는 agent-io-contracts §5 채택
  freshness: FreshnessMeta | None  # status ∈ {OK, LOW}면 필수 (post-init, IO-6 — LOW는 부분 성공이라 신선도 동봉). 실패 상태값일 때만 None 허용

InfoBundle (frozen):
  packets: tuple[InfoPacket, ...]  # 소형 패킷(날씨·교통·페르소나) 직접 포함
  pool_ref: str | None             # 후보 풀(최대 5천)은 세션 캐시 참조 키만 (DL-2) — 키 스킴은 U5 소유 (미결 #3)
```

- Provider I/O 상세 4종(PlaceScoutResponse·DailyWeather·TransitInfo·PersonaContext)은 agent-io-contracts §5를
  그대로 채택하되 **본 스텝에서는 `InfoPacket.data`의 논리 스키마**로만 참조한다 — 정식 dataclass 승격은 각 Provider FD(U5·U6)에서.
- `TransitInfo` 계열은 INV-3 정적 보장 유지: 표시 계열에 duration 필드 부재, `internal_minutes`는 Display 타입에서 제외.
- **결정 대기 (PR #76)**: `DailyWeather.trigger`·`TransitInfo.delay_trigger` 등 **판정 결과의 동기 회신 여부**와
  카테고리 축(ACTIVITY 포함) 경계는 PR #76 계약 회신 전제 — 회신 전에는 `data`에 판정 필드를 싣지 않는 것을 기본값으로 한다.

## 4. 벡터 검색 데이터 타입 — `ports/vector_store_port.py` 내 정의

포트 모듈 내 dataclass 정의는 `llm_port.py`(LlmRequest/LlmResponse) 선례를 따른다.

```
VectorHit (frozen): item_id: str · score: float · payload: dict
```

용도: PersonaContext.preference_vector_hits(agent-io-contracts §5)·질문뱅크 top-k(intent-matching §2)가 공유하는 단일 히트 타입.
