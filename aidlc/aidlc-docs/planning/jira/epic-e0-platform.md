# E0. 플랫폼·품질 기반

> 이 문서의 `EN-*`와 `ST-*`는 실제 Jira 키가 아니라 `Requirement ID`/`External ID`다. 실제 이슈 키는 Jira 생성 시 자동 발급한다.

## Epic

- **Issue Type**: Epic
- **Epic ID**: E0
- **Summary**: `[E0] TripPilot 플랫폼·품질 기반 구축`
- **Fix Version**: `MVP-2026.11`
- **Priority**: P0
- **Target Sprint**: S0~S9
- **Unit**: Cross-cutting
- **Components**: server, mobile, data, infra, security, qa
- **목표**: E1~E9가 같은 아키텍처·보안·테스트·배포 기준을 재사용하고 11월 릴리스 후보를 반복 가능하게 빌드·검증·배포할 수 있는 기반을 제공한다.
- **범위 제외**: 제품 기능 자체, E10~E12 기능 구현, Kubernetes·마이크로서비스 전환, 별도 메시지 브로커 도입
- **Source**: [아키텍처](../architecture.md), [NFR](../nfr.md), [인프라](../infrastructure.md), [개발 순서](../units.md)

### Epic 완료 기준

- [ ] EN-01~EN-10, SPK-01~SPK-04, REF-01이 Done이고 E1~E9가 공통 기반을 실제로 소비한다.
- [ ] dev/prod 환경과 CI/CD가 동일 불변 아티팩트의 승격을 지원한다.
- [ ] 보안·복원력·PBT 기준선과 80% 이상 테스트 coverage가 릴리스 게이트로 자동 검증된다.
- [ ] CP1~CP5 계약과 외부 어댑터 실패를 CI에서 재현할 수 있다.
- [ ] 배포·롤백·백업 설정·복원 runbook·인시던트 대응 증빙이 E13에 연결된다.

---

## EN-01. 모노레포와 모듈 경계 스캐폴드

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S0
- **Story Points**: 8
- **Components**: server, mobile, architecture
- **Dependencies**: 없음; E1~E9 구현을 blocks
- **Source**: `architecture.md` §3·§8·§9, `units.md` §9

**설명**: Spring Boot Kotlin 모듈러 모놀리스와 React Native Expo 앱의 재현 가능한 기본 구조를 만들고 모듈 내부 접근·순환 의존을 자동 차단한다.

**수용 기준**:

- [ ] `server/app`, `server/common`, 1차 모듈 M1~M14·M18 및 C1~C3용 서버 골격이 Gradle 멀티모듈로 빌드된다. M15~M17은 후속 게이트 전 생성하지 않는다.
- [ ] `apps/mobile`에 Expo development build/prebuild 기반 앱과 `features/`, `shared/` 경계가 생성된다.
- [ ] JDK 21, Kotlin, Node, 패키지 매니저, Expo 버전과 잠금 파일이 저장소에 고정된다.
- [ ] Konsist/아키텍처 테스트가 퍼사드 우회·순환 의존·금지된 내부 모듈 참조를 실패시킨다.
- [ ] 서버 liveness와 모바일 smoke 화면이 로컬 및 CI에서 기동된다.

**Sub-tasks**:

- [ ] `ST-EN-01-01` `[ARCH]` 모듈 의존 규칙과 허용 퍼사드 목록을 코드 규칙으로 정의하고 순환 실패 fixture로 검증한다.
- [ ] `ST-EN-01-02` `[BE]` Gradle 멀티모듈, 공통 오류 envelope, 이벤트 버스 골격과 서버 smoke endpoint를 구현한다.
- [ ] `ST-EN-01-03` `[APP]` Expo development/preview 프로필, feature/shared 구조, 공통 navigation/theme 골격을 구현한다.
- [ ] `ST-EN-01-04` `[QA]` 클린 체크아웃부터 서버·앱 빌드까지 bootstrap smoke test와 개발자 실행 문서를 검증한다.

---

## EN-02. API·이벤트·CP1~CP5 계약 관리

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S0~S1
- **Story Points**: 8
- **Components**: server, mobile, data, qa
- **Dependencies**: EN-01; 각 공급 Unit의 계약 동결을 blocks
- **Source**: `units.md` §3 CP1~CP5, `architecture.md` §4

