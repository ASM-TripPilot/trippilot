# U10 GPS·위치 자동화 — Tech Stack Decisions

> **방침**: 상속 우선. U0·U1·U3·U4·U6이 확정한 스택을 그대로 쓰고 **U10이 실제로 요구하는 델타만** 기록한다.
> **작성 근거 (2026-10-12)**: `frontend/package.json`·`frontend/app.config.ts`·`frontend/eas.json`·`frontend/src/shared/storage/`·`frontend/src/__tests__/releaseBuildConfig.test.ts`·`backend/gradle/libs.versions.toml`·`shared-infrastructure.md`를 직접 확인한 결과다. G-U10-5(로컬 저장소)·G-U10-6(기능 플래그)은 **여기서 닫는다** — NFR Design이 다시 열지 않는다.

---

## 1. 상속 (변경 없음)

| 계층 | 스택 | 확인 |
|---|---|---|
| frontend | Expo SDK 54(`expo ~54.0.35`) · Expo Router · TS strict · TanStack Query · Zustand · NativeWind · orval | `frontend/package.json` |
| 위치 | `expo-location ~19.0.8` — `startGeofencingAsync`·`startLocationUpdatesAsync`·`requestBackgroundPermissionsAsync`가 이미 이 패키지에 있다 | 실장 |
| 지도 | 네이버 네이티브 `@mj-studio/react-native-naver-map` — `frontend/src/shared/map/MapView.tsx`가 다중 폴리라인·점선(`NaverMapPathOverlay`)을 이미 지원 | U4 델타 3 개정 블록 |
| 토큰 저장 | `expo-secure-store`(기본 `WHEN_UNLOCKED`) — **바꾸지 않는다**(SEC-U10-03) | `frontend/src/shared/storage/index.ts` |
| 네트워크 상태 | `@react-native-community/netinfo 11.4.1` | 실장 |
| 클라 진단 | `@sentry/react-native ~7.2.0` · `sendDefaultPii: false` · DSN 있을 때만 init | `frontend/src/app/entrypoint/initSentry.ts` |
| backend | Spring Boot + Kotlin 모듈러 모놀리스 · PostgreSQL · Flyway SQL-first · 모듈 층 `api/application/domain/adapter` | U4 델타 6 개정 블록 |
| 스케줄링·락 | `@Scheduled` + **ShedLock 6.10.0**(`shedlock-spring`·`shedlock-provider-jdbc-template`) | `libs.versions.toml` · `TripEndSweeper`·`LocationLegalLogRetentionSweeper` |
| 메트릭 | Micrometer + `NotificationMetrics`·`ReflectionMetrics` 선례 — **EKS에선 OTLP exporter 꺼짐** | `shared-infrastructure.md` §관측 |
| 이벤트 | 아웃박스 + 릴레이(at-least-once · 멱등 구독자) | `app/event/OutboxRelay.kt` |
| 위치 동의·법정 로그 | `location_consent_state` 3층 · append-only `location_legal_log`(`USE`는 V1.3부터 허용) · V2.49 6개월 정리 | V1.3·V1.7·V2.49 |
| 클라 배포 | EAS 빌드 → App Store Connect. **OTA(`expo-updates`) 없음** | `frontend/eas.json` · `package.json` |

## 2. U10 델타

### 델타 1 — `expo-task-manager` 추가 (유일한 신규 네이티브 의존) ★

```
+ expo-task-manager        (SDK 54 대응 버전 — `npx expo install expo-task-manager`가 정하는 값)
```
- 지오펜스·경로 갱신 둘 다 `TaskManager.defineTask`가 필요하다. 정의는 `shared/location/automation/tasks.ts` **모듈 최상위**, 등록(import 실행)은 FSD app 층 엔트리(`frontend/src/app/entrypoint/`)에서 **플래그 ON일 때만**(FD §2.2).
- 이것이 U4 델타 1의 실행이다(U4 tech-stack 델타 1 이연 블록 → 여기서 닫힘).

### 델타 2 — `expo-file-system` 직접 의존으로 명시 (G-U10-5 해소)

