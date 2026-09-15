# 도우미 대화 — 비즈니스 규칙 + PBT 게이트 (FD **초안**)

## 1. 규칙 (BR-DLG)

### 1.1 ③ 인자 추출

| # | 규칙 | 근거 |
|---|---|---|
| BR-DLG-01 | **인자 이름·종류·필수 여부의 정본은 `ARGUMENT_TABLE` 하나다.** 도구 스키마(`tool_specs()`)도 규칙 추출기 목록도 여기서 파생한다 — 손으로 적은 스키마 파일을 따로 두지 않는다 | 두 곳에 적으면 갈라진다. `prompts/intent.yaml` 의 의도 무관 3칸(`date`·`category`·`constraint`)을 대체 |
| BR-DLG-02 | **엔트리별 `slot_pattern` 을 쓰지 않는다.** 추출기는 `ArgumentKind` 마다 하나씩 둔다 | 뱅크 417문장에 패턴을 달 수 없고(증강기가 못 만든다), 같은 `date` 를 의도마다 다르게 뽑는 드리프트가 난다. 개정 대상은 `intent-matching-design.md` §3.1 (§4) |
| BR-DLG-03 | **`PLACE_REF`·`SLOT_REF` 는 문자열로만 뽑는다. POI id 해소를 LLM 에 시키지 않는다** — 현재 일정·후보 풀과 대조하는 closed-set 조회다 | INV-1. `ClosedSetGate`·`EditTranslationGate` 가 이미 하는 방식 |
| BR-DLG-04 | **인자는 평면 스칼라만 담는다**(`str`·`int`·`float`·`bool`). 중첩 객체·배열 금지 | `IntentGate._parse_slots` 가 이미 강제하는 규칙을 타입으로 올린 것 — 게이트와 타입이 어긋나면 게이트가 통과시킨 값이 생성 불가가 된다 |
| BR-DLG-05 | **인자에 사용자에게 보일 시각을 담지 않는다.** "3시에 넣어줘"의 3시는 요청이지 확정 시각이 아니다 | INV-2 |
| BR-DLG-06 | **도구 호출을 쓰더라도 closed-set 보증은 `IntentGate` 가 한다.** 벤더 스키마는 파싱 실패율을 낮추는 최적화일 뿐 권위가 아니다 | INV-1 · NFR-6.3 벤더 중립. 모델·벤더 교체 시 보증이 사라지면 안 된다 |
| BR-DLG-07 | **도구 호출은 3차에서만 쓴다.** 1·2차에 LLM 을 넣지 않는다 | CONFIDENT 의 존재 이유가 "LLM 0회"다(실측 87발화 중 28건). 여기가 무너지면 3단 구조를 둘 이유가 없다 |
| BR-DLG-08 | 도구 미지원 어댑터에 `tools` 를 실으면 **`LlmUnsupportedError`** — 게이트웨이가 폴백 신호로 바꾸고 호출측이 기존 JSON 프롬프트 경로로 강등한다. **조용히 떨구지 않는다** | INV-4 · `LlmRequest.images` 선례(TRIP-595)와 같은 자리 |
| BR-DLG-09 | 규칙 추출기는 **결정론**이다 — 같은 발화에 같은 인자. 실패는 `None` 이고 예외가 아니다. 인자 추출 실패가 라우팅을 죽이지 않는다 | 의도는 이미 확정됐다(`_extract_slots` 현행 방침) |

### 1.2 ④ 다중 의도

