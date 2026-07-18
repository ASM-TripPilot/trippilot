# U0 Foundation — Logical Components

> 논리 설계(배치·제품 선정 아님 — 인프라 매핑은 Infrastructure Design). 패턴 근거는 `nfr-design-patterns.md`(P-*), 규칙 근거는 `../functional-design/business-rules.md`(BR-U0-*).
> Q5 확정(2026-07-17): U0 신규 논리 컴포넌트 **7종**. 크로스커팅(로깅·오류·이벤트버스·테스트 하네스·아키텍처 게이트)은 **TRIP-148~150 기존 자산 수용 — 신규 설계 없음**.

## 1. 컴포넌트 맵

```
[모바일 앱]
   │ HTTPS
   ▼
┌──────────────── 앱 컨테이너 (무상태, min 2 / 다중 AZ) ─────────────────┐
│                                                                       │
│  [RateLimiter] ──── 전 인증 요청 선통과 (IP·계정 2축)                 │
│        │                                                              │
│        ▼                                                              │
│  [BootstrapAssembler]        [TokenService]        [ConsentLedger]    │
│        │                          │                       │           │
│        │                          ▼                       │           │
│        │                   [SocialOAuthPort]              │           │
│        │                     ├ Google 어댑터              │           │
│        │                     ├ 카카오 어댑터   ← [CircuitBreaker]×4   │
│        │                     ├ 네이버 어댑터                          │
│        │                     └ Apple 어댑터                           │
│        │                                                              │
│  [OutboxRelay(골격)] ──── 폴링 ────┐                                  │
│                                    │                                  │
│  ── 기존 자산: 구조화 로깅·표준 오류·이벤트버스(TRIP-148) ──          │
└────────────────────────────────────┼──────────────────────────────────┘
                                     ▼
                        [PostgreSQL 단일 프라이머리]
                        V1.0~V1.7 (outbox·auth_*·consent·moderation)
                                     ▲
                                     │ (읽기 복제본 미도입 — P-SCALE-2)
                        [외부 IdP ×4] ← 아웃바운드만
```

**경계 원칙**: 앱 컨테이너 내부는 무상태. 상태 정본은 PostgreSQL 단독(캐시는 재구성 가능한 파생만 — P-PERF-1).

## 2. 컴포넌트 명세

### C-1. `SocialOAuthPort` + 제공자 어댑터 4

| 항목 | 내용 |
|---|---|
| 책임 | 제공자별 자격 증명 → **(provider, provider_sub) + 프로필** 확정. 두 경로 수용: `AUTH_CODE`(코드 교환) · `SDK_TOKEN`(제공자 조회 API 검증) |
| 포트/어댑터 | 도메인은 포트에만 의존 — 제공자 SDK·HTTP 세부는 어댑터 안에 격리(제공자 추가·교체가 도메인 무변경) |
| NFR | P-SEC-1(fail-closed 검증) · P-RES-2(어댑터마다 서킷 인스턴스) · P-RES-1(자동 재시도 **없음**) |
| 통합 | 아웃바운드 HTTP, 타임아웃 3초. 클라이언트 시크릿·Apple p8 키는 **서버만 보유**(SEC-06) |
| 상태 | 무상태 (JWKS·메타 캐시는 C-8) |
| 갭 | **G-1** — openapi `SocialLoginRequest`에 `grantType` 필드 추가 개정 필요(백엔드 협의) |

### C-2. `TokenService`

| 항목 | 내용 |
|---|---|
| 책임 | 액세스 토큰 발급(ES256·1h·무상태) · 검증 파이프라인 · **리프레시 회전 체인**(90d·해시만 저장·기기별 체인) · 재사용 감지 시 체인 전체 무효화 |
| NFR | P-SEC-1(alg 화이트리스트) · P-SEC-2(2키 중첩 롤오버) · P-PERF-4(클라 single-flight와 계약) |
| 불변식 | **INV-R1: 체인당 현행 토큰 ≤ 1** — 회전·재사용 판정은 캐시 미경유, DB 정본 읽기 |
| 통합 | `auth_session`(V1.4) · 재사용 감지 시 보안 이벤트 발행(P-OBS-2, **건당 즉시**) |
| 상태 | 서명키 = 시크릿 주입(제품은 Infra Design). 검증 셋 = 최대 2 kid |