**설명**: OpenAPI·이벤트 계약의 관리 규칙과 테스트 하네스를 먼저 만들고 후행 Unit의 파괴적 재작업을 막는다. 실제 CP1~CP5 공급자·소비자 구현과 종료는 각 제품 Epic이 소유한다.

**수용 기준**:

- [ ] REST API는 일관된 success/data/error/pagination envelope와 오류 코드를 OpenAPI로 정의한다.
- [ ] CP1~CP5의 소유자·소비자·초기 Draft 스키마와 공통 필드(버전, 멱등 키, 상관 ID, 생산자, 발생 시각)가 계약 레지스트리에 정의된다.
- [ ] 참조 계약의 공급자 테스트·소비자 fixture와 breaking-change 실패 예제가 CI에 있으며, 실제 CP별 테스트는 각 공급·소비 Product Story의 완료 조건으로 연결된다.
- [ ] additive 변경과 breaking 변경의 승인·마이그레이션 규칙이 정리되고 CODEOWNERS 검토를 요구한다.
- [ ] 중복·지연·순서 역전 이벤트에 대한 소비자 멱등성이 검증된다.
- [ ] 도메인 쓰기와 이벤트를 원자화하는 공통 outbox publisher, at-least-once delivery, 소비자 멱등 처리와 재처리 관측 계약이 제공된다.

**Sub-tasks**:

- [ ] `ST-EN-02-01` `[ARCH]` CP1~CP5 Draft 스키마·소유자·버전 호환 정책과 변경 승인자를 정의한다.
- [ ] `ST-EN-02-02` `[BE]` OpenAPI 및 도메인 이벤트 공통 envelope·멱등 키를 구현한다.
- [ ] `ST-EN-02-03` `[APP]` 생성된/수동 타입의 경계와 클라이언트 오류 매핑을 구현한다.
- [ ] `ST-EN-02-04` `[QA]` 참조 공급자·소비자 contract test와 breaking-change CI fixture를 추가하고 Product Story용 템플릿을 배포한다.
- [ ] `ST-EN-02-05` `[BE/QA]` PostgreSQL outbox publisher·재처리·at-least-once·소비자 멱등 reference implementation과 실패 주입 테스트를 만든다.

---

## EN-03. AWS dev/prod IaC와 데이터 기반

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S0~S2
- **Story Points**: 8
- **Components**: infra, data, security
- **Dependencies**: EN-01, 클라우드 계정·도메인 접근 권한
- **Source**: `infrastructure.md` §1~§13

**설명**: AWS 서울 리전의 dev/prod를 Terraform으로 분리 구축하고, 단일 리전 Multi-AZ 및 최소 권한 기준선을 적용한다.

**수용 기준**:

- [ ] Terraform이 VPC·2AZ·ALB·ECS Fargate·ECR·RDS PostgreSQL 16 Multi-AZ·S3·KMS·Secrets Manager·IAM을 생성한다.
- [ ] 환경 차이는 tfvars만 사용하고 원격 상태·잠금·암호화·state 접근 통제가 적용된다.
- [ ] ECS는 최소 2개 태스크를 AZ 분산하고 shallow liveness만 ALB 판정에 사용한다.
- [ ] DB 애플리케이션·마이그레이션·법정 로그 역할이 분리되고 Flyway forward-only 규칙이 검증된다. 위치정보 확인자료는 append-only·6개월 이상 보존이며 앱 역할에 `UPDATE/DELETE` 권한이 없다.
- [ ] 퍼블릭/프라이빗 서브넷과 보안 그룹이 deny-by-default이며 불필요한 인바운드가 없다.

**Sub-tasks**:

- [ ] `ST-EN-03-01` `[INFRA]` network/security Terraform 모듈과 dev plan을 작성하고 보안 그룹 경로를 검토한다.
- [ ] `ST-EN-03-02` `[INFRA]` ECS/ALB/ECR 및 오토스케일·롤링 배포 기반을 구축한다.
- [ ] `ST-EN-03-03` `[DATA]` RDS Multi-AZ, PITR, DB 역할, Flyway 실행 경로와 append-only 권한을 구성한다.
- [ ] `ST-EN-03-04` `[SEC]` KMS·Secrets Manager·IAM 최소 권한 및 공개 리소스 탐지 결과를 승인받는다.

---

