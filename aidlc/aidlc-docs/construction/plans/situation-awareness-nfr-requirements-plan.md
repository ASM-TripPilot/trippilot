# Plan-B 상황 자가 인지(situation-awareness) — NFR Requirements Plan

> **선행**: situation-awareness Functional Design — 산출물 4종 `situation-awareness/functional-design/` · 계획 `situation-awareness-functional-design-plan.md`(Q1~Q19). FD 와 같은 정본 PR 에 함께 올리고, 승인 게이트는 FD 다음 차례로 받는다
> **방침**: **얇게**(U0·U1·U4·U6·U10 상속분과 FD 규칙 재서술 금지) + **실장 우선**(리포 실물을 먼저 확인하고 정한다 — U3·U4·U6·U10 선례)
> **이 스테이지를 도는 이유**: U4 NFR 은 "감지 = 사용자 요청에 응답"(DEC-U4-6)을 전제로 성능·비용·관측을 정했다 — PERF-U4-01(이벤트 기반 평가·폴링 없음) · COST-U4-03(당일 격자만) · tech-stack 델타 5(스케줄러는 정리 작업에만). DEC-SA-1(서버 감시 스윕)이 그 전제를 바꿔 U4·U6·U10 어디에도 없던 축이 생긴다 — **서버 회차 실행**(단일 실행·시간 예산·밤 창·스케줄러 풀) · **외부 호출 예산**(기상청 단기예보·특보·에어코리아·특일 — 키·한도를 AI 와 나눈다) · **선계산 자원**(LLM 비용·DB 커넥션 점유) · **운영 관측**(OTLP 꺼짐) · **켜기·되돌리기**(관찰 전용·카나리·두 번 배포) · **법무 경계**(정보성·광고성·공공누리) · **구 앱 호환**(OTA 없음)
> **작성**: 2026-10-19 · 실측 기준 `origin/develop` `f52f58cf7`

---

## Step 1 결과 — 실측 (2026-10-19 · `origin/develop` `f52f58cf7`)

경로 표기는 FD 계획 §2 와 같다(`<모듈>/…/`).

