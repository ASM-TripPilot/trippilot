# U10 GPS·위치 자동화 — Logical Components

> 입력: `nfr-design-patterns.md`(P-\*-U10) + `functional-design/frontend-components.md`(파일 제안) + NFR Req. U4 `LC-U4-7·8`(이연 → U10)을 대체한다. 명명 `LC-U10-#`.
> 답변 확정 2026-10-12 — Q1=A · Q2=A · Q3=A(계획서 `plans/u10-gps-location-automation-nfr-design-plan.md`).
> **이 문서가 더하는 것은 NFR 장치뿐이다.** 순수 판정 모델(`arming` · `visitJudge` · `autoEventQueue` · `selectRegions` · `config`)의 책임은 FD §2.1이 정본이고 여기서는 **입력·성질 확장**만 적는다. 파일 경로는 제안이며 구현 PR이 확정한다.

## 1. 컴포넌트 맵

```text
frontend (기기)
  index.ts (리포 루트 엔트리)         LC-U10-1 BackgroundEntry        P-BG-U10-1
    -> src/app/entrypoint/registerBackgroundTasks.ts  (플래그 ON 일 때만 tasks 평가)

  src/shared/location/automation/
    tasks.ts                          LC-U10-2 WakeRunner             P-BG-U10-2 / 4 / 6
    wakeBudget.ts                     LC-U10-3 WakePlanner (순수)     P-BG-U10-2
    localStore.ts + stateCodec.ts     LC-U10-4 AutomationStore        P-STORE-U10-1 / 2 / 3 / 4, P-BG-U10-5
    routeDownsample.ts                LC-U10-5 RouteDownsampler (순수) P-PRIV-U10-1, P-PERF-U10-1
    routeDistance.ts                    (FD 그대로 - 배제 전 원시 기준)
    nativeGeofence.ts / nativeRoute.ts LC-U10-6 NativeAdapters        P-BG-U10-4 / 6
    teardown.ts                       LC-U10-7 AutomationTeardown     P-BG-U10-6, P-STORE-U10-4
    useLocationAutomation.ts          LC-U10-8 ForegroundOrchestrator P-BG-U10-2(ctx), P-STORE-U10-3(탐침), P-PERF-U10-1
    arming / visitJudge / autoEventQueue / config   (FD 2.1 소유 - 입력 확장만)

  src/shared/api/
    background.ts                     LC-U10-9 BackgroundTransport    P-BG-U10-3

backend (서버) - 신설 컴포넌트 없음, 기존 패턴 재사용 (3 절)
```

의존 방향: `tasks.ts` → (`wakeBudget` · `localStore` · 순수 모델 · `nativeX` · `shared/api/background` · `shared/storage`). **`tasks.ts`는 React · page · feature · `authedClient`를 import하지 않는다.** `useLocationAutomation`만 React 훅이고, 포그라운드 전송은 일반 `authedClient` 경로를 쓴다.

## 2. 컴포넌트 명세

### LC-U10-1. `BackgroundEntry`

| | |
|---|---|
| 책임 | 앱 JS 평가의 **첫 줄**에서 태스크 정의를 실행한다. 순서: `registerBackgroundTasks` → `expo-router/entry`(둘 다 `require`) |
| 게이트 | `Constants.expoConfig.extra.locationAutomation === true`일 때만 `tasks.ts`를 평가 — OFF면 코드 경로 0(BR-U10-07 · MOBILE-U10-08) |
| 변경 | `frontend/package.json` `"main"`: `expo-router/entry` → `index.ts` |
| 검증 | jest: 플래그 OFF에서 `TaskManager.defineTask` 호출 0 · ON에서 2(목). 실제 wake는 6-b #3 |

### LC-U10-2. `WakeRunner` (`tasks.ts`)

| | |
|---|---|
| 책임 | `GEOFENCE_TASK`·`ROUTE_TASK` 본문 = P-BG-U10-2 파이프라인 1벌(두 태스크가 같은 러너를 다른 이벤트로 부른다) |
| 상태 | 없음 — 전부 `AutomationStore` |
| 시간 | `deadline = t0 + 9,000ms`를 각 단계에 넘긴다. 전송 전 커밋(L5) |
| 실패 | 단계 예외는 **사유 코드만** Sentry(DSN 있을 때)로 — 위치 객체·좌표를 메시지·breadcrumb·extra에 싣지 않는다(SEC-U10-05). `console.*`에도 위치를 찍지 않는다 |
| 강등 | `resolveArming`이 ARMED가 아니면 `AutomationTeardown.degrade()` |
| 경계 | 경로 업로드 · 다운샘플 · Query 캐시 갱신 · 토큰 갱신을 **하지 않는다**(MOBILE-U10-04) |

