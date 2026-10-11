# U8 Conversational Assistant — NFR Requirements

> **방침**: 얇게(O-U8-9 판정). U0·U1·U3·U6 상속분과 **이미 수치가 적힌 곳은 재서술하지 않고 가리킨다**(§8).
> - 첫 응답 3s · 전체 15s · 분당 20회 = ai `ai/aidlc-docs/inception/application-design/services.md` §5.1·§5.4(FD A-6·A-7 승계)
> - 리미터 동작(429 + `Retry-After`, ACTION 턴 포함)·금칙어 fail-closed·15s [대기 취소] = FD `business-rules.md` BR-U8-23·24·44
> **답변(2026-10-12)**: **Q1~Q11 전부 A** — 사용자 일괄 지시 "그럼 권고로 ㄱㄱ"(계획 `construction/plans/u8-conversational-assistant-nfr-requirements-plan.md`)
> **실측 기준**: 계획서 Step 1 표(2026-10-12). 여기 적힌 코드 사실은 전부 그 표에서 왔다.

---

## 0. 이 유닛에서 새로 생기는 축

| 축 | 왜 지금 | 상속으로 안 되는 이유 |
|---|---|---|
| **COST** 턴 단위 LLM 비용 | 사용자 자유 발화가 턴마다 LLM(fable, $10/$50 per 1M)을 부를 수 있다 | U3 COST는 "생성 1회"에 묶인 상한(진행 중 거부)뿐. **계정·일·월 총량 상한이 어디에도 없다** |
| **PERF** fable 사고 vs 3s/15s | 전 기능 `claude-fable-5-1` 통일(사고 끌 수 없음) 뒤 라우터 지연 실측이 없다 | U3 PERF는 화면 쪽만, 서버 예산은 생성 경로 값(day1 15s·전체 60s) — **대화형 예산 분배가 없다** |
| **SEC** 사용자별 리미터 · 주입 표면 | 사용자 발화가 LLM에 그대로 들어가는 첫 표면 | U0 SEC는 인증·전송·인가. **사용자별 레이트 집행기가 리포에 0**(`RateLimited`는 던지는 곳이 없다) |
| **DATA** 개인 발화 보존 | 대화 기록이 계정에 쌓인다 | U6 DATA는 알림(시스템 생성 문구). **사용자가 쓴 자유 텍스트의 보존·파기**는 처음 |
| **OBS** 수집기 없는 관측 | EKS에서 OTel·Micrometer OTLP가 꺼져 있고 알람 0 | U6 OBS는 "카운터만 얹는다" — **지금 EKS에선 아무도 못 본다** |

---

## 1. 비용 (COST-U8-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **COST-U8-01** ★ | **계정·일 사용량을 대화 기록과 독립된 행으로 센다** — `assistant_usage_daily(account_id, day, turns, llm_turns)`. 이력 삭제(`b06`)로 줄지 않는다. 계정 파기 시에만 지워진다(DATA-U8-03) | Q1=A. 리미터가 `assistant_message` 행을 세면 이력 삭제가 창을 비운다(우회) |
| **COST-U8-02** | **LLM 턴 일 상한 = 30**(설정값 `assistant.daily-llm-turn-limit`, 코드·문서 하드코딩 금지). "LLM 턴" = 해석 응답 `llm_calls ≥ 1`이었거나 `/ai/v1/itinerary/edit`를 **발화(`utterance`)로** 부른 턴. **초기값 30은 근거 없는 값**이고 OBS-U8-02 관측 후 조정한다 | U3 COST-U3-03(근거 없는 초기값 + 설정값) 동형 |
| **COST-U8-03** ★ | 일 상한 초과는 **차단이 아니라 강등**이다 — TEXT 턴은 해석을 부르지 않고 "오늘은 버튼으로 도와드릴게요" + quick reply(LLM 0회 ACTION 경로)로 답한다. ACTION 턴·진행 검토(`REVIEW`)·[적용]은 계속 된다. 응답은 `next_actions ≥ 1`(INV-U8-03) | INV-4 · BR-U8-06 dead-end 금지 |
| **COST-U8-04** ★ | **서비스 전역 월 LLM 호출 수 상한**(설정값 = 월 예산 ÷ PERF-U8-03 실측 호출당 단가). backend가 `assistant_usage_daily.llm_turns` 합으로 세고, 도달하면 **전역 버튼 모드**(COST-U8-03과 같은 응답)로 강등한다. 월이 바뀌면 자동 해제 | Q2=A. 비용은 ai 로그(`api/cost.py`)에만 있고 수집기가 꺼져 있어 backend가 아는 숫자로 집행한다 |
| **COST-U8-05** | 벤더 콘솔의 **지출 한도**를 별도로 건다 — 운영 핸드오프(tech-stack §6). COST-U8-04가 1차, 벤더 한도는 마지막 그물이다. 벤더 한도에 닿으면 생성·Plan-B까지 함께 멈추므로 **COST-U8-04가 먼저 닿도록** 값을 잡는다 | Q2=A |
| **COST-U8-06** | 턴 비용의 **확정 상한분**은 출력 상한에서 나온다: LLM 호출 1회 출력 ≤ 1024 토큰(사고 포함) × $50/1M ≈ **$0.051**. 한 턴은 LLM을 **최대 2회**(3차 해석 + 발화 편집 번역) 부른다. 입력분은 컨텍스트 스냅샷 크기에 비례하므로 실측(PERF-U8-03)으로 채운다 — **추정 단가를 문서에 적지 않는다** | `ai/config/llm-prices.json` · `llm_gateway/config.py` `max_tokens=1024` |
| **COST-U8-07** | **ACTION 턴은 LLM 0회다** — quick reply 경로에 LLM 호출을 추가하는 변경은 이 NFR의 재평가 대상이다(§10) | FD DEC-U8-14 · 비용 강등(COST-U8-03)이 성립하는 전제 |

