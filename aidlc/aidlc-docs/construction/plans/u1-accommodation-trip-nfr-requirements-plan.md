# U1 Accommodation & Trip Setup — NFR Requirements Plan

> **입력**: `construction/u1-accommodation-trip/functional-design/` 4종 (DEC-1~13 · INV-U1-01~19 · BR-U1-01~56)
> **상속 기준선(U0에서 확정 — 재질문 안 함)**: SCALE(DAU 1만·MAU 5만·피크 ~500세션·~50 RPS·10x 헤드룸) · AVAIL 월 99.9%(단일 리전·다중 AZ) · SEC(JWT ES256·레이트리밋 카운터=PostgreSQL·Redis 미도입) · OBS(구조화 JSON 로그·상관ID·PII 마스킹·프론트 Sentry) · 익스텐션 3종(security Full · resiliency Full · PBT 부분 blocking) · 배포 없음(로컬 전용, Infra Design SKIP)
> **캘리브레이션 상속**: "적당한 규모 서비스 + 쾌적한 사용자 경험"(2026-07-17 사용자 지시) — U1도 동일 기준으로 과설계를 피한다.

## Step 1 분석 — U1의 NFR 표면은 U0와 성질이 다르다

U0는 **인증·세션·법적 준수**가 NFR의 중심이었다. U1은 **외부 의존 · 데이터 신선도 · 비용**으로 무게중심이 옮겨간다.

| 표면 | 출처 | 왜 NFR인가 |
|---|---|---|
| 외부 포트 6종(콘텐츠·스냅숏·라이브가·딥링크·장소검색·지도) | `business-logic-model.md` §4 | 전부 스텁이지만 **타임아웃·서킷·부분 실패 정책은 지금 정해야** 어댑터 교체 시 계약이 산다 |
| 최저가 스냅숏(DEC-11) | INV-U1-05 · BR-U1-12 | "정적 취급"의 **갱신 주기·신선도 표기**가 미정 — 오래된 가격은 신뢰 문제 |
| POI 수집 게이트(INV-1, CQ3=B로 U1 편입) | INV-U1-01 · BR-U1-01 | 처리량·판정 지연·**closed-set PBT 게이트(blocking)** |
| 지도 SDK·장소 검색(카카오) | DEC-5 | **무료 쿼터·비용 상한**, 초과 시 동작 |
| 딥링크·포스트백 | BR-U1-32 | 멱등 + **위조 방지(서명 검증)** — 정산 지표의 무결성 |
| '내 주변' 탐색 | BR-U1-11 | 위치정보 취급 — U0 위치 동의 자산과의 접점 |
| 목록·상세 응답 시간 | US-STAY-11 · BR-U1-17 | 외부 호출이 끼어 U0의 p95 500ms를 그대로 쓸 수 없음 |

## 실행 계획

- [x] 1. 기능 설계 분석 — 위 NFR 표면 7종 식별, U0 상속분과 U1 델타 분리
- [x] 2. 질문 확정 — Q1=A·Q2=A·Q3=B·Q4=A·Q5=B·Q6=A·Q7=A·Q8=B·Q9=A (2026-07-23). 모호·모순 없음. Q8=B는 기준선 변경(Redis 도입)으로 별도 명시 처리
- [x] 3. `u1-accommodation-trip/nfr-requirements/nfr-requirements.md` — SCALE·PERF·UX·DATA·AVAIL/RES·SEC·LEGAL·COST·OBS + PBT 3종 blocking + 재평가 트리거 3종
- [x] 4. `u1-accommodation-trip/nfr-requirements/tech-stack-decisions.md` — 상속 기록 + U1 델타 6종 + Q8=B 파급 정리 + Infra 이연 5종
- [ ] 5. 완료 메시지 → 승인 게이트 → audit·state 반영

## 질문 (모두 [Answer]: 에 답해 주세요 — "권장 채택"만 적으셔도 됩니다)

## Question 1
**최저가 스냅숏의 갱신 주기와 신선도 표기.** DEC-11로 목록 가격은 스냅숏인데, 얼마나 자주 갱신하고 오래된 값을 어떻게 다룰지가 비어 있습니다.
*추천*: 지역·인기 숙소 위주 **일 1회 배치 갱신**, 스냅숏이 **48시간 초과**면 금액을 숨기고 "가격 미확인"으로 표기(BR-U1-14 재사용). 화면에 "OTA 기준·변동 가능" 고지 상시 노출.

A) 권장 채택 (일 1회 · 48시간 초과 시 숨김)

B) 더 촘촘하게 — 6시간 주기 · 12시간 초과 시 숨김(비용·호출량 증가 감수)

C) 더 느슨하게 — 주 1회 · 7일 초과 시 숨김(스텁 단계라 정확도보다 구조 우선)

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 2
**목록·상세 응답 시간 목표.** U0의 "서버 처리 p95 < 500ms"는 외부 호출이 없는 전제였습니다. U1은 외부 의존이 끼어듭니다.
*추천*: **자체 데이터 경로**(담은 장소·저장 숙소·여행·거점) p95 < 300ms / **외부 의존 경로**(숙소 검색·라이브 정확가) p95 < 1.5초, 초과 시 스켈레톤 유지 + 부분 결과 우선. 지도·장소 검색은 사용자 입력 디바운스 300ms.

A) 권장 채택

B) 더 공격적 — 외부 경로도 p95 < 1초, 넘으면 부분 결과로 즉시 끊기

