# U6 Notification & Settings — Tech Stack Decisions

> 실장 우선. 아래 "실재" 표기는 전부 2026-08-24 실측이다.

---

## 1. 상속 (변경 없음)

| 항목 | 현행 | 근거 |
|---|---|---|
| 백엔드 | Spring Boot + Kotlin 모듈러 모놀리스 | U0 |
| 스케줄링 | **`@Scheduled(fixedDelayString=…)`** — `StalePartialSweeper` 선례 실재 | U4 "스케줄링 신규 인프라 0" |
| 관측 | `spring-boot-starter-actuator`(`libs.versions.toml:20`) + **`micrometer-registry-otlp`(:56)** 실재 | U0·U3 |
| 캐시 | Redis **미도입 유지**(U1 Q8=B 결정의 실행 보류 상태 그대로) | U1·U4 |
| 복원력 | 서킷 **미도입** — `resilience4j`가 리포에 **없다** | U1 P-RES-U1-1(문서만) · U4 재확인 |
| 이벤트 계약 | `common/core/event/`의 `DomainEvent`·`DomainEventPublisher`·`EventEnvelope` + PBT | U0/U1 자산 |
| 인프로세스 발행 | `app/event/SpringDomainEventPublisher` 실재, 4모듈이 주입 사용 | 〃 |
| 프런트 | Expo · TanStack Query · NativeWind · orval | `frontend/README.md` |

---

## 2. U6 델타 — **2개뿐**

### 델타 1 — ShedLock 라이브러리 추가 ★ (백엔드 유일한 신규 의존성)

- **테이블은 이미 있다** — `shedlock(name, lock_until, locked_at, locked_by)` V1.0.
- **라이브러리는 없다** — `libs.versions.toml`에 `shedlock` 항목 부재(실측).
- 필요한 이유: 릴레이가 **다중 인스턴스에서 단일 실행**돼야 한다(REL-U6-04). 락이 없으면 같은 이벤트로 푸시가 두 번 나간다.
- 추가 대상: `net.javacrumbs.shedlock:shedlock-spring` + `shedlock-provider-jdbc-template`.
- ⚠️ **테이블만 깔고 라이브러리를 안 넣은 상태가 V1.0부터 유지돼 왔다** — U0 스캐폴딩 부채의 잔여분이다.

> **[개정 · 2026-10-12] 델타 1 — 이행됨.** ShedLock 라이브러리가 추가됐고(`backend/gradle/libs.versions.toml` `shedlock = "6.10.0"` · `shedlock-spring` · `shedlock-jdbc`, TRIP-539) 릴레이 `backend/app/src/main/kotlin/com/trippilot/app/event/OutboxRelay.kt`가 `@SchedulerLock(name = "outbox-relay")`로 단일 실행된다. 재시도 백오프는 `next_attempt_at`(V2.45 `outbox_backoff`, TRIP-845). **물리 배치는 `common/core/event`가 아니라 `backend/app/.../app/event/`다**(DEC-U6-1과 다름).

### 델타 2 — `PushPort` + `ExpoPushAdapter` (신규 외부 의존)

- 결정: **Expo Push Service**(DEC-U6-3). 인셉션의 `PushPort`(FCM/APNs) 계약은 유지하고 **어댑터만 Expo**로 둔다 — "one external API = one owning module = one adapter port" 규약 준수.
- 콘솔 작업: Android FCM 서버 키를 **Expo에 한 번 등록**, iOS는 EAS 인증서 관리. **U0 소셜 IdP·U4 기상청 키보다 가볍다.**
- 교체 가능성: 무료 티어 초과 시 `FcmAdapter`로 교체(포트 뒤에서 끝난다).

> **[개정 · 2026-10-12] 델타 2 — 이행됨.** `backend/modules/notification/src/main/kotlin/com/trippilot/notification/adapter/out/push/ExpoPushAdapter.kt`(Expo push). 발송 스위치는 `PUSH_MODE`(`off|expo`)이고 EKS 런타임 기본값은 `off`다(`deploy/eks/runtime_secrets.py`, 토큰 `PUSH_EXPO_ACCESS_TOKEN`).

---

## 3. 프런트 — 신규 의존성 **0** ★

| 항목 | 상태 |
|---|---|
| `expo-notifications` | **`package.json ~0.32.17` + `app.config.ts:38` 플러그인 등록 완료**(실측). 사용처만 0 |
| **EAS 재빌드** | **불필요할 가능성이 높다** — 플러그인이 이미 등록돼 네이티브 모듈이 빌드에 포함됐을 것. **U4 `expo-task-manager`(신규 설치 + 재빌드 1회)와 결정적으로 다른 점** |
| 검증 | 착수 시 개발 빌드에서 권한 요청·토큰 획득이 되는지 먼저 확인한다. 안 되면 그때 재빌드 1회 |

