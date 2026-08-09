# Agent Foundation — 비즈니스 규칙 + PBT 게이트 (FD, 로드맵 스텝 ⓪)

## 1. 규칙 (BR-AF)

| # | 규칙 | 근거 |
|---|---|---|
| BR-AF-01 | 모든 위임은 `AgentTask`, 모든 회신은 `AgentResult` — 봉투 밖 에이전트 호출 경로 금지 | DL-1 |
| BR-AF-02 | Agent는 봉투의 intent·slots를 **재해석하지 않는다** — utterance는 뉘앙스 참고 전용. EditAgent의 `EDIT_TRANSLATION`은 확정된 EDIT_SCHEDULE의 세부 번역이며 라우팅 재해석이 아니다 | DL-3 |
| BR-AF-03 | 자식 봉투 deadline = 부모 − 경과분. 잔여 ≤ 0이면 발행 자체 불가 (`spawn`이 유일한 자식 생성 경로, DeadlineExhaustedError) | DL-4 |
| BR-AF-04 | Agent 경계에서 예외 던지기 금지 — 성공/폴백/실패 전부 AgentResult 상태값으로 수렴. FAILED·TIMEOUT ⇔ error 필수 | DL-5, INV-4 |
| BR-AF-05 | `NEED_MORE_INFO` 재수집·재위임은 **최대 1회** — 초과 시 업무 폴백 (Orchestrator 정책) | v2 §3 |
| BR-AF-06 | `InfoPacket.status ∈ {OK, LOW}`면 FreshnessMeta 필수 (LOW는 부분 성공 — io-contracts 충분성 신호). Provider 실패는 예외가 아니라 상태값 (NO_CANDIDATES 등) | IO-6·IO-7 |
| BR-AF-07 | `LlmFeature` 값 추가는 FD 개정 + tier_map + 프롬프트 yaml + ROUTE-P1 + audit 5종 세트 동반 — 코드 단독 enum 확장 금지 | BR-U4-05 정합 |
| BR-AF-08 | `llm.parse_intent`(INTENT)는 **Orchestrator 전용**, `llm.translate_edit`(EDIT_TRANSLATION)는 **EditAgent 전속** — 도구·feature 겹침 0 유지 | v2 도구 배타 |
| BR-AF-09 | 임베딩 차원 1024 고정 (`EmbeddingPort.dim`) — 반환 벡터 길이 ≠ dim은 위반. FakeEmbedding은 결정론(같은 텍스트 → 같은 벡터) | AI-D06, D37 |
| BR-AF-10 | agents는 c1·c2·m7을 조립할 수 있는 유일한 상위 계층 — 하위 계층의 agents(·orchestrator·providers·background) import 금지, agents 형제 간 상호 import 금지, agents의 LlmPort 직접 import 금지 (L-1~L-5) | 계층 규칙 |
| BR-AF-11 | "Agent 4종" 제한은 라우팅 테이블의 대화형 위임 대상에 한정 — Background(자율 트리거형)는 별도 범주: 라우팅 밖, 봉투 재사용(priority=BACKGROUND), INV-1은 소싱 게이트로, 사용자 표시 시각 생성 금지 | v2 §1 재해석 |
| BR-AF-12 | 봉투·신선도 타입 전부 `from_dict(to_dict(x)) == x` — dict 필드는 JSON 원시 타입만, datetime은 tz-aware만 | U5-P10 |
| BR-AF-13 | 대형 데이터는 참조로 — 후보 풀은 `InfoBundle.pool_ref`(세션 캐시 키)만, inline_context는 휘발 데이터 한정 (위반은 리뷰 반려) | DL-2, D31 |

## 2. PBT 게이트 (hypothesis — 전부 통과해야 스텝 종료)

| ID | 속성 | 전략 |
|---|---|---|
| ENV-P1 | 봉투·신선도 전 타입 직렬화 왕복 (AgentTask·AgentResult·InfoBundle·FreshnessMeta·ContextRef·TaskConstraints·TaskError·TaskMetrics) | 신규 delegation generator |
| ENV-P2 | `spawn` 반복 적용 시 deadline 단조 감소 ∧ trace_id 불변 ∧ parent 연결 정확 ∧ 잔여 소진 시 항상 예외 (SPEED-P1 토대) | 경과분 무작위 시퀀스 |
| ENV-P3 | AgentResult 상태-필드 정합: 불변식 표(domain-entities §2)를 위반하는 인스턴스는 생성 불가 | 무작위 필드 조합 → 생성 성공/실패 이분 |
| ENV-P4 | InfoPacket: status ∈ {OK, LOW} ∧ freshness=None인 인스턴스는 생성 불가 | 상태 스윕 |
| EMB-P1 | FakeEmbedding: 같은 텍스트 → 같은 벡터 ∧ len=dim ∧ L2 노름 ≈ 1.0 ∧ 다른 텍스트 → (사실상) 다른 벡터 | 무작위 유니코드 텍스트 |
| EMB-P2 | InMemoryVectorStore: 저장 벡터 자신으로 검색 시 top1 = 자신 ∧ score 내림차순 ∧ top_k 상한 준수 ∧ 동점 시 item_id 사전순(결정론) | 무작위 벡터 셋 |
| ROUTE-P1 (승계) | 전 feature 스윕에 `EDIT_TRANSLATION` 자동 포함 — tier_map 완전성 | 기존 U4 PBT 회귀 |

