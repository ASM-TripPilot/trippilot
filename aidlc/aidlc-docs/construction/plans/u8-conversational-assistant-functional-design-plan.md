# U8 Conversational Assistant — Functional Design Plan

> **유닛**: U8 — **C16 Conversational Assistant**(모듈 16) · 에픽 J · FR-ASSIST-01 · 원문 정본 = **PRD 02**(`aidlc/docs/PRD/02-AI어시스턴트.md`, 스토리 8종, 수용 기준·예외 완비)
> **스토리**: 인셉션 `stories.md`에는 **US-ASSIST 코드가 없다**. 에픽 J는 "한 줄 목록 8개 + 인터페이스 계약"뿐이고 상세 GWT는 "후속 인셉션에서 전개"로 남아 있다. 2026-10-12 `unit-of-work-story-map.md` 개정 블록은 "스토리 상세는 U8 FD에서 전개"로 적었다 → **Q1**
> **의존**: `unit-of-work-dependency.md` — U8 ← U0·U1·U2(포트)·U3·U4·U5. "Assistant는 U2 포트 재사용(신규 엔진 없음)". **U7 Community·U9 Collab은 2026-10-12 폐기**라 어시스턴트는 커뮤니티·공동편집에 의존하지 않는다(§1.5). **U10 GPS·위치 자동화**는 형제 신설 유닛이고 U8과 서로 의존하지 않는다(병렬).
> **경위**: 2026-08-31 착수 → 계획서·Q1~Q7까지 쓰고 답변 대기 상태로 `u8-fd-preserve` 브랜치(7f1fddba)에 보존. **2026-10-12 이 브랜치(`docs/aidlc-scope-refresh`)로 이관**하고 현재 구현에 맞춰 갱신했다(사용자 결정: "보존 브랜치 계획서를 가져와 갱신", audit 2026-10-11T16:20Z 항목).
> **정본 우선순위(2026-08-31 사용자 지시, 유지)**: **ai/ 폴더 문서가 우선 판단 기준**이다. 실장 우선 원칙과 겹치면 리포 실물 > **ai 문서** > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션 순이다. 단 **제품 불변식(단독 확정 금지 등 aidlc §3.5·PRD)과 ai 문서가 충돌하면 덮지 않고 질문으로 올린다**(Q7).
> **ai 문서 실제 위치**: 루트 CLAUDE.md가 `ai/docs/ai-architecture.md`로 적은 문서들은 실제로 `ai/aidlc-docs/inception/design-artifacts/`(ai-architecture·ai-implementation-design)와 `ai/aidlc-docs/inception/application-design/`(intent-matching-design·orchestrator-delegation-design·services·agent-io-contracts·agent-structure-v2)에 있다. `ai/docs/`에는 `openapi.json`(와이어 정본)이 있다.

---

## 0. 2026-10-12 갱신 요약 (보존본 대비)

| 구분 | 보존본(08-31) | 갱신(10-12) |
|---|---|---|
| ai 측 설계 | ai 문서 승계 A-1~A-8 | **ai `assistant-dialogue` FD 초안이 새로 생겼다**(`ai/aidlc-docs/construction/assistant-dialogue/functional-design/`, TRIP-853·930·868). 인자표·되묻기·멀티턴·대화 상태 소유 제안이 들어 있다 → A-9~A-12로 승계(§2) |
| 코드 | IntentRouter 미배선 | **여전히 미배선**이다(`api/wiring.py`가 import하지 않음). 그 사이 **인자표(`domain/dialogue.py`)·추출기(`orchestrator/arguments.py`)·거부 앵커 35문장**이 구현됐다 |
| LLM | 기능별 모델 혼재 | **전 기능 `claude-fable-5-1` 통일 + 기능별 effort**(fb0d51e2). 사고를 끌 수 없고 기본 effort가 high다. `INTENT`·`EDIT_TRANSLATION`은 effort 미지정(=high) → **Q10** |
| 범위 | U8→U7→U9 순서 | **U7·U9 폐기, U10 신설**. U8은 개발 범위로 들어왔다 |
| 질문 | Q1~Q7 | Q1 유지 · Q2 유지 · Q3→**Q7**(코드 근거 보강) · Q4→**Q8** · Q5→**Q3·Q4**로 분리 · Q6→**Q14**(코드로 사실상 해소, 확인만) · Q7→**Q15**. **신설: Q5(라우터 재사용) · Q6(경계·디스패치 주체) · Q9(전달 방식) · Q10(지연 예산) · Q11(rate-limit·가드레일) · Q12(진입점) · Q13(1차 대화 기능 범위)** |

---

## 1. 현재 구현 기준선 (2026-10-12)

전부 grep·파일 실측 결과다. 추정으로 채운 칸은 없다. 개수(경로 수·문장 수)는 드리프트하므로 정본 파일을 가리키고, 실측 시점 값만 괄호로 적는다.

### 1.1 ai/ — 있는 것

