# U8 Conversational Assistant — NFR Requirements Plan

> **선행**: U8 Functional Design 승인(2026-10-12 "그럼 권고로 ㄱㄱ") · 산출물 4종 `u8-conversational-assistant/functional-design/`
> **O-U8-9 판정**: NFR은 **필요하되 얇게**. 새 축만 다룬다. 수치 중 ai 문서(`ai/aidlc-docs/inception/application-design/services.md` §5.1 첫 응답 3s·전체 15s, §5.4 분당 20회)와 FD 규칙(BR-U8-23·24·44 등)에 이미 있는 것은 **다시 적지 않고 가리킨다**.
> **방침**: 실장 우선(리포 실물 먼저 확인) · U0·U1·U3·U6 상속분 재서술 금지(U6 NFR 선례).
> **이 스테이지를 도는 이유**: U8은 **사용자가 자유 발화로 LLM을 직접 부르는 첫 표면**이다. U3의 LLM 호출은 "생성 1회"에 묶여 있었지만 도우미는 턴 수만큼 부른다 — 계정·월 단위 비용 상한, fable 사고 지연, 개인 발화 보관, 주입 표면이 U0~U6 어디에도 없던 축이다.

---

## Step 1 결과 — 실측 (2026-10-12)

| 자산 | 실재 | U8 NFR 함의 |
|---|:-:|---|
| LLM 배정 — 전 기능 `claude-fable-5-1`(`.env.example` `AI_LLM_FEATURE_MODELS`) | ✅ | 사고를 끌 수 없다. `INTENT`·`EDIT_TRANSLATION`은 `default_feature_effort()`에 없음 = 모델 기본(high) (`ai/src/trippilot/llm_gateway/config.py:172~198`) |
| 출력 상한 — `INTENT`·`EDIT_TRANSLATION`은 공용 `max_tokens=1024`, **사고 토큰도 이 안**(같은 파일 `default_feature_max_tokens` 주석) | ✅ | high effort에서 1024 잘림 → 파싱 실패 → 폴백 위험. SHARE_CARD_COPY가 같은 이유로 잘린 실측이 있다 |
| 단가표 — `claude-fable-5-1` 입력 $10 · 출력 $50 / 100만 토큰 | ✅ `ai/config/llm-prices.json` | **턴당 출력 상한분 = 1024 × $50/1M ≈ $0.051/LLM 호출**(입력분은 실측 필요) |
| 요청당 비용 집계 — `trace_id`별 `llm_cost` 로그 줄 | ✅ `ai/src/trippilot/api/cost.py` | 비용은 **ai 로그에만** 있다. 프로세스 로컬 누계(다중 인스턴스 미합산 — 파일 머리 `ponytail:` 주석) |
| 비용 **상한**(계정·월) | ❌ ai·backend 어디에도 없음 | U3 COST도 "진행 중 거부 + 회차 상한(미구현)"뿐 — **새 축** |
| ai 리미터 — in-memory 토큰버킷, **키 = 클라이언트 IP**(`api/middleware.py` `RateLimitMiddleware`) | ✅ | ai 쪽 클라이언트는 backend 파드다 → 사용자별로 못 센다(FD DEC-U8-9 확인) |
| backend `RateLimited(retryAfterSeconds)` → 429 + `Retry-After` | ✅ `common/core/.../DomainException.kt:79` | 던지는 곳만 새로 만든다 |
| gateway nginx — `limit_req` **IP당 10r/s burst 30**, `limit_req_status 429`, `proxy_read_timeout 620s`, 외부 노출 `/api`만 | ✅ `deploy/eks/chart/templates/gateway-config.yaml` | 15s 턴은 타임아웃 변경 불필요. **nginx 429에는 `Retry-After`가 없다**(앱이 두 종류 429를 받는다) |
| backend→ai HTTP 클라이언트 — read 상한 = 대기 상한 + `readTimeoutMarginMs`(2,000), connect 3,000 | ✅ `ScheduleAgentConfiguration.kt:36·50` · `ScheduleAgentProperties.kt:20~21` | 경로별 RestClient 선례. 마진을 그대로 쓰면 해석 6s + 편집 8s + 마진 2×2s = **18s > 15s** |
| Tomcat·Hikari 설정 | 기본값(`application.yml`에 `threads`·`hikari` 키 없음) | 플랫폼 스레드 200 · 커넥션 풀 10. **15s AI 대기 동안 트랜잭션을 쥐면 동시 10턴에 풀 고갈** |
| 금칙어 `TextModerationFacade.inspect` — 사전 없으면 예외(fail-closed) | ✅ | FD BR-U8-23 그대로 |
| 계정 삭제 — 요청 시 `DELETION_PENDING` + 30일 유예, 세션·GPS는 **즉시** 파기, **30일 파기 배치는 미구현**("후속(스케줄러)") | ⚠️ `auth/application/AccountDeletionService.kt:26~28` | FD "계정 삭제는 FK CASCADE"는 **파기 배치가 없어 영원히 안 돈다** → DATA 축 |
| 관측 — EKS에서 OTel·Micrometer OTLP **꺼짐**, 컨테이너 로그 수집 꺼짐, 알람 0 | ⚠️ `shared-infrastructure.md` §관측 | Micrometer 카운터만 얹으면 **아무도 못 본다** → OBS 축 |
| 임베딩 서버 — dev 1 replica, PDB 없음(드레인 시 규칙 랭킹 degraded 계약) | ✅ `values-dev.yaml:40~45` | IntentRouter 1·2차(LLM 0회)가 임베딩에 기댄다. 임베딩이 빠지면 턴이 3차(LLM)로 몰릴 수 있다 → COST·REL |
| 앱 — `expo-crypto`(~15.0.9, `clientTurnId` UUID)·`@gorhom/bottom-sheet`·`@sentry/react-native` | ✅ `frontend/package.json` | **프런트 신규 의존성 0 · 네이티브 재빌드 0** |
| 운영 LangSmith — 운영 이미지에 없음(발화 원문 전송 경로 없음) | ✅ `.env.example` LangSmith 절 | 유지 |