| 자산 | 실측 | SA NFR 함의 |
|---|---|---|
| `@Scheduled` + ShedLock 6.10.0 | 있음 — `app/…/config/AsyncConfig.kt:30` · `ShedLockConfig.kt:20`(기본 lockAtMostFor PT5M) · `backend/gradle/libs.versions.toml:5·37-38` · 락 선례 `app/…/event/OutboxRelay.kt:95` | 신규 인프라 0 — 락 이름 `planb-situation-scan` 하나를 더한다. U10 `DELAY` 락 `planb-delay-scan`(U10 `nfr-design/logical-components.md:134`)과 이름·설정을 나눈다 |
| 스케줄러 스레드 풀 | 설정 없음 — `application.yml` 에 `spring.task.scheduling` 없음 → Boot 기본 1스레드 | 기존 `@Scheduled`(아웃박스 릴레이 2s · 리마인드 폴러 · 재시도 폴러 · 여행 종료 · 위치 구간 스위퍼 등)가 한 스레드를 나눈다. 긴 회차가 알림 적재를 민다(Q2) |
| `@Async` 실행기 | 있음 — core 8 · max 16 · queue 32 · 포화 시 호출 스레드가 직접 실행(`AsyncConfig.kt:43-60·73-75`) | 선계산을 여기 태우면 포화 때 릴레이 스레드가 AI 25s 를 기다린다(Q3) |
| 재계획 산출의 트랜잭션 | readOnly 트랜잭션 안에서 AI `replan` 호출, 시한 25s(`itinerary-generation/…/application/ReplanFacadeService.kt:71-85·302`) · Hikari 설정 없음(기본 10) | 산출 1건 = DB 커넥션 최대 25s 점유(Q3) |
| 기상청 어댑터 | 호출 1건 계약 · 재시도·서킷 없음(`weather-context/…/KmaWeatherAdapter.kt` 클래스 주석 · P-RES-U4-1) · connect 3s·read 5s(`KmaWeatherConfiguration.kt:31-33`) · `trippilot.weather.mode=kma` 일 때만 실 빈(`:41`) | 회차 단위 호출이 생긴다 → 격자 캐시 · 격자 경로 상한 · 회차 안 실패 메모(Q4) |
| 공공데이터포털 특보·대기질·특일 | 어댑터 없음 · 2026-10-19 10:12 실측: 같은 `WEATHER_API` 키로 세 API 가 returnReasonCode 30, 단기예보는 정상 | 키 등록 전에도 안전하게 돌아야 한다 — 출처별 '모름'(Q5 · O-SA-1) |
| 운영 관측 | EKS 에서 OTel SDK·exporter 꺼짐(`deploy/eks/chart/templates/backend.yaml:96-98` · `shared-infrastructure.md` §4.6 · G-05) | 새 Micrometer 지표는 운영에서 셀 수 없다 → 회차 요약 로그 1줄(Q6) |
| 배포 허용목록 | 허용목록 밖 시크릿 키 → 배포 거부(`deploy/eks/runtime_secrets.py:203-207`) · 차트 시크릿 env 는 한 줄 목록(`backend.yaml:102`) | 키는 허용목록이 그 대상에 배포된 뒤에만 시크릿에 쓴다(두 번 배포) · 키 배선을 한 PR 에 모은다(Q7) |
| 개발 대상 푸시 | 강제 off(`infra/scripts/workflow_config.py:66-69`) | 실기기 푸시 왕복은 운영 카나리에서만 확인된다(Q7) |
| 클라이언트 배포 | OTA 없음(`frontend/package.json` 에 `expo-updates` 없음) · 서버 `trippilot.bootstrap.minSupportedVersion` 있음(`profile/…/application/BootstrapProperties.kt:12`) | 구 앱은 새 라벨·게이트를 받지 못한다 → 계약은 추가형만(Q8), 운영 켜기 전 상향(O-SA-7) |
| iOS 푸시 | 빌드가 `aps-environment` 를 지운다(`frontend/app.config.ts:223-245`) · 앱에 수신·탭 리스너 0 | 위험 푸시의 기기 도달 선결(G-SA-7 · O-SA-8) |
| 알림 경로 | PLAN_B 푸시 기본 OFF(`notification/…/domain/NotificationToggle.kt:35-42`) · 억제 사유 `DUPLICATE`·`IN_APP_OFF`·`RATE_LIMITED`(`application/NotificationMetrics.kt:129-141`) · `dedup_key` 는 저장만 | 10분 1회·인앱 전용은 억제 사유 2종을 더해 센다(OBS-U6-03 확장 · G-SA-2) |
| 하루 상한 값 | 3벌 — 코드 LOW 2·NORMAL 5·HIGH 10(`planb-detection/…/domain/PlanBTrigger.kt:112-114`) · U4 `nfr-design/nfr-design-patterns.md:38` 1·3·6 · ai-architecture §6.2 시간당 2·하루 8 | O-SA-9 로 하나로(G-SA-3) |

**전제(질문 아님)** — 이견 있으면 알려 주세요:
- FD 계획에서 정한 값은 다시 묻지 않는다 — 키 계정 O-SA-1 · 폭염 단계 O-SA-2 · `minSupportedVersion` O-SA-7 · iOS 출발 O-SA-8 · 푸시 하루 상한 O-SA-9 · 선계산 상한 O-SA-10 · 토글 행 O-SA-14
- **상속(재서술 안 함)**: 부하·가용성 기반선(U0·U1) · 재시도 없음·서킷 라이브러리 미도입(P-RES-U4-1) · 침묵 실패 금지 사슬(INV-4) · Redis 미도입(U4 tech-stack 델타 4) · security-baseline·객체 수준 인가(타 계정 404) · PBT blocking 게이트
- 일정 쓰기는 사용자 [적용]뿐이다(INV-SA-1) — 성능·비용을 위해 자동 반영하는 선택지는 두지 않는다