## EN-04. CI/CD와 공급망 보안 게이트

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S0~S2
- **Story Points**: 8
- **Components**: infra, qa, security
- **Dependencies**: EN-01, EN-03
- **Source**: `infrastructure.md` §14, `nfr.md` §7·§8

**설명**: PR 검증부터 dev 자동 배포와 승인 기반 prod 승격까지 반복 가능한 파이프라인을 만들고 장기 AWS 키를 제거한다.

**수용 기준**:

- [ ] server/mobile/infra 경로별 GitHub Actions가 lint·typecheck·build·test·scan을 병렬 실행한다.
- [ ] 하드 제약 테스트, PBT, 80% coverage, Critical/High 취약점, secret scan 실패가 머지를 차단한다.
- [ ] AWS 배포는 GitHub OIDC 단기 자격 증명만 사용하고 workflow/action 버전은 commit SHA로 고정한다.
- [ ] dev에서 검증한 동일 ECR git SHA 이미지를 재빌드 없이 prod로 승격한다.
- [ ] Flyway 성공 후 ECS rolling update·smoke test를 수행하고 실패 시 직전 이미지 자동/수동 롤백이 가능하다.
- [ ] CycloneDX SBOM과 테스트·PBT seed·스캔 결과가 릴리스 아티팩트로 보존된다.

**Sub-tasks**:

- [ ] `ST-EN-04-01` `[QA]` server/mobile CI와 coverage·hardConstraintTest·PBT seed 아티팩트를 구성한다.
- [ ] `ST-EN-04-02` `[SEC]` secret/dependency/container/IaC scan과 SBOM 생성 차단 기준을 구성한다.
- [ ] `ST-EN-04-03` `[INFRA]` GitHub OIDC 역할, dev 자동 배포, prod environment 승인과 불변 이미지 승격을 구현한다.
- [ ] `ST-EN-04-04` `[DATA]` forward-only migration 및 N-1 호환 회귀 fixture를 파이프라인에 추가한다.
- [ ] `ST-EN-04-05` `[QA]` 의도적 실패 빌드로 각 머지·배포 게이트가 실제 차단되는지 증빙한다.

---

## EN-05. 전역 보안 기준선 구현

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S0~S3
- **Story Points**: 8
- **Components**: security, server, mobile
- **Dependencies**: EN-01, EN-03, PR7
- **Source**: `nfr.md` §3 SECURITY-01~15, D31·D34·D36

**설명**: 인증·인가·입력·암호화·로깅·시크릿·공급망의 공통 보안 통제를 한 번 구현하고 모든 모듈이 재사용하게 한다.

**수용 기준**:

- [ ] 서버는 공개 allowlist 외 `deny-by-default`이고 리소스를 토큰 주체 기준으로 조회해 IDOR를 차단한다.
- [ ] 전 API가 스키마·길이·크기·content-type을 검증하고 parameterized query를 사용한다.
- [ ] 토큰은 access 1시간/refresh 90일 회전 정책이며 앱의 Keychain/Keystore에만 저장된다.
- [ ] TLS, 저장 암호화, KMS 키 회전, 시크릿 외부화와 PII·토큰 로그 금지가 적용된다.
- [ ] 인증 실패·권한 위반·rate-limit·의심 활동이 구조화 로그와 알람으로 남는다.
- [ ] 위협 모델과 보안 테스트에서 Critical/High 이슈가 0건이다.

**Sub-tasks**:

- [ ] `ST-EN-05-01` `[SEC]` 데이터 흐름·신뢰 경계·위협 모델과 공개 endpoint allowlist를 승인한다.
- [ ] `ST-EN-05-02` `[BE]` JWT 필터 체인, 소유권 helper, 입력/요청 크기 guard, 보안 헤더를 구현한다.
- [ ] `ST-EN-05-03` `[APP]` 보안 저장소·세션 만료·스크린샷/로그 민감정보 처리 기준을 구현한다.
- [ ] `ST-EN-05-04` `[QA]` IDOR·권한·토큰 재사용·rate-limit·악성 입력 통합 테스트를 추가한다.
- [ ] `ST-EN-05-05` `[SEC]` SAST/DAST/의존성 결과와 수동 보안 리뷰를 E13 승인 증빙으로 연결한다.

---

## EN-06. 관측성·알람·인시던트 대응 기반

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S1~S4
- **Story Points**: 5
- **Components**: infra, server, mobile, operations
- **Dependencies**: EN-03, EN-04
- **Source**: `infrastructure.md` §10, `nfr.md` §4·§8