---

## 실행 계획

- [x] 1. FD 4종·FD 계획서 답변 정독 + 상속 NFR(U0·U3·U6)·`shared-infrastructure.md`·`aidlc-state.md` 확장 설정(security-baseline Full · PBT Partial) 확인
- [x] 2. 코드 실측(위 표) — ai `llm_gateway/config.py`·`api/middleware.py`·`api/cost.py`·`ai/docs/openapi.json`(대화 경계 아직 없음), backend `RateLimited`·moderation·`ScheduleAgentConfiguration`·계정 삭제, `gateway-config.yaml`, 루트 `.env.example`
- [x] 3. 질문 Q1~Q11 작성(아래)
- [x] 4. **답변 수집** — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ"로 전 문항 권고안 적용(모호한 답 없음 → 후속 질문 파일 불필요)
- [x] 5. `nfr-requirements.md` — 새 축(COST·PERF·SEC(프라이버시 포함)·DATA·REL·OBS) + 상속 목록 + PBT 매핑 + 재평가 트리거
- [x] 6. `tech-stack-decisions.md` — 상속 / U8 델타 / 미도입 결정 / 개발 중 처리
- [x] 7. 정합 검증 — FD 규칙(BR-U8-23·24·44)과 수치 중복 없음 · U1/U4/U6 "서킷 미도입·Redis 미도입·`@Scheduled` 재사용"과 충돌 없음
- [ ] 8. 완료 메시지 → 승인 게이트 → `audit.md`·`aidlc-state.md`(오케스트레이터 몫 — 이 작업에서는 편집하지 않는다)

---

## 질문 (`Q1=A Q2=B …` 한 줄 가능)

### Q1. 계정 단위 LLM 비용 상한 (COST)

분당 20턴(BR-U8-24)은 **남용 속도**를 막지 **총량**을 막지 않는다. 20턴/분을 한 시간 유지하면 1,200턴이다. 또 리미터는 `assistant_message` 행을 세는데 **사용자가 `b06 이력 지우기`로 행을 지우면 창이 비워진다** — 리미터 자체가 우회된다.