### C-3. `RateLimiter`

| 항목 | 내용 |
|---|---|
| 책임 | IP·계정 2축 독립 판정 → 초과 시 **429 + `retryAfter`** |
| 대상 | `/auth/social/*` · `/auth/token/refresh` · 닉네임 검사 |
| NFR | P-SEC-3 · P-SCALE-3(스파이크를 제어된 저하로 흡수) |
| 상태 | **PostgreSQL 카운터 정본**(Redis 미도입). 임계는 외부화 설정 — 재배포 없이 조정 |
| 통합 | 인증 처리 **이전** 관문 통과. 429 급증은 보안 이벤트(P-OBS-2) |
| 트리거 | 카운터 쓰기가 DB 부하 상위 요인이 되면 분산 카운터 재평가 |

### C-4. `CircuitBreaker` (제공자별 인스턴스 ×4)

| 항목 | 내용 |
|---|---|
| 책임 | 제공자 호출 실패율 감시 → open 시 즉시 실패(호출 미시도), half-open 탐침 복구 |
| NFR | P-RES-2 — **격리 단위 = 제공자**(벌크헤드). 한 제공자 장애가 타 제공자 로그인 차단 금지 |
| UX 계약 | open = 해당 제공자 버튼만 저하 안내, 타 제공자 정상 노출(UX-01 침묵 실패 금지) |
| 상태 | 인스턴스 로컬(공유 불필요 — 각 인스턴스가 독립 관측) |

### C-5. `OutboxRelay` (골격 — Q9 기확정)

| 항목 | 내용 |
|---|---|
| 책임 | `outbox`(V1.0) 폴링 → 이벤트버스 발행 → 상태 전이. **U0는 골격까지**, 실소비 컨슈머는 U1+ |
| 적재 규약 | 상태 변경과 **단일 트랜잭션** 적재(이중 쓰기 금지) — RES-02 |
| NFR | P-RES-1(지수 백오프+지터, 최대 시도 후 DLQ 전이 — 무한 재시도 금지) · at-least-once + **이벤트 ID 멱등 소비** |
| U0 이벤트 | `AccountCreated` · `AccountDeletionRequested`(캐스케이드 개시 신호) |
| 통합 | TRIP-148 이벤트버스 자산 — 브로커 미도입(§9 미도입 표) |

### C-6. `ConsentLedger`

| 항목 | 내용 |
|---|---|
| 책임 | 동의 GRANT/REVOKE 이력 append + **현재 상태 fold**(최신 레코드 기준) · 필수 3종 충족 판정 |
| NFR | **P-SEC-7 — append-only, app 역할 UPDATE/DELETE 권한 회수(V1.7)**. 파기 시에도 캐스케이드 제외(LEGAL-03·BR-U0-13) |
| PBT | 임의 GRANT/REVOKE 시퀀스에서 fold 결과 = 최신 레코드 일치 · 멱등(blocking 게이트 §9) |
| 통합 | `consent_record`·`terms_version`(V1.2). 현행 버전 조회는 캐시(TTL 5분), **증적 쓰기·판정은 DB 정본** |

### C-7. `BootstrapAssembler`

