# TripPilot 백엔드 착수 우선순위 로드맵

> 대상: 백엔드 담당(Spring Boot + Kotlin) · 기준일 2026-07-06
> 근거 문서: `docs/planning/overview.md`, `aidlc/aidlc-docs/aidlc-state.md`, `aidlc/aidlc-docs/construction/shared-infrastructure.md`, `construction/plans/u1-foundation-*`

## 지금 상태 한 줄 요약

설계 문서(INCEPTION + U1~U8)는 전부 완료됐고 **코드는 아직 0줄**이다. 즉 "무엇을 만들지"는 정해져 있고, 지금 필요한 건 **U1(기반)부터 실제 코드로 내려앉히는 것**이다.

## 결론(추천)

순서는 이미 문서가 `U1 → U2 → … → U8`로 못 박아 뒀다. 백엔드로서 **U1을 "걷는 뼈대(walking skeleton)"부터 인증 코어까지** 먼저 세우는 걸 최우선으로 한다. U1은 단순한 첫 유닛이 아니라 **의존성의 뿌리**다 — 공유 인프라·이벤트 버스·보안/관측 기준선을 U1이 정의하고 U2~U8이 그대로 재사용하며(shared-infrastructure.md 명시), 모든 후속 유닛이 인증된 사용자(M1)·프로필(M2)을 전제로 한다.

---

## Phase 0 — 걷는 뼈대 (가장 먼저, 기능 코드 이전)

목적: "비어 있지만 빌드·테스트·배포·로그가 도는" 최소 골격. 여기서 만든 규칙을 U1~U8 전체가 상속한다.

1. **리포 구조 & 모듈러 모놀리스 골격** — 단일 Gradle(Kotlin DSL) 프로젝트에 모듈 경계 잡기: `common/core`(인프로세스 도메인 이벤트 버스 — §4), `common/security`, `auth(M1)`, `user-profile(M2)`, 이후 유닛용 빈 모듈. 모듈 간 직접 참조 규칙(경계) 확정.
2. **컨벤션 세팅** — `docs/conventions/`(branch·commit·PR)와 `aidlc/CLAUDE.md`를 읽고 저장소에 반영(브랜치 전략·커밋 템플릿 `.gitmessage`·PR 템플릿은 이미 리포에 있음).
3. **로컬 개발 환경** — docker-compose로 PostgreSQL 16, **Flyway 마이그레이션 베이스라인**(스키마 정본은 U1 마이그레이션이 소유), `app_migrate`/`app_user` 롤 분리 전제.
4. **횡단 기반 코드**
   - 구조화 JSON 로깅(logstash-logback-encoder) + **PII·토큰 마스킹 컨버터**(SECURITY-03)
   - 통일된 에러 처리 — ADR-0011 원칙(미확인 분리·수동 폴백·**침묵 실패 금지**)
   - 설정 외부화(시크릿 평문 0 — SECURITY-12), `common/core` 이벤트 버스
5. **테스트 하네스** — Kotest + **kotest-property로 PBT 하네스**(PBT는 전 단계 차단 제약). 속성 테스트 스캐폴딩부터 깔아두면 이후 유닛에서 재사용.
6. **CI 파이프라인** — GitHub Actions: build + test + (terraform plan). OIDC 기반, 장기 키 금지(§7.2).

> 산출: `git clone` 후 `./gradlew test`가 돌고, 헬스 엔드포인트가 뜨고, CI가 초록인 상태.

## Phase 1 — U1 인증 코어 (모든 유닛을 여는 열쇠)

`u1-foundation/functional-design/domain-entities.md`, `business-rules.md`(BR-U1-01~44) 기준. 여기가 끝나야 U2 이후가 사용자 컨텍스트를 가진다.

> **MVP 스코프: 소셜 로그인 전용.** 이메일 가입·인증·비밀번호 로그인·브루트포스 방어·SES 인증메일은 **후속 이연**(원설계 보존). Phase 1은 소셜 4종에 집중.