---

## 실행 계획

- [x] 1. FD 4종 + FD 계획 답(Q1~Q19 · O-SA-1~15) + 상속 NFR(U4 NFR Requirements·NFR Design 각 2종 · U6 NFR 2종 · U10 NFR 2종 · `shared-infrastructure.md`) 정독 · 리포 실측(위 표)
- [x] 2. **질문 Q1~Q10 작성 · 답** — 2026-10-19 사용자 지시("하던거 마저해")로 설계 초안 기본값 채택(정본 승인 때 확인)
- [x] 3. 답 모호성 검토 — 기본값 일괄 채택이라 모호한 답 없음, 명확화 파일 불필요. 키 계정(O-SA-1)만 사용자 확인 중 — 관찰 전용 출발이라 진행을 막지 않는다
- [x] 4. `nfr-requirements.md` — 새 축(서버 회차 실행 · 외부 호출 예산 · 선계산 자원 · 운영 관측 · 켜기·되돌리기 · 법무 경계 · 구 앱 호환) + 상속 명시 + PBT 매핑(PBT-SA-01~22 중 NFR 성질: PBT-SA-04 푸시 상한·회차당 사건 · PBT-SA-07 밤 창 경계 · PBT-SA-17 선계산 구독자·상한 · PBT-SA-18 10분 1회) + 재평가 트리거
- [x] 5. `tech-stack-decisions.md` — 상속 / **SA 델타**(ShedLock 을 쓰는 모듈 확장 · 스케줄러 풀 · 격자 예보 테이블 · 공공데이터 어댑터 2종(특보·대기질)과 AI 특일 포트 · 선계산 전용 실행기 · 마이그레이션 3 · 스위치) / 미도입 결정(새 Micrometer 지표 · Redis · 서킷 라이브러리 · 새 `NotificationKind` · 원격 설정 · Hikari 상향) / 개발 중 처리(키 등록 확인 · 실응답 표본 · dry-run 실측)
- [x] 6. 정합 검증 — U4 NFR · U6 NFR · U10 NFR · `shared-infrastructure.md` 와 충돌 없는지(아래 「정합 검증」)
- [x] 7. NFR Design 진행 여부 권고 작성(아래 「NFR Design 권고」)
- [x] 8. 완료 메시지(표준 2-option) → **사용자 승인 게이트**(FD 다음) → `audit.md`·`aidlc-state.md` 기록 — 승인 2026-10-19(FD 와 같은 지시), NFR Design SKIP·Infra 증분 함께 기록

---

## 질문 (`Q1=A Q2=B …` 한 줄로 고쳐도 됩니다)

### A. 회차 실행 · 자원

#### Q1. 감시 스윕의 단일 실행 · 동시성 · 시간 예산 ★ (DEC-SA-1 · BR-SA-01·03 · INV-SA-5)

회차는 cron(매시 :15 07~20 + 20:40 보충, KST)이라 두 파드가 같은 순간 깬다. 장소 감지의 validate 는 실측 20.1s(2026-08-21, 시한 미집행)·소켓 상한 62s 다 — 순차로 돌면 20:15 회차가 21시를 넘겨 발행할 수 있고(밤 창 위반), 예산에서 끊긴 뒤 첫 페이지부터 다시 돌면 꼬리 여행이 영영 평가되지 않는다.

A) ShedLock `planb-situation-scan`(lockAtMostFor PT25M · lockAtLeastFor PT5M) + 여행 단위 병렬 2 + 회차 예산 20분(여행마다 확인, 못 본 여행 수는 요약 로그) + 회차 시작 위치 무작위 회전(상태 저장 없음) + 20:58 이후 쓰기·발행 0 + 종료 신호를 받으면 여행 사이에서 멈추고 정상 반환(락 해제 — 배포로 끊긴 20:15 회차를 20:40 보충이 잇는다)

B) 순차 실행 + 마지막 위치(커서)를 DB 에 남겨 다음 회차가 잇는다