| # | 규칙 | 근거 |
|---|---|---|
| BR-DLG-10 | 한 발화에서 만드는 프레임은 **최대 2개**. 초과 후보는 실행하지 않고 되묻어 좁힌다 | 첫 응답 예산 3초(D38) + 확인 부담. 정본 예시도 2개다("일정 바꾸고 회고도 써줘") |
| BR-DLG-11 | **상태를 바꾸는 의도는 발화당 1개만** (`GENERATE_SCHEDULE`·`REGENERATE`·`REPLAN`·`EDIT_SCHEDULE`). 2개 이상이면 실행하지 않고 되묻는다 | 한 문장으로 일정을 두 번 갈아엎으면 되돌리기가 어렵다. `DESTRUCTIVE_OPS` 가 확인을 강제하는 것과 같은 취지 |
| BR-DLG-12 | **분해는 3차 전용이다.** 1·2차는 발화 하나를 점 하나로 본다 — 임베딩은 구조적으로 분해를 못 한다. 복합 의심 신호(접속 표지 + top1 < `T_high`)가 잡히면 3차로 보낸다 | 2차 투표는 의도 혼재를 **해소할 모호성**으로 다루지 분해하지 않는다(`_vote`) — 복합 발화를 2차에 두면 득표가 갈려 결국 3차로 가는데, 그 사이 LLM 1회를 헛쓴다 |
| BR-DLG-13 | 프레임 목록을 실행 계획으로 옮길 때 **새 타입을 만들지 않는다** — `domain/execution.py` 의 `ExecutionPlan`/`ExecutionStep` 을 쓴다. `depends_on` 없는 프레임은 한 step, 있는 프레임은 다음 step | 정본이 이미 "Execution Plan 에서 step 1개에 병렬 배치"라고 적었고(`orchestrator-delegation-design.md:182`) 타입도 이미 있다(소비자 0) |
| BR-DLG-14 | 프레임 하나가 실패해도 나머지는 각자 결과를 낸다. 부분 성공은 `PARTIAL` 로 **보고**한다 | INV-4 침묵 실패 금지 · `agent-redesign.md` §예시2 "실패 격리" |
| BR-DLG-15 | 각 프레임의 시한은 `AgentTask.spawn` 으로 나눈다 — 합이 부모 시한을 넘을 수 없다 | BR-AF-03 (`DeadlineExhaustedError`). **어셈블리 바닥 보장(TRIP-376)을 없애지 않는다** — agent-foundation 미결 #8 註 |

### 1.3 ⑤ 멀티턴

| # | 규칙 | 근거 |
|---|---|---|
| BR-DLG-20 | **대화 상태의 정본은 백엔드다. AI 서비스는 무상태로 남는다.** 경계가 매 턴 `DialogueContext` 를 받고 갱신본을 돌려준다 | AI 경계는 요청/응답 HTTP 이고 수평 확장 대상이라 상태를 두면 고정 세션이 필요하다. 개인 발화의 보존·삭제 책임은 이미 백엔드에 있다. `CONFIRM_REQUIRED` 왕복이 같은 모양으로 이미 돌아간다 |
| BR-DLG-21 | **넘기는 것은 보류 프레임이지 대화 기록이 아니다.** 직전 발화 전문·턴 목록을 싣지 않는다 | D31 참조 원칙 · 토큰 비용 · 개인 발화 최소 수집. **보관 정책 자체가 미결이다**(제품 O3) — 결정 전에 AI 서비스가 발화를 들고 있으면 안 된다 |
| BR-DLG-22 | **보류 프레임이 있으면 라우팅보다 인자 채우기를 먼저 시도한다.** 채워지면 그 턴은 라우팅을 돌리지 않는다 | "여수"·"3박 4일" 같은 조각은 뱅크에 영원히 안 맞는다. 먼저 채우면 **LLM 0회**로 끝나고, 라우팅을 먼저 돌리면 조각이 엉뚱한 의도에 붙는다 |
| BR-DLG-23 | **되묻기는 프레임당 최대 1회.** 초과하면 결정론 폴백 | INV-4. BR-AF-05(재수집 1회)와 같은 취지의 상한이고 **층이 다르다** — 이쪽은 사람에게, 저쪽은 Provider 에게 묻는다 |
| BR-DLG-24 | 보류 프레임은 셋 중 먼저 오는 것에서 버린다 — ① 다음 턴이 **다른 의도로 CONFIDENT 확정** ② 턴 2회 경과 ③ 만료 시각 초과 | 되묻기를 무한히 끌지 않는다. ①이 핵심이다 — 사용자가 화제를 바꿨는데 옛 질문에 답으로 읽으면 엉뚱한 일을 한다 |
| BR-DLG-25 | `AgentStatus.NEED_MORE_INFO` 를 사용자 되묻기로 재사용하지 않는다 | 그쪽 `missing` 은 Provider 데이터이고 사람 왕복이 없다. 합치면 "데이터가 없다"와 "사용자가 안 말했다"가 같은 재시도 정책을 탄다 |
| BR-DLG-26 | 되묻기 질문은 **어느 인자를 채우려는지** 를 기계가 읽을 수 있어야 한다(`ClarifyRequest.argument`) | 계약 정본의 `EditAgentOutput.clarification_needed: str \| None` 은 문자열 한 칸이라 다음 턴에 답을 **어디에 넣을지** 알 수 없다 — 그대로 쓰면 멀티턴이 성립하지 않는다 |