## 2. 성능 (PERF-U8-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **PERF-U8-01** ★ | **잔여 예산 관통**: 서버 턴 예산 **13s**(앱 15s 타이머에서 모바일 왕복 몫 2s를 뺀다). 턴 시작에 마감 시각을 잡고, ai 호출마다 `deadline_ms = min(단계 상한, 잔여 − 1,000)`, read 상한 = `deadline_ms + 1,000`. **단계 합이 턴 예산을 넘을 수 없다** | Q4=A. 기존 마진(2s)을 두 번 얹으면 6+8+2+2 = 18s로 15s를 넘는다. TRIP-376 "호출측 시한 관통" 선례 |
| **PERF-U8-02** | 단계 상한 초기값 = **해석 5s · 편집 = 잔여 전부**. 잔여가 1s 미만이면 ai를 부르지 않고 FALLBACK. 값은 PERF-U8-03 판정 뒤 설정값으로 고정한다 → **O-U8-3 해소 경로** | FD O-U8-3(제안 6s/8s)를 대체 |
| **PERF-U8-03** ★ | **`INTENT` effort 측정 계획**(O-U8-2): ai 평가셋 87발화 × effort {high, medium, low} × **2회**. 기록 = 경로별(1·2·3차) p50/p95 · 정확도 · 게이트 드롭 · **출력 토큰과 1024 잘림 횟수** · 호출당 비용(`llm_cost` 줄). 측정은 ai 팀 소관이고 결과는 ai `config.py` effort 표 주석에 남긴다(그 파일의 기존 규칙) | Q3=A |
| **PERF-U8-04** ★ | **effort 판정 규칙**: 정확도가 high 대비 −1발화 이내 ∧ 게이트 드롭 0 ∧ 잘림 0 ∧ 3차 p95 ≤ 해석 단계 상한(PERF-U8-02)을 만족하는 **가장 낮은** effort를 고른다. 만족하는 값이 없으면 high를 두고 3차 시한 초과는 FALLBACK quick reply로 흡수한다(INV-4). `EDIT_TRANSLATION`도 같은 규칙으로 잰다 — low에서 전량 드롭된 선례가 있으므로 **낮추는 것을 기본값으로 가정하지 않는다** | `llm_gateway/config.py` effort 주석 |
| **PERF-U8-05** | **"첫 응답 3s"의 측정 정의**: LLM 0회 경로(1·2차 해석, ACTION 턴, 조회형 디스패치)의 **서버 처리 p95 ≤ 3s**. 3차·편집이 붙는 턴은 PERF-U8-01 예산(서버 13s)으로 잰다. 경로별 비율은 OBS-U8-01의 `match_route`·`llm_calls`로 나온다 | FD DEC-U8-8("첫 응답 = 응답 시작") 측정화 |
| **PERF-U8-06** ★ | **AI 대기 동안 DB 트랜잭션·커넥션을 쥐지 않는다.** 턴은 ① 짧은 트랜잭션(소유·멱등·리미터·사용자 행 기록) → 커밋 → ② ai 호출(트랜잭션 밖) → ③ 짧은 트랜잭션(도우미 행·제안·사용량 기록)으로 나눈다 | Hikari 기본 풀 10 — 15s 대기를 쥐면 동시 10턴에 **다른 모든 API가** 커넥션을 못 얻는다 |
| **PERF-U8-07** | 세션 열기(`POST /assistant/sessions`)·이력 조회는 ai를 부르지 않는다 — **p95 500ms**(U6 PERF-U6-03 알림함과 같은 급, 인덱스 `(account_id, last_turn_at DESC)`·`(session_id, created_at)` 근거) | FD domain-entities §3 인덱스 |

