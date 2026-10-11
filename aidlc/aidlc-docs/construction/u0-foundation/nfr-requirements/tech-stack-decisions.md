# U0 Foundation — Tech Stack Decisions

> 대부분은 **기존 확정의 기록**이다(리포 실재 코드·`frontend/README.md` 정본). 신규 결정은 §3 U0 델타뿐. 버전은 리포의 잠금 파일·버전 카탈로그가 정본 — 여기 표기는 라인 수준.

## 1. 기존 확정 — 백엔드 (리포 실재)

| 영역 | 결정 | 근거 |
|---|---|---|
| 언어·프레임워크 | Kotlin + Spring Boot, Gradle 멀티모듈(모듈=컴포넌트, `app` 단일 조립) | TRIP-145 스캐폴드 실재 |
| DB·마이그레이션 | PostgreSQL + Flyway SQL-first forward-only (`V1.0~V1.7` = 스키마 정본) | TRIP-147 |
| 크로스커팅 | 구조화 로깅·표준 오류·이벤트버스(TRIP-148, develop) · 테스트 하네스(TRIP-149) · ArchUnit/Konsist 게이트(TRIP-150) | 각 브랜치 실재 — U0 개발 시 수용 |
| 테스트 | Kotest(+kotest-property) · MockK · Testcontainers(PostgreSQL) | CLAUDE.md 기확정 |
| 로컬 통합 | docker-compose + GHCR 이미지 | TRIP-146 |

## 2. 기존 확정 — 프론트엔드 (`frontend/README.md` 정본)

Expo(dev build+prebuild)·Expo Router·TanStack Query v5+Zustand·RHF+Zod·axios(+expo/fetch 스트리밍 경로)·expo-secure-store·NativeWind 4(tailwindcss 3.4.x)·orval 코드젠·pnpm·Jest(jest-expo)+fast-check+RNTL·Sentry·reanimated/gesture-handler/@gorhom/bottom-sheet·expo-notifications/expo-location/netinfo — 상세·근거는 정본 참조. U0 관련 특기: 소셜 로그인은 어댑터 뒤 카카오·네이버 네이티브 SDK + Google auth-session + Apple 전용 모듈.

## 3. U0 델타 결정 (이번 확정)

| 영역 | 결정 | 근거 |
|---|---|---|
| JWT 서명 | **ES256 + JWK 셋(kid 롤오버)**, `none`·HS256 거부 고정. 구현은 Spring Security 리소스서버 계열 + Nimbus JOSE | NFR-U0-SEC-01 · Q5 |
| 소셜 검증 | `SocialOAuthPort` + 제공자 어댑터 4종. `AUTH_CODE`(코드 교환)·`SDK_TOKEN`(제공자 조회 API 검증) 이중 수용 — openapi 개정 G-1 동반 | BR-U0-02 · Q3 |
| 레이트리미터 | PostgreSQL 카운터 정본(적당 규모 — 별도 Redis 도입 안 함, 병목 실측 시 재평가). 임계 외부화 설정 | NFR-U0-SEC-03 · SCALE-01 |
| 브라우저 로그인 보조 | Google=expo-auth-session(PKCE), Apple=expo-apple-authentication — 코드 교환은 서버 | frontend 정본 |
| 시크릿 | 코드·설정 파일에 시크릿 0 — 주입 인터페이스만 U0 확정, 매니저 제품은 Infrastructure Design | NFR-U0-SEC-01 |
| 관측 수집 | U0는 stdout JSON + Sentry까지. 수집·APM·알림 라우팅 제품은 Infrastructure Design | NFR-U0-OBS |

> **[개정 · 2026-10-12]** 액세스 토큰 서명 알고리즘은 **RS256** 이다(원문 보존 — 개정 전: "ES256"). 근거: `backend/common/security/src/main/kotlin/com/trippilot/security/AccessTokenIssuer.kt`(`SignatureAlgorithm.RS256`) · `JwtSigningKeys.kt`(RSA 키, kid=RFC 7638 지문) · `JwtSecurityConfig.kt`. ES256 은 **Apple `client_secret` 서명에만** 쓴다(`backend/modules/auth/.../external/AppleClientSecret.kt`, TRIP-933). 검증 셋은 현재 **단일 키**(`ImmutableJWKSet(JWKSet(rsaKey))`)라 "kid 2키 중첩 롤오버"(P-SEC-2)는 미구현이다. 서명키는 env `JWT_SIGNING_KEY` 로 주입되며 배포 환경에서는 AWS Secrets Manager(`trippilot/{env}/backend`, `infra/terraform/stack/registry-secrets.tf`) → Helm `deploy/eks/chart/templates/backend.yaml` 경로다.

> **[개정 · 2026-10-12]** 앱 내 PostgreSQL 카운터 레이트리미터는 **구현되지 않았다** — `RateLimited` 예외(`backend/common/core/.../error/DomainException.kt`)와 429 매핑(`GlobalExceptionHandler.kt`)은 있으나 던지는 지점 0건(backend main 전역 검색). 현행 429 는 **배포 게이트웨이(nginx) IP 단위 `limit_req` 10r/s · burst 30**(`deploy/eks/chart/templates/gateway-config.yaml`, `/api`·`/api/` 경로)이 담당한다. 엔드포인트별 임계(로그인·닉네임 등)는 없다 — 필요 여부는 사용자 판단 대상.

## 4. 이연 (Infrastructure Design 대상)

시크릿 매니저 제품 · 로그 수집/APM/알림 제품 · CI/CD 배포·롤백 상세(RESILIENCY-04) · 복원력 테스트 시나리오(RESILIENCY-14) · 인프라 토폴로지 상세(다중 AZ 배치·LB·헬스체크 연결).

> **[개정 · 2026-10-12]** 인프라는 **AWS EKS 로 배포됐다** — 이연 항목의 현행 결정은 유닛별이 아니라 공용 문서 `aidlc/aidlc-docs/construction/shared-infrastructure.md` 가 정본이다. 코드 근거: Terraform `infra/terraform/stack/{network,eks,data,registry-secrets}.tf`(VPC·EKS·RDS PostgreSQL·ElastiCache Redis·ECR·Secrets Manager `trippilot/{env}/{backend,ai,database,shared}`·CloudWatch Container Insights), Helm `deploy/eks/chart`(values-dev/prd), 배포 워크플로 `.github/workflows/aws-deploy.yml`. 시크릿 매니저 제품 = AWS Secrets Manager(JWT 서명키 `JWT_SIGNING_KEY` 포함).
