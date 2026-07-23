# U1 Accommodation & Trip Setup — Logical Components

> 입력: `nfr-design-patterns.md`(P-*-U1) + `functional-design/`. U0 논리 컴포넌트 C-1~C-8 위에 이어짐. 명명 `LC-U1-#`.
> 답변 확정 2026-07-23 Q5·Q6 추천 채택.

## 1. 컴포넌트 맵

```text
U1 (backend modules)
  place-data/           LC-U1-6 PoiCollectionGate ─┐(INV-1)
                        LC-U1-8 CandidatePoolProvider ┴─→ (U3 소비)
  accommodation-search/ LC-U1-1 AccommodationContentPort(+스텁)
                        LC-U1-3 LivePriceGateway(캐시 금지)
                        LC-U1-2 PriceSnapshotBatch(ShedLock)
  saved-accommodation/  LC-U1-7 CoverageResolver(차단 판정)  · (앵커: RegisteredStayFacade)
  affiliate-link/       LC-U1-4 OtaDeeplinkService(추적ID·서명·멱등)
  trip/                 (TripFacade·홈 집계 — 순수 도메인, 신규 인프라 컴포넌트 없음)
  [공용]                LC-U1-5 PlaceSearchPort + MapRenderPort(카카오·서버 프록시·쿼터 모니터)
  [횡단]                U0 자산(로깅·아웃박스·서킷·ArchUnit) + Redis 캐시(신규) + Resilience4j
```

## 2. 컴포넌트 명세

### LC-U1-1. `AccommodationContentPort` + 스텁 어댑터
| | |
|---|---|
| 책임 | 숙소 정적 콘텐츠(이름·좌표·사진·편의시설) 조회. 1차 고정 데이터 스텁 |
| NFR | P-RES-U1-1(벤더별 서킷) · P-RES-U1-3(stale-if-error) · P-PERF-U1-2(검색 결과 10분 캐시) |
| 통합 | 타임아웃 2s · 재시도 없음(P-RES-U1-2) · Resilience4j 서킷 인스턴스 |
| 상태 | 무상태(캐시는 Redis) |

### LC-U1-2. `PriceSnapshotBatch`
| | |
|---|---|
| 책임 | 최저가 스냅숏 일 1회 갱신, 지역·인기 숙소 우선 |
| NFR | P-DATA-U1-1 · **ShedLock 단일 실행**(U0 자산 재사용, 다인스턴스 중복 방지) |
| 통합 | 비대화형 — 백오프 재시도 허용(사용자 지연 무관). 완료 시 관련 Redis 키 무효화 |
| 상태 | 배치 스케줄 |

### LC-U1-3. `LivePriceGateway`
| | |
|---|---|
| 책임 | 정확 1박가 표시 시점 조회 |
| NFR | **P-PERF-U1-2 캐시 절대 금지**(DATA-U1-03) · 타임아웃 1.5s · 실패 시 "가격 미확인" |
| 상태 | 무상태, 조회 결과 즉시 폐기 |

### LC-U1-4. `OtaDeeplinkService`
| | |
|---|---|
| 책임 | 딥링크 파라미터 구성 · 아웃바운드 추적 · 포스트백 수신 |
| NFR | **P-SEC-U1-2** — 서버 추적 ID · HMAC-SHA256 서명 검증 · skew ±5분 · 거래 ID 멱등 · 지표 응답 노출 차단 |
| 통합 | `OtaPartner`에 벤더별 시크릿·딥링크 템플릿 보유. 검증 실패 = 미저장 + 보안 이벤트 |

### LC-U1-5. `PlaceSearchPort` + `MapRenderPort` (카카오)
| | |
|---|---|
| 책임 | 장소·주소 검색·좌표 해석(Local) + 지도 렌더·핀(Map SDK) |
| NFR | P-SEC-U1-3(**키 서버 프록시**) · P-COST-U1-1(쿼터 소진율 관측·상한 없음) · P-PERF-U1-3(디바운스 300ms·검색어 5분 캐시) · P-RES-U1-4(실패 시 핀/주소 폴백) |
| 통합 | `PlaceSearchPort`는 실연동 가능(국내 쿼터). 지도 SDK는 Expo dev build 필요 |

### LC-U1-6. `PoiCollectionGate` — INV-1 소유자
| | |
|---|---|
| 책임 | 웹·외부 출처 POI를 **수집 게이트 통과 시에만 `ACTIVE`로 승격**. 미통과는 `UNVERIFIED` 적재만 |
| NFR | **PBT-U1-1 blocking**(후보풀에 게이트 미통과 POI가 절대 없음) · Q6: **쓰기 경로 동기 배치**(승격 지점에서 게이트, 조회 재검사 없음) |
| 통합 | 단건 판정 100ms 이내(SCALE-U1). 이 컴포넌트가 CQ3=B로 U3에서 U1로 이동한 C7의 핵심 |

