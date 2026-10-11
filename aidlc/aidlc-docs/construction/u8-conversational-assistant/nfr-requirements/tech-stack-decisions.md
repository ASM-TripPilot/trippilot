# U8 Conversational Assistant — Tech Stack Decisions

> 실장 우선. "실재" 표기는 전부 2026-10-12 실측이다(계획서 Step 1 표).
> **결론**: 새 라이브러리·새 인프라 **0**. 델타는 backend 모듈 1 · ai 경계 1 · 테이블 1 + 컬럼 4 · 설정 키 몇 개다.

---

## 1. 상속 (변경 없음)

| 항목 | 현행 | 근거 |
|---|---|---|
| 백엔드 | Spring Boot + Kotlin 모듈러 모놀리스, Flyway SQL-first | U0 |
| backend→ai 호출 | `RestClient` + 경로별 read 상한(대기 상한 + 마진), `X-Service-Token` | `ScheduleAgentConfiguration.kt` · `shared-infrastructure.md` |
| 429 매핑 | `RateLimited(retryAfterSeconds)` → `GlobalExceptionHandler` 429 + `Retry-After` | `common/core/.../DomainException.kt:79` |
| 금칙어 | `TextModerationFacade.inspect`(fail-closed) | moderation 모듈 |
| 스케줄링 | `@Scheduled` + ShedLock(`OutboxRelay` 선례) | U6 REL-U6-04 |
| 이벤트 구독 | 아웃박스 + 인프로세스 구독자(at-least-once, 멱등) | U6 |
| LLM | 전 기능 `claude-fable-5-1`, 기능별 effort·출력 상한 = `llm_gateway/config.py` | U3 COST-U3-04 개정 |
| 비용 집계(달러) | ai `api/cost.py` `trace_id`별 `llm_cost` 로그 | ai |
| 캐시 | Redis **미도입 유지** | U1·U4·U6 |
| 복원력 | 서킷 **미도입** — `resilience4j`가 리포에 없다 | U1·U4·U6 |
| 게이트웨이 | nginx `/api`만 노출 · `proxy_read_timeout 620s` · `limit_req` IP당 10r/s | `gateway-config.yaml` |
| 프런트 | Expo · Expo Router · TanStack Query · NativeWind · orval · `@gorhom/bottom-sheet` | `frontend/README.md` |

---

## 2. U8 델타

### 델타 1 — backend `assistant` 모듈 신설

- `backend/settings.gradle.kts`에 모듈 1개 추가, 층 `api / application / domain / infra`. 다른 모듈은 `api`(퍼사드·DTO)만 본다 — Konsist/ArchUnit 게이트 그대로.
- 의존: `trip`·`itinerary-generation`(신설 `ItineraryEditFacade` — G-U8-1)·`moderation`·`weather-context`·`place-data`의 **api만**. 순환 동기 의존 없음(assistant는 누구에게도 의존받지 않는 말단).
- ai 어댑터: `DialogueInterpretPort` + `HttpDialogueInterpretAdapter`("외부 API 1개 = 포트 1개" 규약). `/ai/v1/itinerary/edit`는 기존 `ScheduleAgentPort`에 메서드 추가(G-U8-2). **두 경로 모두 `CALLED_PATHS`에 넣어 `AiBoundaryOpenApiTest` 계약 게이트에 건다.**
- 스위치: `ASSISTANT_INTERPRET_MODE=off|fake|http`(REL-U8-06). 로컬 기본 `fake`(기존 `AI_SCHEDULE_MODE` 관례).

### 델타 2 — ai 경계 `POST /ai/v1/dialogue/interpret` (ai 패키지 구현)

- 계약 초안은 FD business-logic-model §3. 와이어 정본은 구현 후 `ai/docs/openapi.json`(CI가 실행 앱과 대조). **아직 openapi에 없다**(2026-10-12).
- NFR이 이 경계에 거는 것: ① 요청 `request_meta.deadline_ms`를 존중(PERF-U8-01) ② 응답 `llm_calls`를 **반드시** 싣는다(COST-U8-02·04의 원천 — 빠지면 비용 상한이 0으로 센다) ③ 로그에 발화 원문 금지(SEC-U8-06).
- ai 측 기존 자산 재사용: `IntentRouter`·`IntentGate`·`ARGUMENT_TABLE`·`TimeoutBackstopMiddleware`·`RateLimitMiddleware`(백스톱). 새 라이브러리 0.

### 델타 3 — 스키마 증분 (FD domain-entities 개정 대상)

| 대상 | 내용 | 근거 |
|---|---|---|
| **`assistant_usage_daily`** 신설 | `(account_id FK CASCADE, day date, turns int, llm_turns int)`, PK `(account_id, day)`, 40일 청소 | COST-U8-01·04 · DATA-U8-04 |
| `assistant_message` 컬럼 4 | `outcome` · `match_route` · `llm_calls` · `latency_ms` | OBS-U8-01 |

마이그레이션 번호는 FD 규칙대로 착수 시점 최신 + 1(번호 고정 안 함).

### 델타 4 — 설정 키 (전부 설정값, 하드코딩 금지)

| 키 | 초기값 | 근거 |
|---|---|---|
| `assistant.turn-budget-ms` | 13000 | PERF-U8-01 |
| `assistant.interpret-stage-max-ms` | 5000 | PERF-U8-02(측정 후 고정) |
| `assistant.read-margin-ms` | 1000 | PERF-U8-01 |
| `assistant.rate-limit-per-minute` | 20 | ai services §5.4 · BR-U8-24 |
| `assistant.daily-llm-turn-limit` | 30 | COST-U8-02(근거 없는 초기값) |
| `assistant.monthly-llm-call-limit` | **미정** — PERF-U8-03 단가 실측 후 | COST-U8-04 |
| `assistant.retention-days` | 90 | DATA-U8-01(잠정) |
| `assistant.snapshot-max-days` · `-max-slots-per-day` | 14 · 20 | SEC-U8-08 |