### 1.4 되묻기 (⑤ 와 함께 쓰이지만 별도 규칙)

| # | 규칙 | 근거 |
|---|---|---|
| BR-DLG-30 | **되묻기는 두 종류이고 동시에 나오지 않는다** — 의도가 안 갈리면 `IntentClarify`, 의도는 갈렸는데 필수 인자가 비면 `ArgumentClarify` | 의도를 모르면 어떤 인자가 필요한지도 모른다(`ARGUMENT_TABLE` 이 의도로 색인된다). 두 칸으로 두면 표현 불가능한 상태가 타입에 생긴다 |
| BR-DLG-31 | **`IntentClarify` 의 질문은 LLM 이 만든다** (팀 결정 2026-09-15). 고정 문구를 쓰지 않는다 | 갈리는 자리는 **차이가 문장 안에 없다** — "일정 다시 짜줘"는 REGENERATE 와 REPLAN 둘 다다. 사용자가 자기 말을 되짚어 보지 못하면 무엇을 고르는지 모른다 |
| BR-DLG-32 | **후보는 서버가 주입한다 — 라우터가 갈등하는 2~3개만.** 13종 전체를 주지 않는다. 게이트가 모든 보기를 그 목록으로 되매핑한다 | INV-1. 모델에게 라우팅을 다시 시키는 것이 아니라 **이미 좁혀진 둘 중 무엇인지 물을 문장**을 만들게 하는 것이다. `EDIT_TRANSLATION` 의 `$edit_ops` 와 같은 구조 |
| BR-DLG-33 | **한 요청에 되묻기는 총 1회.** 의도 되묻기 뒤에 인자 되묻기를 이어 붙이지 않는다 | 2연속 되묻기는 사용자가 이탈한다. 의도 확정 후 인자가 비면 선택 인자는 비우고, 필수 인자는 결정론 폴백으로 간다. BR-DLG-23(프레임당 1회)의 상위 상한 |
| BR-DLG-34 | **되묻기는 `FALLBACK` 을 대체하지 3차를 대체하지 않는다** | 실측: 2차 동률대(0.73~0.76)를 3차로 보내면 **전건 정답**이었다. 거기서 사람을 부르면 공짜로 맞힐 것을 왕복 비용으로 바꾼다. 되묻기가 버는 자리는 3차까지 실패한 **FALLBACK 9건/87** 과 3차가 낮은 신뢰도로 **상태 변경 의도**를 냈을 때다 |

---

## 2. PBT 게이트 (hypothesis — 전부 통과해야 스텝 종료)