## 3. 보안·프라이버시 (SEC-U8-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **SEC-U8-01** ★ | **리미터는 파드 수와 무관하게 정확하다** — 계정 단위 `pg_advisory_xact_lock` 안에서 최근 60초 사용자 행을 세고 → 넣고 → 커밋한다. 락은 PERF-U8-06의 첫 트랜잭션에만 건다(AI 호출 전에 풀린다) | Q5=A. backend replicas 2(dev·prd) — 락 없이 세면 동시 요청이 각자 19를 보고 21이 된다(PBT-U8-4 위반) |
| **SEC-U8-02** | **앱은 429를 두 종류 받는다** — backend(JSON 에러 + `Retry-After`)와 gateway nginx(`limit_req` IP당 10r/s, **`Retry-After` 없음**). `Retry-After`가 없으면 고정 문구 "잠시 후 다시 시도해 주세요"로 그리고 숫자를 지어내지 않는다 | `gateway-config.yaml` `limit_req_status 429` |
| **SEC-U8-03** ★ | **화면에 나가는 LLM 유래 문자열은 둘뿐이다** — ① closed-set 라벨·enum의 템플릿 문구 ② **사용자 발화의 부분 문자열**(인자 원문 조각). ai가 돌려준 인자 값이 사용자 발화의 부분 문자열이 아니면(3차 LLM이 지어낸 값) **칩·요약에 싣지 않는다**(BR-U8-13 "바꾼 조건 칩"의 집행 조건). 길이 상한 40자 | DEC-U8-6 템플릿 원칙의 **틈**: 칩은 `frames[0].arguments`를 그리는데, 3차가 낸 인자는 원문 조각이라는 보장이 없다 → 주입 문장이 칩으로 새는 경로 |
| **SEC-U8-04** | 앱은 도우미 문구·칩을 **플레인 텍스트로만** 렌더한다 — 마크다운·링크·HTML 해석 없음. 이동은 `next_action`(closed-set) 버튼으로만 | SEC-U3-03 승계를 도우미 전 문구로 확장 |
| **SEC-U8-05** | **주입 회귀 말뭉치**를 backend 테스트 자산으로 둔다 — 지침 유출·타 계정 요청·역할 전환 발화 묶음을 페이크 해석기에 흘려 ① 응답 문구가 템플릿 집합 밖으로 나가지 않고 ② 스냅샷 키가 화이트리스트 안인지 단언한다. ai 쪽 앵커 보강(G-U8-11·12 상신)과 **독립**으로 돈다 — backend 방어는 ai 앵커 유무에 기대지 않는다 | FD BR-U8-22·26 · PBT-U8-3 |
| **SEC-U8-06** ★ | **발화 원문은 두 곳에만 있다** — `assistant_message.text`(보존 정책 적용)와 LLM 벤더 호출 본문. backend·ai 애플리케이션 로그·예외 메시지·Sentry 이벤트에 **원문·컨텍스트 스냅샷을 싣지 않는다**(길이·intent·match_route·trace_id만). 운영 이미지 LangSmith 미탑재를 유지한다 | Q8=A. 로그에 새면 보존 정책(DATA-U8-01) 밖에서 7·30일 남는다 |
| **SEC-U8-07** | 발화 마스킹(전화·이메일)은 **1차 미도입**. 처리방침의 LLM 처리위탁·국외이전 항목에 "도우미 발화"를 추가하는 것은 법무 핸드오프(tech-stack §6) | Q8=A. 마스킹이 인자 추출(장소명·시각)을 깰 위험 > 이득 |
| **SEC-U8-08** | 컨텍스트 스냅샷은 **크기도 최소화**한다 — 슬롯은 FD §5 화이트리스트 4필드만, 일자 수·슬롯 수 상한(설정값, 초기값 일자 14 · 일자당 슬롯 20)을 넘으면 **현재 일자 ±1일만** 싣는다 | 입력 토큰 = 비용(COST-U8-06) = 지연. 권한 경계(BR-U8-22)와 별개로 **양**의 최소화 |