C) 큐·워커로 여행마다 작업 1건씩 펼친다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: lockAtLeastFor PT5M 은 두 파드가 같은 회차에 깨어 먼저 끝난 쪽 뒤에 다른 파드가 같은 회차를 다시 도는 것을 막고, lockAtMostFor PT25M 은 죽은 파드의 락이 20:40 보충을 막지 않게 한다. 무작위 시작 위치는 상태 없이 공정성을 준다 — B 는 커서 행과 그 경합을 새로 만든다. C 는 신규 인프라다(U4 델타 5 · U6 DATA-U6-05 '스케줄링 신규 인프라 0'). 병렬도·예산은 발명값이라 dry-run 요약 줄의 출처별 `detectorMs` p95 로 조정한다(값 조정은 규칙 개정이 아니다).

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q2. 스케줄러 스레드 풀

A) `spring.task.scheduling.pool.size: 4` — 플래그와 무관하게 머지 즉시 운영에 반영되므로, 리마인드 담당 쪽에 폴러·재시도 폴러 타이밍 변화를 알린다

B) 스윕 전용 `TaskScheduler` 빈을 따로 두고 전역 풀은 1 로 둔다

C) 1 로 두고 스윕을 짧게 만든다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 기존 잡은 다중 파드 동시 실행에 견디도록 짜였다(ShedLock 또는 조건부 쓰기 — 예: `archive/…/application/LocationAutomationService.kt` 스위퍼 주석). 한 파드 안에서 둘이 동시에 도는 것도 같은 성질로 견딘다. B 는 스케줄러가 둘이 되어 어느 `@Scheduled` 가 어디에 붙는지 읽기 어렵다. C 는 validate 지연이 외부 요인이라 성립하지 않는다.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q3. 선계산 실행 자원 — LLM 비용 · DB 커넥션 (DEC-SA-4 · BR-SA-18 · INV-SA-6)

선계산 1건 = 재계획 1회(AI 최대 25s, readOnly 트랜잭션 안). 지역 날씨 한 번에 여러 여행이 동시에 위험해질 수 있다.

A) 전용 실행기 1스레드 + 세마포어(실행 1 · 대기 10)를 얻은 뒤에만 세션을 연다 — 못 얻으면 세션 없이 BUSY(상한·트리거당 1회를 쓰지 않는다) · 이벤트 나이 30분 초과는 무시 · `@PreDestroy` 대기 · SOLVING 이 아닌 세션은 AI 를 부르지 않는다(대체된 세션의 비용 0)

B) 공용 `@Async` 실행기에 태운다

C) 실행기 N + Hikari 최대치 상향

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 1스레드면 선계산의 커넥션 점유가 최대 1개라 사용자 재계획·생성과 Hikari(기본 10)를 다투지 않는다. BUSY 여도 사용자가 알림을 탭하면 i04 실시간 계산으로 떨어지므로 기능 손실이 없다(BR-SA-23). B 는 포화 때 아웃박스 릴레이 스레드가 AI 를 기다린다. C 는 RDS 연결 여유를 확인하지 못했다 — 늘리려면 재계획 산출의 AI 호출을 트랜잭션 밖으로 빼는 일이 먼저다(후속). 상한 값은 O-SA-10.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

### B. 외부 호출

#### Q4. 기상청 단기예보 호출 예산 · 캐시 (BR-SA-15 · COST-U4-03 개정)

회차마다 진행 중 여행의 오늘 격자를, 저녁 회차는 내일 격자까지 본다. 키·일일 한도를 AI 와 나눈다(개발계정 10,000/일). 추정: 단기예보 ≈ 15회차 × 진행 중 여행 × 격자 공유 계수(여행 200 → 하루 약 1,800).