| 항목 | 내용 |
|---|---|
| 책임 | `GET /bootstrap` 1왕복 조립 → `{appUpdate, reconsent, session}` |
| 판정 | **부수효과 없는 순수 함수** · 고정 우선순위: `FORCED` > `reconsent` > 세션 무효 > `ONBOARDING_INCOMPLETE` > 홈 |
| NFR | P-PERF-2(**IdP 호출 경로 배제** — 예산 잠식 방지) · P-RES-4(버전 게이트 fail-open) |
| PBT | 임의 입력 조합에서 **우선순위 역전 0 · 유일 목적지**(클라 `resolveEntry`와 동형 — blocking 게이트) |
| 통합 | 캐시(약관·앱 버전 정책) + DB 조회 1~2회(세션·온보딩 상태) |

### C-8. 캐시 (컴포넌트 아닌 **횡단 메커니즘**)

프로세스 로컬 TTL 캐시(P-PERF-1) — JWKS·제공자 메타(10분) · 약관 현행 버전·금칙어 사전(5분). **stale-if-error**: 갱신 실패 시 직전 값 유지(P-RES-3). 별도 인프라 없음.

## 3. 기존 자산 수용 (신규 설계 없음)

| 자산 | 출처 | U0 델타 |
|---|---|---|
| 구조화 로깅(상관 ID) · 표준 오류 · 이벤트버스 | TRIP-148 | **PII 마스킹 컨버터 추가**(P-SEC-6 — 유일한 델타) |
| 테스트 하네스(Kotest·MockK·Testcontainers) | TRIP-149 | 복원력 시나리오 RT-1~7 수용 |
| 아키텍처 게이트(ArchUnit·Konsist) | TRIP-150 | **"가드 없는 공개 핸들러" 규칙 추가**(P-SEC-4) |
| 스키마 정본(Flyway V1.0~V1.7) | TRIP-147 | 신규 마이그레이션은 **전방호환 규약**(P-DEP-3) 준수 |
| CI(GitHub Actions) | 실재 | RT-1~7 · 구버전앱↔신스키마 호환 잡 추가 |

## 4. 프론트엔드 논리 요소 (`frontend/README.md` 정본 하위)

| 요소 | 책임 | NFR |
|---|---|---|
| `resolveEntry` | 부트스트랩 응답 → 진입 화면 (서버 C-7과 **동형 판정**) | PBT blocking(우선순위 역전 0·유일 목적지) |
| HTTP 인터셉터 | 401 → 리프레시 **single-flight 직렬화** | P-PERF-4(자기 재사용 오탐 방지) |
| 토큰 저장소 | OS 보안 저장소 전용(expo-secure-store) | SEC-09 |
| 소셜 로그인 어댑터 | 제공자별 SDK/브라우저 차이 흡수 → 서버엔 `grantType`+자격 증명 | C-1과 대칭 |
| 오류·스켈레톤 표준(shared/ui) | 침묵 실패 금지 · 200ms 미만 로딩 생략 | UX-01·02 · P-PERF-3 |

## 5. 컴포넌트 → NFR 추적

| 컴포넌트 | 주 NFR |
|---|---|
| C-1 SocialOAuthPort | SEC-06 · RES-01 · P-RES-2 |
| C-2 TokenService | SEC-01·02 · P-SEC-2 · INV-R1 |
| C-3 RateLimiter | SEC-03 · SCALE-02·03 |
| C-4 CircuitBreaker | RES-01 · UX-01 |
| C-5 OutboxRelay | RES-02 |
| C-6 ConsentLedger | SEC-08 · LEGAL-02·03 |
| C-7 BootstrapAssembler | PERF-01·02 · AVAIL-02 · BR-U0-27 |
| C-8 캐시 | PERF-01 · RES-03 |

## 6. Infrastructure Design 이연

시크릿 매니저 제품(C-2 서명키 주입) · 로그 수집/APM/알림 라우팅(P-OBS-2) · 컨테이너 런타임·오토스케일 정책 수치(P-SCALE-1) · LB·헬스체크 연결(AVAIL-01) · 다중 AZ 배치 상세 · DB 백업/복구 목표 · 게임데이 RT-10 실행 환경.
