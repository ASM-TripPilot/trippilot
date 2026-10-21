# 도우미 오케스트레이터 (assistant-orchestrator) — 비즈니스 로직 모델 (FD **초안**, 2026-10-17)

> **초안이다.** 승인 게이트(PR 리뷰) 전이고, 정본을 **수정하지 않는다** — 뒤집는 정본에는 이미 `[개정 · 2026-10-17 ·
> assistant-orchestrator FD]` 블록이 원문 보존으로 들어가 있고(목록은 business-rules §4), 그 블록과 이 문서가 어긋나면
> 이 문서를 고친다. 구현(spec-kit 구현 스텝 `ai/specs/001-assistant-orchestrator/tasks.md`)은 이 FD 와 **같은 PR** 에 실린다 — 코드가 FD 초판과
> 달라진 자리는 DE 본문에 코드 현행으로 반영했다(DE §2.6 dataclass 위치·`due`/`compress_fallback` 시그니처 · §2.10 요약 max_tokens).
>
> **설계의 단일 출처는 설계 브리프(2026-10-17, `ai/specs/001-assistant-orchestrator/research.md`)** 다. 이 문서는 브리프의
> 결정을 **왜** 그렇게 했는지와 **어떤 순서로 돌아가는지**만 적는다 — 타입·필드·불변식·와이어·DDL 은 `domain-entities.md`(이하 DE)가
> 정본이고 여기서 다시 쓰지 않는다. 사실 근거는 조사 보고 8편(ai-intent-gateway · ai-agents-providers · ai-api-tests ·
> ai-db-observability-deploy · be-assistant · fe-assistant · design-canon · eval-shadow), 코드 기준은 **origin/develop 3dc23b4b**.
> 유닛 번호는 붙이지 않는다(DE 머리말과 같은 이유).
>
> 숫자는 브리프 값 그대로다 — 해석 상한 9,000ms · BE read 14s · 턴 13s · 답변 ≤400자·줄 ≤6 · 요약 ≤20줄·줄 ≤120자 · 10턴마다 ·
> 일 LLM 턴 100 · 섀도 DEV 1.0/운영 0.2 · 만료 90일 · `recent_turns` ≤20건·text ≤300 · CANDIDATES ≤5. 바뀌면 브리프부터 고친다.

---

## 0. 사용자 결정 — 원문 요지 (2026-10-17)

브리프 §0 을 그대로 옮긴다. 이 여섯 줄이 이 유닛의 **요구사항**이고, 아래 §1 결정표는 전부 여기서 파생한다.

1. 의도 파악을 3단(뱅크 임베딩 → 투표 → LLM)으로 거치지 않고 **LLM 이 바로 분류**한다. 이상한 프롬프트는 막는다.
2. AI 에 **오케스트레이터**를 둔다 — 의도 파악 → 필요한 에이전트·Provider 에 **병렬**로 일을 시키고 결과를 받는다. 간단한 건 오케스트레이터가 직접 DB 조회.
3. 결과를 조합해 **사용자에게 보일 답변**을 만든다. 결과는 DB 에도 반영.
4. **장단기 메모리**: 세션 id 당 10턴을 20줄로 요약해 DB 에 저장, 같은 사용자가 다시 쓰면 로드.
5. 오케스트레이터에 agent·provider·DB 를 전부 연결. 새 agent/provider 추가 가능. EditAgent 를 살리는 방향도 좋다.
6. 질문뱅크 3단 경로는 **서비스에서 빼되 병렬로 돌려 성능만 측정**한다(섀도).
7. **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** (2026-10-19) "다룰 수 있는 카테고리를 늘려라. 그리고 정해진 의도에 맞춰 수행하는 것만이 아니라, 현재 구조에서 agent·provider 를 어떻게 활용하면 좋을지 생각하는 LLM orchestrator 를 둬라. 지금은 POI DB 를 제공하는 쪽으로 가면 되는데, 정해진 의도에서 벗어난다고 아무 일도 안 하면 안 된다." — 첫째 문장은 #1413(EXPLORE_PLACES, BR-AO-27), 둘째 문장이 2‴ 도구 계획(BR-AO-28·DEC-AO-17).

### 0.1 확인 질문(AskUserQuestion) 4건과 답

| # | 질문 | 사용자 선택 | 다른 안(기각) | 선택이 끌고 온 비용 |
|---|---|---|---|---|
| ① | 접근 | **안 A — 기존 `POST /ai/v1/dialogue/interpret` 확장** | 안 B 새 경계(`/ai/v1/dialogue/turn`)·BE 턴 서비스 새 분기 | 응답 키 집합 BE 게이트(정확 동등)·`extra=forbid` 때문에 AI·BE **한 PR** |
| ② | 메모리 저장소 | **AI 자체 DB 새 테이블**(`ai_kb.dialogue_memory`) | **설계자 추천은 BE `assistant_session` 의 jsonb 칸**(`dialogue_context` 와 같은 "저장·반송" 방식)이었다 — INV-U8-07·BR-DLG-20 과 충돌이 가장 작고 DATA-U8-02/05/06(즉시 파기·hard delete·export)이 **자동으로** 닿는다(design-canon design_notes). | 삭제·내보내기 경계 2개 신설, BE 파기 **3호출** + AI TTL 백스톱, 내보내기 섹션 추가, `TRIPPILOT_VECTOR_DB_URL` 상시 주입(임베딩 off 배포에도 DB 가 있어야 한다), DDL 정본 두 곳 갱신 |
| ③ | EDIT_SCHEDULE | **2단계 분리** — 1단계는 BE 기존 경로(`FRAME`) 유지 | 1단계부터 EditAgent 인프로세스 | 없음(지금 돌아가는 경로 그대로). 2단계는 스냅샷 `end_at`·`is_fixed` + `PROPOSAL`(§12) |
| ④ | 상한·섀도 | 일 LLM 턴 **30 → 100** · 섀도 **DEV 100% · 운영 20%** · 섀도 LLM 호출은 **사용량 상한 제외(로그만)** | 상한 유지(30 이면 하루 30문장 만에 버튼 모드) | COST-U8-02/06·OBS-U8-02 개정(적용됨), 운영 임베딩·LLM 호출 20% 추가(섀도 비용은 `llm_cost` 에 `:shadow` 접미로 따로 보인다) |

②의 기록을 남기는 이유: 사용자 결정은 그대로 따르되, 나중에 "왜 AI 쪽에 개인정보 파생물이 있나"를 묻는 사람이 **대안이 검토됐다는 사실**을
알아야 한다. 재제안하지 않는다.

### 0.2 설계가 기대는 실측 다섯 줄 (전부 DE §0 에 `파일:줄` 이 있다)

- 현 대화 경로는 `request_meta.deadline_ms` 를 **읽지 않는다** — INTENT 호출이 10s 기본으로 나가 BE 해석 상한(5s)과 어긋나 있었다. 새 설계는 반드시 읽는다(§4).
- `CountingLlm` 의 contextvar 카운터는 **스레드로 전파되지 않는다** — 섀도를 같은 스레드에서 돌리면 `llm_calls`(BE 사용량 상한 원천)에 섞이고, 다른 스레드면 아예 안 세어진다(§9).
- AI → BE DB **직접 SQL 없음**, 열린 길은 `/internal/pois` 둘(반경·배치 ≤200). trip_id 로 일정을 가져오는 어댑터 없음 — 일정은 요청 스냅샷으로만(§1 DEC-AO-5).
- BE `HttpDialogueInterpreterTest` 가 응답 키 집합을 **정확 동등** 단언, 요청은 `extra=forbid` — 한 PR, 배포 순서 있음(§13).
- FE 는 kind 10종·NextAction 17종·서버 발급 quick reply·평문 text 만 그린다 — **FE 변경 0** 이 되는 조건이고, 필수 배열 누락은 렌더 크래시(ErrorBoundary 없음)다.

---

## 1. 결정표 (DEC-AO)