A) 격자당 1행 읽기-통과 DB 캐시(오늘·내일의 POP·PTY·SKY·TMP·WSD·TMN·TMX · 만료 = 발표 + 3h + 10분 · 정상 코드 00 만 저장 · HTTP 는 트랜잭션 밖 · 받은 값도 신선해야 쓴다) + **격자 경로만 세는** 파드당 하루 상한 3,000(이름 경로·도우미 날씨 카드는 세지 않는다) + 03 NO_DATA 즉시 ≤ 2회 재요청(격자 경로만) + 회차 안 실패 격자 메모(같은 격자 재호출 안 함) + 같은 출처 연속 3회 실패 시 남은 여행은 그 출처 '모름'(회로 차단 — BR-SA-03) · 약 500여행부터 운영계정 증설

B) 기존 `weather_snapshot`(강수확률 한 칸)을 넓힌다

C) Redis 캐시

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 격자를 공유하므로 호출은 여행 수가 아니라 격자 수에 비례한다(P-PERF-U4-1 — 캐시 키를 발표 주기에 맞춘다). +10분은 발표 지연 여유다. 상한을 격자 경로에만 두는 이유는 스윕이 한도를 먹어 도우미 날씨 카드까지 죽이지 않게 하려는 것이다. 03 재요청은 '재시도 없음' 기반선의 유일한 예외다 — 장애가 아니라 '발표 데이터 미준비' 응답이라서. B 는 시간별·날짜별 값을 담을 칸이 없고, C 는 U4 델타 4(Redis 미도입 유지)를 뒤집는다.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q5. 공공데이터포털 오류의 해석 — 특보 · 대기질 · 특일 (BR-SA-06·16·17 · INV-SA-2 · O-SA-1)

JSON 을 요청해도 오류는 **XML 본문**으로 올 수 있다(`cmmMsgHeader.returnReasonCode`). 오류를 '형식 깨짐'으로 읽으면 하루 종일 날씨 해제가 막힌다.

A) HTTP 401/403 · returnReasonCode 20·22·30·31·32 = 게이트웨이 오류 → **그 출처만** '모름'(캐시하지 않음 · 원인 코드와 함께 파드에서 상태가 바뀔 때 WARN 1번 · 다음 회차에 다시 시도) · 해제는 출처별(한 출처의 모름이 다른 출처의 해제를 막지 않는다) · 특보·대기질은 관찰 전용으로 출발, 등록이 확인되면 목록에서 빼는 커밋이 '켜기' · 특보 회차당 1콜(파드 메모리 20분) · 에어코리아 예보 발표 단위 캐시(하루 ≤ 8콜) · 특일은 **성공한 달만** 캐시

B) 키 오류면 기동을 실패시킨다(설정 오류로 본다)

C) 키가 통할 때까지 감지기 코드를 배포하지 않는다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: A 는 키 상태와 무관하게 안전하다(INV-SA-2 — 모름은 발화도 해제도 아니다). B 는 포털 쪽 등록 지연 하나로 백엔드 전체가 뜨지 않는다. C 는 키 확인(O-SA-1) 뒤 다시 배포해야 하고 실응답 표본 수집을 늦춘다. 특일을 성공한 달만 캐시하는 이유는 달력을 못 읽은 회차의 '평일'이 진짜 휴무를 지우지 않게 하려는 것이다(BR-SA-17 — `HOLIDAY` 는 감지기가 해제하지 않는다).

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

### C. 관측

#### Q6. 관측 수단 — 운영 OTLP 꺼짐 (OBS-U4-01~05 · OBS-U6-03)

A) 회차마다 구조화 INFO 1줄 `planb.situation_sweep`(mode · phase · trips · skipped · failed · 출처별 live·off·observe · 출처별 unknown · announced · pushed · quiet · expired · elapsedMs · 출처별 detectorMs p50/p95) + 선계산 요약 `replan.prepared outcome=` + 알림 억제 사유 2종(`IN_APP_ONLY`·`COALESCED`)을 기존 억제 지표에 더한다 · 새 Micrometer 지표·회차 이력 테이블은 두지 않는다

B) Micrometer 카운터·타이머를 새로 둔다