```
+ expo-file-system         (이미 expo@54 의존으로 전이 설치·자동 링크된 ~19.0.23 — 새 네이티브 코드 0)
```
- **결정**: 원시 표본 = 날짜별 JSONL(추가 쓰기) · 판정 상태·자동 결과 큐·열린 구간 id·킬 스위치 직전 값 = 작은 JSON(임시 파일 → 원자적 교체). 위치 = **캐시 디렉토리 아래 U10 전용 폴더 1개**(iOS `Caches` · Android `cacheDir` — 클라우드 백업 제외, SEC-U10-01). 삭제 = 폴더째(SEC-U10-02).
- **pnpm은 전이 의존을 import할 수 없으므로** 직접 의존 선언이 필요하다(버전은 `expo` 번들과 같게).
- 탈락안: `expo-sqlite`(신규 네이티브 · 질의가 필요 없는 접근 패턴) · `react-native-mmkv`(신규 네이티브 · New Arch 버전 의존) · `expo-secure-store`(소용량·`WHEN_UNLOCKED`로 잠금 wake에서 못 읽음) · AsyncStorage(신규 의존 · 이점 없음).
- 파일 레이아웃·손상 복구 순서는 NFR Design 주제 ③.

### 델타 3 — 빌드 시점 기능 플래그 (G-U10-6 해소) ★

```
frontend/app.config.ts
  const locationAutomation = process.env.TRIPPILOT_LOCATION_AUTOMATION === '1'   # 이름은 구현 PR에서 확정
  plugins / expo-location:
    OFF(현행): locationAlwaysPermission: false · locationAlwaysAndWhenInUsePermission: false
    ON       : locationAlwaysAndWhenInUsePermission: '<한국어 용도 문구>'
               isIosBackgroundLocationEnabled: true
               isAndroidBackgroundLocationEnabled: true
               isAndroidForegroundServiceEnabled: true
  android.permissions(ON): ACCESS_BACKGROUND_LOCATION · FOREGROUND_SERVICE · FOREGROUND_SERVICE_LOCATION
  extra.locationAutomation: locationAutomation          # JS는 expo-constants로만 읽는다

frontend/eas.json
  production            (현행 — 플래그 없음 = OFF)
+ production-automation (extends production, env: TRIPPILOT_LOCATION_AUTOMATION=1)
```
- `EXPO_PUBLIC_*`로 두지 않는다 — JS 노출을 `extra` 한 곳으로 모아 **네이티브 표면과 JS 동작이 같은 값**이 되게 한다(FD §1).
- **잠금 테스트**: `releaseBuildConfig.test.ts`에 ON 케이스 추가 — OFF는 현행 AC-3 그대로(always 문구 부재), ON은 always 문구·`UIBackgroundModes: location`·Android 3권한 **존재**(MOBILE-U10-08). 플랫폼별 ON(STORE-U10-07 — Android는 OFF 출시)은 플래그 값을 플랫폼별로 갈라야 하면 그때 변수를 하나 더 둔다(지금은 Android 스토어 출시 전이라 하나로 충분).

### 델타 4 — 서버 킬 스위치 (O-U10-7 해소 · Q6=B)

```
backend 설정: trippilot.location-automation.enabled  (env 주입, 기본 true)
  - POST /trips/{tripId}/location-automation/intervals  phase=START → 꺼짐이면 409 AUTOMATION_DISABLED
  - POST /trips/{tripId}/visits/auto-events 응답        → automationEnabled: boolean 필드 추가
```
- 신규 엔드포인트·원격 설정 SaaS 없음. EKS 런타임 env 1개(Helm values)라 **Infrastructure Design 증분 1줄**이 생긴다.
- **FD §12.1·§12.4 계약 개정 필요** — 구현 PR에서 FD 개정 블록으로 남긴다(무장 조건이 사실상 6개가 된다 — BR-U10-02).

### 델타 5 — 구간 END 보고 선택 필드 (Q11=A)

```
POST .../location-automation/intervals  phase=END  + wakeCount? · heldCount? · droppedCount? · rawCapHit?
```
- 서버는 Micrometer 카운터 + 구조화 로그로만 쓰고 **저장하지 않는다**(`location_automation_interval` 컬럼 추가 없음). 좌표 없음.

### 델타 6 — backend: 신규 라이브러리 0 · 마이그레이션 3 · 스케줄러 2