### LC-U1-7. `CoverageResolver`
| | |
|---|---|
| 책임 | 여행 날짜별 거점 판정 — 후보 1개=auto, 겹침·공백=미해결(차단) |
| NFR | **PBT-U1-2 blocking**(모든 날짜 정확히 하나의 판정, 기간 밖 없음) · 순수 함수(서버·클라 동형 — 프론트 PBT와 대칭) |
| 통합 | 전 날짜 확정 시 `TripBaseResolved` 발행 → 일정 생성 게이트 해제(BR-U1-46) |

### LC-U1-8. `CandidatePoolProvider`
| | |
|---|---|
| 책임 | U3 솔버·일정 생성에 **closed-set 후보풀** 제공(`CandidatePoolPort`) |
| NFR | LC-U1-6이 걸러낸 `ACTIVE` POI만 노출 — 조회 시점에는 이미 검증된 데이터만 |
| 통합 | U1 → U3 계약. Bedrock 교체·U3 변경에도 이 계약은 불변 |

## 3. 기존 자산 수용 (신규 설계 최소화)

| 자산 | 출처 | U1 델타 |
|---|---|---|
| 구조화 로깅·상관 ID·아웃박스·이벤트버스 | U0/TRIP-148 | 이벤트 6종 추가 발행(도메인 이벤트만, 인프라 그대로) |
| 서킷 브레이커(Resilience4j) | U0 P-RES-2 | **다벤더 인스턴스 확장**(P-RES-U1-1) — 프레임워크 동일 |
| ShedLock 스케줄 락 | U0(V1.x) | `PriceSnapshotBatch` 재사용 |
| ArchUnit·Konsist | U0/TRIP-150 | **closed-set 게이트 우회 금지 규칙 추가**(조회가 게이트 건너뛰지 못하게) |
| 위치 동의·법정 로그 | U0/V1.3 | '내 주변' 이용 사실 append-only 기록(LEGAL-U1-02) — 신규 테이블 없음 |
| **Redis** | **신규(Q8=B)** | U0에 없던 유일한 인프라 추가 — 로컬 docker-compose에 컨테이너 추가 전제 |

## 4. 프론트엔드 논리 요소 (`frontend/README.md` 정본 하위)

| 요소 | 책임 | NFR/PBT |
|---|---|---|
| `resolveCoverage` | 커버리지 판정(서버 LC-U1-7과 **동형**) | 프론트 PBT blocking(전 날짜 유일 판정) |
| `formatPrice` | 스냅숏→표시(없음=가격 미확인) | PBT(INV-3 — 소요시간 문자열 생성 안 함) |
| `nightsSum` 검증 | 도시 박수 합 ≤ 기간 | PBT(INV-U1-14) |
| 지도·검색 어댑터 | 카카오 SDK 차이 흡수 → 서버 프록시 호출 | LC-U1-5와 대칭·키 미보유 |
| 낙관적 담기 토글 | 즉시 반영 후 서버 확인 | UX-U1-03(입력 보존) |

## 5. 컴포넌트 → NFR 추적

| 컴포넌트 | NFR |
|---|---|
| LC-U1-1 ContentPort | RES-U1-01·03·04 · P-PERF-U1-2 |
| LC-U1-2 SnapshotBatch | DATA-U1-01·02 |
| LC-U1-3 LivePriceGateway | DATA-U1-03 |
| LC-U1-4 OtaDeeplinkService | SEC-U1-02·03 |
| LC-U1-5 PlaceSearch/MapRender | SEC-U1-05 · COST-U1-01 · PERF-U1-03 · LEGAL-U1-01·03 |
| LC-U1-6 PoiCollectionGate | PBT-U1-1 · INV-1 · SCALE-U1-02 |
| LC-U1-7 CoverageResolver | PBT-U1-2 · BR-U1-43~47 |
| LC-U1-8 CandidatePoolProvider | INV-1 · U3 계약 |

## 6. Infrastructure Design 이연

Redis 운영 토폴로지(관리형/자체·다중 AZ) · 카카오 API 키·시크릿 주입 · 스냅숏 배치 실행 환경 · POI 초기 적재 파이프라인(TourAPI 등) · 외부 포트 실어댑터 전환 시 벤더 계약·과금 방어(COST 재평가). — U0와 동일하게 **로컬 전용이면 SKIP 대상**.