**설명**: 사용자 오류부터 외부 API 열화까지 상관 ID로 추적하고 골든 시그널·보안 이벤트·비용을 운영자가 탐지할 수 있게 한다.

**수용 기준**:

- [ ] 서버 JSON 로그·ALB 로그·모바일 crash가 PII 없이 중앙 수집되고 요청 상관 ID로 연결되며 일반·감사 로그를 90일 이상 보존한다.
- [ ] Prometheus/Loki/Grafana와 Sentry가 dev/prod 환경·서비스 태그를 구분한다.
- [ ] p50/p95, 5xx, saturation, DB pool, circuit 상태, 외부 쿼터 80%, LLM 비용, FCM 실패 대시보드가 있다.
- [ ] 운영 P1/P2/P3 알람이 SNS/Slack으로 라우팅되고 오너·초동 목표·runbook 링크를 포함한다.
- [ ] 합성 오류를 주입해 알람 발화·ack·종료 기록까지 검증한다.

**Sub-tasks**:

- [ ] `ST-EN-06-01` `[BE]` 구조화 로그, correlation ID, Micrometer metric과 민감정보 redaction을 구현한다.
- [ ] `ST-EN-06-02` `[APP]` Sentry crash·network breadcrumb의 개인정보 필터를 구성한다.
- [ ] `ST-EN-06-03` `[INFRA]` Grafana/Loki/Prometheus·CloudWatch federation·SNS 라우팅을 구축한다.
- [ ] `ST-EN-06-04` `[OPS]` 심각도·오너·초동·에스컬레이션 runbook과 알람 훈련 증빙을 만든다.

---

## EN-07. 복원력·백업·DR 기준선

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S1~S4
- **Story Points**: 8
- **Components**: infra, server, data, qa
- **Dependencies**: EN-03, EN-06
- **Source**: `nfr.md` §2, `infrastructure.md` §4·§6·§14

**설명**: Critical 경로의 단일 장애 전파를 차단하고 시간 단위 RTO/RPO의 Backup & Restore 설정과 실행 가능한 runbook을 만든다.

**수용 기준**:

- [ ] 모든 외부 Port가 명시적 timeout, 멱등 재시도+지터, circuit breaker, fallback, 사용자 고지를 가진다.
- [ ] shallow liveness와 deep dependency health가 분리되고 deep 실패가 LB 축출을 유발하지 않는다.
- [ ] RDS 자동 백업/PITR, S3 versioning·암호화·lifecycle이 적용된다.
- [ ] ECS rolling 실패·외부 API timeout·DB failover 시나리오에서 정해진 저하 모드로 동작한다.
- [ ] 격리 환경 복원 절차·데이터 무결성 검증·RTO/RPO 측정 방법을 runbook으로 만들고 dry-run한다. 전체 복원 리허설은 REL-12에서 실행하거나 정본의 Operations 이연 근거와 후속 기한을 승인받는다.
- [ ] 롤백은 불변 이미지 재배포이고 DB는 forward-only 호환성을 유지한다.

**Sub-tasks**:

- [ ] `ST-EN-07-01` `[BE]` 공통 resilient adapter 정책과 실패 주입 가능한 fake를 구현한다.
- [ ] `ST-EN-07-02` `[INFRA]` RDS PITR·S3 versioning·ECS circuit breaker·health 분리를 구성한다.
- [ ] `ST-EN-07-03` `[QA]` 외부 장애·DB 순단·중복 잡·롤링 배포 회복 시나리오를 자동화한다.
- [ ] `ST-EN-07-04` `[OPS]` 백업 복원 runbook을 dry-run하고 불변 이미지 롤백을 리허설해 시간·결과·후속 조치를 기록한다.

---

## EN-08. 테스트 하네스와 80% 품질 게이트

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S0~S3
- **Story Points**: 8
- **Components**: qa, server, mobile, data
- **Dependencies**: EN-01, EN-02, EN-04
- **Source**: `nfr.md` §7, `PRD/14-테스트.md`, `units.md` §4~§5

**설명**: TDD, 실 PostgreSQL 통합, 속성 기반 테스트, API/UI E2E를 공통 도구로 제공해 각 Story가 같은 방식으로 증빙되게 한다.

**수용 기준**:

- [ ] Backend는 Kotest+Testcontainers PostgreSQL, Mobile은 Jest+fast-check를 사용한다.
- [ ] Unit/Integration/E2E가 분리되고 LLM·외부 API는 PR CI에서 Port fake, 솔버는 실코드로 실행된다.
- [ ] 전체 및 변경 모듈 coverage 80% 미만은 머지를 차단하며 generated/vendor 코드는 명시적으로 제외한다.
- [ ] PBT 실패 seed와 shrink path가 CI artifact로 남고 동일 seed로 재현된다.
- [ ] API E2E는 저장→등록→여행→일정→재계획→기록→알림으로 단계별 확장할 수 있다.
- [ ] UI E2E는 시나리오 A/B/C를 단계별 편입할 수 있는 태그·기기 행렬·리포트 골격을 제공한다. 모바일 후보 빌드의 실제 실행·승인은 REL-10이 소유한다.
- [ ] U1~U8이 SECURITY-01~15, RESILIENCY-01~15, PBT-01~10을 Pass/Fail/N/A와 근거로 기록하는 공통 매트릭스와 CI artifact 검사를 제공한다.

**Sub-tasks**:

- [ ] `ST-EN-08-01` `[QA]` Kotest/Testcontainers fixture와 fast-check 공통 arbitrary·seed 설정을 만든다.
- [ ] `ST-EN-08-02` `[QA]` coverage 산정 범위·예외·PR 차단 임계치를 구성하고 의도적 실패로 검증한다.
- [ ] `ST-EN-08-03` `[QA]` 외부 Port fake·clock·위치·네트워크 실패 주입 라이브러리를 구현한다.
- [ ] `ST-EN-08-04` `[E2E]` API/UI E2E skeleton, 테스트 계정·데이터 정리·병렬 격리를 구현한다.
- [ ] `ST-EN-08-05` `[QA/SEC]` U1~U8 컴플라이언스 매트릭스 템플릿·N/A 근거 규칙·누락 차단 CI 검사를 구현한다.

---

## EN-09. 외부 연동 어댑터·쿼터·시크릿 프레임

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P0
- **Target Sprint**: S1~S5
- **Story Points**: 8
- **Components**: server, infra, security, qa
- **Dependencies**: EN-03, EN-05, EN-07, PR2~PR6
- **Source**: D08~D12, `architecture.md` §3.2, `nfr.md` §2.4

**설명**: 소셜 IdP·메일·지도·장소·OTA 딥링크·미디어 저장·날씨·LLM·FCM을 Port/Adapter 뒤에 격리하고 계약 전에도 fake로 개발 가능한 경계를 만든다.

**수용 기준**:

- [ ] Google/Apple/카카오/네이버 OAuth, SES, 카카오 장소·지오코딩, 카카오모빌리티 거리, 네이버 폴백, TourAPI, OTA 딥링크, S3 미디어 저장/CDN, 기상청, LLM, FCM Port가 정의된다.
- [ ] 각 어댑터의 timeout·재시도 가능 여부·circuit·fallback·rate limit·쿼터·캐시 조건이 표로 관리된다.
- [ ] 자격 증명은 Secrets Manager/GitHub Secrets에서 주입되고 코드·로그·테스트 fixture에 존재하지 않는다.
- [ ] 계약 미완 또는 sandbox 장애 시 deterministic fake로 PR CI E2E를 실행할 수 있다. production/RC profile에서 fake가 바인딩되면 서버가 fail-fast하며 이를 boot test로 검증한다.
- [ ] 외부 응답은 경계 DTO 스키마로 검증하고 알 수 없는/결측/악성 값이 도메인에 유입되지 않는다.
- [ ] 쿼터 80%와 오류율·지연·circuit 상태가 관측된다.

**Sub-tasks**:

- [ ] `ST-EN-09-01` `[ARCH]` 외부 Port 계약과 provider별 책임·캐싱·법무 제약 표를 확정한다.
- [ ] `ST-EN-09-02` `[BE]` 공통 adapter wrapper, 경계 스키마 검증, timeout/circuit/fallback을 구현한다.
- [ ] `ST-EN-09-03` `[QA]` provider별 success/empty/invalid/429/timeout/5xx fake와 contract suite를 만든다.
- [ ] `ST-EN-09-04` `[SEC]` 시크릿 경로·회전·로그 redaction과 저장소 secret scan 결과를 검증한다.
- [ ] `ST-EN-09-05` `[OPS]` 쿼터·비용 대시보드와 provider 장애 runbook을 연결한다.

