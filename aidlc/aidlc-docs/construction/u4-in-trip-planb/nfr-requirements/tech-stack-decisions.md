# U4 In-trip & Plan-B — Tech Stack Decisions

> **방침**: 상속 우선. U0·U1·U3이 확정한 스택을 그대로 쓰고 **U4가 실제로 요구하는 델타만** 기록한다.
> **작성 근거 (2026-08-09)**: `frontend/`·`backend/`·`ai/` 실장을 직접 확인한 결과다. **초안 단계에서 "신규 의존성 0"이라 판단했던 것이 실장 확인으로 뒤집혔다**(델타 1).

---

## 1. 상속 (변경 없음)

| 계층 | 스택 | 확인 |
|---|---|---|
| backend | Spring Boot + Kotlin 모듈러 모놀리스 · PostgreSQL · Flyway(SQL-first, forward-only) · actuator + OTLP | `application.yml`에 `health,info,metrics` + OTLP 실재 |
| 비동기·스케줄링 | **`@EnableAsync` + `@EnableScheduling` + `ThreadPoolTaskExecutor` 실재** | `backend/app/.../config/AsyncConfig.kt` · `StalePartialSweeper` |
| AI | Python · OR-Tools · Anthropic API 직접 · 포트/어댑터 · `HybridSolverFacade{solve, validate, repair, regenerate}` | `ai/src/trippilot/c2/facade.py` |
| frontend | Expo + Expo Router · TS strict · TanStack Query · Zustand · RHF+Zod · NativeWind | `frontend/package.json` |
| 지도 | 카카오 지도 JS SDK를 `react-native-webview`로 임베드 — `@/shared/map/KakaoMapView` | 실장 |
| 위치 | `expo-location ~19.0.8` | 실장 — **단, 포그라운드 권한만 설정됨**(델타 1) |
| 알림 | `expo-notifications ~0.32.17` | 실장 — **로컬 알림에 그대로 사용**, FCM 서버 푸시는 U6 |
| 네트워크 상태 | `@react-native-community/netinfo` | 실장 |
| 위치 동의·법정 로그 | `location_consent_state` **3층**(L1·L2·**L3 `gps_recording_opt_in`**) + append-only `location_legal_log` | `V1.3__auth_location.sql` — **U4가 새 동의 축을 만들지 않는 근거** |
| 변경 이력 | `change_log_entry`(V2.11, append-only, `source_type` 에 `PLAN_B` 포함) | 실장 — **신설 없음** |

## 2. U4 델타

### 델타 1 — `expo-task-manager` 추가 + 위치 플러그인 확장 (필수) ★

**실장 현황**:
- `frontend/package.json`에 **`expo-task-manager` 없음**
- `app.config.ts`의 `expo-location` 플러그인은 **`locationWhenInUsePermission` 하나만** 설정

**U4가 요구하는 것**: 지오펜스(`Location.startGeofencingAsync`)는 `TaskManager.defineTask(NAME, handler)`로 정의된 태스크가 있어야 하고, 앱이 꺼진 상태에서 깨어나려면 **'항상 허용' 권한 + Android 백그라운드 위치 플래그**가 필요하다.

**결정**:
```
+ expo-task-manager                                 (의존 1개 추가)
  app.config.ts / plugins / expo-location:
    + locationAlwaysAndWhenInUsePermission          (iOS 문구)
    + isAndroidBackgroundLocationEnabled: true      (Android)
```
- **EAS 재빌드 선행** — 네이티브 설정 변경이라 OTA로 나가지 않는다.
- 권한 거부는 **정상 경로**다(MOBILE-U4-03). 지오펜스 미가용 시 수동 체크인으로 강등되며 기능이 막히지 않는다.

> **정정 기록**: FD 단계 Q3·Q4 논의에서 "`expo-location`이 이미 있으니 신규 의존성 0"이라 했으나, 지오펜스에는 `expo-task-manager`가 함께 필요하다. **신규 의존성은 1개**이고 EAS 재빌드가 붙는다.

### 델타 2 — `WeatherPort` + 기상청 어댑터 (신규 외부 의존)

**실장 현황**: `ai/src/trippilot/ports/` 9종에 **날씨 포트 없음**. backend에도 weather 모듈 없음.

**결정**: **backend C11 소유**로 `WeatherPort` + `KmaWeatherAdapter`(공공데이터포털 기상청 단기예보)를 둔다. "하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트" 원칙 그대로.
- 캐시는 **DB 테이블 `weather_snapshot`**(COST-U4-02) — 새 캐시 미들웨어를 도입하지 않는다.
- 실패 시 **행을 만들지 않는다**(INV-U4-09) → 만료분으로 발화하지 않는다.
- API 키 발급·콘솔 등록은 U0 소셜 IdP·U1 카카오 콘솔과 같이 **개발 중 처리**로 이연.

