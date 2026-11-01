# U8 Conversational Assistant — Business Logic Model

> **유닛**: U8 — **C16 Conversational Assistant**(모듈 16) · 에픽 J · FR-ASSIST-01 · 원문 정본 PRD 02(`aidlc/docs/PRD/02-AI어시스턴트.md`)
> **스토리**: **US-ASSIST-01~08** (8개, 2026-10-12 `stories.md` 에픽 J 개정 블록으로 전개 — Q1=A)
> **답변(2026-10-12)**: Q1~Q11·Q13·Q15 = A, **Q12 = B**(✦ FAB를 기존 FAB 스택 위에 하나 더 쌓는다), **Q14 = N/A**(비로그인 기능 없음) — 계획서 `construction/plans/u8-conversational-assistant-functional-design-plan.md`
> **정본 우선순위**: 리포 실물 > **ai 문서**(`ai/aidlc-docs/construction/assistant-dialogue/functional-design/`) > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션
> **시각 확인(2026-10-12, 라이브 Figma 밴드 `b`, 10프레임 전부)**: `b01-assistant · default/review/zero-result` · `b02-action` · `b03-scope` · `b04-guardrail` · `b05-fallback · error/solver-unavailable` · `b06-history` · `b07-no-context`. 페이지 `1228:1045`, 행 y=3599, 이름으로 다시 찾음(id `1266:1209`·`1267:1208`~`1277:1208`). **✦ FAB 자체는 밴드 `b` 어디에도 그려져 있지 않다**(G-U8-9).

---

## 0. 이 유닛의 지형 — 해석기는 있고 나머지는 백지다

| 층 | 있는 것 | 없는 것 | U8이 할 일 |
|---|---|---|---|
| ai | 3단 `IntentRouter`·거부 앵커 35문장·`ARGUMENT_TABLE`·EditAgent·`/ai/v1/itinerary/edit`(utterance) | 대화 경계, `DialogueContext` 배선, 라우터 프로덕션 호출자 | **경계 1개**(`POST /ai/v1/dialogue/interpret`) 제안 — 구현은 ai 패키지 |
| backend | `ChangeSource.ASSISTANT`(enum·DB CHECK) · `EditItineraryService` · `TextModerationFacade` · `RateLimited`→429 매핑 | `assistant` 모듈, 대화 테이블, 사용자별 리미터, 편집을 다른 모듈에 여는 퍼사드 | **모듈 신설** — 세션·메시지·제안·디스패치·가드레일 |
| frontend | FAB 스택(바닥 84·152) · `ToastHost`(바닥 220) · `@gorhom/bottom-sheet` | 화면·라우트·feature 0 | ✦ FAB + 도우미 시트 라우트 + feature |

실측 근거는 계획서 §1(2026-10-12)이고 여기서 다시 적지 않는다. 이 문서가 새로 확인한 코드 사실만 §6 갭에 둔다.

---

## 1. 결정 (DEC-U8-\*)