| # | 결정 | 왜 (근거) |
|---|---|---|
| **DEC-AO-1** | **접근 A** — 새 경계가 아니라 `POST /ai/v1/dialogue/interpret` 를 확장한다(요청 += `session_id`·`account_ref`·`recent_turns`, 응답 += `outcome=ANSWER`·`answer`) | 새 경계면 BE `AssistantTurnService` 에 두 번째 AI 호출 분기와 FE 변경이 생긴다. 확장은 BE `answer()` 에 분기 **하나**(ANSWER → 검증 → 저장)만 추가하고 FE 는 0 이다. `outcome` 이 평문 str 이라 스냅샷도 바뀌지 않는다. 대가는 "한 PR" 뿐(§13) |
| **DEC-AO-2** | **서비스 판정 = `DIALOGUE_INTENT`(LLM 직접 분류, `IntentGate` 재사용)** · 3단 `IntentRouter` 는 **섀도 전용** | 사용자 결정 ①⑥. 분류에 history·memory·trip 을 넣으려면 변수가 늘어야 하는데 `intent.yaml` 은 못 건드린다(DEC-AO-3). 0회 경로의 가치(32%·<50ms)는 버리지 않고 **일치율·경로 비중**으로 계속 재서 되돌릴 근거를 남긴다 |
| **DEC-AO-3** | **새 `LlmFeature` 3종**(`DIALOGUE_INTENT`·`DIALOGUE_ANSWER`·`DIALOGUE_MEMORY`)을 둔다 — `INTENT` 재사용 아님 | ① `prompts/intent.yaml` 0.2.0 과 `tests/fixtures/intent_gate`(LLM 기록 61건, baseline 85/87)는 **불변**이어야 한다 — 재생 키가 `sha256(model\nprompt_id@version\n렌더 전문)` 이라 변수 하나만 더해도 전건 미스 ② 섀도가 재는 대상이 **현행 3단 그대로**여야 비교가 성립한다 ③ `PromptRegistry` 는 feature 당 yaml 1개(둘째 파일 불가) ④ 답변·요약은 출력 모양(`{text,footnote}`·`{lines}`)이 분류와 달라 게이트가 다르다. 비용은 BR-AF-07 세트 3벌(BR-AO-15) |
| **DEC-AO-4** | **섀도는 별도 LLM 래퍼(`ShadowCountingLlm`) + `TaggedTrace`(component `c1.gateway.shadow`) + trace 접미 `:shadow`** 로 분리한다 | ① contextvar 미전파 — 스레드로 넘긴 섀도 호출은 `CountingLlm` 에 안 세어지고(조용한 누락), 같은 스레드면 합산(쿼터 2배 소모) → **인스턴스 카운터(Lock)** 가 유일한 정직한 계수 ② `llm_calls` 는 BE 일 100·월 20,000 상한의 원천(사용자 결정 ④ "상한 제외") ③ `llm_cost` 는 trace_id 누계라 같은 id 면 요청 총액이 부풀려진다 → 접미로 장부 분리 ④ `LlmCallRecord.component` 가 `'c1.gateway'` 고정이라 트레이스 필터로 못 가른다 → 래퍼가 component 만 바꿔 위임(타입 개정 없음) |
| **DEC-AO-5** | **FAST_PATH 의 "DB 조회" = 요청 스냅샷 계산 + `POST /internal/pois/batch-get`** 배치 조회(신규 `PoiInfoProvider`) | AI 는 BE DB 접근 경로가 없다(SQL 0, trip_id→일정 어댑터 0). 권한 경계는 BE 스냅샷 화이트리스트(BR-U8-22·PBT-U8-3)에 있고 AI 에는 계정·권한 모델이 없다 — "직접 DB 조회"를 AI 로 옮기면 그 경계가 함께 옮겨온다. 스냅샷에 없는 것(좌표·영업시간·입장료)만 배치 조회로 메운다. 정본 개정은 적용됨(delegation §5·agent-structure-v2 §3 블록) |
| **DEC-AO-6** | **EDIT_SCHEDULE 은 1단계 `FRAME`**(BE `ProposalCards` `/edit` 경로 그대로), 2단계에 인프로세스 | 스냅샷 슬롯에 `end_at`·`is_fixed` 가 없다 — `VisitSlot` 은 `start_at<end_at` 를 강제하고 예약 닻 판정은 `is_fixed` 가 필요해서, 지금 EditTask 를 만들면 AI 가 **시각을 지어내야** 한다(INV-2 위반). 좌표 추가는 BE `ContextSnapshotBuilderTest` 의 부재 단언을 함께 바꾸는 일이라 이 PR 밖. 저장 지점은 어느 단계에서도 바뀌지 않는다(DEC-U8-2/3·BR-U8-30/33) |
| **DEC-AO-7** | **메모리 키 = `session_id`(PK)**, `account_ref` 는 **같은 계정의 다른 세션 요약 최근 2건**("지난 여행 기억")을 묶는 조회 키 | BE 세션은 (계정, 여행) 당 1행이라 세션 키만으로는 다른 여행의 기억이 안 보인다 — "같은 사용자가 다시 쓰면 로드"를 여행을 건너 성립시키려면 계정 식별자가 필요하다. 2건으로 제한하는 것은 프롬프트 토큰(요약 20줄 × 3)과 SEC-U8-08(스냅샷 최소화) 때문. `account_ref` 는 불투명 문자열이고 로그·프롬프트 금지(보안 검토는 미결 #8) |
| **DEC-AO-8** | **`DELETE /ai/v1/dialogue/memory` 는 200 `{deleted: n}`, 멱등(없으면 0)** | 204 는 본문과 양립 불가. BE 파기 경로가 지운 수를 로그에 남길 수 있고, 아웃박스 재시도(DATA-U8-02)가 두 번 와도 두 번째는 `deleted: 0` 으로 성공이다. 미결 #12 해소(브리프 최신판) |
| **DEC-AO-9** | **팬아웃 = 프로세스 공유 풀 하나 + `route_budget.measure_within` 패턴**(submit 전 마감 고정 → wait → pending cancel → PARTIAL) | 리포 선례 두 종(route_budget·_NL_POOL) 모두 공유 풀 — 요청마다 풀을 만들면 N×8 호출·submit 지연(실측 주석). `InfoCollector.collect` 는 순차·시한 무인식이라 **감싸지 않고 Provider 를 직접 submit** 한다(collect 는 그대로 둔다 — 코드 변경 0) |
| **DEC-AO-10** | **`Facts` 가 답변의 뼈대, LLM 은 `text`(와 `footnote`)만 짓는다** — kind·payload·next_actions·quick_replies·template_text 는 핸들러가 결정론으로 만든다 | INV-2·3 은 "값을 어디서 가져오나"의 문제라 LLM 이 값을 **만들 수 없는 구조**가 가장 싸다. INV-4 는 `Facts` 만으로 유효한 `DialogueAnswer` 가 항상 생기는 것(DE §2.5 post-init)으로 구조 보장된다 |
| **DEC-AO-11** | **시한 배분은 §4 표** — BE `interpret-stage-max-ms` 5000→**9,000**, read = interpret + 5,000 = **14s**, 턴 13s 유지, `daily-llm-turn-limit` 30→**100** | LLM 2~3회 + Provider 병렬이 5s 에 들지 않는다(분류 p95 ~4s 실측·PlanB 규칙 랭킹·KMA 소켓 4s). read 여유 5,000 은 다른 두 AI 경계의 `require(read ≥ deadline + 5000)` 와 같은 값. 13s 안이라 앱 15s 경고선을 넘지 않는다. 100 은 "모든 TEXT 턴이 LLM 턴"이 된 뒤의 값이고 **근거 없는 초기값**(COST-U8-02 개정 블록이 그렇게 적었다) |
| **DEC-AO-12** | **`Agent.handle(AgentTask)` 봉투 이관을 하지 않는다** — `PlanBAgent.run(PlanBRagRequest)` 를 직접 부르고 결과를 `TaskResult` 상태값으로 수렴 | 봉투는 넷 다 미구현(생산처 0)이고 agent-foundation 미결 #8 이 "IntentRouter 배선과 함께"로 보류 중. 이 FD 가 요구하는 것은 DL-5(예외 금지)·DL-4(시한 상속)의 **실질**이고, 그것은 `TaskResult`·`deadline_ms` 전달로 얻는다. 봉투를 여기서 열면 에이전트 4종 전부를 건드린다 |
| **DEC-AO-13** | **시한·상한 상수(`dialogue_orchestrator` 모듈 상수 — 초판의 `DialogueOrchestratorConfig` 묶음은 2026-10-18 삭제)는 env 로 노출하지 않는다**; env 는 `TRIPPILOT_DIALOGUE_ORCHESTRATOR`(on\|off)·`TRIPPILOT_DIALOGUE_SHADOW_RATE`(0~1) **둘뿐** | 브리프가 고정한 숫자를 운영 설정으로 열면 "바뀌지 않는 값의 설정화"다. env 키 하나의 비용이 5곳(allowlist·차트 range·테스트 2·.env.example·compose)이라는 실측도 근거. 기능 스위치와 샘플링 비율만 환경별로 다르다 |
| **DEC-AO-14** | **OUT_OF_SCOPE 는 문장 없음** — AI 는 `outcome=OUT_OF_SCOPE` + 내부 사유만, 문구·거절 스트릭은 BE SCOPE 카드 그대로 | 거절은 BE 가 세고(스트릭) 문안도 고정(DEC-U8-6 개정 블록의 "여전히 고정 문안"). LLM 거절 문장은 주입에 가장 취약한 자리다 |
| **DEC-AO-15** | **단기 기억 `recent_turns` 는 BE 가 요청에 싣고 AI 는 저장하지 않는다**; 장기 기억은 요약 20줄(파생물) | SEC-U8-06 "원문은 두 곳에만"을 유지하는 유일한 모양 — 요청 본문은 "LLM 벤더 호출 본문" 범주, 요약은 원문이 아니다. BE 는 `messages.findPage(sessionId, null, 20)` 에서 `text != null`(가려진 입력 제외)만 300자 절단해 싣는다 |
| **DEC-AO-16** | **리터럴 "내가 할 수 있는 것 보기"는 파이프라인 0단계에서 결정론 처리**(LLM 0회) | FE 상시 칩이 서버 발급 SHOW_CAPABILITIES quick reply 가 없을 때 이 문자열을 TEXT 턴으로 보낸다(fe-assistant). LLM 에 묻는 것은 비용·오분류 위험만 있다. TurnOutcome 불변식과의 정합은 미결 #19 |
| **DEC-AO-17** | **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** **2‴ 도구 계획** — 분류가 판단해서 닫은 말에 `DIALOGUE_PLAN` 1회로 읽기 전용 조회 도구(정보 핸들러 7종) ≤2 와 인자를 고르고, 팬아웃 1회 → `merge_facts` → 기존 답변 단계로 **프레임 없는 ANSWER**. 도구 없음·거절·실패·시한 부족은 종전 OUT_OF_SCOPE(BR-AO-28) | 사용자 결정 ⑦("정해진 의도에서 벗어난다고 아무 일도 안 하면 안 된다"). 기각: (a) 분류 프롬프트에 합침 — 범위 안 정확도·지연에 직접 닿아 측정이 섞인다(재평가 조건 미결 #24) (b) 벤더 tool-use·ReAct — 호출 수·시한이 열리고 9s 산술이 안 닫힌다 (c) Provider 직접 도구 — LLM 이 좌표·POI id 를 만들어야 해 INV-1 이 깨진다 (d) 규칙 플래너 — 조건부·복합 말을 못 푼다 (e) 도구 없음에 AI 고정 안내 — 화면 문장 한 벌(DEC-AO-14·BR-AO-06)을 어기고 숙소 화면의 STAY_SEARCH 를 잃는다 |
| **DEC-AO-18** | **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** **켜기 = 배정** — `DIALOGUE_PLAN` 이 기능별 모델(`TRIPPILOT_LLM_FEATURE_MODELS`)에 있으면 계획 워커를 조립하고, 없으면 조립하지 않는다(env 키 무증가) | 미배정 첫 런에 OPENAI_MODEL(terra)로 3s 시한 헛호출이 나지 않는다 · 기능 부재 ≠ 강등(이벤트 없이 종전대로) · 끄기는 배정 항목 손편집(미결 #25) **[개정 · 2026-10-20 · 두 질문은 계획으로]** 분류 0.2.4 부터 "종전대로"는 두 가지를 같이 묻는 말에는 성립하지 않는다 — 0.2.3 은 그 말을 의도 하나로 잡아 절반만 답했고, 0.2.4 는 null 로 닫아 계획 단계로 넘기므로 미배정 환경에서는 SCOPE 카드가 된다. 그래서 0.2.4 는 대상마다 배정(§13 2런)이 끝난 뒤에 머지한다 |

---

## 2. 모듈 배치 (브리프 §2.1 — 전부 새 파일, `wiring.py` 는 주입 줄만)

```
ai/
  src/trippilot/
    domain/
      llm.py                      (+) LlmFeature 3종 — DE §2.10
      freshness.py                (+) ProviderKind.POI_INFO — DE §2.9
    ports/
      memory_store_port.py        (신규) MemoryStorePort Protocol + DialogueMemory dataclass(DE §2.6 — 포트 모듈 내 dataclass 선례 llm_port.py·vector_store_port.py)
    orchestrator/
      dialogue_orchestrator.py    (신규) DialogueOrchestrator.turn(TurnInput) -> TurnOutcome · TurnInput/TurnOutcome/DialogueAnswer/
                                         시한 모듈 상수(§4) · 파이프라인 §3 · 시한 배분 §4 · 팬아웃 §6
      dialogue_handlers.py        (신규) HANDLERS(13종 — [개정 · 2026-10-19] 탐색 포함 14종) · Handler.plan/assemble · resolve_slot · Facts · 템플릿 문구(BE 이식) — §5
      dialogue_memory.py          (신규) due · compress_fallback · expires_at_for — §8 ($memory 조립은 dialogue_orchestrator._memory_lines)
      shadow_probe.py             (신규) ShadowIntentProbe · ShadowCountingLlm · TaggedTrace · ShadowRecord — §9
      dialogue_interpreter.py     (기존 — 로직 무변경) _answer·_from_match 공개 승격(미결 #17) · CountingLlm 은 off 경로에 그대로
      intent_router.py            (기존 — 무변경) 섀도 전용 인스턴스로 한 번 더 조립
      intent_eval.py              (기존) _is_refusal → is_refusal 이름만 공개(로직 무변경)
      info_collector.py           (+) INFO_REQUIREMENTS[GET_POI_INFO] = (POI_INFO,) 1행 — 문서·테스트 정합용(collect 는 부르지 않는다)
    providers/
      poi_info.py                 (신규) PoiInfoProvider(poi_db, fees) — LLM 0회, lookup_by_ids 만 — DE §2.9
    agents/adapters/
      pg_memory_store.py          (신규) PgDialogueMemoryStore(connect) — DML 만, 호출마다 connect(PgVectorStore 선례)
      memory_memory_store.py      (신규) InMemoryDialogueMemoryStore — 테스트·DSN 없는 로컬
    llm_gateway/
      workers/dialogue_intent.py  (신규) build vars($utterance $intents $history $memory $trip) · classify(..., timeout_sec)
      workers/dialogue_answer.py  (신규) build vars($intent $facts $utterance $history $memory $trip $style) · compose(..., timeout_sec)
      workers/dialogue_memory.py  (신규) build vars($previous_summary $recent_turns $trip) · summarize(..., timeout_sec)
      gates/dialogue_answer.py    (신규) {"text","footnote"} → ≤400자·줄 ≤6·_TIME_EXPR·has_contact_like — BR-AO-04
      gates/dialogue_memory.py    (신규) {"lines":[str]} → ≤20줄·줄 ≤120자·중복 제거·연락처·소요시간·~~빈 결과=실패~~ 전부 드롭=실패, LLM 이 비운 배열=새로 기억할 것 없음(성공·0건, 2026-10-19 개정) — BR-AO-09
      gates/intent.py             (기존 — 무변경) DIALOGUE_INTENT 가 feature 인자만 다르게 재사용
      config.py                   (+) tier_map·fallback_modes·effort/max_tokens 3표에 3행
    api/
      schemas.py                  (+) 요청 3필드 · 응답 answer · DialogueAnswerSchema 3종 · 메모리 경계 응답 2종 — DE §3
      dialogue.py                 (+) 사영: 요청→TurnInput · TurnOutcome→응답 · 메모리 DELETE/GET 핸들러 · off 면 기존 경로
      routes.py                   (+) DELETE/GET /ai/v1/dialogue/memory (getattr 패턴)
      wiring.py                   (+) 생성자 인자·조립·위임 줄만 — 경합 1위 파일, 자동 정렬 금지
  prompts/
    dialogue_intent.yaml · dialogue_answer.yaml · dialogue_memory.yaml   (신규, 전부 version "0.1.0")
    intent.yaml (0.2.0) · paraphrase.yaml                                 (무변경 — BR-AO-14)
  main.py                         (+) env 2종 해석 · 메모리 스토어 조립(DSN 있으면 Pg, 없으면 InMemory + WARN "도우미 메모리 미설정")
  scripts/mlops/intent_shadow_report.py   (신규) stdin 로그 → intent_shadow 파싱 → intent_eval.score 재사용 → 마크다운 — §9.3
  tests/fakes/                    (+) FeatureLlm · ScriptedProvider · StubPlanB — DE §8
  tests/fixtures/intent_gate/     (무변경)
deploy/
  eks/bootstrap.sql               (+) dialogue_memory 블록 — DE §4
  eks/runtime_secrets.py          (+) VECTOR_DB_URL 상시 합성 · AI_KEYS += 새 키 2개
  eks/chart/templates/ai.yaml     (+) VECTOR_DB_URL 상시 주입(embedding.enabled 블록에는 EMBEDDING_* 만 남긴다) · range 2키
  eks/chart/tests/test_chart.py · eks/tests/test_runtime.py   (+) 위 두 변경 고정
ai/docker/vector-init/02-dialogue-memory.sql   (신규) compose initdb — DE §4
.env.example · docker-compose.yml              (+) 새 키 2개 통로
.github/workflows/aws-dev-logs.yml             (+) namespace 입력(기본 trippilot) — §9.4
backend/modules/assistant/                     §10
```

**[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 새 파일 4 + yaml: `domain/plan_tools.py`(도구 표 `PLAN_TOOLS`·`NEVER_TOOLS`·`PLAN_GAPS`·`plan_tool_specs_json` — 도메인이라 c1 이 import 한다) · `llm_gateway/gates/dialogue_plan.py`(`DialoguePlanGate`·`DialoguePlanDraft`) · `llm_gateway/workers/dialogue_plan.py`(`DialoguePlanWorker`) · `orchestrator/dialogue_plan.py`(`plan_tools`·`step_tasks`·`step_results`·`merge_facts` — 순수) · `prompts/dialogue_plan.yaml`. 기존 파일은 앵커 주변만: `dialogue_orchestrator.py`(진입 2줄·`_plan_turn`·`_compose(closed=)`·요약 미룸) · `api/dialogue.py`(포트 선계산·배정 시 워커 조립·기동 줄) · `gates/base.py`(칸 머리 `[도구]`). `dialogue_handlers.py`·`domain/dialogue.py`·`wiring.py` 무변경.

**계층 규칙과의 관계**(agent-foundation L-1~L-6, `tests/test_architecture.py`): `orchestrator/` 가 `agents.planb`·`providers`·`poi_curation`·
`agents.adapters` 를 import 하는 것은 선례(`schedule_coordinator.py`)대로 허용이고, **반대 방향은 전부 금지**다 — 그래서 PlanBAgent 는 봉투
(`PlanBRagRequest`)로만 재료를 받고 Provider 는 `params` dict 로만 받는다. `providers/poi_info.py` 가 `agents/planb/composition.hours_label`
을 import 해야 하는 지점만 규칙의 회색지대라 미결 #16 으로 둔다. yaml 은 `llm_gateway/prompts.py`(프롬프트)·`main.py`(데이터) 두 곳 밖에서
읽지 않고, psycopg 는 `agents/adapters/` 안에만 있다.

---

## 3. 한 턴의 파이프라인 (0~7)

```
BE AssistantTurnService ──POST /ai/v1/dialogue/interpret──▶ api/dialogue.py (사영: 요청 → TurnInput, started_ms 1회)
                                                                │  TRIPPILOT_DIALOGUE_ORCHESTRATOR=off 면 기존 DialogueInterpreter 경로 그대로
                                                                ▼
                                                   DialogueOrchestrator.turn(TurnInput) -> TurnOutcome
 0  리터럴 "내가 할 수 있는 것 보기"  ─────────────────────────▶ 능력 안내 ANSWER(TEXT, 의도된 결정론, LLM 0, FallbackEvent 없음)   → 6
 1  context.pending 있음?  ──예──▶ answer_pending(기존 _answer) ─채워짐─▶ 프레임 완성(LLM 0)                                 → 4
                                                               └못 채움─▶ 보류 버림(BR-DLG-23) → 2
 2  메모리 로드(get + recent_for_account ≤2, 실패는 "없이 진행") → DIALOGUE_INTENT(LLM 1, timeout §4) → IntentGate
      ├ {"intent": null}·게이트 실패·시한 소진 ─▶ OUT_OF_SCOPE(reason: 거절 표지)                                            → 6
      │   └ 2″ null·범위 밖 라벨 ∧ 발화가 맞장구·인사 낱말뿐(BR-AO-26, 2026-10-19) ─▶ 받아 주는 한마디 ANSWER(TEXT, 프레임 없음)  → 6
      │   └ 2‴ 판단해서 닫은 말(null·범위 밖·목록 밖 라벨) ∧ 계획 워커 ∧ 잔여 ≥4.6s ─▶ DIALOGUE_PLAN(LLM 1) → 도구 ≤2 → 팬아웃 1회 → merge_facts → 5(closed) → 프레임 없는 ANSWER · 도구 없음·거절·실패 → OUT_OF_SCOPE  → 6
      └ IntentMatch(LLM_DIRECT) ─▶ ShadowIntentProbe.submit(utterance, trace_id, now, service=match, ms, llm_calls, turn_index)  ※ 기다리지 않는다
 3  from_match(기존) — 필수 인자 비면 ARGUMENT_CLARIFY(CLARIFY_QUESTIONS 고정 문안, clarify_count ≤1)                           → 6
      └ EDIT_SCHEDULE 이면 FRAME(executable) — 1단계                                                                           → 6
 4  HANDLERS[intent].plan(ctx) → 파 ≤2 → 공유 풀 팬아웃(§6: submit 전 마감 → wait → cancel → TaskResult) → assemble(ctx, results) -> Facts
 5  DIALOGUE_ANSWER(LLM ≤1, timeout §4; 잔여 <1.5s 면 호출 자체 생략) → DialogueAnswerGate
      ├ 통과 ─▶ DialogueAnswer.from_facts(facts, text=llm_text)           (LLM 문장 — LlmCallRecord 성공)
      └ 실패·생략 ─▶ DialogueAnswer.from_facts(facts, text=None)          (템플릿 — FallbackEvent 짝은 LLM 을 시도했거나 시도해야 했던 턴만; Facts UNAVAILABLE 직행·needTrip·사실 없는 Facts 직행(2026-10-19)은 의도된 결정론, 답변 단계 FallbackEvent 없음 — 팬아웃 실패는 4단이 작업별로 냈다)
 6  메모리: session_id 있고 due(turn_index − summarized_turn_index ≥ 10) 이면 잔여 ≥2.5s → DIALOGUE_MEMORY(LLM 1, ≤2.0s) → put
      └ 잔여 부족·LLM 실패·게이트 실패 ─▶ compress_fallback(결정론) → put + FallbackEvent(stage="memory") · 잔여 ≤0 ─▶ 압축·put 없이 건너뛴다(due 유지) + FallbackEvent(stage="memory")
 7  TurnOutcome(outcome, frames ≤1, clarify, answer, context, llm_calls=서비스 호출 수, reason) → 사영 → 응답
                                                                ▼
BE answer(): ANSWER → 검증(text ≤2000 · TYPES · kind · quick reply 서버 id qr-ai-{8자}-{i} 발급 · CANDIDATES poiId 정본 대조) → NewMessage 저장
             FRAME → 기존 IntentDispatcher(EDIT 1단계) · ARGUMENT_CLARIFY → CLARIFY 카드 · OUT_OF_SCOPE → SCOPE 카드 + 거절 스트릭
```

| 단계 | 하는 일 | LLM | 실패·시한 시 | DE |
|---|---|---|---|---|
| 0 | `normalize(utterance) == "내가 할 수 있는 것 보기"` 이면 BE `capabilities(hasTrip)` 문구를 이식한 결정론 ANSWER(TEXT) | 0 | 없음(순수) | §2.3 |
| 1 | 보류 프레임이 있으면 **그 인자 종류의 추출기 하나만** 돌려 채운다(assistant-dialogue BR-DLG-22 그대로) | 0 | 못 채우면 보류를 버리고 2 로 — 같은 질문을 다시 하지 않는다(BR-DLG-23) | §1 재사용 |
| 2 | `$utterance`·`$intents`(=`tool_specs_json()`)·`$history`·`$memory`·`$trip` 로 분류 1회. 산출을 `IntentMatch(match_route=LLM_DIRECT, confidence=draft.confidence or 0.5)` 로 조립 | 1 | 게이트가 산출을 받아들이지 못한 전부(`{"intent": null}` — 불확실·주입·역할변경·유해 —, closed-set 밖 라벨, 깨진 JSON, 슬롯 모양, 절단) → **OUT_OF_SCOPE + `not_classifiable` 표지**(intent_eval 이 거절로 센다); 시한·벤더 예외·비지원은 인프라 실패라 **표지 없이** OUT_OF_SCOPE(장애를 거절로 세면 정확도가 부풀려진다 — `_refusal_reason`). **[개정 · 2026-10-19]** 분류가 null·범위 밖 라벨로 닫았고(깨진 출력·절단은 아니다) 발화가 맞장구·인사 낱말뿐이면 범위 밖 카드 대신 결정론 ANSWER(BR-AO-26) | §2.2 |
| 2′ | 분류 결과를 알게 된 직후 `ShadowIntentProbe.submit` — 샘플링(rng) 통과 ∧ in-flight <4 일 때만 스레드에 넘기고 **응답 경로는 계속 간다** | 0(서비스) | 포화·샘플 밖은 `intent_shadow_skipped` 1줄. 섀도 실패는 응답에 영향 0 | §2.7 |
| 2‴ | **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 분류가 판단해서 닫은 말(BR-AO-28 진입 조건)에 `$tools`(노출 도구 — 배포마다 고정)·`$history`(최근 4건)·`$trip`·`$utterance` 로 계획 1회 → `DialoguePlanGate` → `HANDLERS[도구].plan` 을 팬아웃 1회(호출 2건이면 작업 이름 `{i}.` 접두) → 핸들러별 `assemble` → `merge_facts` → 5단계(목록 밖 장소 검사 강제·병합 답은 시각을 문장마다 그 문장의 이름에 귀속). `$memory` 는 싣지 않는다 | 1 | 잔여 <4.6s·워커 예외 → OUT_OF_SCOPE + 오케스트레이터 이벤트 · 시한·벤더·깨진 출력·전량 드롭 → OUT_OF_SCOPE + 게이트웨이 이벤트 · 도구 없음·거절 → OUT_OF_SCOPE(이벤트 없음) | §2.11 |
| 3 | 기존 `from_match` — `missing` 계산, 비면 `ArgumentClarify`(고정 문안). EDIT_SCHEDULE 은 인자 해소(day/target)만 하고 `FRAME` | 0 | `clarify_count ≥1` 이면 되묻지 않고 결정론 폴백(BR-DLG-33) | §2.2 |
| 4 | `plan` → 팬아웃 → `assemble`. 여행이 없는데 여행이 필요한 의도면 플랜 없이 `needTrip` Facts | 0 | Provider/PlanB 실패·TIMEOUT 은 `TaskResult.status` 로 들어오고 `assemble` 이 `notes`·`FactStatus.PARTIAL` 로 적는다 — 있는 것만 조립 | §2.4·§2.5 |
| 5 | `$facts`(JSON inline)·`$style` 로 문장 1회 → 게이트(≤400자·줄 ≤6·`_TIME_EXPR`·연락처) | ≤1 | 실패·잔여 <1.5s → `Facts.template_text`(BE 템플릿 이식). **kind·payload·next_actions·quick_replies 는 LLM 결과와 무관하게 Facts 값** | §2.3·§2.5 |
| 6 | 10턴마다 20줄 요약 → `put`(upsert + expires 연장 + 만료 행 정리) | ≤1 | `compress_fallback` 로 전진, 다음 턴에 LLM 이 다시 시도해 덮어쓴다. `session_id` 없으면 단계 전체 생략. 읽기 실패는 2 단계에서 "메모리 없이 진행" | §2.6·§4 |
| 7 | 응답 조립. `llm_calls` = 2+5+6 의 서비스 호출 수(실패 호출 포함, 기존 규칙) — 섀도 제외 | — | 경계 예외 금지(DL-5) — 수렴값은 미결 #14 | §2.2·§3 |

메모리 단계(6)는 outcome 과 무관하게 돈다 — OUT_OF_SCOPE·ARGUMENT_CLARIFY 턴도 `recent_turns` 가 쌓이므로 due 가 되면 요약한다. 단 시한이
먼저다: 잔여가 2.5s 미만이면 결정론 압축이고, 그마저 잔여 ≤0 이면 압축·`put` 도 하지 않고 이번 턴은 건너뛴다(다음 턴 due 가 유지된다 — `summarized_turn_index` 가 안 올라가므로; 건너뛴 사실은 `FallbackEvent(stage="memory")` 로 남긴다 — BR-AO-09·브리프 §2.2).

---

## 4. 시한 배분 (deadline_ms = BE `interpret-stage-max-ms` 9,000 기준 — BE 가 None 이면 AI 기본 9,000)

모든 잔여는 `TurnInput.started_ms`(경계 진입 시 1회 잡은 단조시계 원점) 기준 `remaining = deadline_ms − (clock.monotonic_ms() − started_ms)` 다.
wall-clock 직접 호출 금지(기존 규칙), 시계는 주입(`FakeClock` 으로 PBT AO-P5).

| 단계 | 상한 | 비고 |
|---|---|---|
| 분류 LLM(2) | `min(4.0s, 잔여×0.45)` (초판 2.5s·0.35 — 2026-10-18 실측으로 개정, 아래 註) | effort ~~low~~ **none**(**[개정 · 2026-10-20 · 분류·답변 사고 끔]** 분류 0.2.4 와 함께 — DE §2.10) · max_tokens 1024(초판 256 — DEV 실측 출력 239) · `GatewayFacade.call(timeout_sec=…)` 로 관통(종전 경로는 안 넘겨 10s 기본이었다) |
| 계획 LLM(2‴) | **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** ~~`min(3.0s, 잔여×0.45)`~~ `min(3.5s, 잔여×0.45)` — **잔여 ≥4.6s 일 때만** 부른다 **[개정 · 2026-10-20 · 계획 상한]** 상한 3.0 → **3.5s**(로컬 측정 러너 실측 — 개발 서버 실 트래픽이 아직 없어 아래 "DEV 20턴" 규칙 대신. 같은 시각 짝 3.0s 4/78 → 3.5s 2/78 시한 잘림, 같은 날 런 합 3.0s 10/154·3.5s 15/864(시각·판본이 섞인 합). 몫 0.45 그대로라 하한 산술·비율 사슬 무변경) | effort none(사고 끔 — 2026-10-20 실측 p50 1.36s·p90 2.28s) · max_tokens 1024 · 재시도 없음. 팬아웃은 호출이 2건이어도 1회(`min(3.0s, 잔여×0.4)`) |
| 팬아웃(4) | `min(3.0s, 잔여×0.4)` | **submit 전에** 마감을 고정하고 `wait(timeout)`, pending `cancel` → `TIMEOUT` 상태값 → PARTIAL. 파가 둘이면 같은 예산을 나눠 쓴다(1파 끝난 잔여가 2파 상한) |
| 답변 LLM(5) | `min(3.5s, 잔여−0.4s)` (초판 2.5s); **잔여 <1.5s 면 호출하지 않고 템플릿** | effort ~~low~~ **none**(**[개정 · 2026-10-20 · 분류·답변 사고 끔]** DE §2.10) · max_tokens 512. 0.4s 는 게이트·사영·직렬화 몫 |
| 메모리 LLM(6) | **잔여 ≥2.5s 일 때만**, 상한 2.0s | 아니면 `compress_fallback`(결정론). 요약은 응답 품질과 무관하므로 가장 뒤·가장 먼저 양보 |
| 섀도(2′) | 응답과 **무관**(백그라운드) — 자기 상한 = `IntentRouter` 기본 10s/호출 | 풀 2 · in-flight ≤4. 응답 경로가 섀도를 기다리는 일은 없다 |

중앙값 경로 산술(실측 부품값으로): 분류 ~1.8s(평가셋 평균 1,787ms) + 팬아웃 ≤3.0s + 답변 ~2s + 사영 ≈ 7s < 9s. 꼬리에서 분류 2.5s·팬아웃
3.0s·답변 2.5s 를 전부 쓰면 8.0s + 0.4s 여유로 9s 안이고, 메모리는 그 경우 결정론 압축이다.

**[개정 · 2026-10-18 · 실측]** 실 모델(gpt-5.6-luna, 분류 프롬프트 ≈2,000토큰·답변 ≈720토큰) 20턴: 끝난 턴 기준 분류 p50 1.6s·p90 1.9s·
최대 2.3s, 답변 p50 1.6s·p90 2.4s — 2.5s 상한에서 분류 20턴 중 1턴(→ 범위 밖 카드 + BE 거절 스트릭)·답변 17턴 중 2턴(→ 템플릿)이 잘렸다
(잘린 턴의 실제 값은 모른다 — BR §5 미결 #21). 상한을 분류 `min(4.0s, 잔여×0.45)`·답변 `min(3.5s, 잔여−0.4s)` 로 올린다. 최악 합은 여전히 9s 안이다 — 분류가 4.0s 를
다 쓰면 잔여 5.0s 에서 팬아웃 `min(3.0, 5.0×0.4)=2.0s`, 답변 `min(3.5, 3.0−0.4)=2.6s`, 남는 0.4s 는 사영 몫이고 메모리는 결정론 압축(또는
잔여 ≤0 이면 건너뜀)이다. 중앙값 경로는 그대로다(상한은 꼬리에서만 닿는다). 종전에 성공하던 턴(분류 ≤2.5s)의 팬아웃·답변 몫은
변하지 않는다. 새로 살아나는 턴은 분류 2.5~4.0s 구간(종전에는 범위 밖)이고, 이 턴들은 팬아웃 2.0~2.6s, 답변은 예약 400ms 에 묶이며 그
400ms 가 due 턴의 결정론 압축·put 까지 감당한다. 상한 합(4.0+3.0+3.5)은 9s 를 넘으므로 9s 보장은 **비율(0.45·0.4)과 답변 예약
400ms** 가 지킨다 — PBT 가 그 항을 직접 단언한다(`test_budget_is_honoured_wherever_time_goes`). 백엔드 쪽: 편집 의도(FRAME)는 분류 뒤
백엔드가 `/edit` 를 다시 부르므로, 분류가 ~3.7s 를 넘는 턴은 편집 시한이 8.0s 아래(≈7.6s)로 준다(턴 13s 안).

**[개정 · 2026-10-18 · DEV 배포 smoke 실측]** 개발 서버(EKS→같은 LLM 게이트웨이) 기동 직후 첫 턴(10번째 턴, 요약 due): 분류 4,237ms
(출력 239 토큰 — 사고 포함, 상한 256 에 붙음 → `max_tokens` 1024 로 상향) · 답변 2,032ms · 요약 1,963ms(빈 결과 → 결정론 압축) · 경계
8,311ms(200 ANSWER). 분류 상한 4.0s 를 237ms 넘기고도 성공했다 — SDK 시한은 단계(연결·읽기)별이라 호출 전체의 엄격한 상한이 아니다.
그 몫만큼 9s 를 넘을 수 있고, 백엔드 read 14s 가 흡수한다. 미들웨어 백스톱(deadline + 5,000 = 14s)은 **행(hang)**
에만 걸리는 마지막 그물이고 정상 소진은 항상 200 + 폴백이다(TRIP-291 규율).

BE 쪽: `interpret-stage-max-ms` 5000→9000 · 해석 read timeout = interpret + 5,000 = 14s(`require` 로 고정 — 다른 두 AI 경계와 동일) · 턴 예산
13s 유지(앱 15s 안) · 해석 `deadline = min(9000, remaining − 1000)` 는 산식 그대로 · `daily-llm-turn-limit` 30→100.

**[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 9s 보장은 상한의 합이 아니라 **비율 사슬**이 지킨다 — 분류 ≤0.45R, 계획 ≤0.45R, 팬아웃 ≤0.40R, 답변 ≤R−0.4s 라 어느 경우에도 0.4s 가 남는다(상한 합 ~~13.5s~~ 14.0s(**[개정 · 2026-10-20 · 계획 상한]** 계획 3.5s) 가 9s 를 넘어도 상관없다). 진입 하한 **4,600ms**: 계획이 0.45R 을 다 쓰고 팬아웃이 남은 것의 0.40 을 다 써도 답변 앞 잔여가 답변 시도선 1.5s 이상이려면 R ≥ 4,542ms(정수 내림: 4,542 → 계획 2,043 → 2,499 → 팬아웃 999 → 1,500). 4,500 이면 1,485 라 늘 템플릿이다(정정본 C1). 계획 턴의 팬아웃 몫은 분류 경로보다 작다(중앙값 ≈2.3s 대 3.0s) — SUGGEST_ALTERNATIVE 사슬(POI→풀→기상청→임베딩+벡터 3회)이 TIMEOUT 날 확률이 높아 상수는 그대로 두고 도구별 TIMEOUT 률을 관측한다(BR-AO-29 `task_status`). 계산(추정 — 실측 전): 중앙값 분류 1.6 → 계획 ~1.6 → 팬아웃 0.3~1.0 → 답변 ~1.6 ≈ 5.0~5.7s, p90 ≈8.4s. 요약 행 註 — 턴 서비스 LLM 이 3회면 요약을 한 번 미룬다(BR-AO-09). 실측 개정 규칙: DEV 에서 계획 p90 >2.6s 이거나 계획 시한 폴백 >5% 면 20턴 이상 실측해 상수를 고친다.

---

## 5. 의도별 처리표 (1단계) — `HANDLERS` 의 정본 서술

`plan` 의 1파는 확정 params, 2파는 1파 결과로 조립(`build(ctx, results)`; 좌표가 없으면 그 작업은 `UNAVAILABLE` 로 기록). `assemble` 은 순수.
템플릿 문구의 정본은 `workers/dialogue_answer.py`(`NEED_TRIP_TEXT`·`_ANSWER_TEXT`·`_EMPTY_TEXT`·`_UNAVAILABLE_TEXT`) — LLM 문장이 실패했을 때
그대로 나가는 문장이다. BE 원문이 있는 것(needTrip·SOURCE_UNAVAILABLE·`QueryCards`·`IntentDispatcher`·`ProposalCards` 문구)은 이식,
★ 표기는 이 FD 가 신설한 문구 — AO-P17 이 전수 게이트 검사한다. 아래 열은 `정상(status OK)` / `빈 결과(EMPTY)` 순이다.

| 의도 | plan — 1파 ∥ → 2파 | kind · payload | next_action | quick reply | 결정론 템플릿(폴백) | 비고 |
|---|---|---|---|---|---|---|
| SHOW_SCHEDULE | COMPUTE 스냅샷(scope: 오늘 남은/전체/N일차 — `scope` 인자·DATE·ORDINAL) | TEXT | OPEN_ITINERARY | () | OK: 결정론 요약 `"{날짜 라벨} {N}곳, … 일정이 있어요."`(`dialogue_handlers._assemble_show_schedule` 조립 — 길이 게이트를 넘으면 "일정은 일정 화면에서 확인할 수 있어요."★) / EMPTY "아직 일정에 장소가 없어요." | 문장이 길어지는 자리 — ≤400자·줄 ≤6 게이트에 가장 자주 걸린다 |
| GET_NEXT_SLOT | COMPUTE 스냅샷(now 이후 첫 슬롯) | INFO NEXT_SLOT rows[날짜·계획 시각] | OPEN_LIVE(IN_TRIP) / OPEN_ITINERARY | "다른 곳 추천"(SEND_TEXT, params intent=SUGGEST_ALTERNATIVE·slotKey) | OK "다음 장소예요." / EMPTY "남은 일정이 없어요." | 계획 시각은 스냅샷 `start_at` 그대로(INV-2). **params.intent 가 있는 quick reply 는 BE 가 해석 없이 `dispatched` 로 처리**(BE ACTION 규칙) → BE `ProposalCards.alternatives` 경로 — 미결 #6 |
| GET_WEATHER | 1파 POI_INFO(대상 슬롯 또는 당일 첫 슬롯 poi) → 2파 WEATHER(anchor=좌표, days=[date]) | INFO WEATHER rows[오늘 최대 강수확률] — BE 카드의 "특보" 행은 없다: AI `WeatherProvider` 패킷에 특보 칸이 없고 `triggers` 는 강수 임계를 넘긴 **날짜** 목록이라 특보가 아니다(2026-10-18 리뷰) | OPEN_ITINERARY | () | OK "오늘 예보예요." / EMPTY "지금 날씨를 확인할 수 없어요." | WEATHER_UNKNOWN·좌표 없음 → 템플릿. 일정이 없으면 좌표를 얻을 길이 없다 → 템플릿 + OPEN_ITINERARY_METHOD |
| GET_DISTANCE | 1파 POI_INFO(dest=`resolve_slot`, origin=직전 슬롯) → 2파 TRANSIT(purpose INFO_DISPLAY, mode 인자 또는 PUBLIC) | INFO DISTANCE rows[직전 구간] | OPEN_ITINERARY | () | OK "일정에 적힌 거리예요." / EMPTY "구간 거리는 일정에서 확인할 수 있어요." | **거리만**(`to_public_dict` — INV-3). 해소 실패·TRANSIT UNAVAILABLE → 템플릿 **[개정 · 2026-10-19 · E2E]** 경로 API 가 빠져 Provider 가 하버사인×우회계수(`confidence` LOW)를 내면 거리 뒤에 "(추정)"을 붙이고 메모("직선 거리로 어림한 값")를 싣는다 — 경로 거리처럼 보이면 "약 3.1km"(실제 5.8km)가 됐다 |
| GET_POI_INFO | 1파 POI_INFO(`resolve_slot(place)` 의 poi_id, on=날짜) | INFO PLACE rows[분류·영업시간·입장료] | OPEN_PLACE{poiId} | () | OK·PARTIAL "일정에 있는 장소예요." / EMPTY "장소 정보는 일정에서 장소를 눌러 볼 수 있어요." | 모르는 값은 "미확인"(~~hours_label None~~·fee None·장소 행 없음). **[개정 · 2026-10-19 · E2E]** `hours_label` None 은 "그 요일이 휴무로 읽혔다"라 **"휴무일 수 있음"**(단정하지 않는다 — 런타임 파서가 월 단위 휴무를 일정 배치용으로 매주로 넓혀 읽는다), 정보 없음은 Provider 문구("영업시간 정보 없음") 그대로, 영업시간 기준일이 오늘이 아니면 "날짜" 행을 앞에 둔다 — "미확인"으로 뭉개면 "오늘 영업 여부는 확인할 수 없어요"가 됐다. 일정 밖 장소명은 **해소하지 않는다**(지어내기 금지) → 템플릿 |
| SUGGEST_ALTERNATIVE | 1파 POI_INFO(target 좌표) → 2파 [PLACE 풀(anchor=대상 좌표, dates=그 날, 반경 규칙 기본) ∥ WEATHER] → PLANB `run(use_llm=False, excluded=일정 전부, rain, deadline_ms=잔여)` | CANDIDATES ≤5 [poiId·name·distanceRange·reason] | OPEN_ITINERARY | 후보마다 PICK_CANDIDATE{poiId, slotKey} 정확 1개 | OK "{대상} 대신 갈 만한 곳이에요."(BE `ProposalCards` 앞 문장 — 대상 이름이 게이트를 못 넘으면 "그 장소") / EMPTY "근처에서 대신할 곳을 찾지 못했어요."(후보 0·대상 미해소; 풀·PlanB 실패는 UNAVAILABLE 공통 문구) | 풀 = `CandidatePoolBuilder` 반경(INV-1), 풀 조립 → PlanB 는 **한 스레드 체인**(`PlaceProvider.resolve` 1회 pop). PICK_CANDIDATE 는 BE 기존 ReplaceSlot 제안 경로 |
| EXPLORE_PLACES ★ (2026-10-19) | 1파 [앵커: region → 지역 표 / 다음·첫 슬롯 → POI_INFO 좌표 / 여행 목적지 → 지역 표] → PLACE 풀(anchor, radius_override=앵커 반경, budget HIGH) → 결정론 정렬(BR-AO-27) | CANDIDATES ≤5 [poiId·name·reason("요즘 인기"/카테고리)·distanceRange(일정 근처일 때만)] | 후보마다 OPEN_PLACE | () — PICK 없음 | OK "가 볼 만한 곳을 찾아봤어요."★ / EMPTY "그 조건에 맞는 곳을 아직 찾지 못했어요."★ / 앵커 없음 → ARGUMENT_CLARIFY(region, "어느 지역에서 찾아 드릴까요? '부산'이나 '제주 애월'처럼 알려 주세요."★ — 요청당 1회, 이미 물은 뒤엔 같은 문장 TEXT) | 여행 불필요. 풀 실패 → UNAVAILABLE 템플릿. 말한 지역이 표에 없으면 EMPTY(다른 곳으로 바꿔 찾지 않는다) |
| EDIT_SCHEDULE | 인자 해소만(day/target) — 팬아웃 없음 | **FRAME** | — | — | —(전수표 값 "일정은 편집 화면에서 바꿀 수 있어요." 는 AO-P17 검사용, 1단계 경로에선 나가지 않는다) | 1단계: BE `ProposalCards` `/edit` 재호출. 2단계 §12 |
| GENERATE_SCHEDULE / REGENERATE | 없음 | TEXT 한 줄 | OPEN_ITINERARY_METHOD / OPEN_REGENERATE | () | ~~GENERATE_SCHEDULE "일정 만들기 화면으로 안내할게요." / REGENERATE "일정은 만들기 화면에서 다시 만들 수 있어요."~~ **[개정 · 2026-10-19 · 친근한 말투]** GENERATE_SCHEDULE "일정 만들기 화면으로 안내해 드릴게요. 아래 버튼을 누르면 바로 시작해요." / REGENERATE "일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 누르면 바로 시작해요."(EMPTY 없음 — 넘기기는 결과가 없다) | 여행 없으면 needTrip + CREATE_TRIP·OPEN_STAY_SEARCH. **넘기기 3행(6의도) 공통(2026-10-19)**: 사실이 비어 답변 LLM 을 부르지 않고 위 문구로 바로 답한다(BR-AO-25). **[개정 · 2026-10-19 · 친근한 말투]** 그래서 이 문구가 곧 그 턴의 답이다 — 안내 한 문장 + 아래 버튼(next_action 하나) 안내로 다듬었다(사용자 "지금은 너무 answer 만 띄워 주는 느낌", 프롬프트 0.3.0 과 같은 말투). 되묻기("…볼까요?")로 끝내지 않는다 — 분류 0.2.2 가 그 뒤의 "응"을 같은 의도로 읽어 같은 문장이 되풀이된다(2026-10-19 리뷰). BE `IntentDispatcher` 원문도 같은 문장으로 바꿨다(한 벌). 공유 정규식 오탐 표현("두 분이"·"이 시간에는")은 쓰지 않는다 — AO-P17 전수 검사 |
| REPLAN | 없음 | TEXT | IN_TRIP 이면 OPEN_REPLAN, 아니면 OPEN_REGENERATE | () | ~~IN_TRIP "남은 일정은 다시 짜기에서 바꿀 수 있어요." / 그 밖에는 REGENERATE 문구 "일정은 만들기 화면에서 다시 만들 수 있어요."~~ **[개정 · 2026-10-19 · 친근한 말투]** IN_TRIP "남은 일정은 다시 짜기에서 지금 상황에 맞게 바꿀 수 있어요. 아래 버튼을 누르면 바로 시작해요." / 그 밖에는 REGENERATE 문구 "일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 누르면 바로 시작해요." | 재계획은 BE 봉투(/planb/replan)가 유일한 정직한 경로(스냅샷에 창·from_instant 없음) |
| GENERATE_REFLECTION / TRIP_SUMMARY / STYLE_ANALYSIS | 없음 | TEXT | OPEN_REFLECTION / OPEN_TRIP_SUMMARY / OPEN_STYLE | () | ~~"회고는 기록 화면에서 만들 수 있어요." / "여행 요약은 기록 화면에 있어요." / "여행 스타일은 기록에서 볼 수 있어요."~~ **[개정 · 2026-10-19 · 친근한 말투]** "회고는 기록 화면에서 만들 수 있어요. 아래 버튼을 누르면 기록이 열려요." / "여행 요약은 기록 화면에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요." / "여행 스타일은 기록에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요." | STYLE_ANALYSIS 는 여행 없이도 된다(공통 규칙 예외) |
| OUT_OF_SCOPE | — | (outcome OUT_OF_SCOPE, 문장 없음) | BE SCOPE 카드 | — | —(전수표 값 "그건 제가 도와드리기 어려워요." 는 AO-P17 검사용 — BE SCOPE 카드 문구) | LLM 문장 없음 — 거절·스트릭은 BE 그대로(DEC-AO-14) |

**공통**: 여행이 없는데 여행이 필요한 의도(STYLE_ANALYSIS·OUT_OF_SCOPE 외) → `needTrip` "먼저 여행을 만들거나 숙소를 등록하면 일정을 함께 볼 수
있어요." + CREATE_TRIP·OPEN_STAY_SEARCH(BE 문구 그대로). 출처 불통(`FactStatus.UNAVAILABLE` — Provider·풀·PlanB 실패, 시한 소진)은 의도 공통
**"지금 일부 정보를 확인할 수 없어요."**(BE `FallbackCause.SOURCE_UNAVAILABLE` 이식, `_UNAVAILABLE_TEXT`). `Facts.places` 는 배치 조회·풀에서 온 것만(닫힌 목록). INFO `rows` 는 빈 배열이어도
**반드시 list**(FE 크래시 조건). `quick_replies=()` 는 "상시 칩만", `None` 은 "시작 칩 복귀" — 1단계 핸들러는 둘 중 `()` 를 기본으로 쓴다.

**[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** OUT_OF_SCOPE 행 — 분류가 판단해서 닫은 말은 2‴ 계획을 거친다(도구 없음·거절·실패면 종전 SCOPE 카드). 계획이 고르는 도구 7종(`PLAN_TOOLS`):

| 도구 | 돌려주는 것 | 뒤에서 쓰는 provider·agent (핸들러 안, LLM 0) | 인자 (필수) | 여행 필요 |
|---|---|---|---|---|
| SHOW_SCHEDULE | 날짜별 장소·계획 시각 | 요청 스냅샷 | day·date·scope | ○ |
| GET_NEXT_SLOT | 다음 한 곳·계획 시각 | 스냅샷 | aspect | ○ |
| GET_WEATHER | 날짜 하루의 최대 강수확률 | PoiInfoProvider(좌표) → WeatherProvider | date(`period` 는 숨긴다 — 핸들러가 안 읽는다) | ○ |
| GET_DISTANCE | 직전 구간 거리 | PoiInfo → TransitProvider | **destination**·origin·mode | ○ |
| GET_POI_INFO | 분류·영업시간·입장료 | PoiInfoProvider | **place**·date | ○ |
| SUGGEST_ALTERNATIVE | 대신 갈 곳 ≤5 + PICK | PoiInfo → CandidatePoolBuilder → Weather → PlanBAgent(use_llm=False) | **target**·reason | ○ |
| EXPLORE_PLACES | 등록 장소 ≤5 + OPEN_PLACE | 지역 표 / 일정 앵커(PoiInfo) → CandidatePoolBuilder | region·category·theme | × |

---

## 6. 팬아웃 패턴 — `route_budget.measure_within` 선례를 그대로

```
pool = ThreadPoolExecutor(8, "dialogue-fanout")          # 프로세스 공유 하나 — 요청마다 만들지 않는다(N×8 호출·submit 지연 실측 주석)
for wave in handler.plan(ctx):                           # 파 ≤ 2
    end_ms = min(now_ms + wave_budget_ms, fanout_deadline_ms)   # ★ submit 전에 마감 고정
    futures = {task.name: pool.submit(run_task, task, params(task, results)) for task in wave if params is not None}
    done, pending = wait(futures.values(), timeout=max(0, end_ms − clock.monotonic_ms()) / 1000)
    for f in pending: f.cancel()                          # 미완은 TIMEOUT 상태값 — 결과를 기다리지 않는다
    results |= {name: TaskResult(...)}                    # done 은 상태값(OK/LOW/UNAVAILABLE), pending 은 TIMEOUT, params None 은 SKIPPED
facts = handler.assemble(ctx, results)                    # 순수 — 이름(name) 키로 결정론 병합, 도착 순서 무관
```

- **예외는 상태값으로**: Provider 예외 → `UNAVAILABLE`(`InfoCollector` 와 같은 규칙), `PermissionDeniedError` 만 관통(fail-closed, TRIP-333).
  PlanBAgent 는 자체가 예외를 안 던진다(`is_fallback`·`empty_reason` 상태값).
- **시한 관통**: 작업 자체가 시한을 받는 것(PlanBAgent `deadline_ms`)에는 잔여를 넘긴다. Provider 는 어댑터 소켓 타임아웃(KMA 4s · TMAP/ODsay 2s ·
  BE urllib 10s)이 상한이라 **풀 `wait` 가 실질 마감**이고, 취소된 스레드는 끝까지 돌 수 있다(결과 폐기 — route_budget 선례와 같다). 그래서 풀이
  8이어도 느린 어댑터가 쌓이면 submit 이 밀린다 — 포화는 `TIMEOUT` 상태값으로 드러난다(침묵 없음).
- **`PlaceProvider.resolve` 는 1회 pop** — 풀 패킷을 꺼내는 스레드는 하나여야 한다. 그래서 SUGGEST_ALTERNATIVE 의 "풀 조립 → PlanB" 는 2파에서
  **한 작업(한 스레드 체인)** 으로 묶고, 풀 조립과 WEATHER 만 병렬이다(§5 표).
- **PARTIAL**: 하나라도 TIMEOUT/UNAVAILABLE 이면 `FactStatus.PARTIAL` + `notes`("날씨 미확인" 등) — 있는 것만 조립해 보고한다(delegation-design §5
  "step 일부 성공 = PARTIAL 조립", INV-4). 전부 실패면 `UNAVAILABLE` → 템플릿.
- `InfoCollector.collect` 는 **부르지 않는다**(순차·시한 무인식). `INFO_REQUIREMENTS` 의 `GET_POI_INFO` 행 추가는 표를 정합하게 두는 문서·테스트
  목적이고, 실행 표는 `HANDLERS` 다(delegation §5 개정 블록이 그렇게 적었다).

---

## 7. INV-4 폴백 계단 — 전부 결정론 수렴, 전부 보고

| 단계 | 실패 | 수렴값 | 보고 |
|---|---|---|---|
| 분류(2) | `{"intent": null}` · 게이트 전량 드롭 · LLM 실패·시한 | `TurnOutcome(OUT_OF_SCOPE, reason=거절 표지)` → BE SCOPE 카드 | `FallbackEvent(stage="llm", from="llm_dialogue_intent", to="out_of_scope")` — 게이트웨이가 낸다; 게이트웨이를 **부르지 못한** 잔여 0·워커 예외는 오케스트레이터가 같은 짝을 낸다(`_classify`) · reason 에 `not_classifiable`/`intent_not_routable`/`timeout`/`intent_error` |
| 팬아웃(4) | Provider UNAVAILABLE·TIMEOUT · PlanB 후보 0 · 좌표 없음(params None) | 있는 것만 `Facts(status=PARTIAL, notes=…)`; 전부 없으면 `UNAVAILABLE` → 템플릿 | `TaskResult.status` → `Facts.notes`(사용자 문장 재료) + OK 아닌 작업마다 `FallbackEvent(stage="fanout", from=작업명, to=TIMEOUT\|UNAVAILABLE\|SKIPPED, reason=예외 타입까지)` 1건 — Provider 장애가 운영자에게 보이는 유일한 자리 |
| 답변(5) | 게이트 실패(길이·줄·`_TIME_EXPR`·연락처·빈 문장) · LLM 실패 · 잔여 <1.5s | `DialogueAnswer.from_facts(facts, text=None)` = `Facts.template_text` | `FallbackEvent(from="llm_dialogue_answer", to="template_text")` + `GateDropEvent` |
| 요약(6) | 게이트 실패(~~빈 결과~~ 전부 드롭·상한 초과 — LLM 이 비운 배열은 실패가 아니라 이전 요약 유지·원문 조각 줄 삭제·`dialogue_memory_empty` 건수 로그, 2026-10-19) · LLM 실패 · 잔여 <2.5s · 잔여 ≤0 | `compress_fallback(recent_turns, previous)` → `put`; 잔여 ≤0 이면 압축·`put` 없이 건너뛴다(due 유지) | `FallbackEvent(stage="memory", from="llm_dialogue_memory", to="deterministic_compress")`(건너뛴 턴도 같은 stage 로 1건) |
| 메모리 읽기(2) | 스토어 예외 | 메모리 없이 진행(`$memory="(없음)"`) | WARN 1줄(`account_ref` 미포함) |
| 메모리 쓰기(6) | 스토어 예외 | 이번 턴 포기, 다음 턴 due 유지(`summarized_turn_index` 불변) | `FallbackEvent(stage="memory")` |
| 메모리 DSN 부재 | `TRIPPILOT_VECTOR_DB_URL` 없음 | `InMemoryDialogueMemoryStore`(프로세스 로컬 — 워커 2 × 파드라 "기억"은 성립하지 않는다) | **기동 WARN "도우미 메모리 미설정"**(ai-wiring 표식 토큰 `미설정`) |
| 섀도(2′) | 포화 · 샘플 밖 · 라우터 예외 | 응답 영향 0 | `intent_shadow_skipped {"trace_id","why"}` 1줄 — 세는 쪽이 분모를 안다 |
| 계획(2‴) | **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 잔여 <4.6s · 워커 예외(프롬프트 미등록 포함) | 종전 `OUT_OF_SCOPE`(reason `…; plan:skipped`·`plan:fallback`) | 오케스트레이터 `FallbackEvent(llm, llm_dialogue_plan→out_of_scope, budget_exhausted·plan_error)` |
| 계획(2‴) | 시한·벤더·비지원·비JSON·스키마 위반·절단·입력 호출 전량 드롭 | 종전 `OUT_OF_SCOPE`(`plan:fallback`) | 게이트웨이 FallbackEvent + `LlmCallRecord(success=False)` (전량 드롭은 GateDropEvent 도) |
| 계획(2‴) | 도구 없음(`calls=[]`)·거절(`refused`) — **의도된 결정론** | 종전 `OUT_OF_SCOPE`(`plan:no_tool`·`plan:refused`) | 이벤트 없음 · `LlmCallRecord(success)` · `dialogue_plan` 로그(NO_TOOL+gap / REFUSED) |
| 계획(2‴) | 일부 호출·칸 드롭 / 도구 작업 실패 | 남은 호출로 답 / 그 부분은 PARTIAL·UNAVAILABLE 로 병합 | GateDropEvent / 작업별 `FallbackEvent(stage=fanout, from=[i.]작업명)` |
| 요약(6) — 계획 턴 | 턴 서비스 LLM 3회 · 첫 차례 / 연속 차례 | 미룸(put 없음) / 결정론 압축 | `FallbackEvent(memory, …deferred 또는 deterministic_compress, turn_llm_cap(3))` |
| 경계(7) | 오케스트레이터 자체 예외(버그) | 미결 #14 — 두 안 병기(BR §5) | — |

침묵 실패가 없는지 보는 방법은 한 가지다: **LLM 을 시도했거나 시도해야 했던(재료는 있는데 잔여 부족 포함) 턴의 `template_text` 응답과
`compress_fallback` 쓰기·잔여 ≤0 건너뛰기에는 `FallbackEvent` 가 짝으로 있다**(AO-P5 가 시한 소진 경로에서 이것을 함께 단언한다).
**의도된 결정론은 폴백이 아니다** — 0단계 능력 안내(BR-AO-18)·`needTrip`(BR-AO-23)·`Facts.status = UNAVAILABLE` 템플릿 직행·사실(rows·places·notes·detail) 없는 `Facts` 직행(BR-AO-25, 2026-10-19)·맞장구·인사 답(BR-AO-26, 2026-10-19 — 분류 단계 이벤트는 분류가 낸 그대로)에는
답변 단계 `FallbackEvent` 가 없다(팬아웃 실패는 `_fanout` 이 작업별 `FallbackEvent(stage="fanout")` 로 이미 보고했다); `recent_turns` 가
비어 LLM 을 부르지 않는 압축도 같다. 둘을 가르지 않으면 정상 경로를 폴백으로 오보한다. 문장의 출처를 타입에 두던 `text_source` 와
`TurnOutcome.notes` 는 와이어·로그 어디에도 안 실리는 테스트 전용 메타라 지웠다(2026-10-18 리뷰) — 관측은 트레이스 이벤트 한 길이다.

---

## 8. 메모리 요약 흐름 (장기 기억)

```
turn 진입 ─▶ get(session_id) + recent_for_account(account_ref, exclude=session_id, limit=2)   # 둘 다 실패 허용(없이 진행)
          ─▶ $memory = _memory_lines(current, others) → 워커가 줄마다 inline()·join              # 현재 줄들 + "지난 여행 기억:" + 다른 세션 줄들
… 분류·답변 …
turn 말미 ─▶ due(turn_index, current.summarized_turn_index if current else 0)?  ──아니오──▶ 끝
                      │예
                      ▼
          잔여 ≥2.5s ──예──▶ DIALOGUE_MEMORY($previous_summary, $recent_turns, $trip; ≤2.0s) → DialogueMemoryGate(≤20줄·≤120자·중복·연락처·소요시간·~~빈 결과=실패~~ 전부 드롭=실패; 비운 배열 → 이전 요약 유지·원문 조각 줄 삭제)
                      │                    ├ 통과 ─▶ lines
                      │아니오               └ 실패 ─▶ lines = compress_fallback(recent_turns, previous)   + FallbackEvent
                      └──────────────────▶ lines = compress_fallback(...)                                 + FallbackEvent
          ─▶ put(DialogueMemory(session_id, account_ref, trip_id, lines, summarized_turn_index=turn_index, updated_at=now, expires_at=now+90d))
              # upsert · expires 연장(슬라이딩, BE 세션과 같은 값) · 같은 트랜잭션에서 DELETE … WHERE expires_at <= now() 1회(TTL 백스톱)
```

- **due 조건**은 `turn_index − summarized_turn_index ≥ 10` — `turn_index` 는 BE 가 올리는 값(INV-U8-07)이고 AI 는 읽기만 한다. 첫 요약은
  turn_index 10 에서, 그 뒤 20·30…. `recent_turns` 는 최근 10턴(≤20건)이라 한 번의 요약 입력이 정확히 지난 10턴이다 — BE 가 20건을 싣는 이유.
- **원문은 저장하지 않는다**(DEC-AO-15). 저장되는 것은 요약 20줄(파생물)이고, `compress_fallback` 산출이 발화 조각(줄당 ≤120자)을 담는 점은
  미결 #10 으로 남긴다 — LLM 요약도 발화 조각을 담을 수 있으므로 성격은 같다.
- **파기 3호출 + TTL**(DE §4.1): BE `clear`(session_id)·`deleteForTrip`(trip_id)·`purgeAccount`(account_ref) 가 `DELETE /ai/v1/dialogue/memory`
  를 부른다 — 200 `{deleted: n}` 멱등. `purgeAccount` 실패는 예외로 올려 아웃박스 재시도(DATA-U8-02), `clear`/trip 실패는 WARN + 90일 TTL 백스톱.
  만료 청소는 BE 가 AI 를 부르지 않고 AI TTL 이 같은 값(90일)으로 따라간다. **내보내기**는 `GET …?account_ref=` → BE `AssistantExportContributor`
  섹션 `assistantMemory`(DATA-U8-06).
- `http` 모드가 아닌 BE(`fake`·`off`)는 `DialogueMemoryPort` no-op — AI 메모리가 안 생기니 지울 것도 없다.
- 프로세스 로컬 dict 로는 기억이 성립하지 않는다(uvicorn 워커 2 × 파드) — 그래서 DSN 부재는 **WARN** 이고 운영 조건이 아니다(§7).

---

## 9. 섀도 — 3단 라우터를 서비스 밖에서 재는 법

### 9.1 조립 모양

```
# 서비스 경로(off 폴백·되묻기 답 읽기용) — 종전 그대로
counted  = CountingLlm(llm)
router   = IntentRouter(embedding, bank_store, intent_gateway=GatewayFacade(counted, renderer, IntentGate(), c1, trace),
                        paraphrase_gateway=GatewayFacade(counted, renderer, ParaphraseGate(), c1, trace), bank_ready=lambda: bank_index.indexed)
# 섀도 전용 — 같은 IntentRouter 클래스를 한 번 더, 게이트웨이 2개만 바꿔 조립 (코드 변경 0)
shadow_llm   = ShadowCountingLlm(llm)                    # 인스턴스 카운터 + Lock — contextvar 아님
shadow_trace = TaggedTrace(trace, component="c1.gateway.shadow")   # LlmCallRecord.component 만 바꿔 LoggingTrace 에 위임
shadow_router = IntentRouter(embedding, bank_store,      # 뱅크 스토어·bank_ready 는 서비스 것과 공유(읽기 전용)
                        intent_gateway=GatewayFacade(shadow_llm, renderer, IntentGate(), c1, shadow_trace),
                        paraphrase_gateway=GatewayFacade(shadow_llm, renderer, ParaphraseGate(), c1, shadow_trace),
                        bank_ready=lambda: bank_index.indexed)
probe = ShadowIntentProbe(shadow_router, rate=TRIPPILOT_DIALOGUE_SHADOW_RATE, pool=ThreadPoolExecutor(2, "intent-shadow"),
                          max_inflight=4, rng=random.Random(seed) | SystemRandom, logger="trippilot.intent.shadow")
```

- `probe.submit(utterance, trace_id, now, service=IntentMatch, service_ms, service_llm_calls, turn_index, meta)` 는 **분류 직후** 불리고 즉시
  돌아온다(`meta` = 측정 조건 dict, DE §5 — 발화·slots·account_ref 키는 거절). 스레드 안에서 `router.route(utterance,
  TraceId(f"{trace_id}:shadow"), now)` 를 돌려 `ShadowRecord` 를 만들고 `logger.info("intent_shadow %s", record.to_json())` 한 줄을 남긴다.
  섀도 `llm_calls` 는 `shadow_llm.count` 의 호출 **전후 차이**다 — `reset()` 은 부르지 않는다(공유 인스턴스에 0 을 쓰면 끼어든 요청의 계수를 지운다,
  anti-patterns §공유 어댑터 카운터). 풀 2 에서 섀도 둘이 겹치면 상대 호출이 섞여 **상한값**이 된다; 건별 정확 귀속은 §9.3 의 `:shadow` 집계로.
- rate 는 `rng.random() < rate` — rng 주입이라 테스트는 결정론(AO-P16). 샘플 밖·포화(in-flight ≥4)는 `intent_shadow_skipped` 로 분모를 남긴다.
- `prompts/intent.yaml` 0.2.0·`paraphrase.yaml`·뱅크·픽스처는 **무변경**(BR-AO-14) — 섀도가 재는 것이 현행 3단 그대로여야 한다.

### 9.2 로그 1줄 (로거 `trippilot.intent.shadow`, INFO) — 필드표는 DE §5

```
intent_shadow {"event":"intent_shadow","trace_id":"…","turn_index":12,
  "service":{"intent":"GET_WEATHER","route":"LLM_DIRECT","confidence":0.82,"llm_calls":1,"latency_ms":1650,"refused":false},
  "shadow":{"intent":"GET_WEATHER","route":"CONFIDENT","confidence":0.91,"reason":null,"llm_calls":0,"latency_ms":38,"refused":false},
  "agree":true,"utterance_chars":11,"utterance_sha12":"3f9a…",
  "meta":{"bank_sha":"f1104f0b83d0","t_high":0.82,"t_mid":0.75,"vote_ratio":0.8,"intent_margin":0.02,
          "intent_prompt":"prompts/dialogue_intent.yaml@0.1.0","shadow_prompt":"prompts/intent.yaml@0.2.0"}}
```

발화 원문·slots·`account_ref` 는 **타입에 칸이 없다**(SEC-U8-06, AO-P9). 모양은 `replan_reason {json}` 선례와 같아 `aws-dev-logs.yml` 의
`pattern=intent_shadow` 와 `sed 's/.*intent_shadow //' | jq` 가 그대로 먹는다.

### 9.3 집계 — `scripts/mlops/intent_shadow_report.py` (stdin → 마크다운)

줄마다 `Sample(label=Intent(service.intent), utterance="", match=IntentMatch(shadow…), latency_ms=shadow.latency_ms)` 를 만들어 `intent_eval.score()` 에
넣으면 `correct`=일치 수 · `confusions`=불일치 쌍(경계 3종 EDIT/REPLAN/GENERATE 표시) · `routes`=섀도 경로 비중 · `unrefused_fallbacks`=섀도 인프라
실패 · `p95_ms`=섀도 지연이 그대로 나온다 — 새 집계기를 쓰지 않는다. 서비스가 OUT_OF_SCOPE 를 낸 턴은 섀도의 거절 폴백을 일치로, 비거절 폴백을
제외로 세는 것이 평가셋 의미와 같다(`is_refusal` 공개 승격). 덧붙이는 열: 섀도 LLM 호출 합(`shadow.llm_calls` 합), skip 수·사유, `meta` 가 한 값인지
(섞였으면 경고). **라벨이 없으므로 accuracy 가 아니라 일치율**이고, **최소 2회 측정**(`ai/data/README.md` 규칙 — 실행마다 ±1 흔들린다) 뒤에만
"좋다/나쁘다"를 말한다. 섀도 LLM 호출의 **건별 정확 귀속**(겹침 없는 수)이 필요하면 로그의 `shadow.llm_calls`(상한값) 대신 `llm_cost`·`trace_event`
줄에서 trace_id 접미 `:shadow` 를 세거나 풀 1 로 돌린다. 섀도 기록으로 뱅크 보강 후보를 뽑는 것은 되지만 평가셋 문장은 쓰면 안 된다(leak ≥0.90 금지).

### 9.4 운영 꺼내기

`aws-dev-logs.yml` 에 `namespace` 입력(기본 `trippilot`)을 추가해 개발 대상 `trippilot-dev` 파드 로그도 꺼낼 수 있게 한다(지금은 하드코딩). 실행:
`component=ai, pattern=intent_shadow` → `ai.filtered.log` → `sed -n 's/.*intent_shadow //p' | uv run python scripts/mlops/intent_shadow_report.py`.
`ai-llm-fallback-watch.yml` 의 같은 하드코딩은 이 PR 범위 밖(미결 #7).

---

## 10. 백엔드 변경 요지 (같은 PR, 최소 — 브리프 §3)

| # | 파일 | 변경 |
|---|---|---|
| 1 | `domain/Dialogue.kt` | `InterpretOutcome.ANSWER` · `Interpretation.answer: InterpretedAnswer?`(kind·text·payload·nextActions·quickReplies·footnote) · `InterpretRequest` += `sessionId`·`accountRef`·`recentTurns` |
| 2 | `adapter/out/interpret/HttpDialogueInterpreter.kt` | Wire 요청 += `session_id`·`account_ref`·`recent_turns`; `WireResponse.answer` 기본 null; `toDomain` 검증 — text ≤2000(초과는 `DialogueInterpretFailed` 가 아니라 **폴백 메시지**), `next_actions ≥1 ∧ type ∈ NextAction.TYPES`(아니면 SHOW_CAPABILITIES 로 대체), kind ∈ {TEXT, INFO, CANDIDATES}, quick_replies action ∈ QuickReplyAction; read timeout = `interpretStageMaxMs + 5000`(`require`) |
| 3 | `application/AssistantTurnService.kt` | `answer()` 에 `ANSWER` 분기 → `NewMessage(kind, text, payload, nextActions, quickReplies=서버 발급 id qr-ai-{8자}-{i}, footnote = answer.footnote(기존 `NewMessage.footnote: String? = null` 칸), intent, matchRoute, outcome="ANSWER")`; CANDIDATES 는 `PoiSurfaceFacade.findSurfaces` 로 poiId 실존·이름 대조(없으면 제외, 전부 없으면 폴백), PICK_CANDIDATE params 의 slotKey 가 plan 에 실재하는지 확인; `recent_turns` = `messages.findPage(sessionId, null, 20)` 중 `text != null` 행만(role·text 300자 절단); `session_id`·`account_ref` 전달. `reply()` 헬퍼를 타 `llmCalls`·`matchRoute`·`dialogueContext` 집계 유지 |
| 4 | `AssistantProperties` / `application.yml` | `interpret-stage-max-ms` 9000 · `daily-llm-turn-limit` 100 (새 env 없음 — yml 기본값) |
| 5 | 파기·내보내기 | `DialogueMemoryPort`(http 모드만: DELETE/GET `/ai/v1/dialogue/memory`) → `AssistantSessionService.clear`·`deleteForTrip`(실패 WARN), `AssistantRetention.purgeAccount`(실패 throw → 아웃박스 재시도), `AssistantExportContributor` 섹션 `assistantMemory` |
| 6 | `FakeDialogueInterpreter` + 테스트 | ANSWER 도 낼 수 있게(로컬 기본·IT 연습); `HttpDialogueInterpreterTest` 키 집합 갱신(응답 += `answer`, 새 스키마 3종 키 집합), `AssistantTurnServiceTest` ANSWER 분기·quick reply 발급·길이 초과 폴백·llm_calls 집계, IT |
| 7 | 경로 게이트 | assistant 모듈에 `DIALOGUE_PATHS = listOf("/ai/v1/dialogue/interpret", "/ai/v1/dialogue/memory")` + 계약 실재 테스트(`CALLED_PATHS` 선례) |

BE 는 AI 문장을 **다시 검증**한다(2·3행) — AI 게이트가 1차, BE 가 2차. FE 가 받는 것은 종전과 같은 `NewMessage` 모양이라 FE 변경 0.

---

## 11. 배포 설정 변경 (브리프 §2.1 deploy 행)

| 대상 | 변경 | 왜 |
|---|---|---|
| `deploy/eks/bootstrap.sql` · `ai/docker/vector-init/02-dialogue-memory.sql` | `dialogue_memory` 테이블 + 인덱스 2 + `ai_user` DML GRANT(DE §4 DDL 그대로) | DDL 정본 두 곳, `ai_user` 는 CREATE 권한 없음 |
| `deploy/eks/runtime_secrets.py` | `TRIPPILOT_VECTOR_DB_URL` 을 **항상** 합성(종전 `embedding_enabled` 조건 제거) · `AI_KEYS` += `TRIPPILOT_DIALOGUE_ORCHESTRATOR`·`TRIPPILOT_DIALOGUE_SHADOW_RATE` | 임베딩 꺼진 배포에서도 메모리 DB 가 있어야 한다(선택 ②의 비용); allowlist 밖 키는 배포 거부 |
| `deploy/eks/chart/templates/ai.yaml` | `VECTOR_DB_URL` 상시 주입(`embedding.enabled` 블록에는 `TRIPPILOT_EMBEDDING_*` 만 남긴다) · `range` 목록에 새 키 2개 | 차트와 allowlist 는 한 세트 |
| `deploy/eks/chart/tests/test_chart.py` · `deploy/eks/tests/test_runtime.py` | 상시 주입·새 키·bootstrap 테이블 존재 고정 | 변경을 테스트가 잡아야 한다 |
| `.env.example` · `docker-compose.yml` | 새 키 2개 통로(기본 off·1.0) · `AI_LLM_FEATURE_MODELS` 줄에 `DIALOGUE_INTENT`·`DIALOGUE_ANSWER`·`DIALOGUE_MEMORY` 배정 추가 | 배정이 빠지면 기본 모델로 조용히 샌다(`_warn_unwired` 가 "미배정 N종" 으로 드러낸다) |
| `.github/workflows/aws-dev-logs.yml` | `namespace` 입력(기본 `trippilot`) | §9.4 |
| 로컬 compose | 기존 볼륨은 initdb 가 다시 돌지 않는다 — `docker compose down -v` 또는 수동 적용(README-local 한 줄) | DE §4 |

env **키**는 둘만 늘고(DEC-AO-13), LLM 배정은 기존 키 `TRIPPILOT_LLM_FEATURE_MODELS` 의 **항목**이 늘 뿐이다.

**[개정 · 2026-10-18 · 롤아웃]** 값 넣는 길이 하나 더 있다 — 로컬 AWS 자격(샌드박스 임시 토큰)이 만료되면 시크릿 손편집이 막히므로, 배포
입력 `dialogue_orchestrator`(keep|on|off)·`llm_feature_models`(`FEATURE=model,…` 덧씌우기)를 배포 역할이 시크릿에 쓴다(`push_mode`
선례 — `deploy/eks/runtime_secrets.sync`). 기능 이름은 **같은 커밋 `LlmFeature` 소스와 지금 떠 있는 AI 이미지(`kubectl exec`) 양쪽**에
있어야 쓴다 — sync 는 helm 보다 먼저 시크릿과 k8s Secret 을 덮고 helm --atomic 롤백은 그 Secret 을 되돌리지 않으므로(차트 밖 리소스),
새 이름이 든 런이 롤백되면 옛 이미지가 재시작 때 기동에서 죽는다(2026-10-18 리뷰 확정). 그래서 **새 기능 이름은 그 이름을 아는
이미지가 그 대상에 한 번 성공 배포된 다음 런에서** 넣는다(첫 런은 입력 없이). 지우는 문법은 없다(빼기는 시크릿 손편집). 운영 대상은 `TRIPPILOT_DIALOGUE_SHADOW_RATE` 가 비어 있으면 0.2 를 심는다(사용자 결정 — 개발은 AI 기본 1.0).
배포 smoke 는 AI 파드 안에서 도우미 한 턴(10번째 턴 — 요약 포함)을 실제로 돌리고 기억 행을 지운 뒤 `ai-dialogue:` 한 줄로 모양만
남긴다(기록만 — `report_ai_wiring` 과 같은 이유).

---

## 12. 2단계 — EDIT 인프로세스 설계 스케치 (이 PR 범위 밖, DE §9 가 표)

1단계가 끝낸 것 위에 네 가지만 더한다: ① 스냅샷 슬롯 `+= end_at·is_fixed`(BE `ContextSnapshotBuilder`·`SlotBlock`·`ContextSnapshotBuilderTest`
화이트리스트 + AI `DialogueSlotSchema`, 한 PR) ② `EditTask` 조립 — `solution` ← 스냅샷(`start_at`·`end_at`·`is_fixed`), `pool` ← 대상 좌표 앵커
반경 풀(1단계 SUGGEST_ALTERNATIVE 와 같은 2파), `poi_index` ← 배치 조회, `transport=PUBLIC`·`budget=MID`(현 `/edit` 와이어 기본값) ③ `EditAgent.run`
인프로세스 → `AnswerKind.PROPOSAL` + `proposal{base_days, days, apply_hint, violations}`(`EditProposal.Proposed` 와 같은 모양) → BE
`ProposalCards.proposed` 재사용(ground·`ItineraryFingerprint.of(baseDays)`·diff) ④ 저장은 **여전히 `/apply`**(DEC-U8-2/3). 바뀌지 않는 것:
`HANDLERS[EDIT_SCHEDULE]` 의 자리(지금 FRAME 을 내는 핸들러가 PROPOSAL 을 내게 된다), 시한 배분표(팬아웃 예산 안에서 EditAgent 가 돈다 — 번역 LLM
1회가 들어오므로 턴당 LLM ≤3 상한을 다시 봐야 한다), `CONFIRM_REQUIRED` 의 표현(`ArgumentClarify`·`NEED_MORE_INFO` 와 섞지 않는다 — 2단계 FD 결정).
2단계 FD 는 이 유닛 디렉토리에 `functional-design/` 개정으로 들어온다(새 유닛 아님).

---

## 13. 롤아웃 — 배포 순서와 되돌리기

```
① AI 배포 (TRIPPILOT_DIALOGUE_ORCHESTRATOR 미설정 = off)   — 요청 스키마가 먼저 열려야 BE 가 새 키를 보낼 수 있다(extra=forbid)
② BE 배포 (ANSWER 분기·9000/14s/100·파기 호출)             — 응답 `answer` 는 아직 null 로 온다(AI off) → 종전 FRAME 경로
③ DEV 시크릿 `trippilot-ai` read-modify-write (쓰기 세션/사용자 몫 — MLOps 세션은 AWS 자격 없음):
     TRIPPILOT_DIALOGUE_ORCHESTRATOR=on · TRIPPILOT_DIALOGUE_SHADOW_RATE=1.0 ·
     TRIPPILOT_LLM_FEATURE_MODELS 에 DIALOGUE_INTENT=…,DIALOGUE_ANSWER=…,DIALOGUE_MEMORY=… 항목 추가
④ AI 재기동 → `ai-wiring:` 표식 확인 — "도우미 메모리 미설정" 이 **없어야** 하고, "기능별 모델 배정" 줄에 3종이 있어야 한다("미배정" 에 셋이 남으면 ③ 누락)
⑤ 실연동 1턴(날씨·다음 장소·대안) 왕복 + `intent_shadow` 1건 확인(§9.4) → DoD
⑥ 운영(prd): 시크릿 값은 미결 #1(SHADOW_RATE 0.2). 개발·운영 배포 분리 규칙(develop=dev, main 승격분=prod) 그대로
```

**[개정 · 2026-10-19 · 장소 탐색]** 의도 EXPLORE_PLACES(BR-AO-27)는 순서가 **반대**다 — BE 가 먼저(또는 같이) 나가야 한다. 옛 BE 는 응답
frames 의 `EXPLORE_PLACES` 를 모르는 의도로 읽어(`Intent.valueOf`) 해석 실패 → AI_UNAVAILABLE 폴백으로 답한다(그 사이 탐색 발화만 해당, 다른 의도는 영향 0).
AI·BE 가 한 PR 이라 develop 머지 뒤 자동 배포가 둘을 함께 올리면 창은 배포 간격뿐이다.

**[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** **2런 배포** — 배포는 리포 자동화가 아니라 배포 담당 세션이 develop 머지를 감시해 디스패치한다. ① 1런(코드)은 그 세션이 알아서 올린다 — **배정 입력 없이**: `ai-wiring:` 에 "도우미 계획 단계 off … 미배선" 이 보이고 동작은 종전과 같다(`[도구]` 칸 머리 주입 거름만 첫 런부터 켜진다). **[개정 · 2026-10-20 · 두 질문은 계획으로]** 분류 0.2.4 는 이 순서에 기댄다 — 두 질문 말을 null 로 닫으므로 미배정 환경에서는 SCOPE 카드(+거절 스트릭)가 된다. 개발 머지가 운영까지 자동으로 올라가고 승격은 커밋을 골라 막지 못하므로, **0.2.4 는 개발·운영 2런이 모두 끝난 뒤에 머지한다**. ② 2런은 **명시 요청**한다 — 배포 입력 `llm_feature_models=DIALOGUE_PLAN=<모델>`: `runtime_secrets.merge_feature_models` 는 떠 있는 이미지가 그 이름을 알아야만 받는다. `ai-wiring:` 에 "on — 도구 7종 · 미배선 도구 0종(-)". ③ DEV 수동 3턴(앱 로그인 — 사용자 토큰 없이 부를 길이 없다) 또는 로그(`aws-dev-logs` `source=cloudwatch, namespace=trippilot-dev`)로 관찰 3~7일(BR-AO-29 지표) → 문턱을 넘으면 main 승격. 운영도 코드가 off 로 먼저 가고 실제 문턱은 **운영 2런(배정 입력)** 이다. **되돌리기 순서**: 대상마다 시크릿 `TRIPPILOT_LLM_FEATURE_MODELS` 에서 DIALOGUE_PLAN 을 손으로 지운다(AWS 자격 필요) → 입력 없이 재배포(Secret 은 sync-secrets 가 쓰고 롤아웃은 nonce 가 바뀔 때만) → 그 뒤에만 revert. 이름을 모르는 이미지는 `feature_model_env.py` 에서 '미지 feature' 로 기동이 죽는다 — `TRIPPILOT_DIALOGUE_ORCHESTRATOR=off` 는 도우미 전체 끄개라 이 문제와 무관하다. 로컬 `.env` 도 같다 — 이 이름을 아는 이미지를 빌드하기 전에 넣으면 로컬 AI 가 죽는다(머지 + 재빌드 뒤). "AI 만" PR 이어도 backend-ci(`.env.example` 경로 필터)·infra-validate(`domain/llm.py`)를 탄다 — 코드 변경 없이 초록이어야 정상이다.

되돌리기는 시크릿 `TRIPPILOT_DIALOGUE_ORCHESTRATOR=off` 한 줄 — off 면 사영이 기존 `DialogueInterpreter` 경로를 그대로 타고 BE 는 종전 `FRAME`
만 받는다(코드 롤백 불필요). 메모리 테이블은 남지만 쓰는 쪽이 없어 TTL 로 사라진다. feature 배정은 `.env.example` 정본 줄과 DEV 시크릿 **두 곳**이
갈라지지 않게 같은 값으로 적는다.