> **[개정 · 2026-10-12] §3 "EAS 재빌드 불필요할 가능성" — 틀렸다.** iOS 빌드는 푸시 entitlement를 **명시적으로 제거**한다 — `frontend/app.config.ts`가 `withEntitlementsPlist`로 `aps-environment`를 지운다(TRIP-935 심사 빌드: 번들 ID에 Push 권한이 없어 프로비저닝 프로파일이 서명에서 거부됨, `expo-notifications`가 prebuild에서 자동으로 붙이므로 결과에서 지움). 따라서 서버 푸시를 켜려면 **① App Store Connect에서 번들 ID의 Push capability를 켜고 ② 이 래핑을 걷고 ③ 네이티브 재빌드**가 필요하다(코드 주석 "푸시를 켤 때는 ASC 에서 번들 ID 의 Push 권한을 먼저 켜고 이 래핑을 걷는다"). 서버 측 Expo push(`ExpoPushAdapter`)는 실재한다.

---

## 4. 미도입 결정 (지금 넣지 않는 것)

| 대상 | 왜 안 넣나 | 재평가 조건 |
|---|---|---|
| **WS/SSE(`RealtimePort`)** | "누락 0"은 영속성으로 달성된다(DEC-U6-4). WS를 써도 끊긴 구간은 폴링으로 메워야 한다 | 릴레이 지연이 반복 초과 + 실시간 요구 발생 |
| **dead-letter 테이블** | `WHERE published_at IS NULL AND attempts >= 10`으로 조회가 끝난다(REL-U6-02) | 재처리 운영이 실제로 필요해질 때 |
| **서킷 브레이커(resilience4j)** | 리포에 없고, Expo 장애는 재시도 + 인앱 폴백으로 흡수된다 | 외부 포트 전반 도입 결정 시 |
| **메시지 브로커(Kafka/SQS)** | 아웃박스 + DB 폴링으로 충분한 규모. 브로커는 운영 축을 통째로 추가한다 | 발송량이 폴링으로 감당 안 될 때 |
| **야간 조용시간 스케줄러** | Q1=B — **그냥 발송**(LEGAL-U6-01) | **광고성 알림 종류 추가 시 즉시**(LEGAL-U6-03) · 이탈/CS 관측 시 |
| **Redis** | U1 결정의 보류 상태 유지. 토글·상한 카운터는 DB로 충분 | 발송량 상한 카운팅이 DB 부하가 될 때 |

> **[개정 · 2026-10-12] dead-letter 행 보강.** 백오프는 `attempts` 계산이 아니라 `next_attempt_at` 컬럼(V2.45)으로 조회한다(nfr-requirements REL-U6-01 개정분, TRIP-845).

---

## 5. 백엔드 신규 자산 요약

| 종류 | 내용 |
|---|---|
| 모듈 | `notification` **1개 신설** |
| 공용 | **아웃박스 릴레이**(`common/core/event`에 추가 — 모듈 아님) |
| 마이그레이션 | **V2.33~V2.36** 4종(`notification`·`notification_toggle`·`push_token`·`notification_schedule`) — U5 제안분 다음, 머지 시점 재배정 |
| openapi | `notification` 태그 신규(알림함 조회·읽음·토글 조회/변경·토큰 등록) + **`/me/export` 신설**(G-U6-3) |
| 이벤트 발행부 | **U6 밖** — U1 숙소·U4 Plan-B·U5 회고 3종(G-U6-2) |

> **[개정 · 2026-10-12] §5 실장 대조.** ① 릴레이 위치는 `common/core/event`가 아니라 **`backend/app/src/main/kotlin/com/trippilot/app/event/OutboxRelay.kt`**. ② 마이그레이션 실번호: `notification` **V2.31** · `notification_schedule` **V2.32** · `notification_toggle` **V2.35** · `push_token` **V2.40**(+`outbox_backoff` V2.45 · `notification_push_rate` V2.46 · `notification_schedule_copy` V2.47) · 설정 `account_setting` **V2.42**. ③ **`/me/export`는 구현됐다** — `GET /api/v1/me/export`(`backend/app/src/main/kotlin/com/trippilot/app/export/AccountExportController.kt`). ④ 이벤트 발행부 3종은 붙었다 — `notification`이 `stay.StayRegistered`·`planb.PlanBTriggered`·`reflection.ReflectionReady`를 구독한다(`backend/modules/notification/src/main/kotlin/com/trippilot/notification/adapter/in/event/DomainNotificationSubscribers.kt`).

---

## 6. 개발 중 처리 (설계 문서 밖)

- **Expo 푸시 콘솔 설정** — Android FCM 서버 키 등록 · iOS EAS 인증서. U0 IdP·U4 기상청 키와 동류의 **콘솔 선결 항목**.
- **ShedLock 의존성 추가 + 릴레이 첫 배선** — U5·U6 설계 전체의 전제를 실증하는 작업. `itinerary.ItineraryGenerated`가 **이미 발행 중**이라 이걸 구독해 리마인드 스케줄을 적재하면 **U3 코드 수정 없이 첫 경로가 열린다**.
- **다중 인스턴스 검증** — 현재 로컬 단일 인스턴스라 락이 실제로 필요한 상황이 아직 없다. 배포 진입 시 확인.

> **[개정 · 2026-10-12] §6 갱신.** ShedLock·릴레이 배선은 완료(TRIP-539). 배포는 AWS EKS로 진입했고 dev·prd backend replicas 2라 다중 인스턴스 검증 조건이 실재한다 — 인프라 결정은 `aidlc/aidlc-docs/construction/shared-infrastructure.md`. Expo 콘솔·iOS Push capability는 여전히 선결 항목이다(§3 개정).