| ID | 결정 | 근거 |
|---|---|---|
| **DEC-U8-1** ★ | **AI는 해석만, 디스패치는 backend `assistant` 모듈**(Q2=A·Q6=A). backend가 매 턴 ai `POST /ai/v1/dialogue/interpret`를 불러 `IntentFrame` 1개(또는 되묻기·범위 밖)를 받고, 의도별로 **기존 흐름**을 부른다(§4 표). AI 안에서 위임까지 하는 `AssistantOrchestrator.handle()`(ai `services.md` §2)은 채택하지 않는다 | 생성·재계획·편집은 backend 세션·영속을 거친다(`generation_session`·`replan_session`·`EditItineraryService`). AI가 내부 위임하면 그 수명주기를 우회한다(D-U8-5). ai FD 미결 #13 "핸들러 없는 의도는 백엔드 봉투"와 같은 방향 |
| **DEC-U8-2** ★ | **모든 변경은 제안이다**(Q7=A). 어시스턴트 경로에서 AI의 `apply_mode`가 `AUTO_APPLY`여도 저장하지 않는다. backend가 **전후 비교 카드**(`ProposalCard`)를 만들고, 사용자가 [적용]을 누를 때만 기존 편집 경로로 저장한다. `apply_mode`는 카드의 **표시 힌트**로만 남긴다 | PRD 02-4 "명시적 확인 없이 자동 확정·저장 금지" · aidlc `components.md` §3.5. AI는 무상태라 `APPLIED`는 "검증된 결과를 돌려줌"이지 저장이 아니다 — 변경 지점이 backend 한 곳이고 ai 계약을 깨지 않는다 |
| **DEC-U8-3** | **ai `/edit`는 `confirm=true`로 부른다.** 확인은 AI 왕복이 아니라 backend [적용] 버튼이 맡으므로, AI가 `CONFIRM_REQUIRED`로 해를 숨기면 비교 카드를 그릴 재료가 없다 | `ai/src/trippilot/agents/edit/agent.py:188` — `CONFIRM_REQUIRED`면 `solution` 없이 돌아온다. 확인 책임을 한 곳(backend)으로 모은다 |
| **DEC-U8-4** ★ | **대화 상태는 backend가 저장하되 둘로 나눈다**(Q3=A). ① 표시용 `assistant_message`(사용자가 보는 기록) ② AI용 `DialogueContext`(보류 프레임·턴 수·되묻기 횟수, 세션 행의 jsonb 1칸). AI에는 매 턴 ②와 권한 필터를 거친 **컨텍스트 스냅샷**만 보내고 대화 기록 전문은 보내지 않는다 | ai FD BR-DLG-20·21. PRD 02-5 "계정 귀속·닫았다 열어도 직전 대화". 기록과 AI 입력을 한 칸에 두면 보관 정책(O3)이 AI 입력까지 묶인다 |
| **DEC-U8-5** | **세션 = (계정, 여행) 1개 + 계정당 "일반" 세션 1개**(Q4=A). 여행이 바뀌면 그 여행의 세션을 연다(없으면 만든다). 이전 여행 세션은 목록에서 다시 열 수 있다. 무컨텍스트(여행 없이 연 경우)는 `trip_id IS NULL` 일반 세션 | PRD 02-5 예외 "컨텍스트 전환 시 새 기준 시작·원하면 이전 대화로" |
| **DEC-U8-6** ★ | **사용자에게 보이는 도우미 문구는 backend 템플릿이 만든다.** 1차에서 LLM이 지은 자유 문장을 화면에 내지 않는다. LLM 산출은 ① 의도 라벨·인자(`IntentGate` closed-set 통과분) ② 기존 경로가 이미 검증해 내보내는 값(`/edit` 해·`/explanations` 설명)뿐이다 | 프롬프트 주입으로 "지침 보여줘"를 받아도 **LLM 출력이 라벨 JSON뿐이라 새어 나갈 통로가 없다**(PRD 02-6 "구조적으로 불가능"). 되묻기 질문도 1차는 `ArgumentClarify`(인자 이름 기반 문안)만 쓴다 — LLM 생성 `IntentClarify`는 ai FD가 착수 보류(§6.1.1) |
| **DEC-U8-7** | **한 턴 = 동기 REST 1회, 상한 15s**(Q9=A). 앱은 진행 표시와 [대기 취소]를 보여 준다. 취소는 **클라 측 중단**이고 서버는 그 턴을 끝까지 처리해 기록한다(다음 조회에서 보인다). 생성·재계획처럼 오래 걸리는 일은 대화 안에서 기다리지 않고 기존 화면으로 보내는 `next_action`으로 답한다 | 새 인프라 0. 서버 처리를 중간에 끊지 않아도 안전한 이유: 결과가 **제안**일 뿐 저장되지 않는다(DEC-U8-2) |
| **DEC-U8-8** | **"첫 응답"은 응답 시작으로 정의한다**(Q10=A). 1·2차 해석(LLM 0회)과 백엔드 조회만으로 끝나는 턴은 3s 안, 3차 해석·편집 번역이 붙는 턴은 15s 전체 예산 안. `INTENT` effort는 ai 팀 실측(최소 2회)으로 정한다 → O-U8-2 | ai `llm_gateway/config.py` — 전 기능 `claude-fable-5-1`, `INTENT` effort 미지정(=high). `EDIT_TRANSLATION`은 low에서 게이트 위반으로 전량 드롭된 실측이 있다(같은 파일 주석) |
| **DEC-U8-9** ★ | **가드레일은 backend 1차, ai 2차**(Q11=A). backend: ① 계정별 **분당 20턴**(429 + `Retry-After`, 기존 `RateLimited` 매핑) ② 입력 금칙어 `TextModerationFacade.inspect` 선검사 ③ 컨텍스트 스냅샷 화이트리스트(§5). ai: 거부 앵커 · `IntentGate` closed-set · 출력 게이트. **리미터 저장소는 새로 두지 않는다** — `assistant_message`의 사용자 턴 행을 최근 60초로 세면 된다(인덱스 `(account_id, created_at)`) | 계정 식별자와 데이터 권한이 backend에 있다. ai 리미터는 프로세스 전역 in-memory(`api/middleware.py`)라 사용자별로 못 센다. 메모리 카운터는 EKS 다중 파드에서 파드 수만큼 한도가 늘어난다 — 턴 로그를 세면 파드와 무관하다 |
| **DEC-U8-10** | **숙소 재질의는 1차 범위 밖**(Q8=A). ai Intent에 숙소 라벨이 없다. 숙소 관련 발화가 들어오면 범위 밖 거절이 아니라 **숙소 탐색 화면으로 가는 `next_action`**으로 답한다 | 라벨 추가는 뱅크·인자표·평가셋 세트 작업이고 "대화 ↔ 화면 필터 상태 일관"은 숙소 화면 동기화를 새로 요구한다. 재평가 조건 = 1차 개통 후 실사용 발화 수집(O-U8-6). **라이브 Figma `b01 default`·`zero-result`는 대화 안 숙소 결과를 그린다** — G-U8-8 |
| **DEC-U8-11** | **1차 대화 범위 = 단일 의도 + 인자 되묻기(요청당 1회) + 보류 프레임 멀티턴**(Q13=A). 의도가 안 갈리면 범위 밖 대신 quick reply("내가 할 수 있는 것 보기" + 후보 행동)로 답한다. 다중 의도·`IntentClarify`는 ai FD 착수 조건(AgentTask 봉투 이관 · 허용 집합 평가셋)이 풀릴 때 연다 | ai FD §8 착수 순서. 경계 와이어는 `frames` 배열로 두되 1차 backend는 길이 ≤1만 받는다(§3.2) |
| **DEC-U8-12** ★ | **진입점 = ✦ FAB를 기존 FAB 스택 위에 하나 더 쌓는다**(Q12=B, 사용자 선택). 1차 진입 화면 = 홈 · 숙소 검색(e02) · 일정 상세(`itinerary-plan`) · 여행 중 허브(`live`). 탭바·토스트와 겹치지 않는 것은 BR로 박는다(BR-U8-50~53) | PRD 02-1 "주요 화면 우하단 ✦ FAB, 탭바와 겹치지 않게". 현 토스트가 스택 윗변 208 위(220)에 맞춰져 있어 **✦를 얹으면 토스트를 올려야 한다**(G-U8-10) |
| **DEC-U8-13** | **도우미 시트는 루트 스택의 투명 모달 라우트**(`frontend/app/assistant/index.tsx`)로 연다. 화면별 `@gorhom` 시트로 각 페이지에 심지 않는다 | 진입 화면이 4곳이라 페이지마다 시트를 넣으면 4벌이 된다. `(tabs)` 밖 라우트라 **탭바가 구조적으로 가려진다**(PRD 02-1 "모달/바텀시트에서는 탭바 숨김", 앱 셸 스토리 4). 화면 문맥은 라우트 파라미터로 넘긴다(frontend-components §1) |
| **DEC-U8-14** | **"진행 검토"(US-ASSIST-03)는 `SHOW_SCHEDULE`의 backend 핸들러로 구현한다.** 새 의도 라벨을 만들지 않는다. quick reply `검토해줘`는 발화가 아니라 구조화 액션(`REVIEW`)으로 보내 LLM 0회로 같은 핸들러에 닿는다 | ai 뱅크에 "검토" 계열 문장이 0건이고(`data/intent_question_bank.yaml` grep) 13종 어디에도 검토 라벨이 없다. 라벨 추가는 ai 세트 작업 — 그 전에는 뱅크 문장 보강(SHOW_SCHEDULE)을 ai에 상신(G-U8-6) |
| **DEC-U8-15** | 산출물은 **FD 4종**. NFR은 FD 종료 시 판정(Q15=A) — 새 축은 backend 리미터 위치·세션 보존·턴 지연 3개뿐이고 수치(분당 20·3s/15s)는 ai 문서(A-6·A-7)를 승계한다 | 중복 서술 방지 |