| ID | 속성 | 전략 |
|---|---|---|
| DLG-P1 | `ARGUMENT_TABLE` 이 `ROUTABLE_INTENTS` 13종을 빠짐없이 덮고 ∧ 의도 안에서 인자 이름이 중복되지 않고 ∧ `kind=ENUM` 이면 `choices` 가 비어있지 않다 | 전 의도 스윕 (ROUTE-P1 과 같은 형태) |
| DLG-P2 | `tool_specs()` 산출이 전 의도에서 유효한 JSON Schema 객체 ∧ 도구 이름 집합 = `Intent` 라벨 집합 | 표 → 스키마 왕복 |
| DLG-P3 | `IntentFrame`: `missing` 이 비지 않으면 `executable` 이 False ∧ `missing` 에 표 밖 이름이 든 인스턴스는 **생성 불가** ∧ `OUT_OF_SCOPE ⇔ FALLBACK` | 무작위 필드 조합 → 생성 성공/실패 이분 (ENV-P3 과 같은 형태) |
| DLG-P4 | 추출기 결정론: 같은 텍스트 → 같은 인자, 반복 호출에 불변 (LLM 미개입 경로) | 무작위 한국어 발화 |
| DLG-P5 | `RouterOutcome`: 프레임 3개 이상 ∨ 상태 변경 의도 2개 이상인 인스턴스는 **생성 불가** ∧ `clarify` 가 가리키는 인자가 실제로 `missing` 에 있다 | 무작위 프레임 조합 |
| DLG-P6 | 프레임 → `ExecutionPlan` 컴파일: `depends_on` 관계가 step 순서로 보존 ∧ step 내 프레임끼리는 의존이 없다 ∧ `timeout_sec` 합 ≤ 부모 시한 | 무작위 의존 그래프(비순환) |
| DLG-P7 | `spawn` 분배: N 프레임 시한이 전부 > 0 ∧ 합 ≤ 부모 ∧ 잔여 소진 시 발행 불가 | ENV-P2 승계 |
| DLG-P8 | 되묻기 상한: 어떤 턴 시퀀스에도 같은 보류 프레임에 대해 `clarify` 가 2회 나오지 않는다 | `DialogueContext` 를 물려 가며 턴 반복 |
| DLG-P9 | `DialogueContext`·`PendingFrame`·`IntentFrame`·`RouterOutcome` 전부 `from_dict(to_dict(x)) == x` ∧ `asked_at` 은 tz-aware 만 | U5-P10 승계 |
| DLG-P10 | 인자 값이 항상 평면 스칼라 — 중첩을 담은 `IntentFrame` 은 생성 불가. `IntentGate` 통과값이 전부 `IntentFrame` 생성 가능 | 게이트 ↔ 타입 정합 (양방향) |
| DLG-P11 | `RouterOutcome.clarify` 가 `ArgumentClarify` 와 `IntentClarify` 를 **동시에** 담은 인스턴스는 생성 불가 ∧ `IntentClarify` 면 `frames` 길이 1 | 무작위 조합 |
| DLG-P12 | `IntentClarifyGate`: 주입한 후보 밖 `Intent` 를 담은 응답은 전량 드롭 → 정적 폴백 문구. 보기 수 2~3 밖도 드롭 | 후보 목록 ↔ 응답 무작위 교차 |
| ROUTE-P1 (승계) | 전 feature 스윕에 신규 feature 자동 포함 — `INTENT_CLARIFY` 가 자동으로 걸린다 | 기존 U4 PBT 회귀 |

---

## 3. DoD

- [ ] 위 PBT 전부 green (기존 전체 회귀 포함)
- [ ] `ARGUMENT_TABLE` 13종 전수 + `tool_specs()` 순수 함수 + 추출기 9종 존재, 실 API 호출 0건(D37)
- [ ] **도구 호출의 이득을 실측으로 적는다** — §6 평가셋으로 기존 JSON 프롬프트 경로 대비 **파싱 실패율·인자 정확도**를 2회 이상 비교.
      정확도 개선을 전제로 삼지 않는다 (`ai/data/README.md` "한 번 재고 좋아졌다/나빠졌다 말하지 않는다")
- [ ] 되묻기가 필요한 7종 의도에 대해 **인자 질문 문안이 전부 존재**하고 `options` 가 있는 인자는 보기가 closed-set 과 일치
- [ ] **의도 되묻기 실측** — 현행 `FALLBACK` 9건/87 이 되묻기로 바뀌었을 때 후보 2~3종 안에 정답이 들어 있는 비율.
      들어 있지 않으면 되묻기는 폴백보다 나쁘다(사용자에게 틀린 보기만 준다). 최소 2회 측정