### LC-U10-3. `WakePlanner` (`wakeBudget.ts`, 순수)

| | |
|---|---|
| 책임 | `planSend(now, deadline, outbox, blocked) → {request, timeoutMs} \| null` — 다음에 보낼 요청과 그 타임아웃 |
| 규칙 | 시작 조건 남은 시간 ≥ 3,000ms · 타임아웃 = min(8,000, 남은 시간 − 1,000) · wake당 ≤ 2 · 자동 결과 배치가 먼저 · `blocked`(LOCKED·TOKEN_EXPIRED·AUTH_401)면 null |
| PBT | **PBT-U10-F8** |

### LC-U10-4. `AutomationStore` (`localStore.ts` + `stateCodec.ts`)

| | |
|---|---|
| 책임 | `<cache>/trippilot-u10/` 소유 — 상태 A/B 슬롯 · 원시 JSONL · 디렉토리 삭제 |
| 직렬화 | `withStore(fn)` 모듈 수준 promise 체인 — 포그라운드·백그라운드 공통 단일 작성자(P-BG-U10-5) |
| 순수 부분 | `stateCodec.ts`: `encode(state) → string` · `pickLatest(slotA?, slotB?) → {state} \| EMPTY \| RESET` · `parseRawLines(text) → samples` — 파일 I/O 없이 PBT로 잠근다 |
| 쓰기 | 다음 세대를 현재 세대 반대편 슬롯에(P-STORE-U10-2). 원자 쓰기·rename에 기대지 않는다 |
| 읽기 | throw → `UNREADABLE`(쓰기 금지) · 파싱 실패 → 후보 제외 · 전부 무효 → `RESET` |
| 킬 스위치 | `kill.enabled` 직전 값(P-STORE-U10-3) |
| 라이브러리 | `expo-file-system` 새 API(`File`·`Directory`·`Paths.cache`) — tech-stack 델타 2 |
| PBT | **PBT-U10-F7** · F4(큐 — FD) |

### LC-U10-5. `RouteDownsampler` (`routeDownsample.ts`, 순수)

| | |
|---|---|
| 책임 | 원시 하루치 → 세그먼트 분할 → 닻 찾기(체류 지점 + 세그먼트 끝점) → **닻 배제(R_priv 150m)** → 반복형 RDP(ε₀ 15m, ×1.5 상한 루프) → 인코딩(1e-5) |
| 출력 | `{segments: string[], rawPointCount, storedPointCount}` + `routeDistance`의 `distanceM` — 시간·속도 필드 없음 |
| 실행 자리 | 포그라운드 복귀 시점만(P-PERF-U10-1). 결과를 저장하지 않고 재시도마다 재계산 |
| 값 | `config.ts`: ε₀ · N_max · S_max · R_priv · D_stop · T_stop |
| PBT | **PBT-U10-F5**(⑥ 닻 배제 추가) |
| 벤치 | jest 20,000점(지그재그 최악 포함) — 회귀 감시. 기준 기기 ≤ 2초는 6-b #10 회차 |

### LC-U10-6. `NativeAdapters` (`nativeGeofence.ts` · `nativeRoute.ts`)

| | |
|---|---|
| 책임 | FD §2.2 그대로 + **재시작 규칙**: 지오펜스 wake마다(ARMED + L3) `startLocationUpdatesAsync`를 같은 옵션으로 다시 부른다(P-BG-U10-4). `hasStarted…`로 거르지 않는다 |
| 옵션 | MOBILE-U10-02 값 · Android 포그라운드 서비스 알림 문구 = 기능 이름 수준(STORE-U10-08) |
| 해제 | `stop*`는 "등록 안 됨" 예외를 삼킨다(멱등) |
| 계약 | `registerGeofences → {armed, reason}` 유지(REL-U10-07) |
| 검증 | jest 사각 — 6-b #3 · #6 · #13 |

### LC-U10-7. `AutomationTeardown` (`teardown.ts`)