> **[개정 · 2026-10-17 · assistant-orchestrator FD] DEC-U8-1·4·5·6·8·11.** 사용자 결정(2026-10-17: "의도파악 3단계 말고 바로 LLM · AI 오케스트레이터가 병렬로 일 시켜 답변 조합 · 장단기 메모리 · 질문뱅크는 병렬 측정만")을 반영한다. 원문 행은 이력으로 보존하며, 상세 설계는 `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/`.
>
> **DEC-U8-1** — "AI는 해석만"을 **좁힌다**. AI `DialogueOrchestrator`(안 A — 기존 `POST /ai/v1/dialogue/interpret` 확장)가 **조회·대안·안내** 의도는 Provider·PlanBAgent 를 병렬로 불러 AI 안에서 끝내고 `outcome=ANSWER` 로 답변까지 돌려준다. **저장을 수반하는 변경**(EDIT_SCHEDULE·[적용])은 여전히 backend 제안·[적용] 경로다 — 1단계 EDIT_SCHEDULE 은 `FRAME` 그대로(DEC-U8-2/3 유지). D-U8-5 "수명주기 우회"에 대한 답: **저장 지점은 바뀌지 않는다**(BR-U8-30·33). 왜: 조회·대안은 저장이 없어 우회할 수명주기가 없고, 병렬 수집 결과를 한 턴에 조합하려면 분류·답변이 한 곳(AI)에 있어야 한다.
>
> **DEC-U8-4·5** — 대화 기록(`assistant_message`)·`DialogueContext`·세션 모델(계정×여행 1 + 일반 1)은 backend 소유 그대로. AI 는 **요약 20줄**(줄 ≤120자, 10턴마다 `DIALOGUE_MEMORY` 로 갱신, 실패 시 결정론 압축)만 자체 DB `ai_kb.dialogue_memory` 에 `session_id` 키로 보관한다(보존 90일 = DATA-U8-01 과 같은 값, 쓸 때 연장). 단기 기억은 backend 가 요청에 싣는 `recent_turns`(최근 10턴 ≤20건, text ≤300) — AI 는 **원문을 저장하지 않는다**. backend 파기 경로(이력 지우기·여행 삭제·계정 삭제)가 `DELETE /ai/v1/dialogue/memory` 를 부르고, 만료는 AI 쪽 90일 TTL 이 같은 값으로 따라간다. 왜: "같은 사용자가 다시 쓰면 로드"의 키가 backend 세션 id 이므로 요약만 AI 에 두면 되고, 원문 장소는 늘리지 않는다(SEC-U8-06). **[개정 · 2026-10-23 · assistant-orchestrator DEC-AO-19]** 요약은 3턴마다 **답한 뒤 뒤에서** "종류: 내용" 줄로 갱신하고, 실패하면 이전 기억 그대로 둔다(결정론 압축 폐지). 줄마다 임베딩을 `dialogue_memory_vectors` 에 같이 두어(기억 행을 따라 지워진다 — 파기 3호출·TTL 그대로) 프롬프트에는 최근 3턴 + 이번 말과 가까운 기억 줄만 싣는다. 원문은 여전히 저장하지 않는다.
>
> **DEC-U8-6** — LLM 문장을 **허용**한다(`DIALOGUE_ANSWER`). 단 출구 게이트(≤400자 · 줄 ≤6 · 소요시간 표현 금지(INV-3) · 연락처 패턴 금지) 통과분만 화면에 내고, 게이트 실패·시한 부족(잔여 <1.5s)이면 의도별 **결정론 템플릿**(backend 문구 이식)으로 폴백한다. OUT_OF_SCOPE·거절·되묻기·강등·FALLBACK 문구는 여전히 backend 고정 문안. 왜: 병렬 수집 결과를 조합한 답변은 템플릿으로 못 만들고, 허용 blast radius 는 "보이는 문장 오염"까지로 이미 판정했다 — 후보 선택·저장은 facts 닫힌 집합(INV-1)이고, 문장 속 장소명은 프롬프트 규칙만이라 게이트가 검사하지 못한다(수용된 blast radius).
>
> **DEC-U8-8·11** — 첫 응답 정의 개정: 오케스트레이터 on 이면 **모든 TEXT 턴이 LLM ≥1회**(분류 1 + 답변 ≤1 + ~~10턴마다 요약 1~~ — 요약은 2026-10-23 부터 답한 뒤 뒤에서 돌아 턴 밖이다, assistant-orchestrator DEC-AO-19)라 "LLM 0회 경로 3s" 집합이 빈다 → 해석 상한 **9,000ms**(backend `interpret-stage-max-ms` 5000→9000, read 14s), 턴 예산 13s 유지(PERF-U8-02/05 개정). 단일 의도(`frames ≤1`)는 **유지** — 다중 의도는 후속. 3단 질문뱅크는 서비스에서 빼고 **섀도**(DEV 1.0 · 운영 0.2 샘플링)로만 돌려 일치율을 잰다.

---

## 2. 한 턴의 흐름 (backend `assistant` 모듈)

```
[앱] POST /api/v1/assistant/sessions/{sessionId}/turns
     { clientTurnId, input: TEXT(utterance) | ACTION(quickReply), screen }
        |
        v
 1. 세션 소유 확인 ---------------------------- 남의 세션 / 없음 -> 404(존재 은닉)
 2. 멱등 확인 (sessionId, clientTurnId) ------- 이미 처리됨 -> 저장된 응답 그대로
 3. 리미터: 최근 60s 사용자 턴 >= 20 ---------- 429 + Retry-After (턴 기록 안 함)
 4. 입력 검사
    - TEXT: 길이 1..500, TextModerationFacade - 위반 -> REFUSAL(POLICY) 응답
    - ACTION: 서버가 발급한 quick reply 인지 -- 아님 -> 400
 5. 사용자 메시지 기록 (assistant_message, role=USER)
 6. ACTION 이면 -> 8 로 (해석 생략, LLM 0회)
 7. 해석: 컨텍스트 스냅샷(권한 필터) + DialogueContext
         -> ai POST /ai/v1/dialogue/interpret
         +-- FRAME(1개, executable) ---------> 8
         +-- ARGUMENT_CLARIFY ---------------> 되묻기 응답, DialogueContext 갱신 저장
         +-- OUT_OF_SCOPE -------------------> SCOPE 응답 (+ 가장 가까운 대안)
         +-- 실패/시간초과 ------------------> FALLBACK(AI_UNAVAILABLE) 응답
 8. 디스패치 (§4 표) -> 기존 흐름 호출
         +-- 조회형 -------> 카드 (값은 기존 경로의 검증값만)
         +-- 변경형 -------> ProposalCard 생성 (저장 안 함)
         +-- 장기 작업 ----> next_action (기존 화면으로)
 9. 도우미 메시지 기록 (role=ASSISTANT, kind, payload, nextActions >= 1)
10. 응답 반환
```