| 자산 | 상태 | 경로 | U8 관련성 |
|---|---|---|---|
| **Intent closed-set** 13종 + `OUT_OF_SCOPE`(폴백 전용) · `ROUTING_TABLE`(DELEGATE 8 / FAST_PATH 5 / FALLBACK) | 실재 | `ai/src/trippilot/domain/intent.py` | 라우팅 라벨의 정본이다. 숙소 계열 라벨은 없다(D-U8-2) |
| **3단 IntentRouter**(1차 질문뱅크 임베딩 CONFIDENT → 2차 유사질문 투표 VOTED → 3차 LLM_DIRECT → FALLBACK) · `IntentGate` | **구현·테스트 green, 프로덕션 호출자 0** | `orchestrator/intent_router.py` · `orchestrator/question_bank.py` · `llm_gateway/gates/intent.py` · `data/intent_question_bank.yaml` | U8이 처음 개통한다. 실측: 87발화 중 LLM 0회 32%, 정확도 85/87(97.7%), 평균 1787ms · p95 4231ms(2026-09-22, fable 통일 **전** 측정) |
| **거부 앵커**(`OUT_OF_SCOPE` 35문장, TRIP-868) | 실재 | `data/intent_question_bank.yaml` v0.7 | 범위 밖 요청을 1차에서 LLM 0회로 거절한다 → PRD 스토리 6·7의 1차 방어선 |
| **인자표 `ARGUMENT_TABLE`** + 인자 종류 9 + `tool_specs_json()` | 실재(TRIP-930) | `domain/dialogue.py` · `orchestrator/arguments.py` · `prompts/intent.yaml` v0.2.0 | 필수 인자가 있는 의도는 4종뿐(SUGGEST_ALTERNATIVE·EDIT_SCHEDULE·GET_DISTANCE·GET_POI_INFO) — 되묻기 대상 |
| **EditAgent**(자연어 → `EditCommand` 번역 → 어셈블리 재검증) | 실재 | `agents/edit/agent.py` · `domain/edit.py` · `llm_gateway/workers/edit_translation.py` | **현존하는 유일한 자연어 실행 경로**다 |
| `/ai/v1/itinerary/edit` — `utterance`(≤500자) **또는** `command`, `confirm` 재호출 | 경계 열림, **백엔드 호출자 0**(`HttpScheduleAgentAdapter.CALLED_PATHS`에 없음) | `api/schemas.py` `EditItineraryRequest/Response` · `ai/docs/openapi.json` | 응답 `status` = APPLIED / CONFIRM_REQUIRED / REJECTED / TRANSLATION_FAILED, `apply_mode` = AUTO_APPLY / CONFIRM_REQUIRED |
| **`resolve_apply_mode`** — 파괴적 op(REMOVE·CLEAR_DAY·REORDER_DAY·REPLAN) 또는 affected>1이면 CONFIRM_REQUIRED, **그 외는 AUTO_APPLY** | 실재 | `domain/edit.py:62` | D-U8-1(단독 확정 금지와 충돌). 단 AI는 무상태라 APPLIED는 "검증된 결과를 돌려줌"이지 저장이 아니다 |
| 에이전트 4종(Schedule·PlanB·Reflect·Edit) | 실재. **`AgentTask`/`spawn` 봉투 밖에서 호출**(agent-foundation 미결 #8) | `agents/*` · `orchestrator/schedule_coordinator.py` | 다중 의도(④)는 봉투 이관 전에는 착수할 수 없다(ai FD §8) |
| `ExecutionPlan`·`AgentCall`·`AgentKind.ORCHESTRATOR_FAST` | 타입만 있고 프로덕션 소비자 0 | `domain/execution.py` | FAST_PATH 5종의 실행기는 코드에 없다 |
| API 미들웨어 rate-limit | 실재 — **프로세스 전역 in-memory 토큰버킷**(`TRIPPILOT_RATE_LIMIT_RPS` 기본 100). 사용자별이 아니다 | `api/middleware.py` | 도우미 "분당 20회/사용자"(A-7)를 집행하지 못한다 → Q11 |
| LLM 배정 | `LlmFeature` 전 기능 `claude-fable-5-1`. effort는 REFLECTION_TEMPLATE·REMINDER_COPY·ALTERNATIVE_SELECTION 3종만 `low`, 나머지는 모델 기본(high) | `llm_gateway/config.py` `default_feature_effort` | `EDIT_TRANSLATION`은 low에서 게이트 위반으로 전량 드롭됐다(같은 파일 주석) → Q10 |

### 1.2 ai/ — 없는 것

| 없는 것 | 근거 |
|---|---|
| 도우미 대화 경계(`/ai/v1/assistant/*`·`/ai/v1/dialogue/*`) | `ai/docs/openapi.json` paths에 없다. ai FD 미결 #2 "새 경계를 열지 `/edit`를 확장할지 미정" |
| `AssistantOrchestrator`(services.md §2 `handle()`) | **문서에만** 있다(`services.md`). `src/`에 0건 |
| `dialogue_router.py`·`DialogueContext`·`PendingFrame`·`IntentClarify` | ai FD 초안의 설계 대상. 코드 미착수(되묻기는 "자리가 없다"로 착수 보류, ai FD §6.1.1) |
| FAST_PATH 실행기(GET_NEXT_SLOT·SHOW_SCHEDULE·GET_WEATHER·GET_DISTANCE·GET_POI_INFO) | `ROUTING_TABLE` 값뿐. `INFO_REQUIREMENTS`는 2종만(ai FD 미결 #4) |
| 대화·세션·턴 저장소 | ai·backend 어디에도 없다(ai FD domain-entities §0.1) |
| 스트리밍(SSE/WS) | ai·backend 모두 0건 |

### 1.3 backend/ — 있는 것 / 없는 것

| 자산 | 상태 | 경로 |
|---|---|---|
| `assistant` 모듈 | **없다**. `backend/settings.gradle.kts`에 없고 `grep -ri assist`는 change-log 2파일과 V2.11 마이그레이션만 걸린다 | — |
| `ChangeSource.ASSISTANT` | **있다**. enum과 DB CHECK 제약에 이미 들어가 있다 | `modules/change-log/.../ChangeLogEntry.kt:25` · `ChangeLogFacade.kt:57` · `V2.11__change_log.sql:8` |
| 구조적 편집 + 재검증 | **있다** — `EditItineraryService`(클라가 명시적 조작을 보내면 `/validate`·`/repair` 재검증) | `modules/itinerary-generation/.../EditItineraryService.kt` |
| 자연어 편집 연결 | **없다** — `work-graph.toml` `AI-NL-EDIT`(todo): "AI는 열었고 우리 표면이 없다 — 화면·문구·확인 흐름이 정해져야 계약을 열 수 있다(제품 결정 선행)" | `backend/docs/design/work-graph.toml` |
| 세션 테이블 선례 | `auth_session`(V1.4)·`replan_session`(V2.17·V2.60)·`generation_session`(V2.22·V2.27) | `backend/app/src/main/resources/db/migration/` |
| rate-limit | `RateLimited` 예외 + `GlobalExceptionHandler` 429·`Retry-After` 매핑은 있다. **던지는 곳이 없다**(사용자별 리미터 0). 알림 발송용 `PushRateLimits`만 있다 | `common/core/.../DomainException.kt:79` · `app/.../GlobalExceptionHandler.kt:54,74` |
| 금칙어 검사 | **있다** — `TextModerationFacade.inspect(text)`(moderation 모듈, 금칙어 사전) | `modules/moderation/.../api/TextModerationFacade.kt` |
| 서비스 간 인증 | `SERVICE_AUTH_TOKEN`(backend ↔ ai `X-Service-Token`) | `app/src/main/resources/application.yml` |

### 1.4 frontend/ — 있는 것 / 없는 것

| 자산 | 상태 |
|---|---|
| 어시스턴트 화면·라우트·feature | **없다** — `assistant`·`어시스턴트` 매치 0(`도우미`는 테스트 헬퍼 주석뿐), 밴드 `b` 라우트 0 |
| 기존 FAB | **이미 여럿 있다** — 홈 `CreateTripFab`(여행 만들기)·담은 곳 saved-menu 미니 FAB(`pages/home/ui/HomeScreen.tsx`), 탐색 랜딩 여행 만들기 FAB(`pages/explore/explore-landing`), e02 숙소 검색 FAB, i01 "일정 수정" FAB, j01 "오늘의 회고" FAB. `shared/ui/Toast.tsx`는 "FAB 스택 윗변(바닥 208)" 위 220에 뜨도록 맞춰져 있다 |
| 비로그인 모드 | **없다** — 부트스트랩 `GUEST → LOGIN`(`src/mocks/scenarios.ts`), 비로그인 딥링크는 초대·공유 화면에 한정(`frontend/README.md`) → Q14 |
| 바텀시트 | `@gorhom/bottom-sheet` 실사용. 딤·실제 열림은 jest로 판정할 수 없다(`frontend/.claude/rules/repo-traps.md`) — 어시스턴트 시트도 같은 제약을 받는다 |
| 생성 API 클라 | orval 생성 `changeLogEntrySourceType.ts`에 ASSISTANT 값만 들어와 있다 |

### 1.5 범위 변경의 영향 (U7·U9 폐기 · U10 신설)

- **커뮤니티 의존 제거**: PRD 스토리 6의 "'여행자 커뮤니티' 섹션 금칙어·모더레이션 정책과 동일 계열"은 커뮤니티 폐기로 참조처가 없어졌다. 실제로 쓸 자산은 backend `moderation` 모듈(`TextModerationFacade`)이다. 같은 스토리의 "커뮤니티 공개 콘텐츠는 작성자 공개 범위만" 조항은 N/A다.
- **공동편집 의존 제거**: `ChangeSource.COEDIT`는 enum에 남아 있지만 어시스턴트와 관계없다. 대화 이력·변경 이력에 공동편집자 축은 없다.
- **U10과의 경계**: 어시스턴트 컨텍스트에서 "현재 위치"는 **포그라운드 위치·수동 체크인 기준선**만 쓴다(U10 개정 블록: `geofence.ts` degrade 스텁). 지오펜스 자동 도착 같은 U10 산출물에는 의존하지 않는다.

---

## 2. ai/ 문서 대조 — 승계 결정과 드리프트

### 2.1 승계 (재설계하지 않는다)

| # | 승계 결정 | 출처 | 10-12 상태 |
|---|---|---|---|
| A-1 | 의도 파악 = 질문뱅크 하이브리드 3단, 라벨 closed-set(INV-1 동형) | `intent-matching-design.md` | 코드 실재·미배선 |
| A-2 | 위임 봉투 AgentTask/AgentResult(SUCCESS·FALLBACK·PARTIAL·FAILED·TIMEOUT·NEED_MORE_INFO), 해석 1회·마감 상속·예외 금지 | `orchestrator-delegation-design.md` | 타입 실재, 에이전트 호출은 봉투 밖(미결 #8) |
| A-3 | 컨텍스트는 참조로 전달(`context_refs` + requester 권한 재조회). PRD 스토리 6 "주입 단계 권한 경계"와 맞물린다 | 〃 §2 (D31) | 와이어 실례: generate·replan은 백엔드가 조립한 페르소나를 inline으로 싣는다(AI-D09 부분 개정) |
| A-4 | 라우팅 테이블이 유일 기준이다(Delegate 4 / Fast Path 5 / Fallback) | 〃 §5 · `agent-structure-v2.md` | 코드 정정 2026-09-24: Fast Path 3종의 handler 이름(WeatherAgent 등)은 실재하지 않아 삭제 |
| A-5 | AssistantOrchestrator.handle() 흐름(route → 워커 → EditCommand → validate → apply_mode 분기) | `services.md` §2 | **문서에만 있다** → D-U8-5, Q6 |
| A-6 | 지연 예산: 도우미 첫 응답 **3초**(부분 응답 + next_action) · 전체 15초 · Fast Path 500ms | `services.md` §5.1 · `agent-io-contracts.md` IO-1 | fable 통일 뒤 재측정이 없다 → Q10 |
| A-7 | rate-limit: 도우미 분당 20회(429 + Retry-After) | `services.md` §5.4 | 사용자별 집행기가 어디에도 없다 → Q11 |
| A-8 | 빈 응답 금지, next_action 필수 = PRD 스토리 1 "dead-end 금지" | `services.md` §2.2 · PRD 02-1 | — |
| **A-9** | **의도는 뱅크가, 인자는 표가 맡는다.** 3차만 의도별 인자 스키마를 받고, 1·2차는 규칙 추출기로 LLM 0회를 유지한다(BR-DLG-01·07) | ai `assistant-dialogue` FD §0·§3 | 인자표·추출기 구현됨 |
| **A-10** | **대화 상태 정본은 백엔드, AI는 무상태**(`DialogueContext`를 받고 갱신본을 돌려준다). AI에는 대화 기록이 아니라 **보류 프레임만** 넘긴다(BR-DLG-20·21) | 〃 §4 · business-rules §1.3 | **제안 단계**(미결 #1 "백엔드 합의 필요") → Q3 |
| **A-11** | 되묻기 상한: 프레임당 1회·요청당 1회, 초과 시 결정론 폴백(BR-DLG-23·33). `NEED_MORE_INFO`를 사용자 되묻기로 재사용하지 않는다(BR-DLG-25) | 〃 | 설계만 |
| **A-12** | 다중 의도: 프레임 최대 2개, 상태 변경 의도는 발화당 1개(BR-DLG-10·11). **착수 조건 = AgentTask 봉투 이관 + 복합 평가셋** | 〃 §5·§8 | 착수 불가 상태 → Q13 |

### 2.2 드리프트 (질문으로 올림)

| ID | 관측 | 처리 |
|---|---|---|
| D-U8-1 ★ | ai `resolve_apply_mode`가 비파괴·단일 슬롯 편집을 **AUTO_APPLY**로 판정하고 EditAgent가 확인 없이 `APPLIED`를 돌려준다(`domain/edit.py:62`) ↔ PRD 스토리 4·aidlc `components.md` §3.5 "**명시적 확인 없이 자동 확정·저장 금지**" | → **Q7** |
| D-U8-2 | Intent 13종에 **숙소 탐색 재질의 라벨이 없다** ↔ PRD 스토리 2가 명시적으로 요구한다 | → **Q8** |
| D-U8-3 | `agent-io-contracts.md:370` "AI 도우미 채팅 화면 = 와이어프레임에 부재(M16, 타 팀 담당)"가 **낡았다**. 라이브 Figma에 밴드 `b` 7코드가 있고 M16 담당은 이 트랙(U8)이다 | FD에서 ai 문서 갱신을 올린다(ai 패키지 소유라 협의) |
| D-U8-4 | 도우미 경계 **리소스명 미확정**. ai FD는 `POST /ai/v1/dialogue/*` 후보만 적었다 | → **Q6** |
| **D-U8-5** | services.md의 **AssistantOrchestrator(AI 안에서 위임까지 수행)** ↔ 현행 실행 흐름은 **백엔드가 소유**한다. 생성(`generation_session`)·재계획(`replan_session`)·편집(`EditItineraryService`)이 백엔드 세션·영속을 거치고, AI는 그 흐름이 부르는 무상태 경계다. AI가 내부에서 REGENERATE·REPLAN을 위임하면 백엔드 세션 수명주기를 우회한다 | → **Q6** |
| **D-U8-6** | 지연 예산 A-6(첫 응답 3s)은 경량 모델을 전제로 잡혔다 ↔ 지금은 전 기능이 사고를 끌 수 없는 `claude-fable-5-1`이고 `INTENT`·`EDIT_TRANSLATION` effort가 미지정(=high)이다. 3s 안에 드는지 실측이 없다 | → **Q10** |
| **D-U8-7** | PRD 스토리 6 "커뮤니티 금칙어 동일 계열" 참조처가 U7 폐기로 사라졌다 | §1.5. `TextModerationFacade`로 대체(Q11) |

---

## 3. 라이브 Figma 밴드 `b` 구조 (2026-08-31 관측, 재관측 안 함)

밴드 맵 정본: `frontend/.claude/skills/spec-perception/reference/figma-structure.md`. 밴드 `b` = AI 어시스턴트, "M16 — first-cut 밖"으로 표기되어 있다. U8 편입으로 이 표기는 개정 대상이다(frontend 하네스 소유라 FD에서 상신만 한다). 아래 코드 7개는 보존본 관측값이고 이번 갱신에서 Figma를 다시 호출하지 않았다. node id는 믿지 말고 계획 4단계에서 라이브 이름으로 다시 찾는다(`figma-traps.md`).

| 코드 | 프레임(변형) | PRD 스토리 대응(이름 기준 잠정) |
|---|---|---|
| `b01-assistant` | default · review · zero-result | 1 호출·컨텍스트 + 2 재질의(0건 완화안) + 3 진행 검토 |
| `b02-action` | default | 4 액션 위임(전후 비교·[적용]) |
| `b03-scope` | default | 7 범위 한계·외부 위임 |
| `b04-guardrail` | default | 6 가드레일 거절 |
| `b05-fallback` | error · solver-unavailable | 8 폴백(LLM 실패 / 솔버 비가용) |
| `b06-history` | default | 5 대화 이력·세션 |
| `b07-no-context` | default | 1 예외(무컨텍스트 일반 도움 모드) |

---

## 4. 실행 계획

- [x] 1. 유닛 컨텍스트 — `unit-of-work.md` U8(10-12 개정 블록 포함) · 에픽 J 인터페이스 계약 · `components.md` C16·§3.5 · FR-ASSIST-01 · **PRD 02 원문 통독**
- [x] 1b. 기존 자산 실측 — **2026-10-12 재실측**(§1: ai·backend·frontend)
- [x] 1c. 라이브 Figma 밴드 `b` 구조 매핑(08-31 관측 승계, §3)
- [x] 1d. ai/ 문서 대조 — A-1~A-12 · 드리프트 D-U8-1~7(§2). ai `assistant-dialogue` FD 초안 통독 포함
- [x] 1e. **보존본 이관·갱신**(7f1fddba → 이 브랜치) — 질문 재편(§0 표)
- [x] 2. **질문 Q1~Q15 답변 수집**(§5) → 모호한 답이 있으면 후속 질문 파일
- [x] 3. (Q1=A 시) **US-ASSIST-01~08 전개** — PRD 02 기반으로 코드를 붙이고 `stories.md` 개정을 올린다. U7 폐기로 사라진 참조(스토리 6 커뮤니티 조항)를 정리한다
- [x] 4. 밴드 `b` 시각 확인 — `b01`·`b02`·`b05` 우선, 진입점 배치(Q12) 재판정. 라이브 이름으로 다시 찾는다 *(2026-10-12 완료: 10프레임 전부 스크린샷 확인, 행 y=3599, id `1266:1209`·`1267:1208`~`1277:1208`. ✦ FAB는 밴드 `b`에 없음 → G-U8-9. `b01 default`·`zero-result`의 대화 안 숙소 결과는 Q8=A와 충돌 → G-U8-8)*
- [x] 5. `business-logic-model.md` — DEC-U8-\* · 대화 파이프라인(진입 → 컨텍스트 스냅샷·권한 필터 → 금칙어·rate-limit → ai 해석 → 디스패치/되묻기/폴백 → 제안 → [적용] → 기존 경로 재검증·반영 → change log) · backend↔ai 경계 계약 제안(Q6) · 갭 G-U8-\*
- [x] 6. `domain-entities.md` — 대화 세션·메시지(Q3·Q4) + `DialogueContext` 영속 형태(ai FD 타입과 정합) + 재사용(`ChangeSource.ASSISTANT`·account·trip·itinerary) + INV-U8-\*
- [x] 7. `business-rules.md` — BR-U8-\*(단독 확정 금지·검증값 우선·dead-end 금지·rate-limit·서버측 컨텍스트 필터·되묻기 상한 승계) · PBT-U8-\*(closed-set 인텐트·봉투/`DialogueContext` 직렬화 왕복·rate-limit 창 불변식 후보) · 미결 O-U8-\*(O3 보존 기간 등)
- [x] 8. `frontend-components.md` — 밴드 `b` 7코드 라우트·pages 슬라이스·`features/assistant`·진입점 배선(Q12)·바텀시트 탭바 숨김(앱 셸 규칙)·대화 ↔ 화면 상태 일관(스토리 2)
- [x] 9. 정합 검증 — INV-1~4 · `ScheduleAgentPort`·`CALLED_PATHS` · ai FD BR-DLG 규칙 · U0 rate-limit·세션 자산 · change log · **U7/U9 무의존·U10 무의존** 확인
- [ ] 10. 완료 메시지 → 승인 게이트 → `audit.md`·`aidlc-state.md`(오케스트레이터 소관)

---

## 5. 질문 — `[Answer]:` 뒤에 답을 채워 주세요 (`Q1=A Q2=A ...` 한 줄도 됩니다)

### Q1. 스토리 전개 — 인셉션에 US-ASSIST 코드가 없다

PRD 02 원문에 스토리 8종의 수용 기준·예외가 GWT 수준으로 이미 있어 전개 비용이 낮다. 10-12 story-map 개정 블록도 "U8 FD에서 전개"로 적었다.

A) **FD가 흡수** — PRD 02를 기반으로 US-ASSIST-01~08 코드를 붙여 `stories.md` 인셉션 정정을 올리고(U1 사후 개정 전례), FD는 그 코드를 근거로 진행한다. 별도 스테이지 재개는 없다 **(추천: story-map 개정 블록과 일치하고 비용이 가장 작다)**

B) 인셉션 User Stories 스테이지를 정식 재개(별도 승인 게이트)한 뒤 FD에 착수한다

C) 코드 부여를 생략하고 FD가 PRD 02 스토리 번호(02-1~8)를 직접 인용한다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A

### Q2. 백엔드 형상 — 대화가 어디를 거치나

아키텍처 원칙상 클라이언트는 서버 public REST만 소비한다. PRD 스토리 6은 비노출을 "프롬프트가 아니라 주입 단계 권한 경계로" 강제하라고 요구한다. 현재 backend에는 assistant 모듈이 없다(§1.3).

A) **backend `assistant` 모듈 신설**(C16 `AssistantFacade`) — 클라 ↔ backend ↔ ai. backend가 소유하는 것: 대화 세션·이력, 컨텍스트 스냅샷 구성과 권한 필터, rate-limit·금칙어, change log 연동, ai 경계 호출 **(추천: 인셉션 C16 정의 "소비만: facade"와 맞고, 모듈 경계 원칙을 지킨다)**