C) 회차 이력 테이블을 둔다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 운영에서 읽을 수 있는 것은 컨테이너 로그뿐이다(shared-infrastructure G-05). 한 줄에 회차 전체가 있어야 켜기 단계마다 같은 질의로 비교할 수 있다 — 출처별 Unknown 이 사라지는 것이 특보·대기질 '켜기'의 판정 근거다(O-SA-1). C 는 감시 상태(BR-SA-13)와 겹치는 시계열을 하나 더 만든다. 감시 상태의 신선도 창(날씨 2시간 · 장소 14시간)은 발명값이라 관측으로 조정한다.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

### D. 켜기 · 호환

#### Q7. 켜는 순서 · 카나리 · 되돌리기 ★ (DEC-SA-8 · BR-SA-04)

머지된 코드는 개발을 거쳐 운영까지 승격된다 — 그래서 코드는 전부 꺼진 채 들어간다.

A) 기본값(스윕 off · 지평 today · 선계산 off · 공휴일 off)으로 머지 → ① 개발 `dry-run` 1~2일(요약 줄: 여행 수 · 출처별 Unknown · `detectorMs` p95 · 발화 표본, 휴무 오탐 포함) → ② 개발 `on` → ③ 운영 `dry-run`(첫 켜기 몰림 규모) → ④ FE 보급·`minSupportedVersion` 상향 뒤 운영 `on` + 계정 허용목록(내부 계정) → 실기기 푸시 1회 왕복 → 허용목록 비움 → ⑤ 지평 `tomorrow` → ⑥ 선계산 `on`(FE 게이트 보급 뒤) → ⑦ U3 개정 승인 뒤 지평 `pre-trip` → ⑧ 특보·대기질 키 확인 → 관찰 전용 해제 → ⑨ 공휴일 규칙 `on` → ⑩ 기회 카드. 되돌리기 = 값을 off·today 로 바꾸고 재배포 — 스윕을 끄면 트리거 목록 조회가 스윕 출처 트리거를 즉시 숨긴다(일괄 만료 명령은 두지 않는다). 키 배선은 한 PR 에 모으고, 허용목록이 그 대상에 배포된 뒤에만 시크릿에 키를 쓴다(두 번 배포)

B) 머지 즉시 켠다(스위치 없음)

C) 원격 설정 서비스로 끄고 켠다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 발화 품질(넓혀 읽은 휴무 오탐 — O-SA-13)과 지연(validate)은 실데이터에서만 보인다 — dry-run 은 쓰기 0 으로 그것을 잰다. 개발은 푸시를 강제 off 로 두므로 실푸시는 운영 카나리에서만 확인된다. 먼저 켜면 계산만 하고 아무도 안 보는 단계(선계산 — 게이트 보급 전)와 막다른 길(D-1 — U3 개정 전)을 순서로 막는다. 허용목록보다 시크릿을 먼저 쓰면 배포 전체가 거부된다. C 는 SaaS·신규 의존이다.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q8. 계약 변경의 호환 범위 — 구 앱 · 옛 행 · 롤링 배포

A) **추가형만** — openapi 새 필드는 required 밖(FE 계약 가드·옛 픽스처 보호) · 이벤트 payload 새 필드는 기본값 null(옛 행·옛 구독자 호환, JSON 트리로 읽는다) · 마이그레이션 3건은 상수 기본값 확장형(롤링 창의 옛 파드에 무해, 번호는 머지 직전 `origin/develop` 최댓값 + 1) · 새 상태값·`TriggerKind`·`NotificationKind` 없음 · 저장값이 enum 밖이면 응답은 null 이고 FE 는 kind 라벨

B) 버전 경로(`/v2`)를 새로 연다

C) 강제 업데이트로 한 번에 바꾼다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: OTA 가 없어 구 앱이 오래 남는다. 새 `NotificationKind` 하나로 구 앱 알림함이 죽는다(`NotificationInboxPage.tsx:35` — 모르는 kind 구조분해). 확장형 마이그레이션은 배포 순서와 무관하다. B 는 경로 두 벌을 유지해야 하고, C 는 스토어 심사 일정에 묶인다.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