- **5 다음 실패**해도 사용자 메시지는 남는다 — 침묵 실패 금지(INV-4). 7·8 실패는 반드시 FALLBACK 메시지 1건으로 끝난다(BR-U8-40).
- **금칙어 위반 입력은 원문을 저장하지 않는다** — `[정책 위반 입력]` 표지만 남긴다(BR-U8-23). 위반 텍스트를 계정 기록에 쌓을 이유가 없다.
- **멱등 키**: 앱 재시도·네트워크 재전송이 턴을 두 번 만들지 않는다(INV-U8-05).

> **[개정 · 2026-10-17 · assistant-orchestrator FD] 7·8 단계.** 7 의 해석 호출은 `request_meta.deadline_ms` **9,000**(backend `interpret-stage-max-ms` 5000→9000, read timeout 14s)에 `session_id`·`account_ref`·`recent_turns`(최근 10턴 ≤20건, text ≤300, `redacted` 입력 제외)를 더 싣고, 응답 갈래에 **`ANSWER`** 가 생긴다 — AI 가 Provider·PlanBAgent 를 병렬로 불러 조합한 답변(kind TEXT|INFO|CANDIDATES, `next_actions ≥1`, quick reply)을 backend 가 검증(text ≤2000 · `NextAction.TYPES` · kind · CANDIDATES poiId 정본 대조 · quick reply 서버 id `qr-ai-*` 발급)한 뒤 **8 을 거치지 않고 9 로** 저장한다. `FRAME` 은 종전대로 8(1단계 EDIT_SCHEDULE, 오케스트레이터 off 면 전부). 검증 실패·모르는 outcome 은 여전히 FALLBACK 1건(BR-U8-40). 왜: 병렬 수집 결과를 한 턴에 조합하려면 응답이 "의도 라벨"에서 "답변"으로 넓어져야 한다. 상세 `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/`.

### 2.1 [적용] 흐름 (US-ASSIST-04)

```
[앱] POST /api/v1/assistant/proposals/{proposalId}/apply
        |
 1. 소유·상태 확인: PROPOSED 이고 expires_at 전인가 -- 아니면 409(STALE/EXPIRED)
 2. 기준 지문 대조: 지금 일정 == proposal.base_fingerprint ?
         +-- 다름 -> STALE 로 바꾸고 409. 앱은 "일정이 바뀌어 다시 제안할게요" + 재제안 quick reply
 3. 위반 있는 제안인가 -> 적용 불가(카드에 버튼이 없다, BR-U8-31). 여기 닿으면 409
 4. ItineraryEditFacade.edit(accountId, tripId, after, reason, source=ASSISTANT)   <- G-U8-1
         = EditItineraryService 재검증(validate/repair) + 저장 + 리비전 + (여행 중이면) change_log ASSISTANT
 5. 저장 결과에 위반이 생겼나 (재검증이 제안 때와 다르게 판정)
         +-- 있음 -> APPLIED 로 두되 "솔버가 다시 보니 문제가 있어요" 메시지 + [되돌리기](리비전 복원) next_action
         +-- 없음 -> APPLIED, 확인 메시지 + "일정 보기" next_action
 6. ACTION_LOG 메시지 기록 (무엇을 바꿨나 + revisionId / changeLogEntryId)
```

**5에서 저장을 막지 않는 이유**: `EditItineraryService`는 **비차단 편집**이다(위반은 표시, 저장 허용 — 서비스 머리 주석, ADR-0011). 어시스턴트만 차단으로 바꾸면 같은 편집이 경로에 따라 다르게 저장된다. 대신 제안 단계에서 위반 있는 안은 [적용]을 안 주고(3), 적용 뒤 판정이 갈리면 **숨기지 않고 알리고 되돌릴 수단을 준다** — PRD 02-4 "조용히 적용하지 않고"를 이 두 겹으로 만족한다. 표시 값은 **저장된 일정의 값**이 이긴다(PRD 02-8 예외 "검증값 우선").

### 2.2 세션 열기 (US-ASSIST-01·05)

```
[앱] POST /api/v1/assistant/sessions  { tripId | null }
   tripId 있음 -> TripFacade.findPeriod(accountId, tripId) 로 소유 확인 (없으면 404)
               -> (account, trip) 의 ACTIVE 세션 반환, 없으면 생성
   tripId 없음 -> 계정의 일반 세션 반환, 없으면 생성
   응답: 세션 + 최근 메시지 N개 + 컨텍스트 칩 문구 + 시작 quick reply
```

여행을 지우면(`TripPurgeScopeFacade` 경로) 그 여행 세션도 지운다. 계정 삭제는 FK CASCADE(domain-entities §3).

---

## 3. 경계 계약 초안 — backend ↔ ai (`POST /ai/v1/dialogue/interpret`)

> **제안**이다. 와이어 정본은 ai가 구현한 뒤 `ai/docs/openapi.json`(CI가 실행 앱 스키마와 대조)이고, backend는 `HttpScheduleAgentAdapter.CALLED_PATHS`에 경로를 넣어 `AiBoundaryOpenApiTest` 계약 게이트에 걸리게 한다. 리소스명 `dialogue`는 ai FD 후보(`/ai/v1/dialogue/*`)를 따른다(D-U8-4 해소 제안). 필드는 snake_case(기존 경계 관례).

### 3.1 요청

```json
{
  "request_meta": { "request_id": "uuid", "requested_at": "2026-10-12T05:00:00Z", "deadline_ms": 6000 },
  "utterance": "둘째 날 오후 카페를 더 조용한 곳으로 바꿔줘",
  "dialogue_context": {
    "pending": null,
    "turn_index": 4,
    "clarify_count": 0
  },
  "context": {
    "surface": "ITINERARY",
    "trip": { "trip_id": "uuid", "region": "부산", "start_date": "2026-11-01", "end_date": "2026-11-03", "phase": "PLANNING" },
    "base_stays": [ { "name": "서면 OO호텔", "region": "부산진구" } ],
    "itinerary": {
      "status": "PLANNED",
      "days": [ { "date": "2026-11-02", "slots": [ { "slot_key": "2026-11-02#uuid", "name": "카페 모카", "start_at": "14:00", "category": "CAFE" } ] } ]
    }
  }
}
```

- `utterance` 1..500자(ai `/edit`와 같은 상한). **ACTION 턴은 이 경계를 부르지 않는다.**
- `context`는 **화이트리스트 필드만**(§5). 위치는 1차에서 싣지 않는다(O-U8-5). 시각 `start_at`은 저장된(검증된) 값이다.
- `dialogue_context`는 ai FD `DialogueContext` 직렬형(`to_dict`) 그대로 — backend는 내용을 해석하지 않고 저장·반송만 한다(INV-U8-07).