B) 신규 모듈 없이 기존 모듈(예: itinerary-generation)에 엔드포인트를 얹는다 — "한 컴포넌트 = 한 모듈" 원칙과 어긋날 소지가 있다

C) 클라 → ai 직결 — 권한 경계·rate-limit이 클라 신뢰에 기대게 된다(비추천)

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A

### Q3. 대화 상태의 소유자 (A-10 · ai FD 미결 #1)

ai FD는 "백엔드 소유 + AI 무상태 + AI에는 보류 프레임만"을 **제안**했고 백엔드 합의를 기다린다. PRD 스토리 5는 "계정 귀속·닫았다 열어도 직전 대화 표시"를 요구한다.

A) **backend가 저장한다** — 표시용 대화 기록(메시지)과 AI용 `DialogueContext`(보류 프레임·턴 수·되묻기 횟수)를 **따로** 둔다. AI에는 매 턴 `DialogueContext`만 보내고 발화 기록 전문은 보내지 않는다(BR-DLG-21) **(추천: PRD 계정 귀속과 ai FD BR-DLG-20·21을 동시에 만족한다. `replan_session` 선례가 있다)**

B) AI 서비스가 저장한다 — 고정 세션(수평 확장 문제)과 AI 쪽 개인정보 보관 체계를 새로 만들어야 한다