## 4. 데이터 (DATA-U8-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **DATA-U8-01** ★ | **대화 이력 보존 = 마지막 턴 후 90일**(`expires_at = last_turn_at + 90d`, 턴마다 연장, 설정값 `assistant.retention-days`). 청소 배치(`@Scheduled` + ShedLock — FD domain-entities §4)가 지난 세션을 지운다(메시지·제안 CASCADE). **값은 잠정** — 처리방침 확정 시 설정값만 바꾼다 → **O-U8-1 해소(잠정)** | Q6=A. DATA-U6-03(알림 90일) 선례 |
| **DATA-U8-02** ★ | **계정 삭제 요청 즉시 파기** — `auth.AccountDeletionRequested`를 구독해 그 계정의 `assistant_session`(→ 메시지·제안 CASCADE)과 `assistant_usage_daily`를 지운다. **철회해도 복원하지 않는다**(GPS 즉시 파기 INV-D2와 같은 규율). 구독자는 멱등이다(at-least-once 아웃박스) | Q7=A. **30일 파기 배치가 미구현**이라(`AccountDeletionService.kt` "실제 30일 파기 배치는 후속") FD의 "FK CASCADE"만으로는 영원히 안 지워진다 |
| **DATA-U8-03** | FK `ON DELETE CASCADE`(FD domain-entities §3)는 **이중 안전망**으로 유지한다 — 파기 배치가 생기면 그대로 동작한다. `assistant_usage_daily`도 같은 FK | — |
| **DATA-U8-04** | `assistant_usage_daily`는 **40일 보관** 후 청소(월 상한 COST-U8-04 집계에 필요한 만큼). 발화 내용이 없는 카운터라 대화 보존 정책과 분리한다 | COST-U8-01 |
| **DATA-U8-05** | **이력 지우기(`b06`)는 hard delete**다(세션 단위, 메시지·제안 CASCADE). 사용량 행은 남는다(COST-U8-01). 이미 적용된 일정 변경·change log·리비전은 남는다(BR-U8-20) | — |
| **DATA-U8-06** | **`/me/export`에 도우미 세션·메시지를 넣는다**(본인 것만, `accountId` 스코프 — 내보내기의 유일한 안전 요건). 금칙어로 `redacted`된 행은 표지만 | `AccountExportController` 머리 주석 · 개인 발화도 정보주체 열람 대상 |
| **DATA-U8-07** | `dialogue_context` jsonb는 **보류 프레임만** 담는다(BR-DLG-21) — 원문 목록을 넣는 변경은 이 보존 정책 재평가 대상이다 | ai FD BR-DLG-21 |

## 5. 신뢰성·가용성 (REL-U8-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **REL-U8-01** ★ | **ai 미도달·5xx·시한 초과 = 그 턴만 FALLBACK 1건**(BR-U8-40·41). backend **재시도 없음 · 서킷 미도입**(U1·U4·U6 승계). 15s 예산에 재시도 몫이 없다 | Q9=A |
| **REL-U8-02** ★ | **ai가 죽어도 도우미는 "버튼 모드"로 남는다** — ACTION 턴·진행 검토(`REVIEW`)·이력 조회·[적용](`/validate`·`/repair`를 부르는 편집 경로는 그쪽 폴백 규칙)은 해석 경계 없이 돈다. COST-U8-03·04 강등과 **같은 응답 모양**을 쓴다(한 가지 강등 모드) | INV-4 · FD §6 폴백 표 |
| **REL-U8-03** | **도우미 장애가 다른 API로 번지지 않는다** — PERF-U8-06(트랜잭션 분리)이 커넥션 풀을, 턴 예산 13s 상한이 스레드 점유 시간을 묶는다. 도우미 전용 스레드 풀·벌크헤드는 두지 않는다(재평가 트리거 §10) | Tomcat 기본 200 스레드 × replicas 2 |
| **REL-U8-04** | 임베딩 장애 시 라우터가 3차로 직행할지 FALLBACK할지는 **ai 소관**이다. backend는 응답의 `llm_calls`로 비용만 세고, 늘어난 LLM 턴은 COST-U8-02·04가 막는다 | 임베딩 dev 1 replica·PDB 없음(`values-dev.yaml`) |
| **REL-U8-05** | ai 해석 경계의 실패를 **일정 폴백 신호로 쓰지 않는다**(BR-U8-45) — 생성 경로의 "4xx = 최소일정 폴백" 관례를 이 어댑터에 복사하지 않는다 | FD §3.2 |
| **REL-U8-06** | 전역 스위치 `ASSISTANT_INTERPRET_MODE`(`off`·`fake`·`http`) — `off`는 운영자가 수동으로 버튼 모드를 거는 킬 스위치다(벤더 장애·비용 사고). 기본값은 기존 `AI_SCHEDULE_MODE` 관례처럼 로컬 `fake` | G-U8-4(페이크 먼저) · COST-U8-04와 같은 강등 |

