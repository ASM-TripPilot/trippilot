# situation-awareness — 여행 중 상황 자가 인지(U4 확장) · Tech Stack Decisions

> **방침**: 상속 우선. U0·U4·U6·U10 이 확정한 스택을 그대로 쓰고 **이 확장이 실제로 요구하는 델타만** 적는다.
> **작성 근거 (2026-10-19)**: `origin/develop` `f52f58cf7` 에서 `backend/gradle/libs.versions.toml` · `backend/app/src/main/kotlin/com/trippilot/app/{config,event,observability}/` · `backend/app/src/main/resources/application.yml` · `backend/modules/{weather-context,planb-detection,itinerary-generation,notification}/` · `deploy/eks/{runtime_secrets.py,runtime.py,chart/}` · `infra/scripts/workflow_config.py` · `ai/{pyproject.toml,main.py}` 를 직접 확인했다. 수치·요구의 근거는 `nfr-requirements.md`(PERF-SA·COST-SA·RES-SA·OBS-SA·SEC-SA·LEGAL-SA)다.
> **결정 근거**: `construction/plans/situation-awareness-nfr-requirements-plan.md` 의 계획 Q1~Q10 **전부 추천안 A** — 사용자 지시 "하던거 마저해"로 설계 초안 기본값 채택, 정본 승인 때 확인. 델타별: 델타 1 = 계획 Q1 · 델타 2 = Q2 · 델타 3 = Q4 · 델타 4 = Q3 · 델타 5 = Q5 · 델타 6 = Q7 · 델타 7 = Q8 · NFR Design SKIP = Q10.
> **결론 먼저**: **신규 라이브러리 0**(백엔드·AI·FE). 늘어나는 것은 스케줄 1(cron 2식 · 락 1) · 스케줄러 풀 설정 1 · 캐시 테이블 1 · 선계산 전용 실행기 1 · 공공데이터 어댑터 3종 + 게이트웨이 오류 판독기 1 · 런타임 키 5(백엔드 4 · AI 1) + 차트 고정 env 1 · 마이그레이션 3.

---

## 1. 상속 (변경 없음)