### 델타 3 — `KakaoMapView` 추가 확장 (U3 델타 1에 얹음)

U3가 이미 `markers[]`·`polyline[]`·`center` 갱신·`MARKER_TAP`을 요구했다. U4는 여기에 하나 더한다:

```
+ 점선(dashed) 폴리라인 레이어   — i03 실제 경로(GPS) · i18 변경 전 동선
```
- 새 지도 라이브러리를 도입하지 **않는다**. WebView 1장 유지(PERF-U4-02).
- 소유는 `shared/map` — itinerary(U3)·execution·planb 3곳이 쓴다.

### 델타 4 — Redis 미도입 유지 (U1 결정의 실행 보류)

**실장 현황**: `backend/gradle/libs.versions.toml`에 **Redis·Caffeine·resilience4j·bucket4j 전부 없음**. U1이 Q8=B로 Redis 도입을 결정했으나 **아직 코드에 없다**.

**결정**: U4는 Redis를 **끌어오지 않는다.** 날씨 캐시는 DB 테이블로 충분하고(격자 수만큼만 증가), 호출 상한은 **세션 상태로만**(COST-U4-01, U3와 동형) 구현한다.
- 재평가 트리거: 동시 여행 사용자 증가로 격자 수가 급증하면 그때 U1 결정을 실행에 옮긴다.

### 델타 5 — 스케줄링 신규 인프라 0

`replan_session` 만료 정리·`plan_b_trigger` 정리는 **기존 `@EnableScheduling` + `StalePartialSweeper` 패턴을 그대로 재사용**한다. 신규 스케줄러·큐·워커를 도입하지 않는다.

> DEC-U4-6의 "트리거 평가용 서버 스케줄러 없음"과 모순되지 않는다 — **평가는 클라 요청에 응답해서 하고**, 스케줄러는 **정리 작업에만** 쓴다.

### 델타 6 — backend 신규 모듈 3 + 마이그레이션

| 항목 | 내용 |
|---|---|
| 신규 모듈 | `planb-detection`(C9) · `itinerary-recalculation`(C10) · `weather-context`(C11) — 기존 10모듈과 같은 `api/application/domain/infra` 층 구조 |
| `ScheduleAgentPort` | **5번째 메서드 `replan` 추가**(U2 §7.2). 어댑터가 ai `regenerate(problem, locked_slots)`로 매핑 |
| 마이그레이션 | `plan_b_trigger` · `plan_b_suppression` · `visit_check` · `replan_session` · `actual_route_point` · `weather_snapshot` (V2.14~ 대역) |
| openapi | `planb`·`execution` 태그 신설 → orval 코드젠 대상 추가(`orval.config.ts` `filters.tags`) |

## 3. 미도입 결정 (지금 넣지 않는 것)

| 후보 | 결정 | 재평가 조건 |
|---|---|---|
| `expo-sensors` (만보계) | **미도입** — 걸음 수 미표시(DEC-U4-8) | 디자인이 걸음 수를 되살릴 때 |
| 백그라운드 연속 위치 추적 | **미도입** — 지오펜스로 대체(DEC-U4-7) | 실제 경로 정밀도가 문제로 실측될 때 |
| Live Activity / 다이내믹 아일랜드 | **미도입** — Swift 위젯 + config plugin 비용이 크고, 코드 실행이 아니라 표시 수단이라 트리거 감지를 대체하지 못한다 | "여행 중 상주 표시" 요구가 별도 스토리로 설 때 |
| `expo-background-fetch` | **채택 불가** — iOS가 실행 주기를 정해 몇 시간에 한 번 올 수 있다. 트리거 감지에 부적합 | 없음(기술적 부적합) |
| FCM 서버 푸시 | **U6로 이연** — 지오펜스 wake + **로컬 알림**으로 `i07`이 성립한다 | 서버 스케줄러 도입 시(배포 결정과 함께) |
| rate-limit 라이브러리(bucket4j 등) | **미도입** — 세션 상태 기반 409로 충분 | 상한 우회 사례가 실측될 때 |
| 새 지도 라이브러리 | **미도입** — `KakaoMapView` 확장이 교체보다 싸다 | U1 숙소 등록까지 흔들 만한 요구가 생길 때 |
| 영속 캐시 저장소 | **U3 델타 2에 위임** — U4가 따로 만들지 않는다 | U3 `OFFLINE-U3-01` 구현 시점 |

## 4. 개발 중 처리 (설계 문서 밖)

- **기상청 공공데이터포털 API 키 발급·서비스 신청** — U0 소셜 IdP·U1 카카오 콘솔과 동류의 선결 블로커
- **EAS 재빌드 1회** — 델타 1의 네이티브 설정 반영
- **위치기반서비스사업 신고**(위치정보법 제9조) — 출시 선결과제로 이미 기록됨. 지오펜스 채택이 이 항목의 필요성을 바꾸지 않는다(수집 자체가 이미 대상)