C) 클라이언트가 들고 매 턴 다시 보낸다 — 비용 0이지만 기기를 바꾸면 끊겨 PRD "계정 귀속"과 충돌한다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A

### Q4. 세션 경계와 보존 (제품 O3 "대화 이력 보관 정책")

A) **여행 단위 세션 + 계정 귀속** — 여행(컨텍스트)이 바뀌면 새 세션을 열고 이전 세션으로 돌아갈 수 있다(PRD 스토리 5 예외). 삭제는 회원 탈퇴(`/me` 삭제) 연동이다. 보존 기간 값은 O-U8 미결(운영 결정)로 두되 **만료 컬럼과 청소 배치는 FD에 넣는다**. 여행 없이 연 대화(무컨텍스트 모드)는 계정 단위 "일반" 세션 1개로 둔다 **(추천: PRD 문언과 그대로 맞고 보존 값만 운영에 넘긴다)**

B) 화면(작업 흐름) 단위 세션 — 더 잘게 나눈다

C) 이력을 저장하지 않는다(세션 = 시트를 연 동안만) — PRD 스토리 5를 축소해야 한다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A

### Q5. 의도 해석기 — 기존 IntentRouter를 재사용하나 (신설)

ai에 3단 라우터·거부 앵커·인자표가 구현돼 있고 ai FD가 그 앞뒤(보류 프레임·되묻기)를 붙이는 설계를 이미 했다. 실측: LLM 0회 32%, 정확도 97.7%.

