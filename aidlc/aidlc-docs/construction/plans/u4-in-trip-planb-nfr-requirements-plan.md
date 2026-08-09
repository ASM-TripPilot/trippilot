# U4 In-trip & Plan-B — NFR Requirements Plan

> **방침**: U3와 같이 **얇게**. U0·U1이 정한 NFR·패턴은 **상속**하고, U4에서 새로 생기는 것만 다룬다. FD(`business-rules.md` BR-U4-\*)에 이미 들어간 항목은 다시 쓰지 않고 **참조만** 한다.
> **결정 근거**: U3 선례대로 **`frontend/`·`backend/`·`ai/` 실장을 먼저 확인하고 실장을 우선**한다. 실장에 근거가 없는 항목만 권장안으로 채운다.
> **선행**: U4 Functional Design 승인(2026-08-09).

---

## Step 1 — FD에 이미 들어간 NFR성 규칙 (재서술 금지)

| 이미 확정된 것 | 위치 |
|---|---|
| 외부 API 실패 시 **무발화**(허위 알림 금지) | BR-U4-05 · INV-U4-01 |
| 억제·빈도 상한·민감도를 **감지 단계에서** 적용 | BR-U4-08 · INV-U4-02 |
| 확정 전 원 일정 무변경 · 부분 반영 금지 | BR-U4-28·32 · INV-U4-05 |
| 진행 중 시각 **재추정 없음**(계획값만) | BR-U4-34·35 · DEC-U4-9 |
| 연속 위치 추적 없음 · 실제 경로는 앱 켠 구간만 | BR-U4-41 · DEC-U4-7 |
| 걸음 수 기록·표시 안 함 | BR-U4-41 · DEC-U4-8 |
| 외부 API 실패 → 수동 편집 전환 + 누락 데이터 표기 | BR-U4-43·45 · INV-4 |
| 위치 기준점 사다리(차단 금지) | BR-U4-19 |

> 위 8건은 **NFR 문서에 다시 적지 않는다.** 아래 질문은 그 **바깥에 남은 것**만 묻는다.

## Step 1b — 상속 기반선 (U0·U1·U3에서 그대로 가져오는 것)

- 부하 50 RPS · 피크 500세션 · 가용성 99.9%
- 복원력: 서킷 브레이커 벤더별 분리 · **재시도 없음**(응답성 우선) · stale-if-error · 침묵 실패 금지 사슬
- 보안: security-baseline Full · 객체 수준 인가(타 계정 404)
- 관측: 구조화 로그 · 상관관계 ID · OTLP 내보내기
- PBT: blocking 게이트
- **호출 상한 형태**: 진행 중 세션이 있으면 같은 여행의 재요청을 **409로 거부**(COST-U3-01) — U4 `replan_session`도 **같은 형태를 승계**한다(INV-U4-06이 이미 "열린 세션 최대 1개"를 요구)

## Step 1c — 실장 확인 (2026-08-09)

| 확인 대상 | 실측 | U4에 미치는 영향 |
|---|---|---|
| `frontend/package.json` | `expo-location ~19.0.8` · `expo-notifications ~0.32.17` · `@react-native-community/netinfo 11.4.1` · `expo-secure-store` **실재**. **`expo-task-manager` 없음** · `expo-sensors` 없음 | ⚠️ **정정**: 지오펜스(`startGeofencingAsync`)는 `TaskManager.defineTask`가 필요하다 — **신규 의존성 `expo-task-manager` 1개**가 붙는다(이전 대화에서 "신규 의존성 0"이라 한 것은 `expo-location` 기준이었고, 정확히는 1개다) |
| `frontend/app.config.ts` | `expo-location` 플러그인이 **`locationWhenInUsePermission` 하나만** 설정. `locationAlwaysAndWhenInUsePermission`·`isAndroidBackgroundLocationEnabled` **없음** | 지오펜스는 **plugin 확장 + EAS 재빌드** 필요(OTA 불가) |
| `frontend/src/shared/location/` | `LocationPreprompt.tsx` + `lib/locationColors.ts` 뿐 — **권한 요청·수집 로직 자체가 아직 없다** | U4가 이 디렉토리의 **첫 실동작 구현자**가 된다 |
| `backend/.../V1.3__auth_location.sql` | `location_consent_state`에 **3층 동의**(`os_permission_mirror`·`legal_consent`·**`gps_recording_opt_in`**) · `location_legal_log`는 **append-only**이고 `event_type`에 `COLLECTION`·`USE`·`PURGE` 포함, `detail`에 **원시 좌표 미포함** | ⚠️ 실제 경로(`actual_route_point`)는 **L3 `gps_recording_opt_in`에 걸린다**(새 동의 축을 만들지 않는다). 좌표를 찍을 때마다 `COLLECTION` 로그를 남기면 **법정 로그가 점 수만큼 폭증** → 기록 단위 결정 필요(Q3) |
| `backend/app/.../AsyncConfig.kt` | **`@EnableScheduling` 실재** + `StalePartialSweeper`(중단된 2차 생성 정리) + `@Async` ThreadPoolTaskExecutor | 서버 스케줄러 **자리는 이미 있다**. DEC-U4-6의 "트리거 평가 스케줄러 없음"은 유지하되, **`replan_session` 만료 정리는 기존 sweeper 패턴을 그대로 재사용**(신규 인프라 0) |
| `backend/gradle/libs.versions.toml` | resilience4j · bucket4j · Redis · Caffeine **전부 없음** | 호출 상한은 **라이브러리 없이** 세션 상태로만(U3와 동형). U1이 결정한 Redis는 아직 미도입 |
| `backend/.../application.yml` | actuator `health,info,metrics` + OTLP 엔드포인트 | 관측 채널 선재 — U4는 **지표 이름만** 더한다 |
| `ai/src/trippilot/c1/config.py` | `max_tokens`·`temperature`·`timeout_sec` 상한 실재(U3 COST-U3-04가 승계) | U4가 별도 LLM 상한을 만들지 않는다 |