### E. 법무

#### Q9. 알림·카드의 법적 성격과 출처 표기 (DEC-SA-5·6 · BR-SA-24 · LEGAL-U6-01~03)

A) 위험·주의 = 정보성(서비스 이행에 관한 안내 — 추정)으로 기존 PLAN_B 경로 · 기회(행사·인기) = 알림 경로 밖(앱 안 카드만 — 알림함·푸시 없음) · 위험·주의 문구에 일정 밖 장소·행사 권유를 섞지 않는다 · 기상청·에어코리아 출처 표기(공공누리 1·3유형, 등급 문자열 변경 금지) · 판단은 추정이라 법무 확인 묶음에 올린다(KISA 안내서 2017.11 판 — 판본 재확인)

B) 기회도 마케팅 수신 동의자에게 푸시한다

C) 기회 카드도 두지 않는다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 영리 사업자가 고객에게 보내는 정보는 원칙적으로 광고성이고, 부수적으로 섞여도 전체가 광고성이 된다(정보통신망법 제50조 ①③ · KISA 안내서 p.12~13). 기회를 알림에 실으면 LEGAL-U6-02 가 무너지고, 그것을 조건으로 한 LEGAL-U6-01(야간 조용시간 없음)도 무너진다(LEGAL-U6-03). B 는 마케팅 경로·동의 확인·야간 규칙을 새로 깐다. C 는 사용자 요청(지역 행사·인기 장소 — FD 계획 Q2)을 버린다.

[Answer]: 추천안: A — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

### F. 다음 스테이지

#### Q10. NFR Design 을 돌리나

A) **SKIP**(U3·U5·U6·U8 선례) — Infra 는 `shared-infrastructure.md` 증분 절(신규 AWS 자원 0)

B) 얇게 진행 — 스윕 실행 패턴 한 주제

C) 전면 진행(패턴 카탈로그 전체)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 아래 「NFR Design 권고」.

[Answer]: 추천안: A(SKIP) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

---

## 정합 검증 (Step 6)

| 대상 | 결과 |
|---|---|
| U4 PERF-U4-01(포그라운드 평가는 이벤트 기반 — 폴링 없음) | **유지** — 클라 폴링을 두지 않는다(FE 주기 재조회 없음 — 포그라운드 복귀·푸시 수신 때 무효화만). 주기는 서버 스윕이 갖는다 — PERF-U4-01 개정 블록이 이 문서를 가리킨다 |
| U4 COST-U4-03(당일 격자만) | **개정** — 저녁 회차는 내일 격자도 본다(지평 `tomorrow`·`pre-trip`). 새 천장은 격자 경로 파드 상한(Q4) |
| U4 tech-stack 델타 5 · DEC-U4-6 | **인프라 유지·전제 변경** — `@Scheduled` + ShedLock 재사용으로 신규 인프라 0. "평가는 클라 요청에 응답한다"는 전제만 DEC-SA-1 로 바뀐다 |
| U4 P-RES-U4-1(서킷 미도입 · 타임아웃 + 실패율) | **정합** — 서킷 라이브러리를 들이지 않는다. 회차 안 출처별 연속 실패 3회 차단은 회차 수명의 메모다 |
| U4 P-PERF-U4-1(캐시 키 = 발표 주기) | **정합** — 격자 캐시 만료 = 발표 + 3h + 10분 |
| U4 OBS-U4-01~05 | **정합** — 무발화 사유·허위 알림 근거를 회차 요약 줄로 낸다(운영 OTLP 꺼짐) |
| U4 LC-U4-1·3·9 | **개정** — LC-U4-1(판정 순수 함수)에 생명주기·결정표가 더해지고, LC-U4-3(`WeatherPort`)에 격자 예보 포트가 더해지며, LC-U4-9(클라 신호 수집)는 날씨·장소에 대해 서버 감지기로 옮겨 간다 |
| U4 NFR §8 PBT | **추가** — PBT-SA-01~22 를 blocking 게이트에 더한다 |
| 상속 기반선 '재시도 없음'(U0·U1) | **예외 1건** — 단기예보 03 NO_DATA 즉시 ≤ 2회(격자 경로만, Q4). 장애 재시도가 아니라 발표 미준비 응답이다 |
| U6 LEGAL-U6-01~03 | **정합** — 기회는 알림 경로 밖이라 LEGAL-U6-02 가 유지되고, 그것을 조건으로 한 LEGAL-U6-01 도 유지된다. 스윕이 밤에 돌지 않아(INV-SA-5) O-U6-4 를 종결한다 |
| U6 OBS-U6-03(억제 건수) | **확장** — 억제 사유 `IN_APP_ONLY`·`COALESCED` 를 더한다(억제 총량 식은 그대로) |
| U6 BR-U6-09(같은 일정 10분 1회) | **첫 집행** — 같은 여행 10분 1회(BR-SA-21) |
| U6 DATA-U6-05(스케줄링 신규 인프라 0) | **정합** — 스윕도 `@Scheduled` + ShedLock |
| U10 PERF-U10-06(`DELAY` 5분 · `planb-delay-scan`) | **분리** — 락 이름·설정 키·파일이 다르다. 스케줄러 풀 4 가 두 스케줄러를 같이 담는다. 스윕의 밤 창은 `DELAY` 에 걸지 않는다 |
| `shared-infrastructure.md` §4.6 · G-05 | **정합** — 관측 1차 수단 = 컨테이너 로그(요약 줄) |

