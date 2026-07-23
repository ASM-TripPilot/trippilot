# U1 Accommodation & Trip Setup — Tech Stack Decisions

> U0와 마찬가지로 신규 스택 선택이 아니라 **기존 결정 상속 + U1 델타** 기록이 중심. 답변 확정 2026-07-23.

## 1. 상속 — 변경 없음

| 영역 | 결정 | 출처 |
|---|---|---|
| 백엔드 | Kotlin · Spring Boot · Gradle 멀티모듈 · Flyway SQL-first forward-only | U0 · 리포 실재 |
| 모듈 구조 | 모듈=컴포넌트, 계층 api/application/domain/infra, 타 모듈은 `api`만 의존 | 루트 CLAUDE.md |
| 프론트 | Expo · Expo Router · TanStack Query + Zustand · NativeWind · orval · pnpm | `frontend/README.md` |
| 인증·인가 | JWT ES256 · 객체 수준 인가 · 무상태 검증 | U0 SEC |
| 이벤트 | 트랜잭셔널 아웃박스(at-least-once·멱등 구독) | U0 · V1.0 |
| 관측성 | 구조화 JSON 로그·상관 ID·PII 마스킹 / 프론트 Sentry | U0 OBS |

## 2. U1 신규 모듈 (backend)

C7 이관(CQ3=B)을 반영한 U1 소유 모듈:

```
backend/modules/
  place-data/            # C7 — poi·poi_snapshot·수집 게이트·CandidatePoolPort (U3→U1 이관)
  accommodation-search/  # C3 — 탐색·필터·최저가 스냅숏·라이브가
  saved-accommodation/   # C4 — saved_stay·base_assignment·trip_base_day (앵커)
  affiliate-link/        # C5 — ota_partner·outbound_click·딥링크·포스트백
  trip/                  # C6 — trip·trip_destination·must_visit·홈 집계
```

- 마이그레이션은 U0 Flyway 체인을 이어 **V2.x**로 추가(포워드 온리). `trip_destination`(신설)·가격 스냅숏 컬럼 포함.

## 3. U1 델타 결정

| # | 결정 | 근거 | 비고 |
|---|---|---|---|
| U1-TS-1 | **지도·장소 검색 = 카카오**(맵 SDK + 로컬 검색 API, 한 벤더) | DEC-5 · Q5 | 키는 서버 프록시(SEC-U1-05). RN 네이티브 SDK — Expo dev build 필요 |
| U1-TS-2 | **외부 의존은 전부 포트 + 스텁 어댑터**로 1차 구현 | DEC-3 · Q3 | Content·Snapshot·LivePrice·Deeplink·PlaceSearch·MapRender 6종. Resilience4j로 타임아웃·서킷(벤더별 인스턴스 분리) |
| U1-TS-3 | **최저가 스냅숏 = 배치 갱신**(일 1회) | Q1 · DATA-U1-01 | 스케줄러는 U0 ShedLock(V1.x 실재) 재사용 — 단일 실행 보장 |
| U1-TS-4 | **Redis 도입** — U1 캐시·지역 집계용 | **Q8=B** | §5 상세. U0 "Redis 미도입" 기준선을 U1에서 변경 |
| U1-TS-5 | POI·스냅숏·집계는 **PostgreSQL 영속 테이블**(캐시가 아니라 데이터) | Q8 논지 | Redis는 그 위의 조회 캐시 계층 |
| U1-TS-6 | 지도 쿼터 **상한 없이 모니터링**, 검색어 5분 캐시 | Q5=B | 상한 로직 미구현, 소진율 지표만(OBS-U1-02) |

## 4. Q8=B 파급 정리 (기준선 변경)

U0는 "적당한 규모 → Redis 미도입, 레이트리밋 카운터도 PostgreSQL"로 과설계를 피했다. Q8=B는 이를 U1에서 뒤집는다. 파급을 명확히 한다:

| 항목 | 처리 |
|---|---|
| **Redis 용도(U1)** | 숙소 목록·지역 집계·POI 검색 결과의 **조회 캐시**(짧은 TTL). 원본은 PostgreSQL |
| **U0 레이트리밋 카운터** | **PostgreSQL 유지** — 이미 U0에서 설계·구현된 SEC-03을 Redis로 되돌리지 않는다(불필요한 재작업). 단, Redis가 이미 있으므로 병목 실측 시 이관은 저비용 |
| **U0 재평가 트리거와의 관계** | U0가 "병목 실측 시 Redis 재평가"를 걸어 뒀고, U1이 그 트리거를 **당겨서 선제 도입**하는 형태 — 규칙 위반 아님 |
| **로컬 실행** | 리포 루트 `docker-compose.yml`에 **Redis 컨테이너 추가**가 전제(로컬 전용, TRIP-146 스택 확장) |
| **캐시 무효화** | 스냅숏 배치·POI `data_status` 변경 시 관련 키 무효화. 캐시-원본 불일치는 TTL로 상한 |
| **재평가(역방향)** | 실측 캐시 적중률이 낮으면 인메모리로 축소(NFR §11) — 과설계 회피 원칙 유지 |

## 5. 이연 (Infrastructure Design 대상 — 현재 SKIP)

배포·클라우드 진입 시 확정할 항목(U0와 동일하게 로컬 전용이라 이연):

- Redis 운영 토폴로지(관리형 vs 자체 호스팅·다중 AZ)
- 카카오 API 키·시크릿 주입(로컬 `.env` 커밋 금지만 유지)
- 스냅숏 배치 실행 환경(스케줄러 배치 vs 별도 워커)
- 외부 포트 실어댑터 전환 시 벤더 계약·쿼터·과금 방어(COST-U1-01 재평가)
- POI 초기 적재 파이프라인(TourAPI 등 수집 소스 — 실연동 단계)
