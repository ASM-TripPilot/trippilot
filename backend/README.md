# trippilot-backend

TripPilot 백엔드 (Spring Boot + Kotlin · PostgreSQL 모듈러 모놀리스).

- 설계 정본(문서 레포): [ASM-TripPilot/TripPilot](https://github.com/ASM-TripPilot/TripPilot)
- 로컬 설계 산출물: `docs/design/`
  - `TripPilot-백엔드-우선순위-로드맵.md`
  - `U1-DB스키마-설계.md`
  - `U1-API-설계.md`

## 스택

- Kotlin 2.1 / JDK 21 (LTS)
- Spring Boot 3.4 · Spring Security 6.4
- PostgreSQL 16 · Flyway (SQL-first)
- Gradle 8.x (Kotlin DSL, 멀티모듈)
- 테스트: Kotest(+kotest-property) · MockK · Testcontainers · ArchUnit

## 모듈 구조 (예정)

```
app/                 Spring Boot 조립 (유일한 부트 앱) · Flyway 마이그레이션
common/core          도메인 이벤트 버스 · 트랜잭셔널 아웃박스
common/security      JWT 검증 · 인증 필터
modules/auth         M1 계정 · 소셜 · 토큰 · 동의 · 법정로그
modules/profile      M2 프로필 · 취향 · 닉네임 · 금칙어(C3)
```

## 상태

설계 단계 — 아직 구현 코드 없음. 스키마·API 설계 확정 후 스캐폴딩 착수.