> ⚠️ `monthly-llm-call-limit`이 비어 있는 동안 COST-U8-04는 꺼져 있다 — **실측 전 운영 개통 시 벤더 지출 한도(COST-U8-05)가 유일한 그물**이다. 개통 체크리스트 항목으로 둔다(§6).

---

## 3. 프런트 — 신규 의존성 **0** · 네이티브 재빌드 **0**

| 필요 | 기존 자산 |
|---|---|
| `clientTurnId` UUID | `expo-crypto` ~15.0.9(`shared/storage/installId.ts`가 `randomUUID` 사용) |
| 시트·투명 모달 라우트 | Expo Router 루트 스택 + `@gorhom/bottom-sheet` ^5.2.14 |
| 대기 취소 | 표준 `AbortController` |
| 오류 보고 | `@sentry/react-native` ~7.2.0 — **발화 원문을 breadcrumb·extra에 싣지 않는다**(SEC-U8-06) |
| API 클라 | orval 재생성(`openapi.yaml`에 assistant 태그 추가 후) |

U4 `expo-task-manager`(신규 설치 + 재빌드)와 달리 개발 빌드 교체가 필요 없다.

---

## 4. 미도입 결정 (지금 넣지 않는 것)

| 대상 | 왜 안 넣나 | 재평가 조건 |
|---|---|---|
| **스트리밍(SSE/WS)** | DEC-U8-7 동기 REST 1회. 1차 응답은 템플릿 문구라 토큰 스트리밍으로 얻을 체감이 없다 | 첫 응답 3s(PERF-U8-05) 반복 미달 + 자유 생성 문구 도입 |
| **Redis(리미터·사용량)** | advisory 락 + 행 계수로 파드 수와 무관하게 정확하다(SEC-U8-01) | 리미터 쿼리가 DB 부하로 실측될 때 |
| **서킷 브레이커** | 15s 예산에 재시도·반개방 몫이 없고, 실패 = 그 턴만 FALLBACK | 외부 포트 전반 도입 결정 시 |
| **도우미 전용 스레드 풀·가상 스레드** | 트랜잭션 분리(PERF-U8-06) + 13s 상한으로 경합이 묶인다 | 다른 API p95 상승 실측(REL-U8-03) |
| **발화 PII 마스킹** | 인자 추출을 깰 위험 > 이득(SEC-U8-07) | 법무 의견 |
| **LLM 응답 캐시** | 발화가 문맥(일정 상태)에 묶여 적중률이 낮고, 1·2차 해석이 이미 LLM 0회 경로다 | 동일 발화 반복률 관측 |
| **게이트웨이 도우미 전용 location·타임아웃** | 620s ≫ 13s | 스트리밍 도입 시 |
| **사용자별 LLM 비용 달러 계산(backend)** | 단가는 ai 소비 측 정본(`api/cost.py`). backend는 호출 수만 센다 | 단가가 기능·모델별로 크게 갈려 호출 수 상한이 부정확해질 때 |

---

## 5. 백엔드 신규 자산 요약

| 종류 | 내용 |
|---|---|
| 모듈 | `assistant` **1개 신설** |
| 마이그레이션 | FD 3종(`assistant_session`·`assistant_proposal`·`assistant_message`) + **NFR 1종**(`assistant_usage_daily`) + `assistant_message` 컬럼 4 |
| 퍼사드 | `itinerary-generation/api` `ItineraryEditFacade`(G-U8-1) · `ItineraryPlanFacade` 필드 3(G-U8-3) |
| 이벤트 구독 | `auth.AccountDeletionRequested` → 대화·사용량 즉시 파기(DATA-U8-02) |
| 스케줄 잡 | 대화 보존 청소 · 사용량 40일 청소(ShedLock) |
| openapi | `assistant` 태그 신설(세션·턴·제안 적용·이력 삭제) · `/me/export` 응답에 도우미 절 추가(DATA-U8-06) |
| ai 계약 게이트 | `CALLED_PATHS`에 `/ai/v1/dialogue/interpret`·`/ai/v1/itinerary/edit` 추가 |

---

## 6. 개발 중 처리 (설계 문서 밖 · 핸드오프)

- **벤더 지출 한도 설정**(COST-U8-05) — 운영자 콘솔 작업. 생성·Plan-B와 공유되는 한도라 COST-U8-04가 먼저 닿도록 여유를 둔다. **도우미 운영 개통 전 필수.**
- **처리방침 개정 2항목**(법무) — ① "도우미 대화 기록 — 마지막 이용 후 90일"(DATA-U8-01) ② LLM 처리위탁·국외이전에 "도우미 발화"(SEC-U8-07).
- **PERF-U8-03 측정**(ai 팀) — 결과로 `interpret-stage-max-ms`·`monthly-llm-call-limit`을 채우고 O-U8-2·3을 닫는다. 측정 전까지 운영 개통은 `ASSISTANT_INTERPRET_MODE=off`(버튼 모드)로도 가능하다.
- **FD 개정 블록**(다음 FD 개정 때) — domain-entities §3에 `assistant_usage_daily`·`assistant_message` 4컬럼, §3.1 "계정 삭제 = CASCADE" 옆에 DATA-U8-02(즉시 파기) 주석. 이 NFR 작업에서는 FD를 고치지 않았다.
- **Infrastructure Design 증분 없음** — `shared-infrastructure.md` 변경 0(새 시크릿·새 워크로드·새 노출 경로 0).