| | |
|---|---|
| 책임 | 세 갈래 해제 — `degrade(reason)` · `revokeAndWipe()` · `endSessionAndWipe()`(로그아웃·계정 삭제) |
| 순서 | **OS 해제 먼저**, 그다음 END 큐잉/전송 또는 디렉토리 삭제(P-BG-U10-6) |
| 호출자 | `WakeRunner`(강등 · 서버 거절) · `useLocationAutomation`(포그라운드 강등 · 소유자 불일치) · 위치 동의 철회 경로(`useLocationConsent` revoke 성공 후) · **세션 종료 경로**(로그아웃·계정 삭제 — 토큰 삭제 전에 호출. 정확한 이음매는 구현 PR) |
| 표식 | 강등 사유를 `notice`에 남겨 i01 1줄(FD §11)로 소비 |

### LC-U10-8. `ForegroundOrchestrator` (`useLocationAutomation.ts`)

FD §2.3 책임에 NFR 장치를 더한다.

| 더하는 것 | 패턴 |
|---|---|
| `ctx` 기록(무장 · 복귀 · 일정 변경 · 동의 변경 시) — 백그라운드가 쓰는 유일한 문맥 | P-BG-U10-2 |
| 소유자 확인(`state.owner ≠ 현재 계정` → 해제·삭제) | P-STORE-U10-4 |
| 큐 flush(일반 `authedClient`) · `authBlocked` 해제 | P-BG-U10-3 |
| 킬 스위치 탐침(캐시 `false`면 빈 배치 1회) | P-STORE-U10-3 |
| 경로 재시작 호출 · 업로드 대기 날짜의 다운샘플 → `PUT` → ack 시 원시 삭제 | P-BG-U10-4 · P-PERF-U10-1 |
| `notice` 소비(강등 사유 · 폐기 건수 1줄) | FD §11 |

### LC-U10-9. `BackgroundTransport` (`shared/api/background.ts`)

| | |
|---|---|
| 책임 | 백그라운드 전용 요청 2종(자동 결과 배치 · 구간 보고). 타입만 orval 생성물 공유 |
| 인스턴스 | **인터셉터 없는 전용 axios 인스턴스**(또는 `fetch`) — 401 리프레시·`onSessionExpired` 없음 · 요청마다 `timeoutMs` 지정 |
| 토큰 | `shared/storage.getTokens()` 직접 — throw = LOCKED · `exp` 선판정 = TOKEN_EXPIRED |
| 결과 | `{ok, data} \| {held: 'LOCKED' \| 'TOKEN_EXPIRED' \| 'AUTH_401' \| 'NO_SESSION'} \| {failed: 'NETWORK' \| 'TIMEOUT'}` — 예외를 던지지 않는다(러너가 분기만 한다) |
| 금지 | `refreshTokens` · `clearTokens` · `onSessionExpired` 호출(SEC-U10-04). 구조 확인은 구현 PR 리뷰 + jest(이 모듈이 그 함수들을 import하지 않음) |

## 3. 서버 — 재사용 (신설 컴포넌트 0)

| 요구 | 재사용 | 위치(실물) | U10 몫 |
|---|---|---|---|
| 자동 결과 배치 멱등·서버 우선 | 재생 멱등 + 항목별 트랜잭션 | `modules/archive` — `VisitCheckService` · `OfflineReplayPropertyTest` | 배치 엔드포인트 · `outcome` 6종 · `automationEnabled` |
| `DELAY` 진행 중 판정 | `@Scheduled` 5분 + `@SchedulerLock("planb-delay-scan")` → `TriggerService.evaluate` | 선례 `app/event/OutboxRelay.kt` · 방어선 `ux_plan_b_trigger_active`(V2.18) | 무장 여행만 질의(`location_automation_interval (trip_id, kind, started_at)`) |
| 열린 구간 닫기 | `@Scheduled` + 조건부 UPDATE | 선례 `modules/trip/.../TripEndSweeper.kt` | `SERVER_TIMEOUT` + END 법정 로그 |
| 법정 로그 · 파기 | 파사드(호출자 트랜잭션) · 철회 구독자 | `LocationLegalLogFacade` · `LocationLegalConsentRevokedSubscriber` | 구간 메서드 2 · `PURGE(ACTUAL_ROUTE)` |
| 관측 | Micrometer + 구조화 로그 | `modules/notification/.../NotificationMetrics.kt` | `LocationAutomationMetrics`(OBS-U10-06~10) |
| 킬 스위치 | 설정 불리언 1개 | 운영 모드 키 선례(`PUSH_MODE`) | `trippilot.location-automation.enabled` — 배치는 인프라 증분 |