A) **재사용** — 3단 `IntentRouter` + `ARGUMENT_TABLE` + ai FD `dialogue_router`(감싸는 층) 설계를 그대로 승계한다. U8 FD는 배선·경계·백엔드 측만 설계하고 라우터 내부를 다시 설계하지 않는다 **(추천: 정본 우선순위(ai 문서) + 실측 근거가 있다. 다시 만들면 0회 경로가 사라진다)**

B) 순수 도구 호출(LLM 1회 이상) 라우터로 새로 만든다 — ai FD §0·§7이 실측으로 기각했다

C) backend에 규칙 기반 분류기를 따로 둔다 — 두 벌이 되어 갈라진다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A

### Q6. backend ↔ ai 경계와 디스패치 주체 (D-U8-4 · D-U8-5, 신설)

누가 의도를 해석하고 누가 기존 흐름(생성·재계획·편집·회고·조회)을 호출하나. 생성·재계획·편집은 지금 backend 세션·영속을 거친다.

A) **AI는 해석만 하고 backend가 디스패치한다** — 새 경계 1개(가칭 `POST /ai/v1/dialogue/interpret`: 발화 + `DialogueContext` + 권한 필터된 컨텍스트 스냅샷 → `IntentFrame` 또는 되묻기 또는 OUT_OF_SCOPE + 갱신 `DialogueContext`). backend `assistant` 모듈이 의도별로 **기존 경로**를 부른다: EDIT_SCHEDULE → 기존 `/ai/v1/itinerary/edit`(utterance — 이미 열린 경계) · REGENERATE/GENERATE → 생성 흐름 · REPLAN/SUGGEST_ALTERNATIVE → 재계획 흐름 · 회고 3종 → reflection 모듈 · Fast Path 5종 → backend 조회(일정·날씨·장소)와 기존 `distance_ranges` 재사용 **(추천: PRD "기존 흐름 재사용·신규 계층 없음"과 일치하고 세션 수명주기를 우회하지 않는다. ai FD 미결 #13 "핸들러 없는 의도는 백엔드 봉투"와도 맞는다. 단 services.md A-5 AssistantOrchestrator 설계는 개정을 올려야 한다)**

B) AI가 해석과 위임까지 한다(services.md A-5 그대로) — 새 경계 `POST /ai/v1/dialogue/turn`이 내부에서 에이전트를 부르고 제안을 돌려준다. 호출이 1홉으로 끝나지만 생성·재계획이 backend 세션을 우회하고, Fast Path용 DB 데이터를 매 턴 inline으로 실어야 한다