| 계층 | 스택 | 확인 |
|---|---|---|
| backend | Spring Boot + Kotlin 모듈러 모놀리스 · PostgreSQL · Flyway SQL-first(forward-only) · 모듈 층 `api/application/domain/adapter` | U4 tech-stack 델타 6 개정 블록 |
| 스케줄·락 | `@EnableScheduling`(`backend/app/src/main/kotlin/com/trippilot/app/config/AsyncConfig.kt:30`) · ShedLock 6.10.0(`backend/gradle/libs.versions.toml:5,37-38`) · `@EnableSchedulerLock(defaultLockAtMostFor = "PT5M")` + DB 시각(`ShedLockConfig.kt:20,27`). ShedLock 사용처는 `outbox-relay` 하나(`OutboxRelay.kt:95`), 기존 `@Scheduled` 잡 10개는 전부 `fixedDelay` 다 | 실장 |
| 이벤트 | 아웃박스 + 릴레이 — 2초 · 배치 100 · 최대 10회 · 같은 이벤트의 구독자는 서로 독립(#1348) | `backend/app/src/main/kotlin/com/trippilot/app/event/OutboxRelay.kt:83,122-129,232,235` |
| 비동기 | `@Async` 실행기 core 8 · max 16 · 큐 32 · 포화 시 호출 스레드에서 실행 | `AsyncConfig.kt:51-57,73-75` |
| DB 풀 | Hikari 기본(최대 10) — `application.yml` 에 풀 설정이 없다 | 실장 |
| 기상청 | `KmaWeatherAdapter`(RestClient · connect 3s · read 5s · 디코딩 키) · `weather_snapshot`(V2.19, 키 = (격자, 발표시각)) · `WEATHER_MODE` `fake`·`kma` · 키 `WEATHER_API` | `backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/adapter/out/external/KmaWeatherConfiguration.kt:25-34` · `application.yml:159-161` |
| AI 경계 | AI 검증 = 편집용 짧은 클라이언트(60s + 2s) · AI 재계획 시한 25s(읽기 전용 트랜잭션 안) · `trippilot.ai.schedule.mode` 는 차트 고정 `http` | `ScheduleAgentConfiguration.kt:46-50` · `ReplanFacadeService.kt:71,302` · `deploy/eks/chart/templates/backend.yaml:67-68` |
| 알림 | Expo push(`PUSH_MODE` `off`·`expo`) · 적재 먼저 · 푸시 다음 · `source_event_id` UNIQUE · 계정 소프트 상한(COST-U6-01) | `NotificationRaiseService.kt:69` · U6 tech-stack |
| 관측 | Micrometer 는 있으나 EKS 에서 OTLP·OTel 이 꺼져 있다 · 기동 줄 `[모드]` | `deploy/eks/chart/templates/backend.yaml:91-99` · `RuntimeModeSummary.kt:70-79` |
| 배포 | `aws-deploy` 수동 디스패치 · 시크릿 허용목록 검증 · 개발 대상(`trippilot-dev`)은 푸시 강제 off | `deploy/eks/runtime_secrets.py:203-207` · `infra/scripts/workflow_config.py:66-69` |
| AI | FastAPI · `httpx` · 기동 배선 줄 `ai-wiring:` | `ai/pyproject.toml` · `ai/main.py:328` |
| FE | `expo-notifications ~0.32.17`(수신·탭 API 포함) · OTA(`expo-updates`) 없음 | `frontend/package.json` |
| PBT | Kotest property(BE) · hypothesis(AI) · fast-check(FE) | — |

## 2. 이 확장의 델타

### 델타 1 — 감시 스윕 스케줄 + 락 ★

```text
planb-detection  application/SituationSweep.kt
  매시 회차   cron "0 15 7-20 * * *"   zone Asia/Seoul    (application.yml, 테스트 설정은 "-")
  보충 회차   cron "0 40 20 * * *"     zone Asia/Seoul    (application.yml, 테스트 설정은 "-")
  락          @SchedulerLock(name = "planb-situation-scan", lockAtMostFor = "PT25M", lockAtLeastFor = "PT5M")
  sweep(now)  테스트가 직접 부른다
planb-detection  build.gradle.kts
  + implementation(libs.shedlock.spring)     # 카탈로그 기존 항목. U10 DELAY 와 같은 줄이라 먼저 들어간 쪽을 따른다
```

- **cron 인 이유**: KST 정렬과 밤 제외(INV-SA-5)는 cron 만 표현한다 — `fixedDelay` 는 기동 시각에 끌려간다. 백엔드의 **첫 cron 잡**이라 `zone` 을 반드시 단다. 비싼 감지기는 `wants(phase, dayOffset)` 로 덜 부른다(장소 = 아침 오늘 · 저녁 내일).
- **`lockAtLeastFor = PT5M`**: cron 은 복제본 둘이 같은 순간 깬다. 먼저 잡은 쪽이 몇 ms 만에 끝나 락을 풀면 시계가 조금 늦은 쪽이 같은 회차를 또 돈다. 릴레이의 `PT0S` 는 `fixedDelay` 라서 맞는 값이다(`OutboxRelay.kt:89` — "cron 방식의 시계 오차 이중 실행을 막는 장치").
- **`lockAtMostFor = PT25M`**: 예산 20분(PERF-SA-01)보다 길고, 죽은 파드가 쥔 20:15 락이 20:40 보충을 넘겨 막지 않는 값. ⚠ **경계**: 상한이 두 회차 간격(25분)과 같아서, 20:15 를 쥔 파드가 **비정상 종료**하면 락은 20:40:00 무렵 풀리고 보충 회차는 같은 순간 깬다 — 획득이 밀리초 경합이 된다(정상 종료는 락을 풀어 무관 — RES-SA-06). 보충을 확실히 하려면 상한을 간격보다 짧게(예: PT24M — 예산 20분 + 진행 중 여행 마무리) 둔다 — 정본 승인 때 PT25M 유지 여부를 함께 확인한다.
- **락 이름은 U10 `DELAY` 의 `planb-delay-scan` 과 다르다**(리플렉션 테스트로 고정). 같은 모듈이라 파일·설정 키도 나눈다.
- 새 락 이름은 `shedlock` 테이블(V1.0)에 행을 스스로 만든다 — 마이그레이션이 없다.
- 개발·운영 대상은 DB 가 따로라 `shedlock` 도 따로다 — 두 대상의 스윕은 각자 돈다.

> **[개정 · 2026-10-22 — 구현 반영]** 델타 1 — **`lockAtMostFor = PT24M`** 이다(`backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/application/SituationSweep.kt:103,110` · 줄 번호는 `origin/develop` `49bda757f`). 위 텍스트 블록의 `PT25M` 과 '경계' 문단은 이것으로 읽는다 — '정본 승인 때 PT25M 유지 여부를 함께 확인한다'의 답이다(운영 준비 감사 2026-10-20). 상한이 간격(25분)과 같으면 락 만료(DB 시각)와 20:40 보충의 획득 시도가 같은 순간이라 밀리초 경합이고, 지면 ShedLock 은 DEBUG 만 남겨 그 날 내일 점검이 조용히 빠진다. 24분은 예산 20분 + 진행 중 여행 마무리(감지 시한 ≤ 62초)보다 길고 간격보다 짧다(`:96-101`). 시험이 이 값을 고정한다(`SituationSweepScheduleTest`).
> - `dry-run` 도 회차마다 이 락 행을 갱신한다 — 델타 6 표의 '`dry-run` = 판정·요약 로그만, 쓰기 0'은 트리거·감시 상태·아웃박스·푸시 쓰기 0 이고, 락 행과 격자 캐시(델타 3) upsert 는 허용된 쓰기다(`functional-design/business-logic-model.md` §7 개정 블록).

### 델타 2 — 스케줄러 풀 1 → 4

```text
backend/app/src/main/resources/application.yml
  spring.task.scheduling.pool.size: 4        # Boot 기본 1
```

- 기존 `@Scheduled` 잡 10개가 1스레드(`scheduling-1` — `backend/app/src/test/resources/config/application.yml:25`)를 나눠 쓴다. 최대 20분 회차가 그 하나를 쥐면 아웃박스 릴레이(2초)가 그동안 멈춘다(PERF-SA-05).
- 잡은 자기 자신과 겹치지 않는다(다음 실행은 끝난 뒤 잡힌다). 풀이 늘어 다른 잡끼리 병렬이 될 뿐이다 — 릴레이는 ShedLock, 그 밖의 스위퍼는 조건부 UPDATE 로 멱등이다(shared-infra §3).
- **플래그와 무관하게 머지 즉시 운영에 반영된다** — 리마인드 문구 세션에 폴러·재시도 폴러 타이밍 변화를 로그로 봐 달라고 알린다.

### 델타 3 — 격자 예보 캐시 `weather_grid_forecast` (C11)

```text
V2.NN__weather_grid_forecast.sql        (번호는 머지 직전 origin/develop 최댓값 + 1)
  grid_key    varchar PK      "nx,ny"
  base_at     timestamptz     발표 시각
  hourly      jsonb           오늘·내일(+ 자정 넘김 몫 모레) 시각별 POP·PTY·SKY·TMP·WSD
  daily       jsonb           날짜별 TMN·TMX
  fetched_at  timestamptz
  expires_at  timestamptz     발표 + 3시간 + 10분 · CHECK (expires_at > base_at)
weather-context
  api/HourlyForecastFacade { isLive(); gridKeyOf(lat, lng); forecastForTrigger(lat, lng, at): PointForecast? }   null = 모름 · 고장은 HourlyForecastUnavailable
  application/HourlyForecastService      읽기-통과 캐시 · HTTP 는 트랜잭션 밖
  KmaWeatherAdapter                      GridForecastPort 도 구현 · 격자 경로 파드당 하루 3,000
```

- **만료 = 발표 + 3시간 + 10분** — 다음 발표분이 제공되는 시점(발표 후 약 10분 — `KmaWeatherAdapter.kt:131-135`)까지다. P-PERF-U4-1(TTL = 다음 발표)을 제공 지연까지 넣어 승계한다.
- **정상 결과(코드 00)만 저장**하고 받은 값도 신선해야 쓴다(INV-U4-09 승계). jsonb 수는 읽을 때 수로 정규화한다.
- **`weather_snapshot`(V2.19)은 그대로 둔다** — 그 행은 하루 최대 POP 하나만 담아(`KmaWeatherAdapter.kt:108-128`) 시간별·변형별 판정을 못 한다. 날씨 확인(이름 경로)은 계속 그 캐시를 쓴다.
- **캐시 미들웨어를 들이지 않는다** — 복제본 사이에서 공유되고 재시작에 살아남아야 해서 DB 테이블이다. Redis 는 제거 결정(shared-infra §12 Q5=A).
- 특보 = 파드 메모리 20분(회차당 1콜), 대기질 = 발표 단위 메모리 캐시 — 원문을 DB 에 남기지 않는다.

> **[개정 · 2026-10-22 — 구현 반영]** 델타 3 — 위 텍스트 블록의 `daily jsonb 날짜별 TMN·TMX` 는 더 쓰지 않는다(사용자 결정 25번 (다)의 정리 · 줄 번호 기준 커밋 `b9c1cb52e`(#1540) — `functional-design/domain-entities.md` §8.1 개정 블록). 어댑터는 같은 응답에서 시간별 칸만 읽고, `PointForecast` 에 하루 값이 없으며, 엔티티는 `daily` 칸을 매핑하지 않는다. 칸은 확장형 마이그레이션(`V2.NN__weather_grid_forecast_daily_default.sql` — 기본값 `'{}'`)으로 남기고, 삭제는 옛 파드가 남지 않은 다음 배포의 후속이다 — 델타 7 의 '마이그레이션 3'에 확장형 하나가 더해지고 삭제 하나가 뒤따른다.

### 델타 4 — 선계산 전용 실행기 (C10)

```text
itinerary-recalculation  application/PreparedReplanService.kt
  전용 실행기 1스레드
  실행 자리 = 실행 1 + 대기 10       못 얻으면 세션 없이 BUSY(상한·트리거당 1회를 쓰지 않는다)
  ReplanSolver.solveNow              SOLVING 이 아니면 AI 를 부르지 않는다(대체된 세션 비용 0)
  @PreDestroy 대기                   진행 중 1건(시한 25s)은 graceful 630s 안
```

- **공용 `@Async` 를 쓰지 않는 이유** — 포화하면 호출 스레드(= 아웃박스 릴레이)에서 돈다(`AsyncConfig.kt:51-57`). 릴레이가 25s 씩 막히고, 배치(100건)를 붙잡아 릴레이 락 상한(PT5M — `OutboxRelay.kt:95`)을 넘기면 다른 파드가 같은 행을 다시 집는다.
- **1스레드인 이유** — 재계획 산출이 읽기 전용 트랜잭션 안에서 AI 를 최대 25s 부른다(`ReplanFacadeService.kt:71`) — 스레드 수만큼 DB 연결을 쥔다(Hikari 기본 10, 사용자 재계획과 같은 풀). 늘리려면 'AI 호출을 트랜잭션 밖으로' 후속이 먼저다. DB 풀 상향은 보류(연결 여유 미확인).
- 상한(여행 3 · 전체 100/일)은 실행기가 아니라 세션 수로 센다(COST-SA-07 · BR-SA-18).

> **[개정 · 2026-10-20 — 구현 반영]** 델타 4 — 실행기 대기열 용량은 **자리 수(실행 1 + 대기 10 = 11)** 다(`backend/modules/itinerary-recalculation/src/main/kotlin/com/trippilot/recalculation/application/PreparedReplanService.kt:177-189`). 대기열을 10 으로 두면 앞 작업이 자리를 돌려준 직후(일꾼이 아직 다음 것을 꺼내기 전) 자리를 얻은 사건이 실행기에 거절돼 FAILED 세션이 생긴다 — 상한은 자리(세마포어 — `:72`)가 진다. 종료가 시작된 뒤 도착한 사건은 자리를 잡기 전에 예외로 던진다 — 다음 파드가 재배달을 받는다(`:88-90`). 규칙은 `functional-design/business-rules.md` BR-SA-18 개정 블록. **`@PreDestroy` 대기는 65s** 다 — 위 줄의 '진행 중 1건(시한 25s)'이 아니라 진행 중 산출의 소켓 read 상한(배포 60s + 여유 2s)을 덮는다. 시한 25s 로 잡으면 예산을 넘긴 산출이 잘려(소켓 read 는 인터럽트로 깨지 않는다) 컨텍스트가 닫힌 뒤 기록을 못 하고 `SOLVING` 에 남는다(`PreparedReplanService.kt:168-172`). graceful 630s(`deploy/eks/chart/templates/backend.yaml:88-89`)·파드 종료 유예 660s(`deploy/eks/chart/templates/_helpers.tpl:18`) 안이다.

### 델타 5 — 공공데이터 출처 3종 + 게이트웨이 오류 판독기

| API | 데이터셋(공공데이터포털) | 소유 · 어댑터 | 키 | 출발 상태 |
|---|---|---|---|---|
| 기상청 기상특보 `getPwnStatus`(`WthrWrnInfoService`) | 15000415 · 자동승인 · 개발 10,000/일 · 공공누리 1유형 | weather-context `KmaWarningAdapter` → `WeatherAlertFacade` | `WEATHER_API`(서비스 키 프로퍼티 기본값 `${WEATHER_API}`) | 관찰 전용 목록(`observe-only`) |
| 에어코리아 대기질 예보통보 `getMinuDustFrcstDspth`(`B552584/ArpltnInforInqireSvc`) | 15073861 · 개발 자동승인 · 운영 심의 · 개발 500/일 · 공공누리 3유형 | weather-context `AirKoreaAdapter` → `WeatherAlertFacade` | 〃 | 관찰 전용 목록 |
| 한국천문연구원 특일정보 `getRestDeInfo`(`SpcdeInfoService`) | 15012690 · 자동승인 · 개발 10,000/일 · 이용허락 제한 없음 | ai `ports/holiday_calendar_port.py` + 어댑터 | ai 그룹 `WEATHER_API` | `HOLIDAY_CLOSURE_MODE=off` |

- **활용신청**은 사용자가 했다 — 10-18 Q3(사용자 선택지 질문) 답 "신청할게. 너가 사이트도 띄어주라 지", 이후 "다 신청했어" / "승인도 받았어". 2026-10-19 10:12 실측: `WEATHER_API` 로 세 API 를 부르면 `SERVICE_KEY_IS_NOT_REGISTERED`(returnReasonCode 30), 같은 키의 단기예보 `getVilageFcst` 는 정상.
- **키 공유**: 포털 키 하나(`WEATHER_API` — 백엔드·AI 그룹)를 쓴다. 신청 계정이 키 계정과 다르면 키 env 1개를 더한다(배선 1세트 — O-SA-1).
- **관찰 전용 출발**: 특보·대기질은 `observe-only` 목록에 든 채 출발한다. 키 등록과 실응답 표본을 확인한 뒤 목록에서 빼는 커밋이 '켜기'다. 특일은 하위 코드·공휴일 변경 머지와 키 확인 뒤 `HOLIDAY_CLOSURE_MODE=on`.
- **오류 판독기 하나** — `PublicDataGatewayError.kt`(weather-context): HTTP 401·403 + JSON·XML 어느 본문이든 `cmmMsgHeader.returnReasonCode` 20·22·30·31·32(RES-SA-02). 세 백엔드 어댑터(단기예보 격자 · 특보 · 대기질)가 함께 쓰고, AI 특일 어댑터는 같은 코드를 '실패·미등록 = 없음 + WARN'으로 읽는다.
- **시한**: 백엔드 어댑터는 기존 기상청 값(connect 3s · read 5s)을 쓴다. 특일 조회도 명시 시한과 짧은 실패 기억을 둔다(RES-SA-10).
- **호스트**: 세 API 모두 `apis.data.go.kr` — 기존 단기예보와 같은 호스트라 이그레스 대상이 늘지 않는다.
- **형식 고정**: 특보현황(t6) 형식 · 에어코리아 권역 · 특일 응답은 실응답 표본 픽스처로 고정한다(추정 → 실측). CI 외부 호출은 0이고 대역은 실물처럼 예외로 실패한다.

> **[개정 · 2026-10-20 — 구현 반영]** 델타 5 — 키(O-SA-1 종결 · #1379). 세 API 의 키는 `PUBLIC_DATA_API_KEY`(활용신청 계정 — `WEATHER_API` 계정과 다르다)이고, 비면 `WEATHER_API` 로 대신한다 — 백엔드 특보·대기질 `trippilot.weather.public-data-key`(`backend/app/src/main/resources/application.yml:176` · `backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/adapter/out/external/WeatherAlertConfiguration.kt:28`), AI 특일 달력(`ai/main.py:481-483`). 위 표의 '키' 칸과 '키 공유' 첫 문장은 그 전의 가정이고, 그 둘째 문장(다르면 키 env 1개 · 배선 1세트)이 실제 길이다. 배선 — 허용목록 backend·ai(`deploy/eks/runtime_secrets.py:17-35`) · 차트 secretEnv(`deploy/eks/chart/templates/backend.yaml:105` · `deploy/eks/chart/templates/ai.yaml:79`) · 배포가 저장소 시크릿을 두 그룹에 쓴다(`runtime_secrets.py:393-397` · `.github/workflows/aws-deploy.yml:256`). compose 는 설정하지 않은 env 를 빈 문자열로 넘겨 yml 중첩 기본값으로는 대신이 안 되므로, 빈 값 판정은 코드가 한다(`WeatherAlertConfiguration.kt:16-19`). §4 의 '키 계정 확인'도 이것으로 끝났다.

### 델타 6 — 플래그 체계 · 런타임 키 (DEC-SA-8) ★

| 키 | 위치 → 프로퍼티 | 값(기본) | 뜻 |
|---|---|---|---|
| `PLANB_SITUATION_SWEEP` | backend 시크릿 → `trippilot.planb.situation-sweep.mode` | `off`·`dry-run`·`on` (`off`) | 스윕. `dry-run` = 판정·요약 로그만, 쓰기 0 |
| `PLANB_SITUATION_HORIZON` | backend 시크릿 → `…situation-sweep.horizon`, `trippilot.replan.horizon` | `today`·`tomorrow`·`pre-trip` (`today`) | 저녁 내일 점검·D-1 점검과 C10 전날 창을 함께 연다 |
| `PLANB_SITUATION_SWEEP_ACCOUNT_IDS` | backend 시크릿 | UUID 목록 (빈값 = 전원) | 운영 카나리 — 개발은 푸시가 강제 off 라 실푸시 검증은 운영뿐 |
| `PLANB_PREPARED_REPLAN` | backend 시크릿 → `trippilot.replan.prepared.mode` | `off`·`on` (`off`) | 선계산(LLM 비용) |
| `HOLIDAY_CLOSURE_MODE` | ai 시크릿 | `off`·`on` (`off`) | 공휴일 휴무 규칙 — 생성·재계획·검증 공통 |
| `AI_OPPORTUNITY_MODE` | 차트 고정 env → `trippilot.ai.opportunity.mode` | yml `off` · 차트 `http` | 기회 카드 AI 호출(구 앱은 이 BE 경로를 부르지 않는다) |
| yml `situation-sweep.sources` | `application.yml` | `kma-forecast,kma-warning,airkorea,place` | 감지기 목록 |
| yml `situation-sweep.observe-only` | `application.yml` | `kma-warning,airkorea` | 관찰 전용 — 키 등록·실측 확인 뒤 빼는 커밋이 켜기 |
| yml `parallelism`·`budget`·cron | `application.yml` | 2 · PT20M · `0 15 7-20 * * *` + `0 40 20 * * *` | 테스트 설정은 cron `-`(배경 실행 끔) |
| yml `spring.task.scheduling.pool.size` | `application.yml` | 4 | 스케줄러 풀(기본 1) |
| (기존) `WEATHER_MODE=kma` | | | 단기예보·특보·대기질의 live 조건 — `fake` 면 세 감지기 호출 0 |
| (기존) `PUSH_MODE` | | | 실발송(개발 대상은 강제 off) |

- 장소 감지의 영업시간 판정은 기존 `trippilot.ai.schedule.mode = http`(차트 고정 — `deploy/eks/chart/templates/backend.yaml:67-68`)일 때만 돈다. 아니면 그 판정은 UNKNOWN 이고 폐업 판정만 돈다.
- **검증**: `runtime_secrets` 모드 값 집합(`deploy/eks/runtime_secrets.py:211-217` 꼴) · UUID 목록 검증 재사용(`:236-244`) · `open_gaps` 경고(스윕 on ∧ `WEATHER_MODE ≠ kma` — `:293`). `RuntimeModeSummary` SWITCHES 에 스윕·지평·선계산을 한 줄씩. 정본 키 표 ⊆ 허용목록 ∧ 차트 목록 대조 테스트(`deploy/eks/tests/test_runtime.py`).
- **두 번 배포 규칙**: 키를 아는 허용목록 코드가 그 대상(개발 = develop, 운영 = 승격 뒤 main)에 배포된 뒤에만 시크릿에 키를 쓴다 — 먼저 쓰면 `validate_groups` 가 배포 전체를 거부한다(`deploy/eks/runtime_secrets.py:204-207`). 대상마다 시크릿 그릇이 따로라(`trippilot/<env>/*` · `trippilot/<env>/dev-target/*` — `infra/terraform/stack/registry-secrets.tf:58-66`) 규칙도 대상마다 적용된다. 시크릿 쓰기는 자격 있는 세션·사용자, 디스패치는 배포 담당 세션이 한다.
- **키 배선은 한 변경에 모두** — 읽는 코드가 뒤 변경에서 들어오는 키도 함께 넣는다(차트 한 줄 range 목록의 경합을 한 번으로 줄인다). 스위치 하나당: `application.yml` · 테스트 설정(cron `-`) · `docker-compose.yml`(`${X:-off}` 꼴, 빈 값 금지 — `backend/app/src/test/kotlin/com/trippilot/app/EmptyEnvBindingTest.kt`) · `.env.example`(주석은 줄 위) · `RuntimeModeSummary` SWITCHES · 안내자 기동 로그(DB 쓰기 없음) · `deploy/eks/runtime_secrets.py`(허용목록 · 모드 값 · UUID 목록 · `open_gaps`) · `deploy/eks/chart/templates/backend.yaml:102` · `deploy/eks/chart/tests/test_chart.py` · `deploy/eks/tests/test_runtime.py` · `backend/docs/design/실사용-모드-스위치.md`. AI 키 `HOLIDAY_CLOSURE_MODE` 는 하위 코드·공휴일 변경에서 같은 꼴(`AI_KEYS` · `deploy/eks/chart/templates/ai.yaml:79` · `ai/main.py` 기동 검증 · `ai-wiring:` 표식)로 넣는다.

> **[개정 · 2026-10-20 — 구현 반영]** 델타 6 — 런타임 키를 쓰는 길(#1438): 위 표의 시크릿 스위치 5종은 배포 입력 `runtime_switches`(`KEY=VALUE;KEY=VALUE` — 쌍 구분 `;`)로도 쓴다 — 로컬 AWS 자격 없이 배포 역할이 쓴다(`deploy/eks/runtime_secrets.py:50-53,192-208` · `.github/workflows/aws-deploy.yml:47-51`). 허용 밖 키·형식 오류·같은 키 두 번은 배포 실패이고, 값 검증은 새로 두지 않고 스위치를 얹은 사본으로 기존 `validate_groups`·`open_gaps` 를 돌린다(`runtime_secrets.py:373-383`). `KEY=` 는 그 키를 지워 앱 기본값으로 되돌린다 — `stringData` 로 넣은 키는 매니페스트에서 빠져도 클러스터 Secret 에 남아(server-side apply) merge patch(null)로 함께 지운다(`:420-427`). 위 '시크릿 쓰기는 자격 있는 세션·사용자'에 이 길이 더해진다. `PLANB_SITUATION_SWEEP_ACCOUNT_IDS=` 는 목록이 비는 것이라 전원이다(`backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/application/SituationSweepProperties.kt:23,34`).

### 델타 7 — 신규 라이브러리 0 · 마이그레이션 3 · 모듈 의존

| 항목 | 내용 |
|---|---|
| 신규 라이브러리 | **없음** — `libs.shedlock.spring`(카탈로그 기존)을 planb-detection 에 건다. AI 는 기존 `httpx`, FE 는 기존 `expo-notifications` |
| 마이그레이션 | `V2.NN__plan_b_situation.sql` · `V2.NN__weather_grid_forecast.sql` · `V2.NN__replan_session_initiated_by.sql` — 번호는 머지 직전 `origin/develop` 최댓값 + 1(실측 최신 `V2.72__curated_stay.sql`). 다른 작업도 계속 마이그레이션을 내므로 머지 직전에 다시 본다. 중복은 Flyway 검증이 CI 에서 막는다. 모두 확장형(shared-infra 증분 SA.4) |
| 스케줄 · 실행기 | 델타 1 · 델타 4 |
| 모듈 의존 | planb-detection → place-data(api) · itinerary-recalculation → planb-detection(api `TriggerLookupFacade`) — 순환 없음(`functional-design/business-logic-model.md` §4.0) |
| 이벤트 | `planb.PlanBTriggered`·`recalculation.ItineraryRecalculated` 에 기본값 null 선택 필드 · 구독자 2(선계산 · 소비) — 이벤트 타입 문자열 구독이라 컴파일 의존 없음 |

## 3. 미도입 결정 (지금 넣지 않는 것)

| 후보 | 결정 | 재평가 조건 |
|---|---|---|
| 새 Micrometer 지표(스윕·감지기·선계산) | **미도입** — EKS 에서 OTLP 가 꺼져 있다. 요약 로그가 1차 수단(OBS-SA-07) | EKS 에 OTLP 수집기 개통(G-05) |
| 서킷 브레이커 라이브러리(Resilience4j 등) | **미도입** — 회차 범위 카운터로 충분하다(RES-SA-04 · P-RES-U4-1 유지) | 출처 장애가 회차를 넘어 이어지고 회차 단위 차단이 모자랄 때 |
| Redis·Caffeine 등 캐시 미들웨어 | **미도입** — 격자 예보는 DB 테이블(델타 3), 특보·대기질은 파드 메모리 | 격자 수 급증으로 DB 캐시가 병목일 때(U4 §9 와 같은 조건) |
| Live Activity · 다이내믹 아일랜드 | **미도입**(U4 §3 승계) — 표시 수단이라 감지를 대신하지 못한다 | '여행 중 상주 표시'가 별도 스토리로 설 때 |
| `expo-background-fetch` | **채택 불가**(U4 §3 승계) — 실행 주기를 OS 가 정한다. 감지는 서버 스윕이 한다 | 없음 |
| 안드로이드 알림 채널 `channelId`(TRIP-860) | **이 확장 밖** — 리마인드 푸시 채널까지 바꾸고, 채널을 만들기 전 빌드의 기기에서는 알림이 보이지 않을 수 있다 | 리마인드 문구 세션과 합의한 별도 변경 |
| 앱 주기 폴링(`refetchInterval`) | **미도입** — 판정이 매시 :15 라 5분 폴링 12번 중 11번이 같은 값이다. 포그라운드 복귀·푸시 수신 때 캐시 무효화로 충분하다 | 판정 주기가 짧아질 때 |
| 새 `NotificationKind` · 새 `TriggerKind` | **미도입** — 구 앱 알림함이 모르는 kind 에서 죽는다(`frontend/src/pages/settings/notification-inbox/ui/NotificationInboxPage.tsx:35`) · DEC-U4-4 | 구 앱 지원 종료(`minSupportedVersion` 이 새 kind 를 아는 빌드 이상) · DEC-U4-4 재개 |
| 선계산 실행기 확대 · DB 풀 상향 | **보류** — 재계획 산출이 읽기 전용 트랜잭션 안에서 AI 를 25s 부른다 · DB 연결 여유 미확인 | 'AI 호출을 트랜잭션 밖으로' 후속 머지 |
| 메시지 브로커·잡 큐(SQS·Quartz 등) | **미도입** — `@Scheduled` + ShedLock + 아웃박스로 충분하다(shared-infra §4.4 · 계획 Q1 C 기각) | 병렬 상향으로도 회차 예산을 못 지킬 때 |
| 원격 설정 서비스(SaaS) | **미도입** — 런타임 키 + 재배포 1회로 켜고 끈다(계획 Q7 C 기각 — SaaS·신규 의존). 반영 지연은 배포 1회 | 분 단위로 끄고 켜야 하는 스위치가 생길 때 |
| 스윕 전용 `TaskScheduler` 빈 | **미도입** — 전역 풀 4 하나로 둔다(계획 Q2 B 기각 — 스케줄러가 둘이면 어느 `@Scheduled` 가 어디 붙는지 읽기 어렵다) | 풀 4 에서 다른 잡의 지연이 관측될 때 |
| 일정 변경 직후 즉시 재검증 | **미도입** — 편집은 저장 때 동기 검증, 생성·재계획 결과는 조립 검증값이다. 장소 감지는 아침·저녁 회차뿐 | 편집 밖 경로의 미검증 일정이 실측될 때 |
| 마이그레이션 번호 중복 검사 CI 스텝 | **미도입** — Flyway 자체 검증이 CI 에서 막는다 | 중복이 CI 를 지나 실제로 새면 |
| 긴급재난문자 출처 | **미도입** — LEGAL-SA-04(포털 표기 공공누리 4유형 · safetydata 표기와 충돌) | 3유형 이하로 확인될 때 |

## 4. 개발 중 처리 (설계 문서 밖)

- **키 계정 확인**(O-SA-1) — 활용신청 계정이 `WEATHER_API` 키 계정과 같은가. 다르면 키 env 1개 + 배선 1세트. 등록 반영은 요약 줄에서 그 출처 Unknown 이 사라지는 것으로 본다(켜기 8단계).
- **실응답 표본 수집** — 특보현황(t6) · 에어코리아 권역 · 특일 응답(키 등록 뒤). `LIVE_KMA=1` 격자 왕복(TMN·TMX 실재 · 첫 예보 시각).
- **dry-run 실측** — 개발·운영 `dry-run` 요약 줄로 AI 검증 지연(`detectorMs{place}` p95) · 기상청 호출 수 · 휴무 오탐 표본을 잰 뒤 병렬도·예산·신선도 창을 닫는다(nfr-requirements §7 1·3단계).
- **시크릿 쓰기 · 디스패치** — 두 번 배포 규칙(델타 6). 운영 `PUSH_MODE`·`WEATHER_MODE` 실값은 `[모드]` 줄로 확인한다(배포 담당 세션).
- **iOS 푸시 개통**(FE-D) — 번들 ID Push 권한 · EAS APNs 키(외부 선행) → `frontend/app.config.ts:223-245` 의 entitlement 삭제 래핑 제거 → iOS 재빌드·심사. 그 전에는 Android 만 푸시로 출발(O-SA-8).
- **`minSupportedVersion` 상향**(O-SA-7) — `trippilot.bootstrap.min-supported-version` 설정 커밋 1건(`BootstrapProperties.kt:12`).
- **리마인드 문구 세션 알림** — 스케줄러 풀 4(델타 2) · 앱 푸시 수신·탭 처리가 리마인드에도 적용된다는 것.
- **법무 확인 묶음**(LEGAL-SA-02).

> **[개정 · 2026-10-22 — 구현 반영]** §4 — 위 '실응답 표본 수집'의 `LIVE_KMA=1` 격자 왕복에서 'TMN·TMX 실재'는 더 확인할 것이 없다 — 판정이 하루 값을 쓰지 않는다(델타 3 개정 블록). 특보구역은 공식 개편 목록 대조를 마쳤고(`functional-design/business-rules.md` BR-SA-16 개정 블록), t6 실응답 표본에 남은 몫은 광역 줄의 단위·제외 줄의 하위 권역 판정이다(G-SA-18·19 — `functional-design/business-logic-model.md` §9 개정 블록). 'dry-run 실측'의 AI 검증 지연(`detectorMs{place}` p95)은 시한 3s·백스톱 8s 경로에서 다시 잰다 — 'AI 검증 실측 20.1s'는 그 전 값이다(`nfr-requirements.md` §1 개정 블록).