A) **계정·일 사용량 행을 따로 둔다**(`assistant_usage_daily(account_id, day, turns, llm_turns)` — 이력 삭제와 독립, 계정 CASCADE). **LLM을 부른 턴**(해석 3차 또는 `/edit` 발화 번역)을 하루 **30회**(설정값, 근거 없는 초기값 — U3 COST-U3-03 동형)까지. 넘으면 TEXT 턴은 해석을 생략하고 "오늘은 버튼으로 도와드릴게요" + quick reply(LLM 0회 ACTION 경로)로 답한다 — 막지 않고 강등한다 **(추천: 이력 삭제 우회를 닫고, ACTION 경로가 있어 사용자가 막다른 곳에 서지 않는다)**

B) 일 상한을 `assistant_message` 행 수로 센다(테이블 신설 없음) — 이력 삭제로 우회 가능

C) 일 상한 없음 — 분당 20턴만

X) 기타 (아래 [Answer]: 뒤에 서술)

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q2. 월 예산·서비스 전역 차단 (COST)

비용은 ai 로그(`llm_cost`)에만 있고 수집기가 꺼져 있다. backend는 달러를 모른다. 버그 하나(루프 재시도 등)로 한 달 예산이 하루에 나갈 수 있다.

A) **서비스 전역 월 LLM 호출 수 상한**(설정값 = 월 예산 ÷ O-U8-2 실측 호출당 단가). backend가 `/interpret` 응답의 `llm_calls`와 `/edit` 발화 호출을 `assistant_usage_daily`에서 합산해 세고, 도달하면 **해석 경로를 자동으로 끈다**(Q1의 버튼 모드와 같은 강등, 전역). 벤더 콘솔 지출 한도는 **운영 핸드오프**로 따로 건다(이중 안전망) **(추천: 새 인프라 없이 backend가 아는 숫자로 집행하고, 벤더 한도는 마지막 그물이다)**

B) 관측만 하고 차단은 사람이 한다(알람 인프라가 0이라 사실상 "아무도 모름")

C) 벤더 콘솔 한도만 — 도달 시 ai 전 기능(생성·Plan-B 포함)이 함께 죽는다

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q3. `INTENT` effort 측정 계획 (PERF — O-U8-2)

라우터 실측은 fable 통일 **전**(p95 4,231ms)뿐이다. fable high는 사고를 끌 수 없고 사고 토큰이 1024 상한을 먹는다.

A) **ai 평가셋 87발화 × effort {high, medium, low} × 2회**(ai effort 표 규칙 "최소 2회"). 기록 = 경로별(1·2·3차) p50/p95 · 정확도 · 게이트 드롭 · **출력 토큰(1024 잘림 횟수)** · 호출당 비용(`llm_cost`). **판정 규칙**: 정확도가 high 대비 1발화 이내 ∧ 게이트 드롭 0 ∧ 잘림 0 ∧ 3차 p95 ≤ 해석 시한(Q4) 을 만족하는 **가장 낮은** effort. 만족하는 값이 없으면 high를 두고 3차 시한 초과는 FALLBACK quick reply로 흡수(INV-4) **(추천: EDIT_TRANSLATION이 low에서 전량 드롭된 선례가 있어 "낮추면 빠르다"를 가정할 수 없다 — 판정 규칙을 먼저 박는다)**

B) high 고정, 측정 생략

C) 지금 low로 정하고 문제가 보이면 올린다

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q4. 턴 예산 분배 (PERF — O-U8-3)

FD 제안(해석 6s · 편집 8s)에 기존 read 마진 2s를 두 번 얹으면 18s로 15s 상한을 넘는다. 앱 타이머 15s에는 모바일 왕복도 들어 있다.

A) **잔여 예산 관통**: 서버 턴 예산 **13s**(모바일 왕복 몫 2s를 15s에서 뺀다). 턴 시작에 마감 시각을 잡고, 각 ai 호출의 `deadline_ms = min(단계 상한, 잔여 − 1s)`, read 상한 = `deadline_ms + 1s`. 단계 상한 초기값 = 해석 **5s** · 편집 **잔여 전부**. 잔여가 1s 미만이면 ai를 부르지 않고 FALLBACK. 값은 Q3 실측 뒤 고정 **(추천: TRIP-376 "예산 있는 호출은 호출측 시한이 관통" 선례와 같은 모양이고, 단계 합이 상한을 넘을 수 없다)**