- **소셜 로그인 4종**: Google·Kakao·Naver·Apple(`provider+sub` 복합 유니크), 서버측 code 교환(시크릿 비노출), 소셜 가입은 즉시 `ACTIVE` + 최초 연령 확인
- **Account 상태 머신**: `ACTIVE → DELETION_PENDING → DELETED` (D18). `PENDING_VERIFICATION`은 이메일 가입(후속) 예약값
- **JWT + RefreshSession 회전**: 회전 체인 + **재사용 탈취 감지**(D36), 단일 비행 갱신
- (후속) 이메일 가입·인증(24h 토큰·SES)·argon2id 비밀번호 해시·브루트포스 방어 — 이메일 로그인 도입 시

## Phase 2 — U1 나머지 (동의·프로필·부트스트랩)

- **ConsentRecord(append-only)** + TermsVersion 재동의 플래그(N2·N3, DB 레벨 UPDATE/DELETE REVOKE)
- **LocationConsent 3층 모델** + G182 8조합 매트릭스(위치정보법 정합 — 서버 전송=L1∧L2, GPS 발자취=L1∧L2∧L3)
- **Profile + PreferenceSet 7축**(미설정 NULL vs 중립 기본값 구분, FD-U1-06)
- **닉네임 생성**(재추첨 최대 10회→자릿수 확장 폴백) + **BannedWordDictionary(C3, P8)**
- **계정 삭제 라이프사이클** + GPS 발자취 즉시 파기(FD-U1-07), 법정 로그는 보존
- **부트스트랩 API**: 강제 업데이트 > 재동의 > 세션 우선순위(FD-U1-10) — **U2 스플래시가 의존하는 계약**이므로 U1에서 확정

## Phase 3 — 배포 가능한 dev 환경 (Phase 0~2와 일부 병행)

Terraform(HCL, S3 원격 상태). 적용 순서: **network → security → database → compute → observability**. 초기엔 dev 환경만(Fargate 1태스크·RDS t4g.micro Single-AZ)으로 CI 배포를 뚫고, prod 전 사양은 U1 안정화 후. (mail/SES는 이메일 인증 이연으로 U1 MVP에서 제외 — 이메일 로그인 도입 시 추가, 승격 승인 1~2영업일 유의.)

## 이후

U1 완료 후 `docs/planning/units.md`의 U1~U11 의존과 `unit-of-work-dependency.md`의 **CP1~CP5 계약(필드 수준)**을 확인하며 U2(앱셸 부트스트랩)·U3(숙소·장소, 외부 어댑터 Resilience4j)로 진행. 차별화 축인 **U6 Plan-B 재계획 로직은 담당자(본인) 직접 설계** 영역이며, 나는 검증·PBT·엣지케이스 위주로 보조.

---

## 우선순위 근거 요약

| 순위 | 왜 먼저인가 |
|---|---|
| Phase 0 골격 | U1~U8이 상속하는 기준(이벤트 버스·로깅·에러·PBT·CI)을 여기서 한 번만 정의 |
| Phase 1 인증 | 모든 후속 유닛이 인증된 사용자·토큰을 전제. 뼈대 없이는 U2+ 착수 불가 |
| Phase 2 동의/프로필 | 위치정보법·약관 등 **출시 선결(법적) 요건**이 U1 데이터 모델에 박혀 있음 |
| Phase 3 인프라 | 코드와 병행 가능하나, dev 배포 경로를 일찍 뚫어야 통합 리스크 감소 |

## 주의점 (차단 제약)

- 보안 기준선(SECURITY-01~15)·복원력(RESILIENCY)·PBT(PBT-01~10) 전체 강제가 **전 단계 blocking**. Phase 0에서 하네스로 미리 깔 것.
- 스키마 정본 = U1 Flyway 마이그레이션. DB는 forward-only(롤백은 버전 고정 재배포).
- 법정 로그·동의 증적 테이블은 append-only(DB 권한 + IAM 이중 강제).