C) 더 여유 — 외부 경로 p95 < 3초(스텁 단계에서 목표를 느슨히 두고 실연동 때 조정)

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 3
**외부 포트 실패 정책(타임아웃·재시도·서킷).** ADR-0011(침묵 실패 금지)은 있지만 수치가 없습니다.
*추천*: 포트별 타임아웃 **콘텐츠 2초 / 라이브가 1.5초 / 장소검색 1초 / 지도 3초**, 재시도는 **멱등 조회만 1회**(백오프 200ms), 벤더별 **서킷 브레이커 분리**(한 OTA 장애가 다른 OTA를 막지 않음), 열림 상태에서는 부분 실패 배너 + 캐시/스냅숏 노출(stale-if-error).

A) 권장 채택

B) 재시도 없음 — 실패 즉시 부분 결과로(지연보다 응답성 우선)

C) 권장 + 재시도 2회까지(가용성 우선)

D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 4
**POI 데이터 규모와 수집 게이트 처리량.** C7이 U1로 왔으므로(CQ3=B) 규모 가정이 필요합니다.
*추천*: 1차 국내 대상 **POI 5만~10만 건** 규모, 수집은 **배치 중심**(온디맨드 등록은 사용자 담기·검색 시 단건), 게이트 판정은 동기 처리하되 **단건 100ms 이내**. 미통과 POI는 `UNVERIFIED`로 적재만 하고 노출 안 함(BR-U1-01).

A) 권장 채택

B) 더 작게 시작 — 주요 관광지 중심 5천~1만 건(스텁·시드 데이터 수준)

C) 더 크게 — 20만 건 이상(TourAPI 전량 적재 전제)

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 5
**지도·장소 검색 쿼터와 비용 상한.** 카카오(DEC-5)는 무료 쿼터가 있고 초과 시 과금·차단이 발생합니다.
*추천*: **일일 호출 상한을 앱 설정으로 외부화**하고 80% 도달 시 경고 로그·알림, 100% 도달 시 **검색은 차단하되 지도 렌더와 기저장 좌표 사용은 유지**(이미 등록한 숙소·담은 장소는 계속 보임). 개발 단계에서는 요청 캐시(같은 검색어 5분)로 소모 억제.

A) 권장 채택

B) 상한 없이 운영 — 개발·MVP 단계라 쿼터 초과 가능성이 낮다고 보고 모니터링만

C) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 6
**딥링크 아웃바운드·포스트백의 무결성.** 전환 지표는 내부 정산 근거가 됩니다(BR-U1-32).
*추천*: 아웃바운드 클릭에 **서버 생성 추적 ID**를 심고, 포스트백은 **제휴사 서명 검증 + 동일 거래 ID 멱등**(재수신 무변화), 검증 실패는 저장하지 않고 보안 이벤트로 기록. 클릭·전환 지표는 **어떤 사용자 응답에도 포함 금지**(응답 스키마 수준에서 차단).

A) 권장 채택

B) 서명 검증은 실제 제휴 계약 후로 이연 — 지금은 멱등·추적 ID까지만

C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 7
**'내 주변' 탐색의 위치정보 취급.** BR-U1-11이 위치 권한을 씁니다. U0에서 위치 동의·법정 로그 자산(V1.3)을 이미 만들었습니다.
*추천*: 좌표는 **요청 처리에만 사용하고 저장하지 않는다**(U0의 GPS 즉시 파기 원칙 계승). 위치기반서비스 이용 사실은 U0 `location_legal_log`에 append-only 기록. 권한 거부 시 여행지 중심 좌표로 대체(BR-U1-11)하며 **거부가 탐색을 막지 않는다**.

A) 권장 채택

B) '내 주변'을 1차에서 아예 제외 — 지역 선택(e00·d1b)만으로 충분

C) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 8
**캐싱 계층의 저장소.** U0에서 Redis를 의도적으로 미도입했습니다(과설계 회피). U1은 캐시 대상이 늘어납니다(숙소 정적 콘텐츠·최저가 스냅숏·지역 집계·POI).
*추천*: **PostgreSQL 테이블로 유지**(스냅숏·집계는 원래 영속 데이터이므로 캐시가 아니라 테이블) + 애플리케이션 인메모리 캐시(지역 목록 등 소규모·저변동). **Redis는 계속 미도입**하고 실측 병목 시 재평가(U0과 동일한 재평가 트리거 방식).

A) 권장 채택

B) 지금 Redis 도입 — 목록 조회·집계가 늘어날 것이 확실하므로 선제 도입

C) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 9
**U1의 PBT 게이트 범위.** CQ3=B로 **closed-set 게이트 PBT(INV-1)가 U1로 편입**됐고, 인셉션 dependency 문서도 그렇게 개정됐습니다. 익스텐션 설정상 PBT는 부분 blocking입니다.
*추천*: U1에서 **blocking**으로 둘 것 = ① closed-set 게이트(후보풀에 게이트 미통과 POI가 절대 없음) ② 커버리지 해소 전수성(모든 날짜가 정확히 하나의 판정) ③ 오퍼/스냅숏 정규화·직렬화 왕복. 그 외(딥링크 파라미터·거리 포맷)는 일반 단위 테스트로 충분.

A) 권장 채택 (blocking 3종)

B) closed-set 게이트만 blocking, 나머지는 일반 테스트

C) 4종 이상으로 확대 — 딥링크 파라미터 정확성도 blocking에 포함

D) Other (please describe after [Answer]: tag below)

[Answer]: A