## 4. PBT 게이트 배치

**기기(fast-check · jest, 순수 함수만 — 네이티브는 6-b)**

| ID | 대상 | 성질 | 출처 |
|---|---|---|---|
| F1 | `arming.ts` | FD F1 + **킬 스위치 `false`면 ARMED·EXPLAINER 0** | FD · 확장 |
| F2 | `geofence.ts selectRegions` | FD 그대로 | FD |
| F3 | `visitJudge.ts` | FD 그대로 | FD |
| F4 | `autoEventQueue.ts` | FD 그대로 + 구간 보고 항목은 날짜 전환에 버려지지 않는다 | FD · 확장 |
| F5 | `routeDownsample.ts` · `routeDistance.ts` | FD ①~⑤ + **⑥ 출력 꼭짓점 중 어떤 닻(생성기가 심은 체류 중심 · 원시 세그먼트 끝점)의 R_priv 안에 있는 것 0** · ⑦ 출력 꼭짓점 ⊆ 원시 점(인코딩 전) · ⑧ 기록 공백 앞뒤 점을 잇는 변 0 · ⑨ 결정론 · ⑩ 인코딩 왕복 오차 ≤ 0.5e-5°(PBT-02) | FD · **확장** |
| F6 | 자동 결과·구간 보고 직렬화 | FD 그대로(좌표 키 0) + `sendHeld` 필드 포함 | FD |
| F7 | `stateCodec.ts` | 직렬화 왕복 · **임의 세대 열에서 마지막 쓰기를 임의 바이트에서 잘라도 `pickLatest` = 직전 세대**(직전이 없으면 EMPTY) · 두 슬롯 다 무효 = RESET · JSONL 찢긴 마지막 줄은 버려지고 나머지는 보존 | NFR Req · **구체화** |
| F8 | `wakeBudget.ts` | 임의 (now, deadline, 큐, 보류)에서 ① 요청 끝 시각(시작 + 타임아웃) ≤ deadline − 1,000ms ② wake당 요청 ≤ 2 ③ 큐에 자동 결과가 있으면 첫 요청은 배치 ④ 보류면 요청 0 | **신규** |

생성기 요구(PBT-07): F5는 세그먼트 시작·끝 체류 · 하루 상한 규모(20,000점) · 지그재그 튐 · 막다른 왕복 · 시작점으로 돌아오는 고리 · 2·R_priv보다 짧은 세그먼트 · 점 2개짜리 체류(자동 정지)를 포함한다. F4·F7은 여행지 자정 ± 수 분 경계를 포함한다.

**서버(Kotest property)** — FD PBT-U10-1~7을 각 모듈 테스트에 둔다: 1·4·6 `archive`(경로 · 법정 로그 짝 · 클램프) · 2·3 `archive`(3은 `OfflineReplayPropertyTest` 꼴, NFR Req대로 blocking 취급) · 5 `planb-detection` · 7 직렬화 전수(PBT-U5-5 확장).

## 5. 6-b 실기 추가 항목 (FD §8 #1~11 · NFR Req #12~14에 이어서)

| # | 확인 | 패턴 |
|---|---|---|
| 15 | 재부팅 후 **첫 잠금 해제 전** 지오펜스 wake에서 상태 파일이 덮어써지지 않는다(잠금 해제 뒤 큐가 그대로) | P-STORE-U10-2 ★ |
| 16 | 킬 스위치 OFF → 강등 뒤 ON으로 되돌리고 포그라운드 복귀 → 탐침으로 다시 무장 | P-STORE-U10-3 |
| 17 | 앱 강제 종료(스와이프) 후 지오펜스 진입이 앱을 다시 띄우는가 | O-U10-ND-2 |
| 18 | 액세스 토큰 만료(앱 1시간 이상 미사용) 상태의 wake → 요청 0 · `sendHeld.tokenExpired` 증가 · 포그라운드 복귀 시 flush | P-BG-U10-3 |
| 19 | 그날 마지막 슬롯 완료 후 귀환 이동에서 경로가 이어지는가 | O-U10-ND-3 |
| 20 | 실제 경로 레이어가 숙소·방문지 150m 앞에서 끝나거나 직선으로 지나는 모습의 체감 | P-PRIV-U10-1 · O-U10-ND-4 |