B) 고정 분배 6s/8s + 마진 2s(합 18s — 앱 타이머와 어긋남)

C) 15s 한 덩어리, 단계 시한 없음

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q5. 분당 20턴 리미터의 원자성 (SEC)

FD는 "최근 60초 사용자 행 수를 센다"로 정했다. backend는 replicas 2이고, 같은 계정의 동시 요청 둘이 각각 19를 세고 둘 다 넣으면 21이 된다 — PBT-U8-4("어느 창에서도 ≤20")가 깨진다.

A) **계정 단위 advisory 트랜잭션 락**(`pg_advisory_xact_lock(계정 해시)`) 안에서 세고 → 사용자 행을 넣고 → 커밋. 락은 짧은 첫 트랜잭션에만 걸고 AI 호출 전에 푼다 **(추천: 새 인프라 0, 파드 수와 무관하게 정확하다)**

B) 근사 허용 — 소량 초과를 받아들이고 PBT를 단일 스레드 성질로 좁힌다

C) Redis 카운터(U1 보류 상태 그대로 — 도우미만을 위해 도입)

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q6. 대화 이력 보존 기간 (DATA — O-U8-1)

`expires_at` 컬럼·청소 배치는 FD에 있고 값만 비었다. 운영·법무 결정이지만, 값이 비면 배치가 아무것도 안 지운다(= 무기한 보관).

A) **마지막 턴 후 90일**(`expires_at = last_turn_at + 90d`, 턴마다 연장). 개인정보 처리방침에 "도우미 대화 기록 — 마지막 이용 후 90일" 항목을 넣는 것은 **법무 핸드오프**(값은 잠정, 처리방침 확정 시 설정값만 바꾼다) **(추천: U6 알림 90일 보관(DATA-U6-03) 선례와 같고, "닫았다 열어도 직전 대화"(PRD 02-5)를 여행 한 사이클 동안 지킨다)**

B) 1년

C) 30일

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q7. 계정 삭제 시 대화 이력 (DATA/LEGAL)

FD는 "계정 삭제 = FK CASCADE"로 적었지만 **30일 파기 배치가 미구현**이라 CASCADE가 일어나지 않는다. 현행 삭제 요청은 세션·GPS 발자취를 **즉시** 지운다.

A) **삭제 요청 즉시 파기** — `auth.AccountDeletionRequested`를 구독해 그 계정의 `assistant_session`(메시지·제안 CASCADE)과 `assistant_usage_daily`를 지운다. 철회해도 복원하지 않는다(GPS 즉시 파기 INV-D2와 같은 규율). FK CASCADE는 파기 배치가 생기면 그대로 이중 안전망 **(추천: 개인 발화는 GPS와 같은 급의 민감 기록이고, 미구현 배치에 기대지 않는다)**

B) 30일 유예 뒤 파기 배치의 CASCADE에 맡긴다(배치가 생길 때까지 무기한)

C) 유예 동안 조회만 막고 30일 뒤 파기

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q8. 발화 원문의 로그·외부 전송 범위 (PRIVACY)

발화 원문은 `assistant_message`(보존 정책 적용)와 LLM 벤더 호출(3차·편집 번역)에만 있어야 한다. 로그·트레이스에 새면 보존 정책 밖에 남는다.

A) **원문은 DB 한 곳 + LLM 호출 본문에만.** backend·ai 애플리케이션 로그·예외 메시지·Sentry 이벤트에 원문·컨텍스트 스냅샷을 싣지 않는다(길이·intent·route·trace_id만). 운영 LangSmith 미탑재 유지. 발화 내 개인정보 마스킹은 1차 미도입(여행 요청에 연락처를 쓸 이유가 드물고, 마스킹이 인자 추출을 깬다) — 처리방침의 LLM 처리위탁·국외이전 항목에 "도우미 발화"를 추가하는 것은 법무 핸드오프 **(추천: 보존 정책이 실제로 지켜지는 유일한 모양이다)**