C) 1차는 `/ai/v1/itinerary/edit` utterance 연결만 한다(자연어 편집 단일 기능, `AI-NL-EDIT` 해소) — 의도 라우팅을 열지 않는다. 어시스턴트라기보다 편집 보조다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q7. apply_mode 드리프트 — AUTO_APPLY를 어떻게 다루나 ★ (D-U8-1)

코드상 비파괴·단일 슬롯 편집은 `AUTO_APPLY`로 판정되어 확인 없이 `APPLIED`가 돌아온다. 다만 AI는 무상태라 저장 여부는 backend가 정한다. PRD 스토리 4·§3.5는 "명시적 확인 없이 자동 확정·저장 금지"다.

A) **어시스턴트 경로에서는 apply_mode와 상관없이 전부 "제안"으로 다룬다** — backend가 AI의 검증된 결과를 **전후 비교 카드**로 보여 주고, 사용자가 [적용]을 눌러야 기존 편집 경로(`EditItineraryService` 재검증)로 저장하고 `ChangeSource.ASSISTANT`로 기록한다. AI 계약·코드는 바꾸지 않고 `AUTO_APPLY`는 "확인 다이얼로그 수준을 낮춰도 되는 변경"이라는 표시 힌트로만 쓴다 **(추천: PRD·§3.5 문언을 지키면서 ai 계약을 깨지 않는다. 변경 지점이 backend 한 곳이다)**