- [ ] `slot_pattern` 경로 제거 시 `_extract_slots`·로더 검증·테스트를 함께 걷어낸다 (죽은 기능을 남기지 않는다)
- [ ] 멀티턴 경계 계약에 **백엔드 합의 서명** — `DialogueContext` 를 누가 저장하고 언제 지우는지가 합의문에 있어야 한다 (§5 미결 #1)
- [ ] BR-AF-07 5종 세트 — 신규 `LlmFeature` 를 만든다면 FD 표·tier_map·프롬프트 yaml·ROUTE-P1·audit 전부. **`INTENT` 재사용이면 세트 불요**
- [ ] `audit.md` 에 항목 추가 (AI-DLC append-only)

---

## 4. 정본 개정 필요 목록 (본 FD 는 정본을 수정하지 않는다 — 승인 후 별도 개정)

| 대상 정본 | 개정 내용 |
|---|---|
| `intent-matching-design.md` §3.1 | `IntentBankEntry.slot_pattern` **폐기** — 인자 추출은 `ArgumentKind` 별 추출기로 옮긴다(BR-DLG-02). 필드가 남아 있으면 다음 사람이 417문장을 채우려 든다 |
| `intent-matching-design.md` §2 [슬롯 추출] | "부족하면 `llm.parse_intent` 를 슬롯 전용으로 1회" → **인자 종류에 따라 갈린다**로 정정: 규칙 가능 종류는 규칙만, `FREE_TEXT`·해소 실패는 3차 승격, 그래도 비면 되묻기(BR-DLG-07·22) |
| `intent-matching-design.md` §2 파이프라인 그림 | 산출이 "AgentTask 발행(intent + slots)"에서 **`IntentFrame[]` → `ExecutionPlan`** 으로 바뀐다 (프레임 2개 가능) |
| `orchestrator-delegation-design.md` §5 표 아래 복합 intent 註 | 상한을 명문화 — 프레임 최대 2개 · 상태 변경 의도 최대 1개(BR-DLG-10·11). 현행 문장은 상한 없이 "병렬 배치"만 적었다 |
| `agent-io-contracts.md` §`EditAgentOutput` | `clarification_needed: str \| None` → `ClarifyRequest`(어느 인자를 묻는지 포함)로 승격. 문자열 한 칸으로는 다음 턴에 답을 넣을 자리를 알 수 없다(BR-DLG-26) |
| `agent-io-contracts.md` / `domain/reflection.py` | `TRIP_SUMMARY.day_date`·`STYLE_ANALYSIS` 가 계약에만 있고 코드 타입에 없다 — 표(§2.1)가 계약을 따랐으므로 어느 쪽을 정본으로 할지 정해야 한다 |
| `intent-matching-design.md` §2 파이프라인 · §7 INV-4 행 | **FALLBACK 자리에 되묻기를 넣는다.** 현행은 "기본 응답 + 수동 편집 안내"인데, 3차까지 실패한 9건/87 에 대해 "혹시 이런 뜻인가요"를 묻는 편이 낫다. 침묵하지 않으므로 INV-4 는 그대로 지켜진다 |
| `domain/llm.py` · `llm_gateway/config.py` · `prompts/` | 신규 `LlmFeature.INTENT_CLARIFY`(LIGHT) + `intent_clarify.yaml` + `IntentClarifyGate` — **BR-AF-07 5종 세트** 대상 |
| `agents/planb/rag.py` · `api/schemas.py` (코드) | PlanB `reason` 의 어휘(`weather`·`closed`·…·`none`)가 **`str` 필드의 주석으로만** 있다. `ARGUMENT_TABLE` 이 `choices` 를 가지려면 `EditOp` 처럼 타입이 되어야 한다 — 주석은 게이트가 검사할 수 없다 |
| `ai/docs/openapi.json` (자동 생성 — 손대지 않는다) | 자연어 진입 경계가 열리면 `scripts/export_openapi.py` 로 재생성. 경계 신설 자체는 §5 미결 #2 |
| `ai/claude.md` · `ai/README.md` | `IntentRouter` "미배선" 표기의 해소 조건을 이 FD 로 연결 (현행 문구는 "자연어 진입점이 열릴 때 배선된다") |
| `aidlc/.../unit-of-work.md` (모노레포) | U8 Conversational Assistant 의 ai 측 대응 산출물로 본 FD 를 연결. **유닛 번호는 붙이지 않는다**(번호 충돌 안티패턴) |

---

## 5. 미결 목록

| # | 내용 | 해소 시점 |
|---|---|---|
| 미결 #1 | **대화 상태 소유 합의** — BR-DLG-20 은 "백엔드 소유"를 제안일 뿐 합의가 아니다. 백엔드에는 assistant/chat 모듈도 테이블도 없고(`ChangeSource.ASSISTANT` enum 값만 있다) 저장 위치·보존 기간·삭제 요구 대응이 전부 미정 | 백엔드 트랙 합의 + 제품 O3("대화 이력 보관 정책") |
| 미결 #2 | **자연어 진입 경계가 없다.** 9개 경계 중 발화를 받는 것은 `/ai/v1/itinerary/edit` 의 `utterance` 하나뿐이고 그나마 백엔드가 안 부른다. 새 경계(`POST /ai/v1/dialogue/*`)를 열지, `/edit` 를 확장할지 미정 | 제품 결정 선행 — `backend/docs/design/work-graph.toml` `AI-NL-EDIT` ("우리 openapi 에 대응 표면이 없다. 화면·문구·확인 흐름이 정해져야 계약을 열 수 있다") |
| 미결 #3 | **봉투 이관과의 순서.** 다중 의도는 프레임마다 봉투 1개를 요구하는데, 에이전트 4종이 아직 `AgentTask` 밖 전용 타입(`ScheduleTask` 등)으로 호출된다 | agent-foundation 미결 #8 (AgentTask 이관). **그 작업이 보류 중이면 ④는 착수할 수 없다** |
| 미결 #4 | **`INFO_REQUIREMENTS` 가 2종뿐이다** — `GENERATE_SCHEDULE`·`REPLAN` 만 있고 나머지 11종의 수집 요구표가 없다. 프레임이 실행 가능해도 수집이 안 된다 | U5·U6 Provider FD |
| 미결 #5 | **도구 호출을 위한 신규 `LlmFeature` 필요 여부.** `INTENT` 를 재사용하면 프롬프트 하나가 도구/JSON 두 형태를 겸하게 되고, 분리하면 BR-AF-07 5종 세트가 든다 | 4.2 포트 확장 실장 시 |
| ~~미결 #6~~ | **해소 (팀 결정 2026-09-15)** — `IntentClarify` 의 질문은 **AI 가 만든다**(BR-DLG-31). 발화를 되짚어야 하므로 고정 문구로는 안 된다. `ArgumentClarify` 의 문안은 FE 가 인자 이름으로 조립해도 되고, 그쪽은 여전히 화면 설계 소관 | — |
| 미결 #7 | **`ExecutionPlan` 의 표현력 부족 가능성.** `AgentCall.task: str` + `params: dict` 라 프레임의 `intent`·`confidence`·`match_route` 가 컴파일에서 소실된다. 관측(LangSmith)에서 경로별 비중을 프레임 단위로 보려면 계측을 어디에 붙일지 정해야 한다 | ④ 실장 시 |
| 미결 #9 | **`OUT_OF_SCOPE` 거부 앵커 뱅크 부재.** 평가 발화 87건 중 25건이 `t_mid` 아래인데 그중 9건이 범위 밖이고 전부 엉뚱한 의도에 top1 이 붙는다(뱅크가 `ROUTABLE_INTENTS` 13종만 덮는다). 범위 밖은 **열린 집합**이라 전수 커버가 불가능하니 흔한 갈래(금융·계정·기기제어·잡담)만 덮는 것이 현실적이다. 이득은 정확도가 아니라 **비용**(3차가 이미 대부분 맞힌다) | 별도 티켓 |
| 미결 #10 | **의도 되묻기의 후보 선정 규칙이 미정.** `FALLBACK` 로 떨어진 발화에서 후보 2~3종을 무엇으로 뽑나 — 1차 top-k 의 상위 의도인가, 3차가 낮은 신뢰도로 낸 것과 그 경쟁자인가. 후보에 정답이 없으면 되묻기가 폴백보다 나쁘다 | DoD 실측 후 |
| 미결 #8 | **복합 의심 신호의 실측 근거가 없다.** BR-DLG-12 의 "접속 표지 + top1 < T_high" 는 가설이다. 복합 발화가 평가셋에 **0건**이라 현재로선 측정할 수 없다 | 평가셋에 복합 발화 항목 추가 (§6 확장) |
