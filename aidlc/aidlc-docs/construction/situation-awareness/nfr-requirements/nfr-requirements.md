# situation-awareness — 여행 중 상황 자가 인지(U4 확장) · NFR Requirements

> **방침**: 얇게. U0·U4·U6·U10 NFR과 상속 기반선(AVAIL-01 월 99.5% · RTO 4시간 · RPO 15분 — U0 개정 블록 · 재시도 없음 · 서킷 라이브러리 미도입 P-RES-U4-1 · security-baseline Full · resiliency-baseline Full · PBT Partial — PBT-02·03·07·08·09 blocking)은 **그대로 승계**하고 다시 적지 않는다.
> **FD 중복 금지**: 회차·지평(BR-SA-01) · 대상(02) · 공정성·예산·격리·회로 차단의 동작(03) · 관찰 전용(04) · 식별·해제·만료(05~07) · 알림 결정표·억제·사건(08~10) · 범위(11) · 문구(12) · 조회·소비(13·14) · 임계(15·16) · 장소 감지(17) · 선계산·낡음·진입(18~20) · 알림 정책(21) · 기회 카드(22) · 진입 게이트(23) · 출처 표기(24)는 **`functional-design/business-rules.md`가 정본**이다. 여기 있는 것은 그 규칙이 **얼마나 빠르게·얼마나 적게·어떤 조건에서 켜지는가**뿐이다.
> **NFR Design 은 두지 않는다**(U3·U5·U6·U8 선례). 패턴(회로 차단·격벽·관찰 전용·강등)은 이 문서와 `tech-stack-decisions.md` 델타에 있고, 인프라는 `shared-infrastructure.md` 「situation-awareness 증분 (2026-10-19)」이다.
> **결정 근거 (2026-10-19)**: 계획 `construction/plans/situation-awareness-nfr-requirements-plan.md` 의 **계획 Q1~Q10 전부 추천안 A**(Q10 = NFR Design SKIP) — 사용자 지시 "하던거 마저해"로 설계 초안 기본값을 채택했고 정본 승인 때 확인한다. 미결 O-SA-2~15 도 같은 지시로 **초안 기본값 채택 — 정본 승인 때 확인**, O-SA-1 은 사용자 확인 중이다. 이 문서에서 '계획 Qn' 은 그 계획의 질문이고, '10-18 Qn' 은 사용자 선택지 질문(원문 전체는 `functional-design/business-logic-model.md` §0)이다 — 이 문서가 기대는 사용자 답은 아래 표에 원문 그대로 다시 적는다.
> **수치의 지위**: FD 임계와 같다 — 설정·기준값이고 조정은 규칙 개정이 아니다. 근거 없는 초기값은 그렇게 표시한다.
> **실측 기준**: `origin/develop` `f52f58cf7`(2026-10-19). 코드 사실은 `경로:줄`로 단다.

| 사용자 선택지 질문(원문, 2026-10-18) | 답(원문) | 이 문서 |
|---|---|---|
| 10-18 Q1 "변수를 감지한 뒤 '재계획'은 어떻게 할까요?" (선택지: 미리 짜 둔 대안 (Recommended) / 한 번 탭 재계획 / 자동 적용) | "미리 짜 둔 대안 (Recommended)" | PERF-SA-06 · COST-SA-07 · RES-SA-08 |
| 10-18 Q3 "기상특보·미세먼지·공휴일은 공공데이터포털에서 날씨 키 계정으로 '활용신청'을 해야 합니다(대부분 자동승인). 제가 대신 할 수 없는데 어떻게 할까요?" (선택지: 신청할게 (Recommended) / 나중에) | "신청할게. 너가 사이트도 띄어주라 지" — 이후 "다 신청했어" / "승인도 받았어" | COST-SA-03~06 · RES-SA-02 · §7 8·9단계 |
| 10-18 Q4 "Plan-B 알림의 푸시 기본값은 지금 OFF(사용자가 설정에서 켜야 옴)입니다. 어떻게 할까요? (운영 서버의 푸시 발송 자체가 켜져 있는지는 코드로 확인 불가)" (선택지: 위험 알림만 기본 ON (Recommended) / 지금처럼 OFF) | "위험 알림만 기본 ON (Recommended)" | LEGAL-SA-01·06 · §7 4단계 |
| (2026-10-19) | "하던거 마저해" | 계획 Q1~Q10 · O-SA-2~15 초안 기본값 채택 |

> **[개정 · 2026-10-20 — 구현 반영]** 이 문서가 기대는 사용자 답이 둘 늘었다(2026-10-19 정본 승인 뒤, 결정 수집 문서 「결정 대기 목록 (10-19)」 — 원문 표 전체는 `functional-design/business-logic-model.md` §0.4): #1 "운영에서 실사용자에게 위험 푸시 켜기"(추천 (나) "운영 dry-run·본인 계정 카나리까지만, 전원은 그때 다시 묻기") · #2 "위험·주의 푸시를 광고 동의 없이 보내는 '정보성 알림'으로 볼지"(추천 (가) "정보성으로 보고 진행") — 답은 둘 다 "추천대로 진행". 반영은 §7 · LEGAL-SA-02 개정 블록.

> **[개정 · 2026-10-20 — 사용자 결정 25~31]** 이 문서가 기대는 사용자 답이 더 늘었다(2026-10-20, 같은 결정 수집 문서의 「추가 결정 7건 — 상황 감지 (10-20)」 — 원문 표 전체는 `functional-design/business-logic-model.md` §0.4 개정 블록): 26 "산지 권역 특보(강원중부산지 등)만 걸린 강원·경북 시군 여행지. …"(추천 (라) "(나) + 시군·도 이름으로 시작하지 않는 구역은 '모름'(거짓 '특보 없음' 차단)" — (나) "그대로 + 켜기 전 특보구역 목록 전체 대조") · 28 "미리 짜 둔 대안이 '낡음'으로 처리되는 2분 기준에 줄 대기 시간이 들어간다. …"(추천 "(다). 개발 서버에서 미리 계산을 켜 보고, 낡음으로 닫히는 비율이 눈에 띄면 (가)") · 31 "운영 서버에 공휴일 휴무(공휴일·명절에 쉬는 곳을 일정에서 빼기)를 켤지. …"(추천 (가) "개발 서버의 첫 실제 조회(10-21 07:15 장소 점검)가 경고 없이 지나면 운영도 켬") — 답은 25~31번 7건 모두 "추천대로 진행". 25·27·29·30번은 '안 정하면 · 마감' 칸의 마감만 쓴다. 반영은 §7 개정 블록.

---

## 0. 이 확장에서 새로 생기는 축

| 축 | 왜 새로운가 | 상속으로 안 덮이는 이유 |
|---|---|---|
| **PERF** 서버 배경 회차 | 서버가 매시 진행 중 여행을 훑는다(DEC-SA-1 — DEC-U4-6 의 확장) | U4 PERF 는 이벤트 기반 평가뿐(PERF-U4-01) — 회차 예산·병렬·스케줄러 스레드 축이 없었다 |
| **COST** 사용자 없는 외부 호출 | 앱을 열지 않아도 기상청·에어코리아·AI 검증·AI 재계획(LLM)을 부른다 | U4 COST 는 '요청 시 격자 수만큼'(COST-U4-03) — 하루 총량·파드 상한·선계산 상한이 없었다 |
| **RES** 키 미등록으로 출발하는 출처 | 새 공공데이터 출처 3종이 미등록(30) 상태로 출발한다 | U4 는 '실패 = 무발화'(INV-U4-09)뿐 — 출처별 해제·게이트웨이 오류 판독·관찰 전용이 없었다 |
| **OBS** 수집기 없는 배경 작업 | 회차가 사용자 요청 밖에서 돌아 응답 코드로 드러나지 않는다 | U4 OBS 는 OTLP 지표 이름(§5)이 전제인데 EKS 에선 OTLP 가 꺼져 있다 |
| **LEGAL** 광고성 경계 · 공공누리 | 기회 카드가 처음으로 '일정 밖 장소 권유'를 담는다 · 공공데이터 3종에 출처 표시 의무가 붙는다 | U6 LEGAL 은 '알림 경로는 정보성만'(LEGAL-U6-02) — 앱 안 카드·출처 표기를 다루지 않았다 |
| **호환** 구 앱 · 롤링 창 | 트리거·이벤트·세션 계약에 필드와 값이 늘고 마이그레이션 3건이 롤링 배포 중에 돈다 | OTA 가 없어 새 라벨·게이트를 모르는 구 앱이 오래 남는다 — U4·U6 NFR 에 이 축이 없었다(RES-SA-13) |

---