| 항목 | 내용 |
|---|---|
| 신규 라이브러리 | **없음** — ShedLock·Micrometer 기존 |
| 마이그레이션 | FD M-U10-a(`visit_check` 확장) · M-U10-b(`actual_route_day`) · M-U10-c(`location_automation_interval`) — 번호는 머지 시점 V2.63 이후 |
| 스케줄러 | ① `DELAY` 진행 중 판정 5분 + ShedLock(PERF-U10-06) ② 열린 구간 `SERVER_TIMEOUT` 스위퍼(REL-U10-03) — `TripEndSweeper` 꼴 |
| 메트릭 | `LocationAutomationMetrics`(이름 제안) — `NotificationMetrics` 꼴. OBS-U10-06~10 |
| 파사드 | `LocationLegalLogFacade.recordUseInterval`·`recordCollectionInterval` 신설(FD domain-entities §6) |

## 3. 미도입 결정 (지금 넣지 않는 것)

| 후보 | 결정 | 재평가 조건 |
|---|---|---|
| `react-native-background-geolocation`(Transistor) | **미도입** — 유료 라이선스(Android 출시 시) · 신규 네이티브 · `expo-location`과 기능 중복. 배터리 최적화(모션 기반 정지 감지)는 장점이나 모션 권한 요청을 부른다(MOBILE-U10-07과 충돌) | MOBILE-U10-01을 파라미터 조정으로 못 맞출 때 |
| `expo-sensors`(모션·만보계) | **미도입** — 걸음 수 없음 · 모션 권한 미요청 | 상속(U4 §3) |
| `expo-sqlite` · `react-native-mmkv` · AsyncStorage | **미도입** — 델타 2 | 질의가 필요한 접근 패턴이 생길 때 |
| 앱 수준 암호화 라이브러리 | **미도입** — OS 데이터 보호로 충분(Q3=A) | 법무·보안 검토가 기기 내 암호화를 요구할 때 |
| `expo-updates`(OTA) | **미도입** — 플래그가 빌드 값이라 OTA로 켤 수도 없다. 롤백은 킬 스위치(델타 4) | 별도 결정 |
| Firebase Remote Config 등 원격 설정 SaaS | **미도입** — 델타 4로 충분 | 원격 스위치가 2개 이상 필요해질 때 |
| 클라 분석 SDK(Amplitude 등) | **미도입** — 퍼널은 서버 구간 데이터로 파생(OBS-U10-01) | 설명 화면 이탈 원인을 화면 단위로 봐야 할 때 |
| `expo-background-fetch` | **채택 불가** — 실행 주기를 OS가 정한다(U4 §3 승계) | 없음 |
| 백그라운드 토큰 갱신 | **하지 않는다** — SEC-U10-04 | Q4=B로 갈 때도 갱신은 포그라운드만 |
| 서버 지오펜스 판정 · 원시 좌표 서버 수신 | **하지 않는다** — DEC-U10-4·8 | 없음(설계 원칙) |

## 4. 개발 중 처리 (설계 문서 밖)

- **EAS 재빌드** — 델타 1(신규 네이티브)·델타 3(권한 표면). **dev client도 재빌드**해야 태스크가 존재한다. 로컬은 `pnpm expo prebuild` → `pnpm expo run:ios`(`LANG=en_US.UTF-8`). gitignore된 `frontend/ios/`·`frontend/android/`는 **새로 prebuild한 것만 믿는다** — 현재 로컬 `ios/TripPilot/PrivacyInfo.xcprivacy`는 #1030 이전 산출물이라 `PreciseLocation`이 없다.
- **심사 패키지**(STORE-U10-01·02) — 심사 노트 · 시연 영상 · 심사 계정 여행 시드 · 용도 문구 · 개정 약관 URL. 체크리스트 형태로 출시 티켓에.
- **Play 신고**(STORE-U10-07) — Android 플래그 ON 시점에.
- **법무 확인**(LEGAL-U10-01) · **약관·처리방침 개정**(LEGAL-U10-02) · **위치기반서비스사업 신고**(LEGAL-U10-05) — 플래그 ON 외부 배포 전.
- **배터리 실측**(MOBILE-U10-01) — 6-b #10, 플래그 ON/OFF 두 빌드.
- **킬 스위치 env**(델타 4) — Helm values·런타임 시크릿 목록에 1줄(Infrastructure Design 증분).