## 6. 관측 (OBS-U8-\*)

EKS에서 OTel·Micrometer OTLP가 꺼져 있고 알람이 0건이다(`shared-infrastructure.md` §관측). 그래서 **지표의 원천을 DB 행에 둔다**(Q10=A). 보존 정책(DATA-U8-01)과 함께 지워지므로 별도 파기가 필요 없다.

| ID | 요구 |
|---|---|
| **OBS-U8-01** ★ | `assistant_message`(도우미 행)에 **4칸**을 둔다 — `outcome`(FRAME·ARGUMENT_CLARIFY·OUT_OF_SCOPE·FALLBACK 원인·REFUSAL·DOWNGRADED) · `match_route`(CONFIDENT·VOTED·LLM_DIRECT·ACTION·NONE) · `llm_calls`(int) · `latency_ms`(서버 처리 시간). FD domain-entities §3.2 개정 대상(마이그레이션 착수 시 반영) |
| **OBS-U8-02** | **집계 6종을 SQL로 정의**해 backend 문서에 둔다: ① 일별 턴 수(TEXT/ACTION) ② **OUT_OF_SCOPE율** ③ **FALLBACK율(원인별)** ④ **적용률** = APPLIED ÷ 생성된 제안 ⑤ STALE·EXPIRED율(O-U8-4 판정 입력) ⑥ 경로별 `latency_ms` p95(PERF-U8-05 판정) |
| **OBS-U8-03** | 강등 발생(COST-U8-03 계정·COST-U8-04 전역·REL-U8-06 수동)은 **WARN 구조화 로그 1줄**(계정 id 해시·원인) — 조용히 강등하지 않는다(INV-4 취지) |
| **OBS-U8-04** | 같은 이름의 Micrometer 카운터를 함께 얹는다(`assistant.turns`·`assistant.fallback`·`assistant.downgraded`) — 수집기가 켜지면 바로 쓰도록. 그 전까지는 OBS-U8-02가 정본 |
| **OBS-U8-05** | **임계값을 두지 않는다** — 관측만 하고 판정은 재평가 트리거(§10)에서 사람이 한다(OBS-U3-04 승계) |

> 비용 달러 집계는 ai `api/cost.py`(`trace_id`별 `llm_cost` 줄)가 정본이다 — backend가 다시 만들지 않는다(OBS-U3-01 승계). backend가 세는 것은 **호출 수**(COST-U8-04)다.

---

## 7. 게이트웨이·인그레스

**변경 없음.** 근거만 적는다.

- gateway nginx `proxy_read_timeout 620s`·NLB idle 350s ≫ 서버 턴 13s. 도우미 경로를 위한 location 분리·타임아웃 조정 불필요(`gateway-config.yaml`).
- 외부 노출은 `/api`만 — 도우미 API는 `/api/v1/assistant/*`라 그대로 들어간다. ai는 클러스터 내부(`http://ai:8000`, `X-Service-Token`)이고 외부에서 닿지 않는다. ai `/ai/v1/dialogue/interpret`도 같은 경로.
- `limit_req` IP당 10r/s burst 30은 사용자 턴(분당 20)보다 훨씬 느슨해 정상 사용을 막지 않는다. 다만 응답 모양이 다르다 → SEC-U8-02.
- ai 미들웨어 리미터(IP 키 = backend 파드)는 backend 전체 호출에 걸리는 백스톱이지 사용자 리미터가 아니다(DEC-U8-9 확인).