---

## EN-10. 후속 게이트 확장점 선반영

- **Issue Type**: Story
- **Labels**: enabler
- **Parent**: E0
- **Priority**: P1
- **Target Sprint**: S4~S8
- **Story Points**: 5
- **Components**: architecture, server, data, security
- **Dependencies**: EN-02, E4~E8 도메인 모델
- **Source**: D16, D30, D31, `scope.md` §3.2

**설명**: E10~E12를 구현하지 않으면서도 MVP 데이터·권한·이력 구조가 후속 기능을 막지 않도록 최소 확장점을 검증한다.

**수용 기준**:

- [ ] LLM 컨텍스트는 클라이언트 데이터가 아니라 서버가 요청자 권한으로 재조회하는 D31 경계를 사용한다.
- [ ] 일정 plan/current/changelog와 slot ID가 공개 스냅샷·공동 편집 이력으로 확장 가능하되 후속 테이블·UI는 만들지 않는다.
- [ ] 계정 상태가 향후 단계적 제재를 추가할 수 있고 MVP 동작에는 사용되지 않는다.
- [ ] 공개 일정은 allowlist 기반 상대 시기·마스킹 스냅샷을 추가할 수 있는 변환 경계를 가진다.
- [ ] 항목 버전·낙관적 잠금 확장 가능성을 ADR/contract test로 검증하되 WebSocket·잠금 서비스는 구현하지 않는다.
- [ ] E10~E12 코드·endpoint·화면이 MVP 빌드에 노출되지 않는다.

**Sub-tasks**:

- [ ] `ST-EN-10-01` `[ARCH]` D16/D30/D31 확장점과 MVP 비구현 경계를 ADR·모듈 계약에 기록한다.
- [ ] `ST-EN-10-02` `[DATA]` plan/current/changelog·slot ID·account status 스키마의 additive 확장성을 migration test로 검증한다.
- [ ] `ST-EN-10-03` `[SEC]` 서버 재조회 LLM 권한 경계와 공개 스냅샷 allowlist의 데이터 유출 테스트를 추가한다.
- [ ] `ST-EN-10-04` `[QA]` MVP API·navigation·빌드 아티팩트에 Future 기능이 노출되지 않는 범위 회귀 테스트를 추가한다.

---

## SPK-01. Expo 국내 지도 SDK config-plugin 검증

- **Issue Type**: Spike
- **Parent**: E0
- **Labels**: spike, mobile, map
- **Priority**: P0
- **Target Sprint**: S1
- **Due Date**: 2026-08-07
- **Timebox**: 3 working days
- **Components**: mobile, architecture
- **Blocks**: E3 지도·핀 지정·내 주변 UI
- **Source**: `units.md` U3 리스크, `architecture.md` §9.2

**검증 질문**: Expo development build/prebuild와 config plugin으로 카카오 지도 SDK를 iOS/Android에 재현 가능하게 통합하고 네이티브 프로젝트를 커밋하지 않을 수 있는가?

**종료 기준**:

- [ ] iOS/Android 실기기 또는 공식 emulator에서 지도 렌더·핀·좌표 선택·위치 권한 거부 smoke가 동작한다.
- [ ] `expo prebuild --clean` 이후 같은 결과가 재현되고 생성 네이티브 프로젝트를 저장소에 커밋하지 않는다.
- [ ] config plugin 소스·필수 자격 증명·빌드 시간·알려진 제한과 실패 시 대체 경로가 ADR에 기록된다.
- [ ] 결론이 No-Go면 U3 일정·대체 지도 UI·native project 관리 전환 영향을 추정해 PO가 결정한다.

**Sub-tasks**:

- [ ] `ST-SPK-01-01` `[APP]` 최소 Expo 앱에 카카오 지도 config plugin과 iOS/Android smoke 화면을 만든다.
- [ ] `ST-SPK-01-02` `[QA]` clean prebuild·EAS preview·권한 허용/거부를 두 플랫폼에서 재현한다.
- [ ] `ST-SPK-01-03` `[ARCH]` Go/No-Go ADR과 U3 구현 가이드·fallback을 승인한다.

---

## SPK-02. AI 일정 생성 5초·20초 성능 검증