B) AUTO_APPLY를 살린다(경미한 변경은 즉시 저장 + 되돌리기 보장) — PRD 스토리 4·§3.5 인셉션 정정을 올려야 한다

C) AI 쪽을 고친다(어시스턴트 경로에서는 `resolve_apply_mode`가 항상 CONFIRM_REQUIRED) — ai 코드·계약 변경이 필요하다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q8. 숙소 재질의 — 라우팅할 의도가 없다 (D-U8-2)

PRD 스토리 2는 "지금 추천한 숙소 말고 ~조건이면"을 요구한다. 숙소 탐색(C3)은 backend 소유이고 ai Intent에는 해당 라벨이 없다.

A) **1차 제외** — 숙소 재질의는 OUT_OF_SCOPE가 아니라 "숙소 탐색 화면으로 이동" next_action으로 응답하고, US-ASSIST-02 수용 기준 중 숙소 부분을 1차 범위 밖으로 명시한다(재평가 조건: 1차 개통 후 실사용 발화 수집) **(추천: 의도 추가는 뱅크·인자표·평가셋 세트 작업이고, "대화 ↔ 화면 필터 상태 일관"까지 하면 숙소 화면 상태 동기화가 새로 필요하다. 1차 범위를 작게 유지한다)**

B) U8에 포함한다 — ai Intent에 숙소 탐색 라벨을 추가(뱅크·인자표·평가셋)하고, Q6=A면 backend가 `AccommodationSearchFacade`로 디스패치한다. 화면 필터 동기화 규칙까지 FD에서 명세한다

C) 숙소 재질의를 제품 범위에서 아예 뺀다(PRD 개정)

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q9. 응답 전달 방식 — 스트리밍인가 (신설)

ai·backend 어디에도 SSE·WebSocket이 없다. 장시간 작업은 세션 + 폴링(`generation_session`)으로 돌고 있다.

A) **동기 요청/응답** — 한 턴 = REST 1회(상한 15s). 앱은 진행 표시와 [대기 취소]를 보여 준다(PRD 스토리 8). 생성·재계획처럼 오래 걸리는 작업은 대화 안에서 기다리지 않고 기존 화면의 비동기 흐름으로 넘기는 next_action으로 응답한다 **(추천: 새 인프라가 0이다. 해석은 CONFIDENT 경로 기준 50ms 미만이고 무거운 일은 원래 흐름으로 넘긴다)**

B) SSE 스트리밍 신설 — 토큰 단위로 응답을 표시한다. backend·ai·ingress(EKS)에 새 경로가 필요하다

C) 비동기 작업 + 폴링(턴 접수 → 턴 상태 조회) — `generation_session` 선례를 따른다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q10. 지연 예산 vs fable 사고 (D-U8-6, 신설)

A-6 "첫 응답 3s"는 경량 모델 전제였다. 지금은 `INTENT`·`EDIT_TRANSLATION`이 `claude-fable-5-1` high effort로 돈다. `EDIT_TRANSLATION`은 low에서 게이트 위반으로 전량 드롭된 실측이 있다.

A) **"첫 응답"을 응답 시작으로 정의한다** — 3s 안에 해석 결과나 진행 상태를 돌려주고(1·2차는 LLM 0회), 3차 해석·편집 번역은 15s 전체 예산 안에서 처리한다. `INTENT`의 effort 값은 ai 팀 실측(최소 2회)으로 정하고 FD는 O-U8로 걸어 둔다 **(추천: ai effort 표의 실측 규칙과 같은 방식이다. FD가 근거 없는 값을 박지 않는다)**

B) 첫 응답 예산을 5s로 완화한다(services.md 개정)

C) `INTENT`만 effort를 지원하는 다른 경량 모델로 분리 배정한다(통일 결정 fb0d51e2 번복)

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q11. rate-limit·가드레일 집행 위치 (A-7 · D-U8-7, 신설)

사용자별 리미터가 없다(backend는 `RateLimited` 429 매핑만, ai는 전역 토큰버킷). 금칙어는 backend `TextModerationFacade`, 범위 밖은 ai 거부 앵커가 있다.

A) **backend가 1차, ai가 2차** — backend `assistant`가 ① 계정별 분당 20회(429 + Retry-After, 기존 매핑 재사용) ② 입력 금칙어 `TextModerationFacade` 선검사 ③ 컨텍스트 스냅샷 권한 필터(타 사용자·내부 지표는 애초에 싣지 않음)를 맡는다. ai는 거부 앵커·`IntentGate` closed-set·출력 게이트로 2차 방어한다. 반복 위반 시 "사용 안내로 전환"(PRD 스토리 6·7 예외)은 backend가 세션 카운터로 판정한다 **(추천: 계정 식별자와 데이터 권한이 backend에 있다. 기존 자산을 재사용해 신규 인프라가 리미터 하나뿐이다)**