---

## 실행 계획

- [x] 1. FD 분석 — 이미 확정된 NFR성 규칙 8건 식별 · 상속 기반선 정리
- [x] 1c. **실장 확인** — frontend 의존성·플러그인·`shared/location` / backend 위치 동의 3층·법정 로그·스케줄러·의존성 / ai 상한
- [x] 2. 질문 Q1~Q6 답변 수집 (2026-08-09) — 사용자 "ㄱㄱ" = **추천안 전부 채택(Q1~Q6=A)**. 모호성 0 → 명확화 파일 없음
- [x] 3. `nfr-requirements.md` — **MOBILE-U4-01~07** · PERF-U4-01~05 · COST-U4-01~06 · **LEGAL-U4-01~05** · DATA-U4-01~05 · OBS-U4-01~05 · OFFLINE-U4-01~05 · SEC-U4-01~04 + 재평가 트리거 6
- [x] 4. `tech-stack-decisions.md` — 상속 11행 + **U4 델타 6**(`expo-task-manager`+plugin 확장 · `WeatherPort`/기상청 어댑터 · `KakaoMapView` 점선 레이어 · Redis 미도입 유지 · 스케줄링 신규 0 · backend 모듈 3+마이그레이션 6) + **미도입 결정 8** + 개발 중 처리 3
- [ ] 5. 완료 메시지 → 승인 게이트 → `audit.md`·`aidlc-state.md`

**전제(질문 아님)** — 이견 있으면 알려주세요:
- **재계획 호출 상한은 U3 형태를 승계**한다 — 열린 세션 1개(INV-U4-06) + 진행 중 재요청 409. 임의 쿨다운 상수를 새로 만들지 않는다
- **`replan_session` 만료 정리는 `StalePartialSweeper` 패턴 재사용** — 신규 스케줄링 인프라 0
- **Infrastructure Design은 U0·U1·U3와 동형으로 SKIP 예정**(배포·클라우드 계획 부재)

---

## 질문 (모두 `[Answer]:` 에 답해 주세요)

마지막 선택지는 항상 "Other". "추천해줘"라고 적으셔도 됩니다.

## Question 1 — 지오펜스의 실제 비용 ★ (실측으로 드러난 정정)

FD에서 지오펜스 조합으로 확정했는데, **비용이 제가 말한 것보다 큽니다**:

- **신규 의존성 `expo-task-manager` 1개** (지오펜스는 `TaskManager.defineTask` 없이는 안 됨)
- **`app.config.ts` plugin 확장** — `locationAlwaysAndWhenInUsePermission` + Android 백그라운드 위치 플래그
- **EAS 재빌드 필요** (네이티브 설정 변경이라 OTA 불가)
- **'항상 허용' 권한 요청** — 승인율이 '앱 사용 중'보다 낮고, iOS는 최초 요청 후 일정 시간 뒤 시스템이 재확인 프롬프트를 띄움

- **A) 그대로 수용** *(추천)* — 위 비용을 지불하고 지오펜스를 1차에 넣는다. 거부해도 앱은 수동 체크인으로 강등되므로 **기능이 막히지는 않는다**
- **B) 단계적** — 1차는 포그라운드 폴링만(`i07` 푸시·자동 도착 감지 없음), 지오펜스는 **후속 티켓**. 지금은 `expo-task-manager`도 안 넣고 EAS 재빌드도 미룬다
- **C) 재검토** — 비용 대비 효용을 다시 따진다(백그라운드 감지 자체를 1차 밖으로)

