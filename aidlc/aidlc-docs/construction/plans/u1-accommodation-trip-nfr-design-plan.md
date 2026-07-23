# U1 Accommodation & Trip Setup — NFR Design Plan

> **입력**: `u1-accommodation-trip/nfr-requirements/` 2종(SCALE·PERF·UX·DATA·AVAIL/RES·SEC·LEGAL·COST·OBS + PBT 3 blocking) + `functional-design/` 4종.
> **상속 컨텍스트**: 단일 리전·다중 AZ · GitHub Actions·롤링·버전 핀+스키마 전방호환(U0 P-DEP-1~3) · 경량 복원력 테스트(U0 §6) · 캘리브레이션 "적당한 규모 + 쾌적한 UX".
> **U0와의 차이**: U0 NFR Design은 RESILIENCY-04·14 이연분 해소가 **blocking 필수**였다. 그 둘은 U0에서 확정됐으므로 **U1은 이연 blocking 질문이 없다** — U1 델타 패턴·논리 컴포넌트에만 집중한다.
> **명명 계승**: 패턴 `P-{RES/SCALE/PERF/SEC/OBS}-U1-#`, 논리 컴포넌트 `LC-U1-#`(U0의 C-1~C-8 위에 이어짐).

## Step 1 분석 — U1 NFR 요구의 설계 표면

| NFR 요구 | 패턴화 대상 |
|---|---|
| RES-U1-01~05(타임아웃·재시도 없음·벤더별 서킷·stale-if-error·폴백) | **외부 포트 복원력 패턴** — U0 P-RES-2(서킷 격리)의 다벤더 확장 |
| DATA-U1-01~04(스냅숏 배치·48h 신선도·정확가 미저장) | **가격 2단·배치 갱신 패턴** |
| PERF-U1-01~04 + Q8=B(Redis) | **캐시 계층 패턴**(PG 영속 + Redis 조회 캐시) — U0 "분산 캐시 미도입"을 U1이 뒤집음 |
| SCALE-U1-02(POI 5만~10만) | **검색·목록 확장 패턴**(인덱스·페이지네이션·읽기 복제본 미도입 유지) |
| SEC-U1-02~05(포스트백·URL·키 프록시) | **딥링크 무결성·입력 검증 패턴** |
| PBT-U1-1~3(closed-set·커버리지·정규화) | **논리 컴포넌트에 게이트 배치** |
| COST-U1-01·02(쿼터 무상한·모니터링) | **쿼터 관측 패턴**(상한 대신 소진율 경보) |

## 실행 계획

- [x] 1. NFR 요구 분석 — 설계 표면 식별(위 표)
- [x] 2. 질문 확정 (Q1~Q6) — **전항 추천 채택**(2026-07-23 "추천대로 진행"). 모호·모순 없음
- [x] 3. `u1-accommodation-trip/nfr-design/nfr-design-patterns.md` — P-RES-U1-1~4·P-SCALE-U1-1~3·P-PERF-U1-1~3·P-SEC-U1-1~3·P-COST-U1-1·P-DATA-U1-1·P-OBS-U1-1 + NFR 커버리지 + 미도입·재평가 5종
- [x] 4. `u1-accommodation-trip/nfr-design/logical-components.md` — LC-U1-1~8 + 기존 자산 수용 6(Redis만 신규) + 프론트 논리 요소 5 + PBT 게이트 배치 + NFR 추적
- [ ] 5. 완료 메시지 → 승인 게이트 → audit·state 반영

## 질문 (모두 [Answer]: 에 답해 주세요 — "추천으로"만 적으셔도 됩니다)

### 복원력 패턴

**Q1. 서킷 브레이커 임계·반열림 정책.** RES-U1-03(벤더별 서킷 분리)·RES-U1-02(재시도 없음)는 확정. 임계값과 복구 정책이 남았습니다.
*추천*: 슬라이딩 윈도우 **실패율 50%(최소 20호출)**에서 open, **30초 후 half-open**으로 소수 시험 호출, 성공 시 close. open 동안은 즉시 fallback(부분 실패 배너 + stale 스냅숏, RES-U1-04). 포트별 인스턴스 분리(콘텐츠·라이브가·딥링크·장소검색·지도 각각).

A) 추천으로  B) 더 민감하게(실패율 30%·60초 open)  C) 더 둔감하게(실패율 70%·15초 open)  D) Other

[Answer]:

### 확장성 패턴

