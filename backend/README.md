# trippilot-backend

TripPilot 백엔드 (Spring Boot + Kotlin · PostgreSQL 모듈러 모놀리스).

- 설계 정본(문서 레포): [ASM-TripPilot/TripPilot](https://github.com/ASM-TripPilot/TripPilot)
- 로컬 설계 산출물: `docs/design/`
  - `TripPilot-백엔드-우선순위-로드맵.md`
  - `U1-DB스키마-설계.md`
  - `U1-API-설계.md`

## 스택

- Kotlin 2.2.20 / JDK 25 툴체인
- Spring Boot 4.0.1 (Spring Security 는 그 BOM 이 관리)
- PostgreSQL 16 · Flyway (SQL-first, forward-only)
- Gradle 9.6.1 (Kotlin DSL, 멀티모듈)
- 테스트: Kotest(+kotest-property) · MockK · Testcontainers · ArchUnit

## 모듈 구조

```
app/                 Spring Boot 조립 (유일한 부트 앱) · Flyway 마이그레이션 V1.0–V2.40 + R__ 시드 6
common/core          도메인 이벤트 버스 · 트랜잭셔널 아웃박스
common/security      JWT 검증 · 인증 필터
common/test-support  Testcontainers 기반 통합테스트 지원
modules/             기능 모듈 15 — accommodation-search · archive · auth · change-log ·
                     itinerary-generation · itinerary-recalculation · moderation · notification ·
                     place-data · planb-detection · profile · reflection · saved-accommodation ·
                     trip · weather-context
```

모듈 층은 `api / application / domain / adapter` 이며, **다른 모듈은 `api` 만 의존**한다
(Konsist·ArchUnit 이 빌드에서 강제).

## 상태

구현 중. 15개 기능 모듈이 동작하고 테스트 소스 197개가 있다. 문서와 코드가 어긋나면 코드가 정본이다.