B) A + 전화번호·이메일 패턴 마스킹 후 LLM 전송

C) 디버깅을 위해 원문 로그 허용(로그 보존 7·30일에 맡김)

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q9. ai·임베딩 장애 시 가용성 (REL)

A) **ai 미도달·5xx·시한 초과 = 그 턴만 FALLBACK**(`b05 error`, BR-U8-40·41). backend **재시도 없음 · 서킷 미도입**(U1·U4·U6 승계). quick reply ACTION 턴과 진행 검토(`REVIEW`)는 ai 없이 돈다 — "도우미 기능 일부"가 아니라 **버튼 모드**로 계속 쓸 수 있다. 임베딩 장애 시 라우터가 3차로 직행할지 FALLBACK할지는 ai 소관이고, backend는 결과의 `llm_calls`로 비용만 센다(Q1·Q2 상한이 막는다) **(추천: 새 인프라 0, 15s 예산 안에 재시도 몫이 없다)**

B) 해석 실패 시 1회 재시도(예산 잔여가 있을 때)

C) 서킷 브레이커 도입(resilience4j 신규)

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q10. 관측 지표 — 어디에 남기나 (OBS)

EKS에서 Micrometer OTLP·OTel이 꺼져 있고 알람이 0건이다. U6처럼 "카운터만 얹는다"면 지금은 아무도 못 본다.

A) **지표를 DB 행에서 파생한다.** `assistant_message`(도우미 행)에 `outcome`·`match_route`·`llm_calls`·`latency_ms` 4칸, 제안은 기존 `status`. 집계 = SQL 정의 6종(턴 수·OUT_OF_SCOPE율·FALLBACK율(원인별)·적용률·STALE/EXPIRED율·지연 p95). Micrometer 카운터는 같은 이름으로 함께 얹되 수집기가 켜질 때까지는 보조 **(추천: 수집기 유무와 무관하게 오늘 볼 수 있고, 보존 정책과 함께 지워진다)**

B) Micrometer 카운터만(수집기 켜질 때까지 무관측)

C) 관측 없음

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q11. NFR Design 스테이지

A) **SKIP** — 패턴(advisory 락 리미터·트랜잭션 분리·잔여 예산 관통·버튼 모드 강등·삭제 이벤트 구독)이 이미 이 요구 안에 집행점까지 들어갔고, 신규 논리 컴포넌트는 테이블 1개(`assistant_usage_daily`)와 컬럼 4개뿐이다. 새 인프라·새 외부 의존이 0이다(U3·U5·U6 SKIP 선례) **(추천: 같은 내용을 두 번 쓰게 된다)**

B) 진행 — `nfr-design-patterns.md`·`logical-components.md` 작성

X) 기타

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

---

## NFR Design 진행 여부 — 권고: **SKIP**

- **이유**: ① 신규 인프라·외부 의존 0(gateway·ingress·ai HTTP 클라이언트·moderation·`RateLimited` 매핑 전부 재사용) ② 패턴 5종이 `nfr-requirements.md`에 **집행점까지** 박혔다 ③ 신규 논리 컴포넌트는 `assistant_usage_daily` 1테이블 + `assistant_message` 4컬럼 — FD `domain-entities.md` 개정 블록 수준이다 ④ U3·U5·U6 동형 선례.
- **재개 조건**: 스트리밍(SSE) 도입 결정 · Redis 도입 결정 · 다중 의도(ai FD ④) 착수로 턴 내 병렬 위임이 생길 때 · 관측 수집기(OTel) 개통으로 지표 설계를 다시 할 때.
- **Infrastructure Design**: 증분 없음 — `shared-infrastructure.md` 변경 0(gateway 타임아웃·노출 경로 그대로, 새 시크릿 0). 운영 핸드오프 3건(벤더 지출 한도·처리방침 2항목)은 `tech-stack-decisions.md` §6.

## 다음 단계

산출물 2종 생성 완료 → 승인 게이트 → `audit.md`·`aidlc-state.md` 기록(오케스트레이터).