## NFR Design 권고

**권고 = SKIP** — Q10=A.

- **U10 이 NFR Design 을 돈 이유가 여기엔 없다.** U10 은 패턴의 본체가 기기 백그라운드 실행이라 실패 모드를 jest 가 원리적으로 못 봤다. 이 기능의 실행은 서버 회차이고, 그 실패 모드(밤 창 경계 · 회차 예산 · 단일 실행 · 회로 차단 · 재배달 멱등)는 PBT·통합 테스트가 본다 — PBT-SA-07(밤 창 경계 20:58·20:59·21:00·06:59·07:00) · PBT-SA-04(푸시 상한 · 회차당 사건 ≤ 1) · PBT-SA-17(선계산 구독자 멱등 · 상한 · BUSY 는 세션 0) · PBT-SA-18(같은 여행 10분 1회) + 스윕 단위 테스트(모드 3종 · 회로 차단 3회 · 예산 · 시작 위치 회전 · 종료 신호 · 20:58 컷).
- **새로 설계할 패턴이 없다.** 단일 실행 락은 `OutboxRelay` 의 ShedLock, 캐시는 `weather_snapshot` 의 읽기-통과, 스케줄러 배치는 U10 `planb-delay-scan` 과 같은 꼴이다. 값·배치까지 `nfr-requirements.md`·`tech-stack-decisions.md` 에 들어간다(U3·U6 가 스킵한 이유와 같다).
- **남는 불확실성은 값이다** — 병렬도 · 예산 · 감시 상태 신선도 창 · 해제 임계. 값은 설계 문서가 아니라 dry-run 실측(Q7 의 ①·③)으로 닫는다.
- **재개 조건**: dry-run 요약 줄의 회차 경과가 예산(20분)을 넘거나, 선계산 동시성 확대(재계획 산출의 AI 호출을 트랜잭션 밖으로)가 필요해질 때 — `aidlc-state.md` 에 재개 조건으로 남긴다.

---

## 다음 단계

산출물 2종 → **완료 메시지·사용자 승인 게이트**(FD 다음) → `audit.md`·`aidlc-state.md` 기록 → (승인 시) NFR Design SKIP 기록 → Infrastructure Design 증분(`shared-infrastructure.md` — 신규 AWS 자원 0 · 런타임 스위치 · 스케줄러 1 · 마이그레이션 3 · 외부 호출 증가).