## 1. 성능 (PERF-SA-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **PERF-SA-01** ★ | **회차 예산 20분**(`budget = PT20M`). 여행마다 남은 예산을 보고, 모자라면 남은 여행을 건너뛰고 그 수를 요약 줄 `skipped=`에 낸다 — 다음 회차는 시작 위치를 바꿔 돈다(BR-SA-03). 20:40 보충 회차는 20:58 쓰기 컷(INV-SA-5)이 먼저 와서 실효 18분이다 | 계획 Q1=A. 회차 간격(매시 60분 · 20:15→20:40 25분)보다 짧아야 회차가 겹치지 않는다. 락 상한 PT25M 과 짝이다(tech-stack 델타 1). **근거 없는 초기값** |
| **PERF-SA-02** | **병렬 = 여행 단위 2**(`parallelism = 2`). 감지기는 트랜잭션 밖이라 DB 연결을 쥐지 않는다 — 병렬 상한을 정하는 것은 장소 감지가 부르는 AI 검증의 **AI 서버 CPU** 다. 올리는 조건 = 켜기 1·3단계 dry-run 의 `detectorMs{place}` p95 · `skipped` 실측 + AI 서버 CPU 경합(#1358·#1359 계열)이 없을 것 | 계획 Q1=A. AI 검증 실측 **20.1s**(2026-08-21 실 AI 왕복, 시한 미집행 — `backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/ScheduleDeadlineProperties.kt:56-58`) · 소켓 상한 **62s**(편집 경로 상한 60s + 여유 2s — 같은 파일 `:38` · `backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/adapter/out/external/ScheduleAgentProperties.kt:20` · 같은 폴더 `ScheduleAgentConfiguration.kt:46-50`). **근거 없는 초기값** |
| **PERF-SA-03** | **장소 회차 처리량(계산값)**. 장소 감지는 아침(07:15)·저녁(20:15·20:40) 회차에만 돌고 여행당 AI 검증 1회다(BR-SA-17). 예산 안 처리량 ≈ 1,200s × 2 ÷ 20.1s ≈ **119여행**, 응답이 소켓 상한에 붙으면 ≈ 38여행. 장소 회차에 `skipped > 0` 이 반복되면 §10 재평가. 낮 회차(날씨만)는 격자 캐시가 호출을 묶어 이 제약이 없다 | PERF-SA-01·02 의 곱 — 실측 전 계산값 |
| **PERF-SA-04** | **외부 호출 상한 시간**. 공공데이터포털 어댑터(단기예보 격자·특보·대기질)는 기존 기상청 값 connect 3s · read 5s 를 쓴다. AI 검증 62s. 같은 출처가 한 회차에서 연속 3번 실패하면 회로가 열린다(RES-SA-04) — 한 출처의 장애가 회차에 더하는 최악 지연은 3 × 그 출처의 상한이다 | `backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/adapter/out/external/KmaWeatherConfiguration.kt:31-33`. RESILIENCY-10(시한 MUST) |
| **PERF-SA-05** | **스케줄러 풀 = 4**(`spring.task.scheduling.pool.size`). 스윕이 한 스레드를 최대 20분 쥐어도 릴레이·폴러가 돌 자리가 남는다. 플래그와 무관하게 머지 즉시 운영에 반영된다 — 리마인드 문구 세션에 알린다 | 계획 Q2=A. Boot 기본은 1스레드(`scheduling-1` — `backend/app/src/test/resources/config/application.yml:25`)이고 기존 `@Scheduled` 잡 10개(아웃박스 릴레이 2초 `backend/app/src/main/kotlin/com/trippilot/app/event/OutboxRelay.kt:83` · 리마인드 폴러 · 문구 재시도 · 미읽음 게이지 · 부분 일정 정리 · 여행 종료 · 자동화 구간 · 법정 로그 보존 · 토큰 revoke · 도우미 보존)가 그 하나를 나눠 쓴다. 풀이 1이면 회차 동안 알림 배달이 통째로 멈춘다 |
| **PERF-SA-06** ★ | **선계산 = 전용 실행기 1스레드 + 실행 자리(실행 1 · 대기 10)**. 릴레이 스레드는 기다리지 않는다 — 자리를 못 얻으면 세션 없이 BUSY. 사건 나이 30분 초과는 무시한다. 1건 = AI 재계획 1회(시한 25s — `backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/ReplanFacadeService.kt:302`)이고 그동안 읽기 전용 트랜잭션이 DB 연결 1개를 쥔다(같은 파일 `:71`) → 선계산의 연결 점유 ≤ 1. 늘리는 선행 = 재계획 산출의 AI 호출을 트랜잭션 밖으로(후속) | 10-18 Q1 답 · 계획 Q3=A. 공용 `@Async` 는 포화 시 호출 스레드에서 돈다(`backend/app/src/main/kotlin/com/trippilot/app/config/AsyncConfig.kt:51-57`) — 릴레이 스레드가 25s 씩 막힌다. DB 풀은 Hikari 기본 10(`application.yml` 에 풀 설정 없음), 상향은 보류(DB 연결 여유 미확인) |
| **PERF-SA-07** | **진입 게이트 대기 ≤ 3초** — 트리거 상세 + `prepared?date=` 를 함께 기다리고 넘으면 i04(BR-SA-23). 신규 조회 3종(트리거 상세 · `prepared?date=` · `opportunities?date=`)은 상속 기반선(U0 PERF)을 따른다 | 막다른 길 없음(INV-4) |
| **PERF-SA-08** | **기회 조회 = BE→AI 1왕복 · LLM 0회**. AI 쪽 POI 반경 조회 ≤ 8회 · 시한 예산 70% 안에서 끊고 부분 결과 + note. BE 호출은 `request_meta` 시한을 싣고, 소켓 read 상한 = 시한 + 여유(기존 `readTimeoutMarginMs` 2s 관례). 값은 BE 기회 조회 구현이 정한다 | 허브 표시를 막지 않는다 — 실패·초과는 빈 목록(RES-SA-09). RESILIENCY-10 |
| **PERF-SA-09** | **감시 상태 신선도 창 = 날씨 2시간 · 장소 14시간**(BR-SA-13). 날씨는 매시 회차를 한 번 놓쳐도, 장소는 아침→저녁(07:15→20:15) 간격을 덮는 값이다. 회차가 없는 밤에는 날씨가 20:40 회차 2시간 뒤부터 07:15 회차까지 `UNKNOWN`('확인 불가')으로 보인다 | **근거 없는 초기값**. 밤 표시는 INV-SA-5(밤에 돌지 않는다)의 결과다 |

> **[개정 · 2026-10-20 — 구현 반영]** PERF-SA-08 — 값(#1422): `deadline_ms` 3s · 소켓 읽기 상한 **9s** · 연결 1s(`backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/adapter/out/external/OpportunityConfiguration.kt:34-37`). 읽기 상한은 위의 '시한 + 여유(`readTimeoutMarginMs` 2s 관례)'가 아니라 **상대 백스톱(시한 + 5s — `TRIPPILOT_TIMEOUT_MARGIN_MS` 기본)보다 1s 길게** 잡았다. 같거나 짧으면 상대가 마감을 넘겨 정리해 보내는 응답(백스톱 504 포함)을 우리 소켓이 먼저 끊는다 — 우리 소켓 시계는 요청을 다 보낸 순간 출발해 상대 시계보다 앞서고, 응답은 돌아오는 길도 걸린다. 리마인드 14s·회고 21s 경계와 같은 꼴이고, 설정이 '읽기 상한 ≥ 시한 + 5s'를 기동에서 강제한다(`:45-48,56`). AI 쪽은 시한의 70% 안에서 반경 조회(≤ 8회)를 끊는다(`ai/src/trippilot/api/opportunities.py:35-36`).

> **[개정 · 2026-10-22 — 구현 반영]** PERF-SA-01·02·03 — 운영 준비 감사(2026-10-20)에서 코드와 맞춘 것.
> - **PERF-SA-01 의 '락 상한 PT25M'은 `PT24M`** 이다(`tech-stack-decisions.md` 델타 1 개정 블록).
> - **PERF-SA-02·03 의 'AI 검증 실측 20.1s'(2026-08-21 · 시한 미집행)는 지금 경로보다 앞선 값이다** — 하루 점검의 검증은 `deadline_ms` 3s 를 싣고 AI 백스톱은 시한 + 5s(8s)라, 그보다 길면 보류(영업시간 모름)로 끝난다(`functional-design/business-logic-model.md` §6.3 개정 블록). PERF-SA-03 의 '≈ 119여행'은 그 값으로 낸 계산이라 함께 다시 낸다. 켜기 1·3단계 dry-run 에서 `detectorMs{place}` p95 와 장소 모름 수(`unknown={place:n}`)를 같이 본다 — 실측이 백스톱 근처면 보류가 회차 회로(연속 3번)를 열어 그 회차 남은 여행의 영업시간 판정이 꺼진다(BR-SA-17).

## 2. 비용·외부 호출 (COST-SA-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **COST-SA-01** ★ | **단기예보 격자 경로 하루 ≈ 15·o·N 콜**(N = 진행 중 여행, o = 격자 공유 계수 0.5~1) — N 50 ≈ 600 · 200 ≈ 1,800 · 500 ≈ 3,750. 개발계정 10,000/일을 AI 와 나눈다. **진행 중 약 500여행부터 운영계정 증설**(활용사례 등록·심의) | 계획 Q4=A. 추정 가정 — 낮 갱신(만료 = 발표 + 3시간 + 10분) 5회 + 저녁 1회 × 실외 격자(오늘 ≈ 1.5 · 내일 ≈ 2) × 03 재요청 계수 ≈ 1.5. **추정** — 켜기 1·3단계 요약 줄과 실키 격자 왕복(`LIVE_KMA=1`)으로 실측 |
| **COST-SA-02** ★ | **격자 경로 파드당 하루 3,000 콜 상한**. 이름 경로(날씨 확인 `WeatherTriggerService`)·도우미 날씨 카드는 세지 않는다. 넘으면 부르지 않고 WARN 하루 1번, 그 격자 Unknown. 카운터는 파드 프로세스 수명 범위다 — 재기동(배포 포함)하면 0 부터 다시 세어, 그 날 재기동이 있으면 파드당 (재기동 수 + 1) × 3,000 까지 오를 수 있다(폭주 방지 그물이다 — 키 한도에 닿으면 게이트웨이 거절 22 로 그 출처가 모름이 된다) | 계획 Q4=A. 운영 대상 backend 복제본 2(`deploy/eks/chart/values-dev.yaml:22-23`)라 최대 6,000 — 키 한도의 4,000 이상이 AI·이름 경로 몫으로 남는다. 개발 대상(복제본 1 — `deploy/eks/chart/values-dev-target.yaml:10-11`)이 같은 키 값을 쓰면 한도도 함께 쓴다 **[라이브 미확인]** |
| **COST-SA-03** | **특보 = 회차당 1콜**(전국 특보현황 1건, 파드 메모리 20분 · 발표 시각·순번이 같으면 다시 파싱하지 않는다), 오늘만 → **하루 ≤ 16** | 계획 Q5=A. 기상특보 조회서비스 — 자동승인 · 개발 10,000/일(공공데이터포털 15000415) |
| **COST-SA-04** | **대기질 = 예보 발표 단위 캐시, 하루 ≤ 8콜**(PM10·PM25 × 발표 회차 — 발표 시각은 실응답으로 확정). 운영계정(심의 승인)이 필요 없는 양이다 | 계획 Q5=A. 에어코리아 대기오염정보 — 개발 자동승인 · 운영 심의 · 개발 500/일(15073861) |
| **COST-SA-05** | **오류 상태 호출량** — 게이트웨이 오류(RES-SA-02)는 캐시하지 않고 다음 회차에 다시 묻는다: 출처별 회차당 1~2콜, 하루 ≤ 30. 키 미등록(30)이 종일 이어져도 한도에 닿지 않는다 | 계획 Q5=A. 2026-10-19 10:12 세 API 가 30 인 상태에서 출발한다(O-SA-1) |
| **COST-SA-06** | **특일 = (연, 월)당 1콜, 성공한 달만 캐시**. 실패 처리는 RES-SA-10 | 계획 Q5=A. 특일정보 — 자동승인 · 개발 10,000/일(15012690) |
| **COST-SA-07** ★ | **선계산 = LLM 비용이 드는 유일한 새 경로**. 1건 = AI 재계획 1회(구성 LLM `REPLAN_COMPOSITION` HEAVY 등급 — `ai/src/trippilot/llm_gateway/config.py:58`). **여행당 하루 3 · 전체 하루 100**, 실제로 연 세션만 센다 — BUSY·건너뜀은 상한도 트리거당 1회도 쓰지 않는다(BR-SA-18). freeText 를 싣지 않는다(번역·발화 해석 LLM 을 부르지 않게). 스위치 `PLANB_PREPARED_REPLAN` 기본 `off` | 10-18 Q1 답 · 계획 Q3=A · O-SA-10(초안 기본값 채택) |
| **COST-SA-08** | **LLM 0회 경로** — 감지기 4종·판정·알림·기회 조회. 장소 감지의 AI 검증은 조립 검증만이라 LLM·경로 API 를 부르지 않는다(조립 추정기 `TravelEstimator` = 직선거리 × 우회 계수 — `ai/src/trippilot/api/wiring.py:3748-3751` · `ai/src/trippilot/assembly_engine/travel.py:34-46`). 사용자가 누르는 [넣어서 다시 짜기]는 기존 자연어 재계획 비용(U4 승계)이다 | BR-SA-17 · BR-SA-22 |
| **COST-SA-09** | **DB 증가** — `plan_b_watch` 여행당 ≤ 4행(출처 PK) · `weather_grid_forecast` 격자당 1행(덮어쓰기) · `plan_b_trigger` 는 대상(kind × 날짜 × slotKey)당 ACTIVE 1 + 억제·무영향 무발화 행 날짜·변형당 1(BR-SA-08). 정리 잡은 이 확장 밖이다(후속) | RDS 자동 확장 대비 무시할 수준(shared-infra 증분 SA.4) |

## 3. 신뢰성 · 모름 (RES-SA-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **RES-SA-01** ★ | **모름은 발화도 해제도 아니다**(INV-SA-2). 아래는 전부 그 출처·그 대상의 모름이다 — 행을 만들지 않고 ACTIVE 를 닫지 않는다: `isLive=false`(`WEATHER_MODE=fake` 포함) · 게이트웨이 오류 · 03 재요청 소진 · 타임아웃·5xx·형식 깨짐 · 격자 상한 초과 · 판정 시각 값 결측 · AI 검증 보류·영업시간 원문 없음 · 상태 조회 예외 · 회로 차단 · 예산으로 못 본 여행. 관찰 전용·꺼짐·미호출도 해제가 아니다. 해제는 **출처별**이라 한 출처의 모름이 다른 출처의 해제를 막지 않는다. 모름이 이어지면 감시 상태가 신선도 창(PERF-SA-09)을 지나 '확인 불가'가 된다 — 조용히 '정상'으로 보이지 않는다 | INV-U4-09 · P-RES-U4-2(만료값으로 발화 금지) 승계 · INV-4 |
| **RES-SA-02** ★ | **공공데이터포털 게이트웨이 오류 판독** — HTTP 401·403 과 `cmmMsgHeader.returnReasonCode` **20**(서비스 접근 거부)·**22**(일일 요청 한도 초과)·**30**(등록되지 않은 서비스 키)·**31**(기한 만료 키)·**32**(등록되지 않은 IP)를 **JSON·XML 어느 본문에서든** 읽는다(JSON 을 요청해도 XML 오류 본문이 온다). 처리 = 캐시하지 않음 · 그 출처만 Unknown · 파드에서 상태가 바뀔 때 WARN 1번(원인 코드만) · 다음 회차에 다시 묻는다. 판독기 하나(`PublicDataGatewayError`)를 백엔드 어댑터 3개가 함께 쓰고, AI 특일 어댑터는 같은 코드를 '실패·미등록'으로 읽는다 | 계획 Q5=A. 기존 단기예보 어댑터는 JSON `resultCode` 만 본다(`KmaWeatherAdapter.kt:60-63`) — XML 오류 본문은 형식 깨짐으로 읽혀 원인이 사라진다. 2026-10-19 10:12 실측: 특보·대기질·특일 = 30, 같은 키의 단기예보 정상 |
| **RES-SA-03** | **재요청은 `03`(NO_DATA)만, 즉시 ≤ 2회**(격자 경로). 그래도 없으면 그 격자 Unknown. 계정·키 오류·타임아웃·5xx 는 다시 부르지 않는다 | 계획 Q4=A. '재시도 없음' 기반선(`KmaWeatherAdapter.kt:38` — P-RES-U4-1)의 이 확장 유일한 예외. 발표 직후에는 제공 지연으로 빈 응답이 올 수 있다(`KmaWeatherAdapter.kt:131-135`) |
| **RES-SA-04** | **회로 차단·실패 기억은 회차 범위**. 같은 출처가 한 회차에서 연속 3번 실패하면 그 회차의 남은 여행은 그 출처를 Unknown 으로 둔다. 회차 안에서 실패한 격자는 다시 부르지 않는다. 상태는 회차가 끝나면 버린다(저장 없음) | 계획 Q1·Q4=A. RESILIENCY-10(서킷 SHOULD). 라이브러리 미도입(P-RES-U4-1)과 양립한다 — 카운터가 회차 안에만 산다 |
| **RES-SA-05** | **격리와 쓰기 경로** — 감지기는 트랜잭션 밖. 예외는 그 출처·여행·날짜만 Unknown. 일정 조회 예외 = 그 여행만 실패(WARN · 상태 불변 · 다음 여행 계속). 쓰기는 `reconcile` 하나 — 여행 1개 = 트랜잭션 1개(DEC-SA-2). 대상 유니크 위반은 새 트랜잭션으로 1회 재시도, 행 버전 충돌은 다음 회차가 다시 판정한다 | SECURITY-15(외부 호출 오류 처리 · 오류 경로 자원 정리) |
| **RES-SA-06** | **종료·배포·락** — 종료 신호를 받으면 여행 사이에서 멈추고 정상 반환해 락을 푼다. 진행 중 AI 검증(≤ 62s)은 graceful 종료 630s 안에 끝난다. 배포로 끊긴 20:15 회차는 20:40 보충이 잇는다. 파드가 비정상 종료하면 락은 상한(PT25M) 뒤 풀린다(경계 — tech-stack 델타 1) | 종료 계약 `deploy/eks/chart/templates/backend.yaml:85-86`(`SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE` 630s) · shared-infra §4.2 |
| **RES-SA-07** | **아웃박스 구독자** — 선계산 구독자는 계약 위반·파싱 실패만 WARN 후 삼키고 일시 오류는 던져 재시도받는다. 릴레이는 같은 이벤트의 구독자를 서로 독립으로 돌리고 하나라도 실패하면 이벤트째 재시도한다(최대 10회 — `OutboxRelay.kt:122-129` · `:235`). 알림 구독자는 `source_event_id` UNIQUE(`backend/modules/notification/src/main/kotlin/com/trippilot/notification/application/NotificationRaiseService.kt:69`)로, 선계산은 트리거당 SYSTEM 세션 1개(부분 유일)로 멱등이다. 선계산이 실패해도 알림 행은 남는다 | at-least-once(shared-infra §4.4) · #1348 |
| **RES-SA-08** | **선계산 강등** — 꺼짐·상한·열린 세션·자리 없음(BUSY) → 세션 없음, 앱은 i04 실시간 계산으로 간다. 실행기 거절 → FAILED. AI 실패·해 없음 → FAILED·NO_SOLUTION(BR-U4-26 대칭 3옵션). 파드 재시작으로 SOLVING 고착 → 2분 뒤 `stale`. 어느 실패도 일정 쓰기를 만들지 않는다 | INV-SA-1 · INV-4 |
| **RES-SA-09** | **기회 조회 강등** — AI 무응답·시한 초과·계약 위반 → BE 200 빈 목록 + WARN. 행사 미배선 → TRENDING 만 + note. FE 는 실패·빈 목록이면 그리지 않는다 | DEC-SA-6(상태 없음) |
| **RES-SA-10** | **특일 달력** — 실패·미등록 → 없음 + WARN → 날짜 명시형 규칙만 쓰고 정기 규칙 판정은 그대로다. `HOLIDAY` 트리거는 감지기가 해제하지 않는다(달력을 못 읽은 회차의 '정상'이 진짜 휴무를 지우지 않게 — BR-SA-17). 특일 조회는 명시 시한을 두고 실패도 짧게 기억해, 생성·재계획·검증 요청마다 실패 호출이 붙지 않게 한다 — 성공한 달만 오래 캐시하는 규칙과 별개이고 값은 하위 코드·공휴일 구현이 정한다 | RESILIENCY-10. 공휴일 규칙은 생성·재계획·검증 전 경로가 같은 헬퍼로 보므로(BR-SA-17) 실패 호출의 지연이 그 전부에 붙는다 |
| **RES-SA-11** | **되돌리기** — 스위치 값을 `off`·`today` 로 바꾸고 재배포(배포마다 파드 재시작). 스윕을 끄면 트리거 목록이 스윕 출처 트리거를 즉시 숨긴다(회수 — BR-SA-13, 일괄 만료 명령 없음). 마이그레이션 3건은 확장형이라 코드 되돌림에도 무해하다. 코드 롤백 방식은 사용자 결정(shared-infra §12 Q6=B)을 따른다 | 계획 Q7=A · RESILIENCY-04 |
| **RES-SA-12** | **강등 허용 워크로드** — 스윕·선계산·기회 조회는 멈춰도 일정 조회·편집·사용자 재계획이 그대로다. 별도 가용성 목표를 두지 않는다. 멈춤은 감시 상태 '확인 불가'와 요약 줄 부재로 드러난다 | RESILIENCY-01 · INV-4 |
| **RES-SA-13** ★ | **계약 호환 — 추가형만**. openapi 새 필드는 required 밖(FE 계약 가드·옛 픽스처 보호) · 이벤트 payload 새 필드는 기본값 null(옛 행·옛 구독자 호환, JSON 트리로 읽는다) · 마이그레이션 3건은 상수 기본값 확장형(롤링 창의 옛 파드에 무해 — shared-infra 증분 SA.4) · 새 상태값·`TriggerKind`·`NotificationKind` 없음 · 저장값이 집합 밖이면 응답은 null 이고 FE 는 kind 라벨. 구 앱(OTA 없음)의 날짜 오동작은 서버 진입 강제(BR-SA-20)가, 라벨 오표기는 켜는 순서(O-SA-7)가 막는다 | 계획 Q8=A. 새 kind 하나로 구 앱 알림함이 죽는다(`frontend/src/pages/settings/notification-inbox/ui/NotificationInboxPage.tsx:35` — 모르는 kind 구조분해) |

> **[개정 · 2026-10-22 — 구현 반영]** RES-SA-01·06·13.
> - **RES-SA-01 모름 목록에 더한다** — 특보 매칭의 낯선 하위 구역(도의 시군·광역시의 군 목적지) · 관서 묶음 줄 × 그 묶음의 다른 광역 목적지(`functional-design/business-rules.md` BR-SA-16 개정 블록) · AI 가 판정하지 못했다고 답한 장소의 영업시간(검증 응답 `unverified_slots` — BR-SA-17 개정 블록). 셋 다 신호가 없으면 확인하지 않는다.
> - **RES-SA-06 의 '락은 상한(PT25M) 뒤 풀린다'는 `PT24M`** 이다 — 20:15 를 쥔 파드가 비정상 종료해도 락이 20:39 무렵 풀려 20:40 보충이 잡는다(`tech-stack-decisions.md` 델타 1 개정 블록).
> - **RES-SA-13 의 '마이그레이션 3건'에 확장형 하나가 더해진다** — `weather_grid_forecast.daily` 의 기본값 `'{}'`(코드가 그 칸을 매핑하지 않는다). 칸 삭제는 옛 파드가 남지 않은 다음 배포의 후속이다(`functional-design/domain-entities.md` §8.1 개정 블록). 응답 선택 필드(AI 검증 `unverified_slots` 사유 · 기회 `event_type`/`eventType`)는 추가형이지만 BE 경계 계약 시험이 키·enum 을 정확 일치로 보므로 AI·BE 를 같은 변경에 싣는다.

> **[개정 · 2026-10-22 — 구현 반영]** RES-SA-01·10(G-SA-19·21·22).
> - **RES-SA-01 모름 목록에 더한다** — 특보 제외 줄이 목적지 시군의 하위 권역만 뺌(G-SA-19 · `functional-design/business-rules.md` BR-SA-16 개정 블록) · 특일 달력을 못 읽은 검증에서 주간 영업 창으로 HC1 을 통과한 태그형 휴일 규칙 장소의 슬롯(G-SA-22 · BR-SA-17 개정 블록 ⓑ). 그리고 **일부 모름도 감시 상태를 남기지 않는다** — 장소 감지기가 그 날 본 대상 가운데 발견이 없는데 상태·영업시간을 모르는 것이 하나라도 있으면 발견·해제는 그대로 쓰되 감시 상태 행을 건드리지 않는다(G-SA-21 · BR-SA-17 개정 블록 ⓐ).
> - **RES-SA-10 의 '날짜 명시형 규칙만 쓴다'는 판정·조립에 그대로다** — 생성·재계획·기회·편집·수리와 검증의 위반 판정 모두 못 읽은 달력을 빈 달력으로 읽는다. 더해진 것은 검증·수리 응답의 미판정 보고뿐이다 — 태그형 휴일 규칙과 주간 영업 창이 있는 장소의 슬롯이 그 창으로 HC1 을 통과했으면 `HOURS_UNKNOWN` 으로 싣고, 백엔드 하루 점검이 그것을 모름으로 읽어 그 날 장소 감시는 '확인 불가'가 된다(G-SA-22 · #1572 · G-SA-21). 특일 조회가 계속 실패하면 그런 슬롯이 낀 날마다 '영업' 감시가 그렇게 보인다.

> **[개정 · 2026-10-22 — 구현 반영]** RES-SA-01(특보 실응답 표본 · TRIP-1590) — 모름 목록의 '관서 묶음 줄 × 그 묶음의 다른 광역 목적지'(위 블록)는 그 줄이 관서 묶음 꼴의 흔적을 보일 때로 좁아진다(t6 는 행정 광역 줄 — G-SA-18). '시군 전체 이름을 뺐어도 광역 줄 안의 그 시군 섬이 남는 제외 줄'(`전라남도(여수 제외)` × 여수)을 더한다(`functional-design/business-rules.md` BR-SA-16 개정 블록).

> **[개정 · 2026-10-23 — 구현 반영]** RES-SA-13 — 위 블록의 `weather_grid_forecast.daily` 칸 삭제(후속)를 마쳤다 — V2.86(TRIP-1575). V2.81 과 그 코드가 운영까지 나가 이 칸을 아는 옛 파드가 없는 뒤의 2단계라 롤링 창에 무해하다.

> **[개정 · 2026-10-23 — 구현 반영]** 대기질 장애 때 마지막 발표분(TRIP-1607 · `backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/application/WeatherAlertService.kt`).
> - 에어코리아 읽기 시한 실패가 48시간 19회차 중 8이었다(TRIP-1576 — 코드 결함 아님, 재요청 금지 RES-SA-03).
> - 장애(시한·5xx·형식)면 18시간 안에 받은 마지막 발표분으로 답하고, 그 값을 20분 유지한다. 재요청이 아니다 — 다음 회차에 다시 묻는다(COST-SA-05 그대로).
> - 아침 첫 조회가 실패해도 어제 17시 발표분(약 14시간 전)의 '오늘' 예보로 답한다.
> - 게이트웨이 거절(키·한도)은 설정 문제라 그대로 모름이다. 재기동 직후의 첫 실패도 기억이 없어 모름이다.
> - 장애 빈도는 요약 줄 `unknown` 이 아니라 어댑터 WARN 줄로 센다.

## 4. 관측 (OBS-SA-\*)

**원천은 로그다** — EKS 에서 OTLP·OTel 이 꺼져 있어(`deploy/eks/chart/templates/backend.yaml:91-99`) 카운터는 운영에서 보이지 않는다. 컨테이너 로그는 dev 스택에서 켜져 있고 보존 90일이다(`infra/terraform/environments/dev.tfvars:11-12`).

| ID | 요구 | 근거 |
|---|---|---|
| **OBS-SA-01** ★ | **회차 요약 INFO 1줄**(형식 고정 — 아래). 0건 회차도 남긴다. 관찰 전용(dry-run·observe-only) 결과는 쓰지 않는 대신 이 줄과 발화 표본 줄(여행 id · 출처 · 변형 · 심각도 · slotKey)로 남긴다 — 켜기 1·3·8단계가 휴무 오탐·광역 특보 과잉을 이 줄로 판정한다 | 계획 Q6=A · BR-SA-04 · OBS-SA-07 |
| **OBS-SA-02** | **선계산 요약** `replan.prepared outcome=` — `OPENED` · `Skipped`(DUPLICATE · TRIP_CAP · GLOBAL_CAP · INVALID · OPEN_SESSION · EARLIER_OPEN · BUSY) · `APPLIED` · `REFUSED`(낡음 409). 켜기 6단계가 BUSY 비율·적용률을 이 줄로 본다 | 계획 Q6=A · BR-SA-18 · BR-SA-19 |
| **OBS-SA-03** | **상태 변화 WARN** — 게이트웨이 오류(원인 코드, 파드에서 상태가 바뀔 때 1번) · 격자 상한 초과(하루 1번) · 회로 차단 · 문구 가드 위반(그 신호만 버림 — BR-SA-12) · 특일 실패. 같은 상태가 이어지는 동안 반복하지 않는다 | 로그 폭주 없이 원인이 보이게 |
| **OBS-SA-04** | **기동 줄** — `[모드]` 줄에 스윕·지평·선계산 1줄씩(`backend/app/src/main/kotlin/com/trippilot/app/observability/RuntimeModeSummary.kt:70-79` SWITCHES) · 안내자 줄 `상황 감시 = 꺼짐`(DB 쓰기 없음) · AI 배선 줄 `ai-wiring:` 에 `HOLIDAY_CLOSURE_MODE`(`ai/main.py:328`). 운영 `PUSH_MODE`·`WEATHER_MODE` 실값도 `[모드]` 줄로 확인한다 | §7 0단계 · G-SA-7 |
| **OBS-SA-05** | **알림 억제 사유** — 기존 `SuppressReason`(`backend/modules/notification/src/main/kotlin/com/trippilot/notification/application/NotificationMetrics.kt:129-141`)에 `IN_APP_ONLY`·`COALESCED` 를 더한다. 새 지표가 아니고 억제 총량 식은 그대로다. 운영 판독은 요약 줄의 `pushed=`·`quiet=` 로 한다 | 계획 Q6=A · OBS-U6-03 · G-SA-2 |
| **OBS-SA-06** | **DB 로 남는 원천** — `plan_b_trigger`(발화·조용한 발화·해제·만료·소비, `alerted_severity`·`pushed_at`) · `plan_b_suppression`(허위 알림 비율 OBS-U4-02 의 분자) · `plan_b_watch` · `replan_session` 의 `initiated_by = 'SYSTEM'` 행 종료 상태(초안 적용률). 운영에서 질의를 어디서 돌리나는 U10 증분 I-U10-1 과 같은 미결이다 | 새 계측 없음 |
| **OBS-SA-07** | **새 Micrometer 지표·새 알람 없음**. 요약 줄은 주기 검토 재료이지 호출(page) 대상이 아니다. 스윕이 멈추면 사용자 표면의 감시 상태가 '확인 불가'로 바뀐다(BR-SA-13) | 계획 Q6=A(B·C 기각) · shared-infra §4.6 · G-05 · §12 Q3 |

```text
planb.situation_sweep mode= phase= trips= skipped= failed= live=[] off=[] observe=[] unknown={source:n} announced= pushed= quiet= expired= elapsedMs= detectorMs={source:p50/p95}
```

| 필드 | 뜻 |
|---|---|
| `mode` · `phase` | `off`·`dry-run`·`on` · `MORNING`·`DAYTIME`·`EVENING`(BR-SA-01) |
| `trips` · `skipped` · `failed` | 본 여행 · 예산으로 못 본 여행 · 일정 조회 등으로 실패한 여행 |
| `live` · `off` · `observe` | 출처 목록 — 부른 것 · 꺼진 것(`isLive=false` · 목록 밖) · 관찰 전용 |
| `unknown` | 출처별 Unknown 수 |
| `announced` · `pushed` · `quiet` | 알림 사건 수 · 그중 `push=true` · 조용한 발화 수 |
| `expired` | EXPIRED 로 닫은 수(만료·해제 — 원인은 DB 에 두지 않는다) |
| `elapsedMs` · `detectorMs` | 회차 소요 · 출처별 감지 지연 p50/p95 |

좌표·계정 id 를 싣지 않는다(SEC-SA-05).

> **[개정 · 2026-10-22 — 구현 반영]** 관측의 판독(운영 준비 감사 2026-10-20 — 코드로 확인 · 줄 번호는 `origin/develop` `49bda757f`).
> - **`dry-run` 의 '쓰기 0'** — 트리거·감시 상태·아웃박스(사건)·푸시 쓰기가 0 이다. 감지기는 그대로 불리므로 격자 캐시 upsert 와 ShedLock 락 행 갱신은 일어난다 — 허용된 쓰기다(`functional-design/business-logic-model.md` §7 개정 블록).
> - **`dry-run` 표본 해석**(OBS-SA-01 · 켜기 1·3·8단계) — `dry-run` 은 행이 없어 회차마다 '지금 켜면'을 다시 센다 — 같은 위험이 매시 다시 세지고, 요약 줄의 `announced`·`pushed`·`quiet` 는 그 회차의 값이라 회차끼리 더하지 않는다. 표본 줄 `planb.situation_sample tripId= source= kind= date= variant= severity= slot=` 은 신호(양성)만 싣는다 — 모름은 요약 줄의 출처별 수(`unknown=`)로 본다. 장소 표본의 `slot` 은 `{date}#{poiId}` 이고 날씨 표본은 비어 있다. 오탐은 (`tripId`, `source`, `date`, `variant`)로 중복을 걷어 센다 — 장소는 `slot` 이 장소를 가른다(`backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/application/SituationSweep.kt:219-221,288-298`).
> - **OBS-SA-02 의 빈칸** — 대기 중 2분을 넘겨 낡은 이른 날짜 SYSTEM 세션을 늦은 날짜 사건이 닫고 연 경우가 `outcome=OPENED` 로만 남는다 — 결정 28 의 '낡음으로 닫히는 비율'을 이 줄로 셀 수 없다(G-SA-23 — 6단계 전에 가르는 수단을 둔다).

> **[개정 · 2026-10-22 — 구현 반영]** OBS-SA-01 표본 줄 — 슬롯 신호는 끝에 `name="장소 이름"` 과 `at=요일 HH:mm~HH:mm`(자정 넘김 `(+1)`)을 더 싣는다. 날짜 전체 신호(날씨·특보)는 `name=null at=null` 이다. 장소 id 는 환경마다 다른 무작위 값이라 이것 없이는 휴무 오탐을 영업시간 원문과 로그만으로 대조할 수 없었다 — 운영 dry-run 첫 07:15 회차(2026-10-22)에서 켰다면 9건 중 3건에 휴무 푸시가 나갈 뻔했는데(OUT_OF_HOURS 2 · CLOSED_DAY 1) 대조하지 못했다. 좌표·계정 id 는 여전히 싣지 않는다(SEC-SA-05). 사용자 결정 2026-10-22(`business-logic-model.md` §0.4) · TRIP-1569 · #1542.

> **[개정 · 2026-10-22 — 구현 반영]** OBS-SA-02 — §4 첫 개정 블록(관측의 판독)의 'OBS-SA-02 의 빈칸'을 메우고 결과값 목록을 코드에 맞춘다(G-SA-23 · #1573 · 줄 번호 기준 커밋 `68cecd987` · `backend/modules/itinerary-recalculation/src/main/kotlin/com/trippilot/recalculation/application/PreparedReplanService.kt`).
> - **사건마다 한 줄** — `OPENED` · 건너뜀 사유(`DUPLICATE`·`TRIP_CAP`·`GLOBAL_CAP`·`INVALID`·`OPEN_SESSION`·`EARLIER_OPEN`·`BUSY`) · `OLD`(사건 나이 30분 초과 — BR-SA-18 ①) · `REJECTED`(종료 중 실행기가 받지 않아 세션을 FAILED 로 닫음)(`:93,97,112,136,138-142`). 적용·거절은 세션 쪽 줄이다 — `APPLIED` · `REFUSED staleness=`(`backend/modules/itinerary-recalculation/src/main/kotlin/com/trippilot/recalculation/application/ReplanSessionService.kt:452,509`).
> - **`EARLIER_STALE`(신설)** — 그 사건이 계산 중(대기 포함) 2분을 넘긴 더 이른 날짜의 선계산을 닫고 열었으면 `OPENED`(종료 중이라 실행기가 받지 않았으면 `REJECTED`) 앞에 한 줄 더 남는다 — `session`·`date` 는 닫힌 쪽이다. `OPENED` 는 종전대로 한 줄이라 분모가 흔들리지 않는다.
> - **`FINISHED status= waitMs= ageMs=`(신설)** — 산출이 끝날 때 한 줄. 기록조차 못 한 산출과 배포 종료 대기를 넘겨 시작 못 하고 버린 산출은 남기지 않는다.
> - **판독**(켜기 6단계) — 낡음으로 닫힌 비율 = `count(EARLIER_STALE) / count(OPENED)` · '없음'으로 보인 비율 = `count(FINISHED ∧ ageMs > 120000) / count(FINISHED)` · 줄 대기는 `waitMs` 분포. `EARLIER_STALE` 의 두 갈래(기다리거나 계산하다 낡음 / 파드 종료·기록 실패로 멈춤)는 같은 `session` 의 `FINISHED` 유무로 가른다(상태는 `CANCELED` 또는 `null` — 버려진 대기 산출은 '멈춤'에 섞인다)(`functional-design/business-rules.md` BR-SA-19 개정 블록). 좌표·계정 id 는 싣지 않는다(SEC-SA-05).

> **[개정 · 2026-10-23 — 구현 반영]** OBS-SA-01 — 켠 뒤 쓴 신호의 줄(TRIP-1608 · `backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/application/SituationSweep.kt`). 운영을 켠 첫 저녁(2026-10-23 20:15)에 알림 4건이 나갔다. 그런데 표본 줄이 쓰지 않은 신호만 실어, 앱에 간 휴무·영업시간 알림이 맞았는지 장소 이름·시각으로 대조할 수 없었다(운영 DB 는 로컬에서 못 본다).
> - `on` 이면 쓴 출처의 양성 신호를 `planb.situation_live` 줄로 남긴다. 꼴은 표본 줄과 같다(tripId·source·kind·date·variant·severity·slot·name·at).
> - 회차마다 다시 판정하므로 떠 있는 위험은 회차마다 다시 찍힌다. 새로 알린 수는 요약 줄의 `announced` 다.
> - 표본 줄(`planb.situation_sample`)은 그대로 쓰지 않은 신호(dry-run·관찰 전용)만 싣는다.

## 5. 보안 (SEC-SA-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **SEC-SA-01** ★ | **문구·푸시 노출면** — 사유·제목·본문에 좌표 꼴·소요·지연 시간·상대 날짜어가 없다(BR-SA-12 — 서버 `SituationCopy` 가 저장 전에 거르고, 어기면 그 신호만 버린다). 푸시 data 는 `PLANB_REPLAN {tripId, triggerId}` 뿐이다 — 날짜·세션 id·좌표를 싣지 않는다 | 잠금화면·알림함은 인증 이전 표면(SEC-U4-04 승계) · INV-3 |
| **SEC-SA-02** | **객체 수준 인가** — 신규 조회 3종(`GET /trips/{tripId}/triggers/{triggerId}` · `GET …/replan-sessions/prepared?date=` · `GET …/opportunities?date=`)은 소유 계정이 아니면 404(존재 은닉). SYSTEM 세션도 여행 소유 계정에 묶이고 [적용]은 소유자만이다(INV-SA-1) | SEC-U4-01 · SEC-U4-02(`trips/**` 딥링크는 서버 인가가 유일한 방어선) |
| **SEC-SA-03** | **서비스 키 비노출** — 공공데이터포털 키는 질의 문자열에 실린다. 요청 URL·응답 본문을 로그에 싣지 않고 원인 코드만 남긴다. 키는 디코딩 키(`%` 없음)를 넣는다(`KmaWeatherConfiguration.kt:21-23` · `:51-56`). 특보·대기질·특일은 `WEATHER_API` 를 쓰고, 신청 계정이 다르면 키 env 1개를 같은 시크릿 그릇에 더한다(O-SA-1) | SECURITY-12 · 선례 `KmaWeatherAdapter.kt:62`(메시지에 코드만) |
| **SEC-SA-04** | **카나리 허용목록은 인가가 아니다** — `PLANB_SITUATION_SWEEP_ACCOUNT_IDS` 는 스윕 대상만 좁힌다. 목록 밖 계정의 데이터를 가리지도, 목록 안 계정에 권한을 주지도 않는다. 형식은 UUID 목록이고 배포 전에 검증한다(`deploy/eks/runtime_secrets.py:236-244` 꼴). 값은 비밀이 아니고 '커밋 없이 바꾼다'는 이유로 시크릿에 둔다 | SEC-U10-08 선례(스위치는 가용성 장치) |
| **SEC-SA-05** | **로그 개인정보** — 요약 줄·표본 줄·WARN 에 좌표·계정 id 를 싣지 않는다. 여행 id · 출처 · 건수 · 원인 코드까지 | SECURITY-03 · 컨테이너 로그 보존 90일 |
| **SEC-SA-06** | **입력 상한** — `date` 쿼리는 날짜 형식만 받고 범위 밖은 빈 목록·404. AI 기회 요청은 슬롯 1~30 · `planned_poi_ids` ≤ 300 · 응답 ≤ 3, 표시 게이트(2~60자 · 연락처 꼴 금지 — BR-SA-22) | SECURITY-05 |
| **SEC-SA-07** | **내부 경계** — BE→AI 기회 호출은 기존 `X-Service-Token`·NetworkPolicy 경계를 그대로 탄다. 새 공개 경로는 gateway `/api` 아래뿐이다 | SECURITY-08 · shared-infra §4.4·§4.5 |
| **SEC-SA-08** | **fail-safe** — 스위치 오타는 배포 전에 막는다(`runtime_secrets` 모드 값 집합). 오류의 기본값은 '알리지 않음'이다(RES-SA-01) | SECURITY-15 |

> **[개정 · 2026-10-20 — 구현 반영]** SEC-SA-03 — O-SA-1 종결: 특보·대기질·특일 활용신청 계정이 `WEATHER_API` 계정과 달라 키 env `PUBLIC_DATA_API_KEY` 를 더했다(#1379). 같은 시크릿 그릇(backend·ai)에 들고, 읽는 쪽은 비면 `WEATHER_API` 로 대신한다(`backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/adapter/out/external/WeatherAlertConfiguration.kt:28` · `ai/main.py:481-483`). 기동 줄에는 키를 읽은 env **이름만** 남기고(`WeatherAlertConfiguration.kt:31-32`), `%` 가 든 키(인코딩 키 — 한 번 더 인코딩돼 게이트웨이 거절 403·30)는 기동 WARN 이다(`:35-41`). 배선·반영 확인은 `functional-design/business-logic-model.md` §10 개정 블록.

## 6. 법적 처리 (LEGAL-SA-\*)

| ID | 요구 | 근거 |
|---|---|---|
| **LEGAL-SA-01** ★ | **기회는 알림 경로 밖** — 근처 행사·요즘 인기는 앱 안 카드로만 보이고 `NotificationRaiseService` 를 부르지 않는다(푸시·알림함 0 — DEC-SA-6). 위험·주의 문구에도 일정 밖 장소·행사 권유를 섞지 않는다 | 계획 Q9=A. 정보통신망법 제50조 ①(영리목적 광고성 정보 전송은 수신자의 명시적 사전 동의) · ③(21시~다음 날 08시 전송은 별도 사전 동의). KISA 안내서(2017.11 판 p.12~13 — 판본 재확인 필요): 영리 사업자가 고객에게 보내는 정보는 원칙적으로 광고성이고, 부수적으로 섞여도 전체가 광고성이다. LEGAL-U6-02(이 경로는 정보성만)를 지키는 길이고, 섞이면 LEGAL-U6-01(조용시간 없음)의 근거가 무너진다(LEGAL-U6-03) |
| **LEGAL-SA-02** | **법무 확인 묶음** — 아래는 추정이라 법무 확인에 올린다: ① 위험·주의 알림이 정보성(거래·서비스) 예외에 든다 ② 앱 안 카드는 '전송'이 아니다 ③ KISA 안내서의 현행 판본 ④ 푸시·알림함 본문(출처 없음)이 공공누리 출처 표시 범위에 드는가(LEGAL-SA-03) | `functional-design/business-logic-model.md` §6.3 · §10 끝 |
| **LEGAL-SA-03** | **공공누리 출처 표기** — 기상청 단기예보·기상특보 = **1유형**(출처 표시) · 에어코리아 = **3유형**(출처 표시 · 변경 금지 — 등급 문자열 그대로) · 특일정보 = 이용허락범위 제한 없음. 출처는 API `attribution`(기상청 단기예보 · 기상청 기상특보 · 에어코리아)으로 내리고 FE 가 위험 시트에 `출처: {attribution}` 을 붙인다(BR-SA-24) | 계획 Q9=A. 공공데이터포털 15084084 · 15000415(1유형) · 15073861(3유형) · 15012690(제한 없음) |
| **LEGAL-SA-04** | **긴급재난문자는 감지 출처로 쓰지 않는다** | 공공데이터포털(15134001) 표기 이용허락범위가 공공누리 **4유형**(출처 표시 · 상업적 이용 금지 · 변경 금지)이고 API 유형 LINK(원 플랫폼 키가 따로 필요할 수 있다 — 추정) · 운영 심의다. safetydata 표기('제공기관이 공공기관이면 3유형, 민간이면 4유형')와 충돌해 어느 쪽인지 확인되지 않았다 — 영리 B2C 앱에 싣지 않는다. 재평가 §10 |
| **LEGAL-SA-05** | **약관 — 네이버** — 네이버 검색 → LLM 추출 행사(`evx-`)는 기회 카드에 보이지 않는다 — 공식(`tourapi-`)·수동 큐레이션 행사만(O-SA-12). 네이버 블로그 언급 수를 인기 신호로 쓰지 않는다(2026-09-01 약관으로 접음) | 추출 행사를 카드에 보이면 약관 노출이 넓어진다(2026 특약 2차 보도 — 원문 미확인) |
| **LEGAL-SA-06** | **야간** — 알림 단계에 조용시간을 두지 않는다(LEGAL-U6-01 승계). 스윕이 21:00~06:59 에 돌지 않고 20:58 이후 쓰기·발행이 0 이라(INV-SA-5) 위험 푸시가 밤에 나갈 길이 없다 — O-U6-4 는 이 경로에서 닫힌다. U10 `DELAY` 는 이 창에 묶이지 않는다(담당에게 알린다) | 10-18 Q4 답 · DEC-SA-1 |
| **LEGAL-SA-07** | **위치정보** — 스윕·선계산은 사용자 기기 위치를 받지 않는다. 판정 재료는 계획 슬롯의 등록 POI 좌표·목적지이고, SYSTEM 세션 기준점은 숙소 거점 → 목적지 중심 사다리다(`ReplanFacadeService.kt:173-187`). 위치 동의·법정 로그(`location_legal_log`) 대상이 늘지 않는다 | LEGAL-U4-05 승계 |

> **[개정 · 2026-10-20 — 구현 반영]** LEGAL-SA-02 ① — 사용자 결정(2026-10-19 — `functional-design/business-logic-model.md` §0.4 #2 "추천대로 진행"): 위험·주의 푸시는 **정보성 알림(광고 동의 불필요)으로 보고 진행**한다. 법무 확인 회신을 운영 전원 켜기의 선행으로 두지 않는다(고르지 않은 안 = "법무 확인 뒤 전원 켜기"). ②~④ 는 법무 확인 묶음에 그대로 남는다. 추천 근거는 LEGAL-SA-01 의 경계 그대로다 — 예약한 일정의 비·휴무·폐업 안내는 서비스 이행 정보이고, 광고성 기회 카드는 푸시 없이 앱 안에만 뜬다.

---

## 7. 켜는 순서 — 운영 출시 조건

'개발' = 개발 대상(네임스페이스 `trippilot-dev` · `dev-api`), '운영' = 출시 앱이 보는 운영 대상(네임스페이스 `trippilot`)이다(shared-infra 증분 머리). develop 머지분은 개발 대상 배포 → main 승격 → 운영 대상 배포로 이어지므로 **코드는 전부 꺼진 채(`off`·`today`·`off`) 들어간다**. 키를 시크릿에 쓰는 순서는 '두 번 배포 규칙'(tech-stack 델타 6)을 따른다. 계획 Q7=A(B 머지 즉시 켜기 · C 원격 설정 서비스는 기각). FE-A~D 는 `functional-design/frontend-components.md` §1 의 앱 변경 묶음이다(FE-A 푸시 수신·탭 · FE-B 진입 게이트·라벨·감시 행 · FE-C 기회 카드 · FE-D iOS 푸시 entitlement).

| # | 대상 | 할 일 | 확인 |
|---|---|---|---|
| 0 | 전부 | 변경 머지(기본 `off`·`today`·`off`) | 기동 로그 `[모드]` · 안내자 줄 `상황 감시 = 꺼짐` |
| 1 | 개발 | `PLANB_SITUATION_SWEEP=dry-run` 1~2일 | 요약 줄: 여행 수 · 출처별 Unknown · `detectorMs` p95 · 발화 표본(휴무 오탐 포함) |
| 2 | 개발 | `=on` | `plan_b_trigger` 행 · 알림함 행(푸시 강제 off) · 감시 상태 |
| 3 | 운영 | `=dry-run` | 1 과 같은 지표, 첫 켜기 몰림 규모 |
| 4 | 운영 | FE-A·B 스토어 반영 + `minSupportedVersion` 상향(O-SA-7) → `=on` + `ACCOUNT_IDS` = 내부 계정 → 실기기 푸시 1회 왕복(iOS 는 FE-D 뒤 — O-SA-8) → `ACCOUNT_IDS` 비움 | 허위 알림 비율(OBS-U4-02) |
| 5 | 개발 → 운영 | `PLANB_SITUATION_HORIZON=tomorrow` | 20:15 · 20:40 요약 줄 |
| 6 | 개발 → 운영 | `PLANB_PREPARED_REPLAN=on`(FE 게이트 보급 뒤 — 먼저 켜면 계산만 하고 아무도 안 본다) | 선계산 요약 OPENED · BUSY · APPLIED · REFUSED |
| 7 | 개발 → 운영 | BR-U3-28 · INV-U3-04 승인 뒤 `HORIZON=pre-trip`(O-SA-6) | D-1 알림 탭 → 비교 화면 |
| 8 | 전부 | 특보·대기질 키 등록 확인(요약 줄의 그 출처 Unknown 소멸 — 2026-10-19 10:12 실측 30, O-SA-1) → `observe-only` 에서 빼는 커밋 | 발화 표본(광역 과잉 경보) |
| 9 | 개발 → 운영 | 하위 코드·공휴일 변경 머지 · 특일 키 확인 → `HOLIDAY_CLOSURE_MODE=on` | 생성 샘플 비교 |
| 10 | 전부 | 기회: AI 기회 경로 → BE 기회 조회(차트 `http`) → FE-C 스토어 반영 | 카드 표본 · `notes` |

- **4단계의 선행**(G-SA-7): 앱 수신·탭 처리(FE-A) · iOS entitlement(FE-D — 번들 ID Push 권한 · APNs 키, 외부 선행) · 운영 `PUSH_MODE` 실값(`[모드] push=`). 그 전에는 알림함·허브 알약이 유일한 표면이다. 개발 대상은 푸시가 강제 off 라(`infra/scripts/workflow_config.py:66-69`) 실푸시 확인은 운영 카나리뿐이다.
- **`minSupportedVersion`** 은 런타임 키가 아니다 — `trippilot.bootstrap.min-supported-version`(기본 `1.0.0`, `backend/modules/profile/src/main/kotlin/com/trippilot/profile/application/BootstrapProperties.kt:12`)이라 상향은 설정 커밋 1건이다.
- **되돌리기** = 값을 `off`·`today` 로 바꾸고 재배포(RES-SA-11).

> **[개정 · 2026-10-20 — 구현 반영]** 켜는 순서의 실행 수단과 운영 범위(#1438 · 사용자 결정 2026-10-19 — `functional-design/business-logic-model.md` §0.4 · §7 개정 블록).
> - 표의 시크릿 스위치는 배포 입력 `runtime_switches`(`KEY=VALUE;…` · 허용 키 5종 · `KEY=` = 그 키 삭제 → 앱 기본값)로 쓴다. 되돌리기도 같은 입력의 `KEY=off`·`KEY=today` 또는 `KEY=` 로 배포 한 번이다(RES-SA-11 — 파드 재시작).
> - **4단계는 본인 계정 카나리 + 실기기 푸시 1회 왕복까지다.** 마지막 '`ACCOUNT_IDS` 비움'(전원)은 카나리 결과를 보고 사용자에게 다시 묻는다(BLM §0.4 #1). `PLANB_SITUATION_SWEEP_ACCOUNT_IDS=`(삭제)도 목록이 비는 것이라 전원이다.
> - 4단계의 정보성 판단은 사용자 결정으로 진행한다 — LEGAL-SA-02 개정 블록.
> - 8단계의 키는 O-SA-1 종결(`PUBLIC_DATA_API_KEY` — SEC-SA-03 개정 블록)로 통한다(2026-10-19 실측). 남은 것은 요약 줄의 그 출처 Unknown 소멸·실응답 표본 확인과 `observe-only` 에서 빼는 커밋이다.
> - 9단계(`HOLIDAY_CLOSURE_MODE=on`)의 확인 '생성 샘플 비교'는 2026-10-20 에 마쳤다(로컬 측정 — 코드 밖 사실). 실키 특일 응답 12회 p50 83ms·최대 101ms(소켓 2s 초과 0) · 공유본 60,521곳 중 휴일 규칙 1,905곳(매핑 실패 0), 원인 36종 표본 약 150건 원문 대조 오탐 0 · 같은 후보 60곳 조립 on/off(서울·제주·부산 × 설 연휴·추석 연휴·평범한 주말 3일) — 연휴는 off 가 그 날 닫힌 곳을 3~7곳 방문하고 on 은 0, 빈 날 없음, 평범한 주말은 on/off 같은 해. 개발부터 켠다.

> **[개정 · 2026-10-20 — 사용자 결정 25~31]** 단계에 더하는 조건(원문 표와 근거는 `functional-design/business-logic-model.md` §0.4 · §7 개정 블록).
> - **9단계 운영**(31번 (가)) — 개발은 10-20 부터 켜져 있다(31번 원문 — 코드 밖 사실). 개발 서버의 첫 실제 조회(10-21 07:15 장소 점검)가 경고 없이 지나면 운영도 켠다 — 마감 12-25.
> - **8단계**(26번 (라)) — 특보를 `observe-only` 에서 빼기 전에 개편 특보구역 목록 전체를 매칭 규칙과 대조한다. 도 단위 산지 이름이 실제 특보 문장에 계속 쓰이면 그때 권역 → 시군 표를 다시 본다(`functional-design/business-rules.md` BR-SA-16 개정 블록).
> - **6단계**(28번 (다)) — 개발에서 켠 뒤 낡음으로 닫히는 선계산 비율을 본다 — 눈에 띄면 2분을 계산 시작부터 잰다(DB 칸 추가 — BR-SA-19 개정 블록).
> - **구현의 마감** — 25번(한파·폭염 판정값)은 5단계 전 · 늦어도 11월 하순, 29번(재계획 화면 [다시 시도])의 앱 빌드는 6단계 전, 27번(기회 카드)·30번(요청 화면 시드 기준 — 앱 빌드)은 4단계의 '`ACCOUNT_IDS` 비움'(전원) 전.

> **[개정 · 2026-10-22 — 구현 반영]** 단계 판독 갱신(운영 준비 감사 2026-10-20 · 결정 25~30 구현 — 근거는 `functional-design/business-logic-model.md` §7 · §9 개정 블록).
> - **1·3단계** — 판독은 §4 개정 블록(같은 위험의 매시 재집계 · 양성만 싣는 표본 · 중복 제거 키). `detectorMs{place}` p95 와 장소 모름 수는 PERF-SA-02·03 을 다시 정하는 값이다(§1 개정 블록).
> - **2단계** — 개발 `=on` 전에 같은 날 판정·미판정이 섞인 장소의 감시 상태(G-SA-21)를 정한다.
> - **4단계 카나리는 한 입력으로만** — `runtime_switches` 에 `PLANB_SITUATION_SWEEP=on;PLANB_SITUATION_SWEEP_ACCOUNT_IDS=<UUID>` 를 함께 싣는다. `=on` 만 넣으면 저장된 목록이 없을 때 그 배포부터 전원이다.
> - **6단계** — 개발에서 켜기 전에 낡음으로 닫힌 선계산을 가르는 수단(G-SA-23)이 있어야 결정 28 의 다시 볼 조건을 잰다.
> - **8단계** — 개편 특보구역 목록 전체 대조는 마쳤다(`functional-design/business-rules.md` BR-SA-16 개정 블록). `observe-only` 에서 빼기 전에 t6 실응답 표본으로 G-SA-18(광역 줄의 단위)·G-SA-19(제외 줄의 하위 권역)를 정한다. §10 의 '2026 특보구역 개편 시행' 재평가는 이 대조로 한 번 돌았다 — 다음 개편이면 새 목록으로 대조 시험을 다시 돌린다.

> **[개정 · 2026-10-22 — 구현 반영]** 단계 진행과 판독 갱신(근거는 `functional-design/business-logic-model.md` §7·§9 개정 블록).
> - **2단계 — 개발 `=on`(2026-10-22 14:16 KST · 배포 런 39726251832).** 조건이던 G-SA-21 은 #1546 으로 닫혔다. 첫 `on` 회차(15:15)는 여행 5 · 사건 0 · WARN 0(코드 밖 사실). 표의 확인(`plan_b_trigger` 행 · 알림함 행 · 감시 상태)에 장소 감시 '확인 불가' 빈도를 더해 본다 — G-SA-21 결정의 대가다.
> - **6단계** — 재는 수단이 생겼다(G-SA-23 · #1573). 판독은 §4 개정 블록(OBS-SA-02).
> - **8단계** — G-SA-19 는 닫혔다(#1571). 빼기 전에 남은 것: 특보는 t6 광역 줄의 단위(G-SA-18) · 하위 권역 제외의 모름을 걸림으로 좁힐지(G-SA-24 — 사용자에게 묻는다) · 제주 시 목적지 매칭(G-SA-20), 대기질은 에어코리아 읽기 시한 실패의 빈도(TRIP-1576)를 요약 줄 `unknown` 의 `airkorea` 비율로 며칠 더 본다.
> - **9단계 운영 — 켰다**(2026-10-21 · 배포 런 39585752292 — 운영 `PLANB_SITUATION_SWEEP=dry-run` 을 쓴 같은 런 · `HOLIDAY_CLOSURE_MODE=on`). 31번 (가)의 조건인 개발 서버 첫 실제 조회(10-21 07:15 장소 점검)가 경고 없이 지났다(코드 밖 사실). #1572 가 운영에 실린 뒤로는 운영 특일 조회가 실패한 회차의 검증이 태그형 규칙 장소를 미판정으로 싣는다(RES-SA-10 개정 블록).

> **[개정 · 2026-10-22 — 구현 반영]** 8단계 갱신 — 특보를 `observe-only` 에서 빼기 전에 정할 것에서 G-SA-18 이 빠진다(실응답 표본 — t6 광역 줄은 행정 광역 · TRIP-1590 · `functional-design/business-rules.md` BR-SA-16 개정 블록). 남은 것은 G-SA-24 · G-SA-20 과 대기질의 에어코리아 모름 비율이다.

> **[개정 · 2026-10-23 — 사용자 결정]** 8단계 갱신 — 특보 쪽 정본 결정은 남지 않는다(G-SA-24 · G-SA-20 해소 — `functional-design/business-logic-model.md` §0.4 · §9 개정 블록). 남은 것은 대기질의 에어코리아 모름 비율과 `observe-only` 에서 빼는 커밋이다.

> **[개정 · 2026-10-23 — 사용자 지시]** 4~8단계를 지시 하나로 진행한다(`functional-design/business-logic-model.md` §0.4 2026-10-23 사용자 지시 블록).
> - 4단계 '`ACCOUNT_IDS` 비움'(전원) · 6단계(운영 선계산) · 7단계(`pre-trip`) · 8단계(특보·대기질 관찰 전용 해제)를 이번에 한다. 5단계는 7단계에 든다(`pre-trip` 이 진행 중 여행의 내일도 본다).
> - 카나리·실기기 푸시 1회 왕복은 건너뛴다 — 대신 운영 첫 `on` 회차의 요약 줄 · WARN · 트리거 · 알림 · 선계산 줄을 바로 판독한다(OBS-SA-02).
> - 4단계 선행 중 FE-A·B·C 스토어 반영과 iOS 푸시(FE-D — 번들 ID Push 권한 · APNs 키)는 남는다. 그 전에는 옛 앱이 OS 알림·알림함만 받고 탭 라우팅이 없다. `minSupportedVersion` 상향도 새 빌드 뒤로 미룬다(O-SA-7).

## 8. PBT (blocking · 확장 Partial 모드)

`functional-design/business-rules.md` 의 **PBT-SA-01~22**(전부 blocking)를 그대로 승계한다. NFR 성질이 큰 것은 PBT-SA-04(푸시 상한 · 회차당 사건 ≤ 1) · 07(밤 창 경계) · 17(선계산 구독자 멱등 · 상한 · BUSY 는 세션 0) · 18(같은 여행 10분 1회)이다 — 실행 패턴의 실패 모드를 이 넷과 스윕 단위 테스트가 보므로 NFR Design 을 두지 않는다(계획 Q10=A). 확장 규칙과의 대응:

| 확장 규칙 | 해당 PBT | NFR 관점 추가 |
|---|---|---|
| PBT-02 왕복 | **해당 행 없음** | 이 확장이 새로 만드는 직렬화 쌍 3종은 왕복 속성이 필요하다 — ① 이벤트 payload(`planb.PlanBTriggered` 새 선택 필드 7종 · `recalculation.ItineraryRecalculated` 의 `triggerId`·`targetDate`) JSON 왕복, 옛 6필드 payload 는 새 필드 null 로 읽힌다(손실 방향 문서화) ② `GridForecast` ↔ jsonb(`hourly`·`daily`) 왕복, 수 타입은 읽을 때 수로 정규화(허용 편차 문서화) ③ AI 기회 요청·응답 스키마 왕복(hypothesis). 예시 통합 테스트(격자 jsonb 왕복 · 옛 6필드 사건 회귀)를 생성 입력으로 일반화한다. 번호는 정본 승인 때 PBT-SA 표 끝에 잇는다 |
| PBT-03 불변식 | 01~16 · 18~22 | — |
| PBT-04 멱등(권장) | 01(회차를 거듭해도 대상·심각도별 사건 ≤ 1) · 17(같은 봉투 N회 → SYSTEM 세션 1개) | 이 확장의 본체(매시 재판정 · at-least-once)라 blocking 표 안에 있다 |
| PBT-07 생성기 품질 | 전부 | 생성기가 반드시 포함할 경계: KST 20:58·20:59·21:00·06:59·07:00(07) · 월말·연말 '내일'(22) · 발화·해제 임계 양쪽(POP 50·60 · WSD 12·14 · TMP 31·33·35 · −10·−12 — 09~11) · 판정 시각 값 결측(09) · 숫자·시각 꼴 장소명(`365분식` · `4시30분왕족발` · `40시간`)·따옴표·줄바꿈·초장문(08) · 여러 회차 관측열 × 인메모리 행(01~05) · prepare·start 임의 순서(14) · 임의 payload·임의 AI 응답(17·20). 도메인 생성기(계획 슬롯 · 관측 · 트리거 행)는 모듈 테스트 공용으로 둔다 |
| PBT-08 재현 | 상속 | — |
| PBT-09 프레임워크 | Kotest property(BE) · hypothesis(AI) · fast-check(FE) — 상속 | — |

**PBT·CI 사각**: 실푸시 도달 · 콜드/웜 탭 · 포그라운드 배너 · 실 기상청·에어코리아·특일 응답 형식 · 지연·오탐 실측은 실기·운영 확인(콜드·웜 탭 → 올바른 화면 · 운영 카나리 실푸시 1회 왕복 · 개발·운영 dry-run 요약 줄 · `LIVE_KMA=1` 격자 왕복 · 키 등록 뒤 실응답 표본 수집)이 유일한 그물이다. CI 외부 호출은 0이고 대역은 실물처럼 예외로 실패한다.

> **[개정 · 2026-10-22 — 구현 반영]** §8 — PBT-02 행의 ② `GridForecast` ↔ jsonb 왕복은 `hourly` 만이다 — `daily` 칸은 매핑하지 않는다(`functional-design/domain-entities.md` §8.1 개정 블록). PBT-07 생성기 품질에 하나를 더한다 — 성질의 전제(행사만으로 3장 · 그 날 위험 행)를 생성기가 거의 만들지 못하면 성질이 공허하게 통과한다: PBT-SA-19 는 붐비는 장면을, PBT-SA-20 은 셋에 둘 꼴로 그 날 위험 행을 일부러 싣는다(역검증으로 확인 — `functional-design/business-rules.md` §10 개정 블록).

## 9. 확장 기준선 대응

| 규칙 | 대응 |
|---|---|
| SECURITY-03 로깅 | OBS-SA-01·03 · SEC-SA-05 — 구조화 1줄 · 좌표·계정 id 없음 · 운영 원천 CloudWatch |
| SECURITY-05 입력 검증 | SEC-SA-06 |
| SECURITY-08 접근 제어 | SEC-SA-02 · SEC-SA-07 |
| SECURITY-12 자격 증명 | SEC-SA-03 |
| SECURITY-15 fail-safe | SEC-SA-08 · RES-SA-01 · RES-SA-05 |
| RESILIENCY-01 중요도 | RES-SA-12 — 강등 허용 |
| RESILIENCY-04 배포·롤백 | RES-SA-11 · RES-SA-13 · §7 — 코드 롤백은 shared-infra §12 Q6=B |
| RESILIENCY-05 감시·알림 | OBS-SA-07 — 새 알람 없음, 침묵은 사용자 표면의 '확인 불가'로 드러난다 |
| RESILIENCY-10 의존 격리 | 시한(PERF-SA-04·08 · RES-SA-10) · 회로 차단(RES-SA-04) · 격벽(전용 실행기 PERF-SA-06 · 스케줄러 풀 PERF-SA-05) · 강등(RES-SA-08·09·12) |
| 그 밖 | 해당 없음 — 새 AWS 자원 0(shared-infra 증분 SA.1) |

## 10. 재평가 트리거

| 트리거 | 조치 |
|---|---|
| 장소 회차에 `skipped > 0` 반복 · `detectorMs{place}` p95 가 예산을 위협(PERF-SA-03) | AI CPU 여유 확인 뒤 병렬 상향 · 장소 회차 재배치 |
| 단기예보 격자 경로가 파드 상한 3,000 에 근접(진행 중 약 500여행) | 운영계정 증설(활용사례 등록·심의) |
| 선계산 BUSY 비율이 높거나 초안 적용률이 낮게 실측(OBS-SA-02) | 'AI 호출 트랜잭션 밖' 후속 뒤 실행기 확대 · 또는 선계산 끄기 |
| 허위 알림 비율(OBS-U4-02)이 높게 실측 | 발화·해제 임계(BR-SA-15) · 심각도 재조정 |
| 넓혀 읽은 휴무 오탐이 dry-run 표본에 보임 | O-SA-13 강등 결정 |
| 특보 광역 과잉 경보가 표본에 보임 · 2026 특보구역 개편(→235구역) 시행 | `observe-only` 유지 · 목적지 매칭 규칙 개정 · t6 실응답 표본 재수집 |
| 밤사이 '확인 불가' 표시가 문의·이탈로 이어짐(PERF-SA-09) | 신선도 창을 밤 회차 공백 기준으로 재산정 |
| 스케줄러 풀 4 에서 다른 잡의 지연 관측 | 풀 재산정 — 리마인드 문구 세션과 함께 |
| 기회 알림(푸시·알림함) 요구 | LEGAL-U6-02·03 재검토(광고성 동의 경로) — U6 §10 과 같은 축 |
| 긴급재난문자 라이선스가 3유형 이하로 확인 | 감지 출처 추가 검토(LEGAL-SA-04) |
| 법무 확인 묶음 회신(LEGAL-SA-02) | 출처 표기 범위 · 정보성 판단 반영 |
| EKS 에 OTLP 수집기 개통 | 요약 줄에 더해 카운터 도입 검토 |

## 11. 상속 NFR 과의 대응

원 문서에는 새 규칙 본문을 쓰지 않고 `[개정 · 2026-10-19 · situation-awareness FD]` 블록으로 이 문서를 가리키기만 한다(블록 목록은 `functional-design/business-logic-model.md` §8 의 'U4 NFR' 표와 U6 `nfr-requirements.md` 행). 그 블록이 가리키는 상속 ID 와 이 문서의 대응:

| 원 문서 · 대상 | 이 문서 |
|---|---|
| U4 `nfr-requirements.md` PERF-U4-01(이벤트 기반 · 주기 폴링 없음) | DEC-SA-1 · PERF-SA-01·05 |
| 〃 COST-U4-03(당일 격자만) | COST-SA-01~06 |
| 〃 OBS-U4-01~05(OTLP 지표 이름) | OBS-SA-01~07 |
| 〃 §8 PBT | §8(PBT-SA-01~22) |
| 〃 신설 COST(선계산) | COST-SA-07 · PERF-SA-06 |
| U4 `tech-stack-decisions.md` 델타 5(스케줄러는 정리 작업에만) | tech-stack 델타 1·2 |
| U4 `nfr-design-patterns.md` P-PERF-U4-1(TTL = 다음 발표) | tech-stack 델타 3(만료 = 발표 + 3시간 + 10분) |
| 〃 P-PERF-U4-2(평가 요청 자연 상한) | PERF-SA-01(회차 수가 상한) |
| 〃 P-RES-U4-1(서킷 미도입 · 재시도 없음) | RES-SA-03·04(03 재요청 · 회차 범위 회로 차단 — 라이브러리 미도입은 유지) |
| 〃 §8(서버 스케줄러 선제 평가 · 커넥션 풀 상향) | tech-stack 델타 1·4 · §3(선계산 실행기 확대·DB 풀 상향 보류) |
| U4 `logical-components.md` LC-U4-1 · 3 · 9 | DEC-SA-2(LC-U4-1) · tech-stack 델타 3·5(LC-U4-3) · DEC-SA-1(LC-U4-9) |
| U6 `nfr-requirements.md` LEGAL-U6-02·03 | LEGAL-SA-01 |
| 〃 OBS-U6-03 | OBS-SA-05 |
| 〃 §10 재평가 트리거 | §10 '기회 알림 요구' |