### 3.2 응답

```json
{
  "outcome": "FRAME",
  "frames": [
    { "intent": "EDIT_SCHEDULE", "arguments": { "day": "2026-11-02", "target": "카페 모카" },
      "missing": [], "confidence": 0.93, "match_route": "CONFIDENT" }
  ],
  "clarify": null,
  "dialogue_context": { "pending": null, "turn_index": 4, "clarify_count": 0 },
  "llm_calls": 0
}
```

| `outcome` | 뜻 | `frames` | `clarify` |
|---|---|---|---|
| `FRAME` | 실행 가능한 의도 1개 | 길이 1, `missing` 빔 | null |
| `ARGUMENT_CLARIFY` | 의도는 정했고 필수 인자가 빔 | 길이 1 | `{ frame_index, argument, question, options[] \| null }` |
| `OUT_OF_SCOPE` | 범위 밖(거부 앵커·FALLBACK) | `[OUT_OF_SCOPE 프레임]` | null |

- **1차 backend는 `frames` 길이 ≤1만 받는다**(DEC-U8-11). 2 이상이면 "하나씩 말씀해 주세요" + 후보 quick reply로 답한다(실행하지 않는다).
- `clarify.question`은 ai가 **인자 이름 기반 고정 문안**으로 채운다(ai FD 미결 #6 "ArgumentClarify 문안은 FE가 조립해도 된다" — 1차는 ai가 표 문안으로 채우고 backend는 그대로 싣는다, BR-U8-11).
- `turn_index`는 **backend가 올린다**. ai는 읽기만 한다(ai FD §4.1).
- 오류: 4xx/5xx·타임아웃은 backend가 FALLBACK 메시지로 바꾼다. **이 경계의 실패를 일정 폴백 신호로 쓰지 않는다** — 생성 경로의 "4xx = 최소일정 폴백" 관례(ai FD §3.1)는 여기 적용되지 않는다.
- **소요시간 필드 없음**(INV-3). 인자에 담기는 시각은 요청이지 확정값이 아니다(BR-DLG-05).

> **[개정 · 2026-10-17 · assistant-orchestrator FD] §3.1·§3.2 계약 확장.** 요청 += `session_id: str|null` · `account_ref: str|null` · `recent_turns: [{role: USER|ASSISTANT, text ≤300}] (≤20)`; `request_meta.deadline_ms`(9,000 기준, 없으면 AI 기본 9,000)는 AI 가 **반드시 읽어** 모든 LLM·Provider 호출에 시한을 내린다(종전 경로는 읽지 않았다). 응답 `outcome` += **`ANSWER`**, `answer: {kind: TEXT|INFO|CANDIDATES, text ≤600, payload, next_actions ≥1 [{type,label,params}], quick_replies[{label,action,params}]|null, footnote|null}`(ANSWER 가 아니면 null). 메모리 경계 신설: `DELETE /ai/v1/dialogue/memory?session_id=|trip_id=|account_ref=`(셋 중 정확히 하나, 200 `{deleted: n}` — 멱등) · `GET /ai/v1/dialogue/memory?account_ref=`(내보내기). `dialogue_context` 모양·반송 규칙은 그대로(INV-U8-07). 왜: backend `HttpDialogueInterpreterTest` 가 응답 키 집합을 **정확 동등**으로 단언하고 요청 스키마는 `extra=forbid` 라 AI·backend 변경은 **한 PR** 이어야 하며, FE 변경은 0(kind 10종·NextAction 17종·서버 발급 quick reply 그대로). 상세 `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/`.

### 3.3 기존 경계 재사용 (새로 열지 않는다)

| 경계 | 어시스턴트 용도 | 현 상태 |
|---|---|---|
| `POST /ai/v1/itinerary/edit` | `EDIT_SCHEDULE` 제안 — `utterance` 또는 `command`(후보 교체), `confirm=true`(DEC-U8-3) | 열림, **backend 호출자 0** → `CALLED_PATHS`에 추가(G-U8-2) |
| `POST /ai/v1/planb/alternatives` | `SUGGEST_ALTERNATIVE` 후보 — 기존 `GET .../itinerary/slot-candidates`(백엔드)를 그대로 거친다 | 호출 중(`proposeSlotCandidates`) |
| `POST /ai/v1/itinerary/validate`·`/repair` | [적용] 시 `EditItineraryService`가 이미 부른다 | 호출 중 |

---

## 4. 디스패치 표 — 의도 → 기존 흐름

> **원칙**: 대화 안에서 끝내는 것은 **조회와 제안**뿐이다. 오래 걸리거나 화면 상태가 필요한 일은 기존 화면으로 보낸다(`next_action`). 표의 "보이는 값"은 전부 기존 경로가 이미 검증·저장한 값이다(INV-2).

| 의도 | 1차 처리 | 호출(backend 퍼사드 / 경로) | 응답 카드 · next_action | 스토리 |
|---|---|---|---|---|
| `EDIT_SCHEDULE` | **제안** | ai `/edit`(utterance, `confirm=true`) → `ProposalCard` | 전후 비교 · [적용]/[취소] · 위반 시 대안 quick reply | 04 |
| `SUGGEST_ALTERNATIVE` | 후보 → 고르면 **제안** | 슬롯 후보 조회(기존 slot-candidates 서비스) → 후보 카드. 고르면 ai `/edit`(`command`=REPLACE_SLOT, LLM 0회) → `ProposalCard` | 후보 카드(이름·거리·이유) → 비교 카드 | 02·04 |
| `REPLAN` | 넘기기 | 없음 (여행 중일 때만) | `OPEN_REPLAN`(i10 `planb/index`) + 바꾼 조건 요약 | 02 |
| `REGENERATE` | 넘기기 | 없음 | `OPEN_REGENERATE`(일정 만들기 방식 화면) + 조건 요약 | 02 |
| `GENERATE_SCHEDULE` | 넘기기 | 없음 | 여행 있음+일정 없음 → `OPEN_ITINERARY_METHOD` · 여행 없음 → `CREATE_TRIP` | 01·03 |
| `SHOW_SCHEDULE` (+ ACTION `REVIEW`) | **진행 검토 카드** | `TripFacade` · `ItineraryFacade.findCurrent` · 일정 표면(G-U8-3) · `TripBaseStayFacade` | 상태 요약 + **솔버가 표기한 위반만** 문제 행으로 + 행마다 해결 next_action(DEC-U8-14) | 03 |
| `GET_NEXT_SLOT` | 조회 | `ItineraryPlanFacade.findPlanSlots` + 방문 상태 | 다음 장소 카드(이름·계획 시각·직전 구간 거리) · `OPEN_LIVE` | 01 |
| `GET_DISTANCE` | 조회(일정상 인접 구간만) | 일정 슬롯의 `distanceRange`(G-U8-3) | 거리만. 인접 아닌 두 곳은 "일정에서 확인해요" + `OPEN_ITINERARY`(G-U8-5) | 07 |
| `GET_POI_INFO` | 조회 | `PoiSurfaceFacade.findSurfaces` (인자 `place`를 **현재 일정 슬롯 이름**과 대조 — ai FD §3.1 "가리키는 행위는 현재 상태로") | 장소 카드(영업시간 등 표면 값, 없으면 "미확인") · `OPEN_PLACE` | 01 |
| `GET_WEATHER` | 조회 | `ContextFacade.readingForDisplay(gridKey, at)` | 날씨 카드. 실패면 "지금 날씨를 확인할 수 없어요"(U4 BR 승계 — 잘못된 정보로 말하지 않는다) | 01 |
| `GENERATE_REFLECTION` · `TRIP_SUMMARY` · `STYLE_ANALYSIS` | 넘기기 | 없음 | `OPEN_REFLECTION` / `OPEN_TRIP_SUMMARY` / `OPEN_STYLE` | 01 |
| `OUT_OF_SCOPE` | 거절 + 대안 | 없음 | SCOPE 카드 + "내가 할 수 있는 것 보기" + 문맥상 가장 가까운 대안(숙소 상세면 `OPEN_OTA` 외부 예약) | 07 |
| (숙소 관련 발화) | 넘기기(DEC-U8-10) | 없음 | `OPEN_STAY_SEARCH` + "숙소 조건은 숙소 검색에서 바꿀 수 있어요" | 02 |

**`next_action`은 화면 이동 의도이지 실행이 아니다.** 앱이 라우트로 옮기고, 그 화면의 기존 확인·확정 절차가 그대로 돈다(재계획 확정은 여전히 `planb/diff`의 [확정]).

> **[개정 · 2026-11-01]** 위 문장의 「재계획 확정은 여전히 `planb/diff`의 [확정]」은 낡았다 — 비교 화면(`planb/diff`)은 사용자 결정으로 삭제됐고, 재계획 확정은 재계획안 화면 `planb/draft` 의 [적용하기]다. `next_action` 이 실행이 아니라 이동 의도라는 원칙은 그대로다(원문 보존).

**바꾼 조건 요약**(PRD 02-2 "예산 ↓ · 도보 10분 이내로"): 넘기기 행은 `frames[0].arguments`를 사람이 읽는 칩으로 바꿔 메시지에 싣는다. **목적 화면의 입력값으로 미리 채우는 것은 1차 밖**(G-U8-7) — 대화 ↔ 화면 상태 일관 AC는 일정 편집(제안 적용)에서만 성립한다.

> **[개정 · 2026-10-17 · assistant-orchestrator FD] 표의 1차 처리자가 둘로 갈린다.** 오케스트레이터 on 이면 **AI 가 `ANSWER` 로 끝내는 의도**: `SHOW_SCHEDULE`(스냅샷 계산 → TEXT 요약) · `GET_NEXT_SLOT`(INFO NEXT_SLOT + "다른 곳 추천" quick reply) · `GET_WEATHER`(PoiInfo 좌표 → WeatherProvider → INFO WEATHER) · `GET_DISTANCE`(TransitProvider, 거리만 — INV-3) · `GET_POI_INFO`(신규 `PoiInfoProvider` = `/internal/pois/batch-get`, INFO PLACE) · `SUGGEST_ALTERNATIVE`(PlanBAgent `use_llm=False` 인프로세스 → CANDIDATES ≤5, PICK_CANDIDATE 는 종전 backend ReplaceSlot 제안 경로로) · 넘기기 행(REPLAN·REGENERATE·GENERATE_SCHEDULE·회고 3종 = TEXT 한 줄 + 종전 `next_action`). **`FRAME` 유지**: `EDIT_SCHEDULE`(1단계 — `ProposalCards` `/edit` 경로 그대로, 2단계에 EditAgent 인프로세스 + PROPOSAL). **backend 그대로**: `OUT_OF_SCOPE`(LLM 문장 없음 — SCOPE 카드·거절 스트릭) · ACTION 턴 · `REVIEW` 검토 카드 · [적용]. "보이는 값은 검증값만"(INV-2)과 "저장은 [적용]만" 원칙은 변하지 않는다. 왜: 저장이 없는 조회·대안은 AI 가 병렬 수집해 한 턴에 조합하는 편이 9,000ms 안에 들고, 저장이 있는 변경은 backend 수명주기(제안·지문·적용)를 그대로 타야 한다. 상세 `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/`.

---

## 5. 컨텍스트 스냅샷 — 권한 경계 (US-ASSIST-06)

backend `ContextSnapshotBuilder`가 매 턴 만든다. **화이트리스트 방식** — 아래에 없는 필드는 싣는 코드가 없다.

| 블록 | 필드 | 출처(퍼사드) | 싣지 않는 것 |
|---|---|---|---|
| `surface` | `HOME`\|`STAY_SEARCH`\|`ITINERARY`\|`LIVE`\|`STAY_DETAIL` | 앱이 보낸 화면 값(enum 검증) | 화면 자유 텍스트 |
| `trip` | id · 지역명 · 시작·종료일 · `phase`(PLANNING/IN_TRIP/ENDED) | `TripFacade.findPeriod(accountId, tripId)` — **소유 확인 겸용** | 다른 계정 여행(조회 자체가 null) |
| `base_stays` | 이름 · 권역 | `TripBaseStayFacade` | 가격·제휴 정보·수수료(PRD 13 비고 내부 지표) |
| `itinerary` | 상태 · 일자별 슬롯(`slot_key`·이름·계획 시작 시각·카테고리) | `ItineraryPlanFacade` | 리비전 이력·거절 기록·후보 풀·점수 |

- 위치(`inline_context` 휘발 위치)는 1차에서 싣지 않는다 — U10과 무관하게 포그라운드 위치를 쓸 근거가 아직 없다(O-U8-5).
- 페르소나·취향은 싣지 않는다. 해석에 필요 없고, `/edit`·생성 경로가 각자 이미 받는다.
- **이 표가 PRD 02-6 "프롬프트가 아니라 주입 단계 권한 경계"의 실체다.** 프롬프트 주입이 "다른 사용자 일정 보여줘"를 요청해도 스냅샷에 그 데이터가 없다(PBT-U8-3).

---

## 6. 폴백 표 (INV-4 — 침묵 실패 금지)

| 상황 | 감지 | 사용자에게 | next_action(≥1) | Figma |
|---|---|---|---|---|
| ai 해석 실패·타임아웃 | `/interpret` 5xx·타임아웃 | "지금 도우미가 응답하지 못했어요" | [다시 시도] · "도우미 없이 계속"(현재 화면 기존 동작) | `b05 error` |
| `/edit` 번역 실패(`TRANSLATION_FAILED`) | 응답 status | "요청을 일정 변경으로 바꾸지 못했어요" | [직접 편집](`OPEN_ITINERARY_EDIT`) · 다시 말하기 | — |
| `/edit` 거절(`REJECTED`)·해 없음 | 응답 status·위반 | 불가 사유(솔버 위반 문구) | 다른 날로 / 고정 해제 / 이 장소 빼기 quick reply(US-SCHED-04 예외 선택지) | `b02` 변형 |
| 솔버 비가용(`/edit` 5xx·타임아웃) | 어댑터 예외 | "지금은 시간·동선 검증을 할 수 없어요" — **추측으로 시각을 채우지 않는다** | [직접 편집] · [나중에] | `b05 solver-unavailable` |
| 조회 원천 실패(날씨·장소 표면) | 퍼사드 null·예외 | "지금 일부 정보를 확인할 수 없어요" + 가용한 범위만 | 해당 화면 열기 | `b01 review` 변형 |
| 대화 저장 실패 | DB 예외 | 턴 실패 응답(5xx) — 앱이 "임시 보관" 표시 후 재전송(멱등 키로 중복 없음) | [다시 보내기] | — |
| 응답 15s 초과 | 앱 타이머 | 진행 표시 유지 → [대기 취소] | 취소 시 시트 유지·입력 복원 | — |
| 리미트 초과 | 429 | "잠시 후 다시 시도해 주세요(N초)" | 현재 화면 기존 동작 | — |
| 금칙어 | moderation | 간단한 거절 사유 | "내가 할 수 있는 것" | `b04` |
| 반복 위반·반복 범위 밖(연속 2회) | 세션 카운터 | **같은 거절을 되풀이하지 않고** 사용 안내로 전환 | 가능한 도움 목록 quick reply | `b04` 하단 문구 |
| 되묻기 상한 초과 | `clarify_count ≥ 1` + 미충족 | 결정론 폴백 — "이렇게 해볼까요?" 선택지 | 후보 행동 quick reply | — |
| 제안이 낡음(일정이 그 사이 바뀜) | 지문 불일치 | "일정이 바뀌어 다시 제안할게요" | [다시 제안] | — |

---

## 7. 갭 (G-U8-\*)

| ID | 갭 | 처리 |
|---|---|---|
| **G-U8-1** ★ | **`EditItineraryService`가 다른 모듈에 열려 있지 않다**(`application` 층, 퍼사드 없음 — `itinerary-generation/api/`는 `ItineraryFacade`·`ItineraryPlanFacade`·`ReplanFacade`뿐). 그리고 **변경 출처가 `ChangeSourceType.MANUAL`로 하드코딩**돼 있고(`EditItineraryService.kt:131`) change log는 **여행 중(오늘 ≥ 시작일)에만** 남긴다. 리비전 주체도 `RevisionActor { USER, AI }`뿐이다 | `itinerary-generation/api`에 `ItineraryEditFacade.edit(accountId, tripId, days, reason, source)` 신설 — `source`로 `ASSISTANT`를 받게 한다. 여행 전 변경은 기존 규칙대로 리비전(h36)이 담는다(reason 접두 `[도우미]`). 리비전 주체를 늘릴지는 O-U8-7 |
| **G-U8-2** | `/ai/v1/itinerary/edit`의 **backend 호출자가 0**이다(`CALLED_PATHS` 6경로에 없음 — `HttpScheduleAgentAdapter.kt:394`). `work-graph.toml` `AI-NL-EDIT`(todo)가 "제품 결정 선행"으로 막혀 있었다 | 이 FD가 그 제품 결정(화면·문구·확인 흐름 = `b02`·DEC-U8-2)이다. `ScheduleAgentPort`에 edit 메서드 + `CALLED_PATHS` 추가 |
| **G-U8-3** | **진행 검토·거리 조회에 필요한 슬롯 표시 값이 퍼사드에 없다** — `PlannedSlotView`에 `distanceRange`·`hasViolation`·`violationReason`이 없다(REST `SlotResponse`에만 있다, `ItineraryController.kt:217~219`) | `ItineraryPlanFacade`에 세 필드 추가(api-safe 문자열·불리언) |
| **G-U8-4** | ai 대화 경계·`dialogue_router` **미구현**(ai FD 착수 순서 3) · `IntentRouter` 프로덕션 호출자 0 | ai 패키지 작업. backend는 `ASSISTANT_MODE=fake` 페이크로 먼저 개발(기존 `AI_SCHEDULE_MODE` 관례) |
| **G-U8-5** | 임의 두 장소 사이 거리를 내는 backend 경로가 없다 — 거리 추정은 ai 조립 안에 있다 | 1차 = 일정상 인접 구간만. 임의 쌍은 O-U8-8 |
| **G-U8-6** | **"검토해줘" 계열 발화가 뱅크에 0건** — 자유 발화 검토 요청이 `SHOW_SCHEDULE`로 갈지 보장이 없다 | ai에 `SHOW_SCHEDULE` 뱅크 문장 보강 상신(평가셋 포함). 그 전에는 quick reply `REVIEW` 액션이 보장 경로 |
| **G-U8-7** | `next_action`으로 넘긴 화면이 **바꾼 조건을 받는 입력이 없다** — i10 `planb/index`·일정 방식 화면은 쿼리 프리필을 받지 않는다 | 1차는 조건 요약만 메시지로(§4). 프리필은 화면별 후속(O-U8-6과 함께 재평가) |
| **G-U8-8** | **라이브 Figma `b01 default`·`zero-result`가 대화 안 숙소 결과·완화안을 그린다** ↔ Q8=A(숙소 재질의 1차 밖) | Figma가 화면 정본이지만 범위는 사용자 결정이 이긴다. 1차 구현은 `b01` 껍데기(헤더·컨텍스트 칩·입력·quick reply)만 쓰고 숙소 카드는 그리지 않는다. Figma 개정 또는 "1차 밖" 표기는 frontend 하네스(figma-build) 소관으로 상신 |
| **G-U8-9** | **✦ FAB가 Figma에 없다** — 밴드 `b` 10프레임은 열린 시트만 그리고 진입 FAB·스택 배치는 그리지 않았다 | Q12=B 배치(BR-U8-50~53)를 Figma에 그려 달라고 상신. 값은 기존 FAB 규격(56×56, `right-lg`)을 쓴다 |
| **G-U8-10** ★ | **토스트가 기존 FAB 스택 윗변(208) 위 220에 고정**이다(`shared/ui/Toast.tsx:13,70`, TRIP-1286). ✦를 220에 얹으면 토스트와 겹친다 | ✦ 있는 화면에서 토스트를 ✦ 윗변(276) + 12 = **288**로 올린다(BR-U8-52). 토스트는 루트 `ToastHost` 하나라 화면별 오프셋을 받을 장치가 필요하다 |
| **G-U8-11** | 거부 앵커에 **범위 밖 하위 갈래 라벨이 없다**(주석 `# 결제·예약`뿐) — backend가 "예약 요청이라 OTA로 보낸다"를 구분할 수 없다 | 1차는 화면 문맥(`STAY_DETAIL`)으로 대안을 고른다. ai에 앵커 갈래 필드(`scope_group`) 상신 |
| **G-U8-12** | 거부 앵커에 **프롬프트 주입·지침 유출 문장이 0건**이다(`프롬프트`·`지침`·`무시` grep 0) | 구조적 방어(DEC-U8-6 템플릿 응답 + §5 화이트리스트)로 유출은 막힌다. 다만 그런 발화가 엉뚱한 의도로 붙어 엉뚱한 카드가 뜰 수 있다 → ai에 앵커 갈래 추가 상신 |
| **G-U8-13** | ai 문서 `agent-io-contracts.md:370` "AI 도우미 채팅 화면 = 와이어프레임에 부재(M16, 타 팀 담당)"가 낡았다(D-U8-3). ai `services.md` §2 `AssistantOrchestrator`는 DEC-U8-1로 채택하지 않는다 | ai 패키지 소유 — 개정 상신 |
| **G-U8-14** | `frontend/.claude/skills/spec-perception/reference/figma-structure.md`가 밴드 `b`를 "M16 — first-cut 밖"으로 적는다 | frontend 하네스 소유 — `harness-rule-edit` 경로로 개정 상신 |

> **[개정 · 2026-10-21 · U8 최소 마감 (TRIP-1512 / TRIP-1516)] 갭 G-U8-1~14 상태.** 위 원문 행은 착수 시점(2026-10-12) 서술로 보존한다.
>
> | ID | 상태 | 근거 |
> |---|---|---|
> | G-U8-1 | 해소 | 편집 퍼사드 신설, 변경 출처 `ASSISTANT` 수용(TRIP-1374) |
> | G-U8-2 | 해소 | `/ai/v1/itinerary/edit` 백엔드 호출 배선(TRIP-1376) |
> | G-U8-3 | 해소 | 일정 퍼사드에 거리·위반 3필드(TRIP-1375) |
> | G-U8-4 | 해소 | ai 대화 경계 `POST /ai/v1/dialogue/interpret`(TRIP-1410) + 오케스트레이터(#1308·#1309), 개발·운영 서버 켜짐(#1313) |
> | G-U8-5 | 해소 | 일정 밖 두 곳 거리 답변(#1466) — O-U8-8 |
> | G-U8-6 | 소멸 | "검토해줘" 뱅크 문장 보강 대상(질문뱅크 1차)이 10-17 개정으로 분류 경로에서 빠졌다. 옛 3단 라우터는 제거 결정(business-rules O 개정 블록) |
> | G-U8-7 | **잔존** | 넘긴 화면이 바뀐 조건을 받는 입력(쿼리 프리필)은 아직 없다. 후속 |
> | G-U8-8 | 해소 | Figma `b01-[1차]` 새 프레임에 "1차 밖" 표기(TRIP-1328, 4865:3615) |
> | G-U8-9 | 해소 | Figma `b08-[✦] 진입 FAB` 4프레임(frontend-components R20). 정본 이식은 사람 판단 |
> | G-U8-10 | 해소 | `useRaisedToastBottom`(frontend-components R7) |
> | G-U8-11 | **잔존** | 거부 앵커의 범위 밖 하위 갈래 라벨(`scope_group`) 코드 검색 0건 — 미구현 |
> | G-U8-12 | 해소 | 주입 꼴 발화는 LLM 앞에서 거절, 지난 턴·기억으로 다시 싣지 않음(#1399) |
> | G-U8-13 | 확인 | "AI 도우미 채팅 화면 = 와이어프레임에 부재(M16, 타 팀)" 문장이 `ai/docs` 에서 더는 발견되지 않는다(2026-10-21 검색) |
> | G-U8-14 | 해소 | `figma-structure.md` 가 밴드 `b` 를 U8 도우미 개발 범위로 적고 있다 |


---

## 8. 스토리 커버리지

| 스토리 | 화면(Figma) | 규칙 | 상태 |
|---|---|---|---|
| US-ASSIST-01 호출·컨텍스트 | ✦ FAB + `b01`·`b07` | BR-U8-01~06 · 50~53 | 설계 완료. FAB Figma 없음(G-U8-9) · 토스트 이동(G-U8-10) |
| US-ASSIST-02 대화형 재질의 | `b01` | BR-U8-10~13 | **부분** — 일정 쪽(대체 후보·재계획 넘기기)만. 숙소 재질의 1차 밖(DEC-U8-10), 화면 프리필 1차 밖(G-U8-7) |
| US-ASSIST-03 진행 검토 | `b01 review` | BR-U8-14~16 | 설계 완료. 퍼사드 확장 선행(G-U8-3) |
| US-ASSIST-04 액션 위임 | `b02` | BR-U8-30~35 | 설계 완료. 편집 퍼사드 선행(G-U8-1·2) |
| US-ASSIST-05 대화 이력·세션 | `b06` | BR-U8-17~21 | 설계 완료. 보존 기간 값 미결(O-U8-1). 비로그인 갈래 N/A(Q14) |
| US-ASSIST-06 가드레일 | `b04` | BR-U8-22~26 | 설계 완료. 앵커 갈래 상신(G-U8-11·12) |
| US-ASSIST-07 범위 한계 | `b03` | BR-U8-27~29 | 설계 완료 |
| US-ASSIST-08 폴백 | `b05` 2종 | BR-U8-40~45 | 설계 완료 |

**미커버 0** — 단 02는 범위를 줄인 부분 커버이고(사용자 결정 Q8=A), 전 스토리가 **ai 대화 경계(G-U8-4)가 열려야** 실제로 돈다. 그 전에는 quick reply 액션 턴(LLM 0회)과 페이크 해석기로 개발·검증한다.