## 3. DoD

- [ ] 위 PBT 전부 green (기존 전체 회귀 포함)
- [ ] 아키텍처 테스트 보강 3종 green: L-1(하위→상위 금지) · L-2(agents 상호 금지) · L-3(agents→LlmPort 금지)
- [ ] `default_tier_map()`에 EDIT_TRANSLATION 추가 + "전 feature 매핑 존재" 테스트
- [ ] `domain/delegation.py`·`domain/freshness.py`·`ports/embedding_port.py`·`ports/vector_store_port.py`·fake 2종 존재, ports 순수성(stdlib만) 기존 테스트 green
- [ ] 실 API 호출 0건 (D37) — 임베딩 fake는 stdlib 해시만
- [ ] 미결 #1~#6·결정 대기(PR #76) 항목이 코드에 선반영되지 않았음 확인 (판정 필드 미탑재 등)

## 4. 정본 개정 필요 목록 (본 FD는 정본을 수정하지 않는다 — 승인 후 별도 개정)

| 대상 정본 | 개정 내용 |
|---|---|
| `agent-structure-v2.md` §3 (85행) | Edit 전속 도구 `llm.parse_intent` → `llm.translate_edit` 개명 (대안 A 채택 시) |
| `agent-structure-v2.md` §1 용어표 | "Background(자율 트리거형)" 범주 행 추가 — Agent 4종 제한의 적용 범위를 "라우팅 대상"으로 한정 명문화 |
| `intent-matching-design.md` §4 | `llm.parse_intent` 소유를 "Orchestrator 전용" 명시 (현행 "C1 (경량)" 표기를 소유 주체 기준으로 정정) |
| `orchestrator-delegation-design.md` §5 | 라우팅 테이블에 "자율 트리거형은 라우팅 테이블 밖 (issued_by=BACKGROUND_TRIGGER)" 각주 |
| `u4-c1-gateway/functional-design/domain-entities.md` §1 | LlmFeature 표에 EDIT_TRANSLATION 행 추가 (BR-AF-07 절차의 일부) — **반영 완료 (TRIP-315)**, 미결 #4 표기 동반 |
| `agent-io-contracts.md` §5 | 정보 계층 명칭을 v2 용어(Provider)로 정합화 + FreshnessMeta 정의 위치를 본 FD `domain/freshness.py`로 참조 전환 |
| `ai/README.md` 도구 제한 표 | `llm.parse_intent` 행의 Edit 열 → Orchestrator 열로 이동, `llm.translate_edit` 행 신설 |

## 5. 미결 목록

| # | 내용 | 해소 시점 |
|---|---|---|
| 미결 #1 | Kotlin↔Python 프로토콜(AI-D01) — 봉투 직렬화의 최종 IDL(OpenAPI/proto) | 프로토콜 확정 시 |
| 미결 #2 | **결정 대기 (PR #76)** — ACTIVITY 카테고리 축·트리거 동기판정 회신 여부. InfoPacket.data에 판정 필드 탑재는 회신 후 | PR #76 회신 |
| 미결 #3 | `pool_ref` 세션 캐시 키 스킴 (U5 소유 — 본 스텝은 opaque str) | U5 FD |
| 미결 #4 | EDIT_TRANSLATION 티어 LIGHT 확정 여부 (복잡 편집 발화 정확도) | K-2 실모델 검증 |
| 미결 #5 | Background의 LlmFeature 사용 상한 (현행 PLACE_EXTRACTION 1종 외 추가 여부) | U6 FD |
| 미결 #6 | TripReadiness·FreshnessCurator 요구사항 정본 부재 (로드맵 유래 명칭만 존재) | 해당 기능 인셉션 문서화 |
| 미결 #7 | 집계형 FreshnessMeta — `ScheduleAgentOutput.freshness`는 "사용 데이터 신선도 집계"(agent-io-contracts)인데 집계 스키마 미정의. 본 FD FreshnessMeta는 패킷 단일 source용 | 경계 계약 개정 (TRIP-282) |