B) ai가 사용자별 리미트를 집행한다 — 와이어에 계정 식별자가 필요하고(현재 principal은 trip_id 파생 임시값) 인메모리 버킷은 수평 확장 시 갈린다

C) 1차는 rate-limit을 생략하고 비용 지표만 관측한다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q12. 진입점 — FAB 충돌 (신설)

PRD는 숙소 탐색·일정·여행 중 화면 **우하단 ✦ FAB**를 요구한다. 그 화면들에 이미 FAB가 있다(e02 숙소 검색·i01 일정 수정·j01 오늘의 회고·홈/탐색 여행 만들기). 토스트도 FAB 스택 위치에 맞춰져 있다.

A) **Figma 밴드 `b` 정본대로 정하되 FD는 배치 규칙만 BR로 박는다** — 탭바·기존 FAB·토스트(바닥 220)와 겹치지 않을 것, 1차 진입 화면 = 일정(h 결과·i01)·여행 중(라이브)·숙소 탐색. 구체 위치는 계획 4단계 시각 확인에서 확정한다 **(추천: 화면 정본은 Figma다. 시각 확인 전에 위치를 정하면 다시 고치게 된다)**

B) 기존 FAB 스택 위에 ✦ FAB를 하나 더 쌓는다(PRD 문언 그대로)

C) 앱바 우상단 ✦ 아이콘으로 바꾼다(PRD 개정 필요)

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]:  B

### Q13. 1차 대화 기능 범위 — 되묻기·멀티턴·다중 의도 (A-11·A-12, 신설)

PRD 스토리 8은 "모호하면 단정하지 말고 되묻기", 스토리 2는 "직전 맥락 누적"을 요구한다. ai FD는 의도 되묻기를 "자리가 없다"로 보류했고, 다중 의도는 봉투 이관 전 착수 불가다.

A) **1차 = 단일 의도 + 인자 되묻기(요청당 1회) + 보류 프레임 멀티턴.** 의도가 안 갈리면 OUT_OF_SCOPE 대신 quick reply(“내가 할 수 있는 것 보기” + 후보 행동)로 응답해 PRD "되묻거나 선택지 제시"를 만족한다. 다중 의도·LLM 의도 되묻기(`IntentClarify`)는 ai FD 착수 조건이 풀릴 때 개통한다 **(추천: ai FD 착수 순서(§8)와 일치하고 막힌 선행 조건에 걸리지 않는다)**

B) 다중 의도(최대 2)까지 1차에 넣는다 — AgentTask 봉투 이관(agent-foundation 미결 #8)이 선행되어야 한다

C) 단일 턴만 둔다(되묻기·멀티턴 없음) — PRD 스토리 2 "누적 조건"·스토리 8 "되묻기"를 줄여야 한다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### Q14. 비로그인 일반 도움 모드 — 코드로 사실상 해소 (보존본 Q6)

현 앱은 `GUEST → LOGIN`으로 부트스트랩하고, 비로그인 딥링크는 초대·공유 화면에 한정된다(§1.4). 즉 비로그인 상태로 어시스턴트를 열 경로가 없다.

A) **N/A로 명시한다** — PRD 스토리 1·5의 비로그인 예외는 "진입 경로 부재"를 근거로 1차 범위 밖에 기록한다. 무컨텍스트 모드(`b07-no-context`, 로그인했지만 여행이 없음)는 그대로 설계한다 **(추천: 실장 사실과 일치하고, 없는 플로우를 설계하지 않는다)**

B) 실장과 무관하게 비로그인 모드를 지금 설계한다(향후 대비)

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: 비로그인기능 제공하지 않은 상태

### Q15. 산출물 범위 (보존본 Q7)

A) **FD 4종**(business-logic-model·domain-entities·business-rules·frontend-components) 작성 후 NFR 필요 여부를 판정한다(U6 전례). rate-limit·지연 예산·비용 수치는 ai 문서에 이미 있으니(A-6·A-7) 다시 쓰지 않는다. NFR이 필요해도 backend 집행 위치·세션 보존 같은 새 축만 다룬다 **(추천: 중복 서술을 막고 승인 게이트를 하나로 유지한다)**

B) FD 4종 + NFR Requirements까지 진행한다

C) 풀세트(FD → NFR Req → NFR Design → Infra Design)로 진행한다 — 인프라는 as-built(`construction/shared-infrastructure.md`)에 얹는다

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

---

## 6. 다음 단계

답변 수집 → (Q1=A 시) US-ASSIST 전개 → 밴드 `b` 시각 확인 → 산출물 4종 생성 → 승인 게이트.

이번 사이클의 최대 리스크는 두 가지다.
- **경계 계약(Q6)과 대화 상태 소유(Q3)가 backend·ai 양 팀 합의 사안**이다. ai FD 미결 #1·#2가 같은 자리를 기다리고 있다. FD는 "제안 + ai 팀 확정 절차"로 쓰고 `ai/docs/openapi.json` CI가 계약을 강제하게 해 드리프트를 막는다.
- **IntentRouter는 아직 어떤 사용자 요청에서도 실행된 적이 없다.** fable 통일 뒤의 지연·정확도 실측이 없으므로(Q10), FD의 지연 관련 규칙은 실측 전까지 O-U8 미결로 걸어 둔다.