[Answer]: A

## Question 2 — 포그라운드 트리거 평가 주기

앱이 켜져 있을 때 얼마나 자주 판정을 물을지에 **실장 근거가 없습니다**(U0·U1·U3 어디에도 폴링 주기가 없음).

- **A) 이벤트 기반 — 주기 폴링 없음** *(추천)*
  화면 진입 · 앱 포그라운드 복귀 · 슬롯 경계 통과 · 방문 체크 직후에만 평가를 요청. 배터리·서버 부하 모두 최소이고, 실제로 상황이 바뀌는 순간과 일치한다
- **B) 고정 주기** — 여행 중 화면에서 60초 폴링
- **C) 적응형** — 다음 슬롯이 가까울수록 짧게(예: 5분 전부터 30초)

[Answer]: A

## Question 3 — 실제 경로 기록 정밀도·보존·법정 로그 단위 ★

`location_legal_log`는 **append-only**이고 `event_type='COLLECTION'`을 요구합니다. 좌표를 찍을 때마다 로그를 남기면 **점 수만큼 행이 늘어납니다**(하루 수천 행 가능).

- **A) 세션 단위 로그 + 성긴 샘플링** *(추천)*
  좌표는 **최소 이동 거리 기준**으로만 기록(예: 50m 이동 시 1점, 정확도 낮으면 폐기). 법정 로그는 **수집 구간(세션) 시작·종료에 1건씩** — `detail`에 구간·점 개수만(원시 좌표 미포함은 스키마가 이미 강제). 보존은 **여행 종료 후 N일**, 이후 `PURGE` 로그와 함께 파기
- **B) 점마다 COLLECTION 로그** — 법적으로 가장 보수적이지만 로그 폭증
- **C) 실제 경로 기능 자체를 1차 밖으로** — `i03` 실제 경로 레이어 미구현

> 어느 쪽이든 **L3 동의(`gps_recording_opt_in`)에 걸린다** — 새 동의 축은 만들지 않습니다.

[Answer]: A

## Question 4 — 날씨 조회 예산 ★

C11이 이 유닛의 신규 외부 의존입니다. 기상청 단기예보는 **3시간 간격 발표 · 격자(nx·ny) 단위**입니다.

- **A) 격자·발표시각 단위 캐시 + 활성 여행만 조회** *(추천)*
  캐시 키 = `(격자, 발표시각)`, TTL = 다음 발표까지. **여행 중인 사용자의 당일 격자만** 조회하므로 동시 사용자가 늘어도 격자 수만큼만 늘어난다. 캐시는 **DB 테이블**(`weather_snapshot`)로 — Redis는 U1이 결정만 하고 아직 미도입이라 여기서 끌어오지 않는다
- **B) Redis 캐시로** — U1 결정(Q8=B)을 여기서 실행에 옮긴다
- **C) 캐시 없이 매번 조회** — 호출량 관측 후 판단

[Answer]: B

## Question 5 — 로컬 알림 빈도 상한 (민감도 3단의 실제 수치)

BR-U4-08이 민감도(`LOW`·`NORMAL`·`HIGH`)를 요구하는데 **수치가 어디에도 없습니다.**

- **A) 하루 상한만 설정값으로 — 초기값에 "근거 없음" 라벨** *(추천)*
  `LOW=1` · `NORMAL=3` · `HIGH=6` (여행 1일 기준). BR-U2-15(임계값 하드코딩 금지)에 따라 **설정값**으로만 두고, 실사용 관측 후 조정. 문서에는 "근거 없는 초기값"이라 명시
- **B) 상한 없이 억제 규칙만** — 동일 kind×slotKey 1회(BR-U4-07)로 충분하다고 보고 일일 상한을 두지 않는다
- **C) 수치를 이 단계에서 정하지 않는다** — 미결로 남기고 개발 중 결정

[Answer]: A

## Question 6 — 여행 중 오프라인 ★

`frontend/README.md` 오프라인 정책은 **"일정 조회 오프라인 캐시는 제공하지 않는다. 기록 입력(방문 체크·사진·메모)만 로컬 큐"** 입니다. 그런데 **여행 중이 바로 데이터가 잘 끊기는 상황**입니다.

- **A) 정책 그대로 + 방문 체크만 큐잉** *(추천)*
  일정 조회는 온라인 필요(끊기면 오류 화면 + 재시도). 방문 체크는 `shared/storage` 큐에 쌓아 복구 시 동기화. **재계획은 온라인 전용**(솔버 호출이라 당연)
- **B) 여행 중 화면만 예외** — 활성 일정 1일치를 로컬 캐시해 오프라인에서도 타임라인은 보이게. 정책 예외를 만든다
- **C) 전면 오프라인 지원** — 범위 초과

[Answer]: A