- **Issue Type**: Spike
- **Parent**: E0
- **Labels**: spike, ai, performance
- **Priority**: P0
- **Target Sprint**: S4
- **Due Date**: 2026-09-18
- **Timebox**: 5 working days
- **Components**: ai, server, qa
- **Blocks**: E5 구현 착수 승인
- **Source**: D11, D28, D38, U5 리스크

**검증 질문**: closed-set POI 점수화와 하드 제약 솔버가 MVP 규모에서 첫 1일 5초·전체 20초를 지키고 초과 시 결정론 fallback으로 전환 가능한가?

**종료 기준**:

- [ ] 대표 국내 여행 1/3/7/30일 데이터와 동시 생성 10건의 p50/p95·비용·병목을 측정한다.
- [ ] LLM 경량/상위 티어, 후보 수, solver timebox별 품질·지연 trade-off를 비교한다.
- [ ] 5초 점진 노출, 20초 전체 한계, 취소·부분 초안·결정론 fallback을 prototype으로 검증한다.
- [ ] 목표 미달이면 범위·품질·인프라 변경안과 사용자 고지를 PO/Architect가 승인한다.

**Sub-tasks**:

- [ ] `ST-SPK-02-01` `[AI]` closed-set 점수 응답과 solver benchmark prototype·대표 dataset을 만든다.
- [ ] `ST-SPK-02-02` `[PERF]` 동시 10건과 기간/후보 수 행렬을 실행해 p50/p95·비용을 기록한다.
- [ ] `ST-SPK-02-03` `[ARCH]` 모델 티어·timebox·fallback·용량 결정을 ADR로 승인한다.

---

## SPK-03. Plan-B 10초·트리거 순수 함수 검증

- **Issue Type**: Spike
- **Parent**: E0
- **Labels**: spike, planb, performance
- **Priority**: P0
- **Target Sprint**: S5
- **Due Date**: 2026-10-02
- **Timebox**: 3 working days
- **Components**: server, ai, qa
- **Blocks**: E6/E7 구현 착수 승인
- **Source**: D27·D28·D38, G116, U6 리스크

**검증 질문**: 날씨·휴무·이동 지연·체류 초과를 결정적으로 재현하고 검증된 대안 2~3개를 10초 안에 제시할 수 있는가?

**종료 기준**:

- [ ] clock·현재 위치·외부 맥락을 주입하는 트리거 순수 함수가 동일 입력에 동일 결과를 낸다.
- [ ] 저장 장소 우선 후보 축소·warm-start·solver timebox로 정상/최악 입력 지연을 측정한다.
- [ ] 10초 초과, 후보 0건, 외부 API 실패에서 수동 수정 fallback과 사용자 고지를 검증한다.
- [ ] 목표 미달 시 E7 Story 분할·용량·fallback 변경을 S6 계획 전에 승인한다.

**Sub-tasks**:

- [ ] `ST-SPK-03-01` `[BE]` 주입 가능한 trigger evaluator와 재계획 benchmark prototype을 만든다.
- [ ] `ST-SPK-03-02` `[QA]` 4개 트리거·후보 0·timeout·API 실패 행렬을 고정 seed로 실행한다.
- [ ] `ST-SPK-03-03` `[ARCH]` 10초 budget·warm-start·fallback 결정을 E6/E7 DoR에 반영한다.

---

## SPK-04. 관측 스택 호스팅 결정

- **Issue Type**: Spike
- **Parent**: E0
- **Labels**: spike, observability, cost
- **Priority**: P0
- **Target Sprint**: S0
- **Due Date**: 2026-07-24
- **Timebox**: 2 working days
- **Components**: infra, operations, security
- **Blocks**: EN-06 운영 환경 구축
- **Source**: `infrastructure.md` §10 PD-4

**검증 질문**: Prometheus·Loki·Grafana를 AMP/AMG, Grafana Cloud 또는 자체 호스팅 중 어떤 방식으로 운영할 것인가?

**종료 기준**:

- [ ] 월 비용, 서울 리전/데이터 위치, 90일 보존, 접근 통제, 운영 부담, vendor lock-in을 비교한다.
- [ ] MVP DAU·RPS·로그량 가정과 2배/10배 확장 비용을 기록한다.
- [ ] 선택안의 Terraform·SSO/IAM·SNS/Slack·Sentry 연결 PoC와 탈출 기준을 정의한다.
- [ ] Architect·Security·Operations가 ADR과 예산을 승인한다.

**Sub-tasks**:

- [ ] `ST-SPK-04-01` `[INFRA]` 세 후보의 비용·보존·운영·보안 비교표를 만든다.
- [ ] `ST-SPK-04-02` `[SEC]` 데이터 위치·접근 통제·로그 민감정보 위험을 검토한다.
- [ ] `ST-SPK-04-03` `[ARCH]` 호스팅 ADR·Terraform 영향·확장 트리거를 승인한다.

---

## REF-01. 13 SP Requirement Story Delivery Slice 분할

- **Issue Type**: Task
- **Parent**: E0
- **Labels**: refinement, planning
- **Priority**: P0
- **Target Sprint**: S0
- **Due Date**: 2026-07-24
- **Components**: architecture, qa
- **Blocks**: 아래 15개 13 SP Requirement Story의 Sprint Ready 전환
- **Source**: `jira/README.md` Definition of Ready

**설명**: 원 `US-*`는 요구사항 추적 컨테이너로 유지하고, 실제 Sprint에는 8 SP 이하의 독립 검증 가능한 Delivery Story만 넣는다.

**완료 조건**:

- [ ] 각 원 Story의 AC를 누락·중복 없이 Delivery Slice에 할당하고 원 Requirement ID를 공통 필드로 유지한다.
- [ ] 각 Slice에 단일 Target Sprint, dependency, component, estimate, 테스트·보안 완료 조건이 있다.
- [ ] Slice 간 API·데이터 계약과 병렬/순차 관계가 명시되고 하나의 Slice가 다른 Slice의 미완성 코드를 숨기지 않는다.
- [ ] 원 Story는 모든 Slice와 원문 AC가 Done일 때만 Done으로 집계된다.

**Sub-tasks**:

- [ ] `ST-REF-01-01` `[REFINE]` `US-E1-01`을 인증 수단/계정 충돌/세션·보안 경계 기준의 8 SP 이하 Delivery Story로 분할한다.
- [ ] `ST-REF-01-02` `[REFINE]` `US-E3-01`을 검색 입력/데이터 조합/가격 조회·fallback 기준으로 분할한다.
- [ ] `ST-REF-01-03` `[REFINE]` `US-E3-06`을 수동 등록/복귀 handoff/날짜·거점 검증 기준으로 분할한다.
- [ ] `ST-REF-01-04` `[REFINE]` `US-E3-08`을 지도 검색/링크 파싱/핀 지정 공통 계약과 경로별 Slice로 분할한다.
- [ ] `ST-REF-01-05` `[REFINE]` `US-E4-08`을 POI 사본/한도·권역 경고/시각 고정·미리보기 기준으로 분할한다.
- [ ] `ST-REF-01-06` `[REFINE]` `US-E5-01`을 단일·다중 거점/전환일/오류·권한 fallback 기준으로 분할한다.
- [ ] `ST-REF-01-07` `[REFINE]` `US-E5-03`을 시간 제약 모델/solver 검증/해 없음 안내 기준으로 분할한다.
- [ ] `ST-REF-01-08` `[REFINE]` `US-E5-07`을 클라이언트 경량 검증/서버 확정 검증/자동 보정 기준으로 분할한다.
- [ ] `ST-REF-01-09` `[REFINE]` `US-E5-10`을 완전 AI/같이 고르기/직접 만들기 공통 저장 계약과 모드별 Slice로 분할한다.
- [ ] `ST-REF-01-10` `[REFINE]` `US-E7-02`를 4개 트리거 수집/판정·억제/알림 제안 기준으로 분할한다.
- [ ] `ST-REF-01-11` `[REFINE]` `US-E7-04`를 후보 소싱/solver 검증/0건·timeout fallback 기준으로 분할한다.
- [ ] `ST-REF-01-12` `[REFINE]` `US-E7-07`을 잔여 재정렬/고정 블록/미배치 이월·휴식 모드 기준으로 분할한다.
- [ ] `ST-REF-01-13` `[REFINE]` `US-E8-04`를 plan/current/actual/changelog 저장·조회·diff 재생 기준으로 분할한다.
- [ ] `ST-REF-01-14` `[REFINE]` `US-E8-08`을 종료 전이/전체 요약/지도·통계/fallback 기준으로 분할한다.
- [ ] `ST-REF-01-15` `[REFINE]` `US-E8-12`를 로컬 큐/재시도·멱등 동기화/충돌 해소 기준으로 분할한다.