**Q2. POI 검색·숙소 목록 확장 방식.** SCALE-U1-02(POI 5만~10만).
*추천*: **단일 프라이머리 DB 유지**(U0 P-SCALE-2 계승, 읽기 복제본 미도입) + 지역·카테고리·좌표 **복합 인덱스** + 커서 페이지네이션. 근접 검색은 PostGIS 공간 인덱스(GiST). 목록·집계는 Redis 캐시(Q3)로 읽기 부하 흡수. 스파이크는 U0 오토스케일 + 429 저하 계승.

A) 추천으로  B) 읽기 복제본 지금 도입  C) Other

[Answer]:

### 성능/캐시 패턴 (Q8=B 파급을 설계로)

**Q3. Redis 캐시 대상·TTL·무효화.** tech-stack Q8=B로 Redis 도입 확정. 무엇을 어떻게 캐시할지가 설계 대상입니다.
*추천*: 캐시 대상 = **숙소 검색 결과(TTL 10분)·지역 집계(TTL 1시간)·POI 검색 결과(TTL 10분)**. 최저가 스냅숏·POI 원본은 **캐시가 아니라 PG 테이블**(캐시하지 않음). 무효화 = 스냅숏 배치 완료·POI `data_status` 변경 시 관련 키 삭제. **정확 1박가는 캐시 금지**(DATA-U1-03 절대). 캐시 미스·Redis 장애 시 PG 직읽기로 폴백(캐시는 가속층일 뿐 정합성 원본 아님).

A) 추천으로  B) TTL을 더 짧게(검색 3분·집계 15분 — 신선도 우선)  C) Other

[Answer]:

### 보안 패턴

**Q4. 포스트백 서명·URL 화이트리스트 관리.** SEC-U1-02·04(Q6=A로 서명 검증 확정).
*추천*: 포스트백 서명은 **제휴사별 공유 시크릿 HMAC-SHA256**(제휴사마다 키·검증 로직을 `OtaPartner`에 설정으로 보유), 타임스탬프 skew ±5분으로 재전송 차단. 링크 붙여넣기 URL은 **허용 OTA 도메인 화이트리스트**(설정 외부화)로만 파싱, 그 외 도메인은 거부. 지도·검색 키는 서버 프록시 엔드포인트 뒤에만 존재.

A) 추천으로  B) 서명 검증은 제휴 계약 후로 이연(멱등·추적 ID만) — NFR Q6=A를 완화  C) Other

[Answer]:

### 논리 컴포넌트

**Q5. U1 신규 논리 컴포넌트 경계.**
*추천*: LC-U1-1 `AccommodationContentPort`+스텁어댑터 · LC-U1-2 `PriceSnapshotBatch`(ShedLock 단일 실행) · LC-U1-3 `LivePriceGateway`(캐시 금지·표시시점) · LC-U1-4 `OtaDeeplinkService`(추적 ID·포스트백 멱등·서명) · LC-U1-5 `PlaceSearchPort`+`MapRenderPort`(카카오, 서버 프록시·쿼터 모니터) · LC-U1-6 `PoiCollectionGate`(INV-1 closed-set 소유) · LC-U1-7 `CoverageResolver`(커버리지 차단 판정) · LC-U1-8 `CandidatePoolProvider`(U3에 노출). 크로스커팅(로깅·아웃박스·서킷·캐시·ArchUnit)은 **U0 자산 + Redis 추가만** 수용(신규 설계 최소화).

A) 추천으로  B) Other(컴포넌트 추가/분할 지정)

[Answer]:

**Q6. 스냅숏 배치·closed-set 게이트의 실행 배치.**
*추천*: 최저가 스냅숏 갱신은 **스케줄 배치**(U0 ShedLock 재사용, 단일 실행 보장, 일 1회). closed-set 게이트(PBT-U1-1)는 **쓰기 경로에 동기 배치** — POI가 후보풀(`CandidatePoolProvider`)에 들어가는 지점에서 게이트를 통과해야만 `ACTIVE`가 되고, 조회는 이미 걸러진 데이터만 본다(조회 시점 재검사 없음 → 성능·불변식 동시 확보). PBT-U1-2 커버리지 전수성은 `CoverageResolver` 순수 함수에, PBT-U1-3 정규화 왕복은 콘텐츠·스냅숏 매퍼에 건다.

A) 추천으로  B) Other

[Answer]:

---

**일괄 승인**: 전 항목 추천안으로 진행하려면 "추천대로 진행"으로 답해 주세요. 개별 항목만 바꾸려면 해당 Q 번호로 지정해 주세요.