## 8. 상속 (재서술하지 않음)

- **U0**: 인증·인가·토큰·삭제 유예 30일·보안 베이스라인(SECURITY-01~15, Full)·위치 동의 3층
- **U1**: 외부 포트 폴백·**Redis 미도입(보류) 사실**·**서킷 미실장 사실**
- **U3**: LLM 토큰 상한은 C1 실장값(`llm_gateway/config.py`) · AI 관측 레코드 5종 정본(OBS-U3-01) · LLM 텍스트 플레인 렌더(SEC-U3-03)
- **U6**: `@Scheduled` + ShedLock 청소 패턴(REL-U6-04, 다중 인스턴스 운영 중) · 90일 보관 선례
- **ai 문서**: 지연 3s/15s(§5.1) · 분당 20회(§5.4) · 대화 상태 최소 전달(BR-DLG-20·21)
- **FD**: 리미터 응답(BR-U8-24) · 금칙어 fail-closed(BR-U8-23) · 15s 취소(BR-U8-44) · 스냅샷 화이트리스트(BR-U8-22)

## 9. PBT (blocking — security-baseline Full · PBT Partial)

FD **PBT-U8-1~9 · F1**을 그대로 게이트로 쓴다. NFR이 **집행 조건을 좁히는 것 2건**과 **추가 1건**:

| ID | 성질 | 층 | 매핑 |
|---|---|---|---|
| PBT-U8-4 (보강) | 리미터 창 ≤ 20을 **동시 요청 2개 이상**(가상 스레드·Testcontainers PostgreSQL)에서도 단언한다 — 단일 스레드 성질로 좁히지 않는다 | backend | SEC-U8-01 |
| PBT-U8-8 (보강) | INV-3 문자열 검사 대상에 **칩 문구**(SEC-U8-03 통과분)를 넣는다 | backend · FE | SEC-U8-03 |
| **PBT-U8-N1** ★ | **칩 폐포** — 임의의 발화 `u`와 임의의 ai 인자 값 `a`(악의적 문자열 포함)에 대해, 생성된 칩 문구 ∈ 템플릿 집합 ∪ { `u`의 부분 문자열 ≤ 40자 }. `a`가 `u`의 부분 문자열이 아니면 칩에 나타나지 않는다 | backend(Kotest property) | SEC-U8-03 |

확장 설정의 PBT Partial(PBT-02·03·07·08·09 blocking — 순수 함수·직렬화 왕복) 범위 안이다: N1은 순수 함수(칩 생성기) 성질이다.

## 10. 재평가 트리거

| 트리거 | 재평가 대상 |
|---|---|
| PERF-U8-03 측정 완료 | PERF-U8-02 단계 상한 고정 · COST-U8-04 월 상한 수치 산출 · O-U8-2·3 닫기 |
| 일 상한(30) 도달 계정이 관측 창에서 반복(OBS-U8-03) | COST-U8-02 값 조정 |
| 전역 월 상한 도달 | COST-U8-04 예산 재산정 · 모델·effort 재검토 |
| quick reply(ACTION) 경로에 LLM 호출 추가 | COST-U8-07 · COST-U8-03 강등 모드 성립 여부 |
| 처리방침 확정 · 법무 의견 | DATA-U8-01 값 · SEC-U8-07 마스킹 |
| 30일 파기 배치 구현 | DATA-U8-02(즉시 파기)와 배치의 중복 정리 — 즉시 파기는 유지 |
| 도우미 동시 턴이 스레드·커넥션 경합으로 다른 API p95를 올림 | REL-U8-03 벌크헤드(전용 풀) 또는 가상 스레드 도입 |
| 스트리밍(SSE) 요구 | PERF-U8-05 "첫 응답" 정의 · 게이트웨이 `proxy_buffering`(이미 off) 재확인 · NFR Design 재개 |
| OTel 수집기 개통 | OBS-U8-04를 정본으로 승격, OBS-U8-02 SQL은 보조로 |
| 포그라운드 위치를 스냅샷에 싣기로 결정(O-U8-5) | SEC-U8-06·08 · 위치 법정 로그 대상 여부(U0) |
