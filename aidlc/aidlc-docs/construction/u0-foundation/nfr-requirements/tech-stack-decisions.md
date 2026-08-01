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

## 4. 이연 (Infrastructure Design 대상)

시크릿 매니저 제품 · 로그 수집/APM/알림 제품 · CI/CD 배포·롤백 상세(RESILIENCY-04) · 복원력 테스트 시나리오(RESILIENCY-14) · 인프라 토폴로지 상세(다중 AZ 배치·LB·헬스체크 연결).
