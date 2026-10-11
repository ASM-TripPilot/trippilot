# Shared Infrastructure Design — Plan (As-Built 추출)

> **대상**: 전 유닛 공통(U0~U6). 백엔드가 단일 배포 단위인 모듈러 모놀리스라서 인프라 문서를 **통합 1건**으로 둔다(2026-08-31 결정: AWS EKS, 통합 1건).
> **성격**: 인프라 배포는 끝났다(사용자 결정 2026-10-12). 그래서 이 계획은 "설계 결정"이 아니라 **실재 코드에서 as-built 를 추출하는 절차**다. 추출 단계는 모두 끝났다.
> **산출물**: `aidlc/aidlc-docs/construction/shared-infrastructure.md`
> **규칙 근거**: `aidlc/.aidlc-rule-details/construction/infrastructure-design.md`(7개 질문 범주) · `common/question-format-guide.md` · `common/content-validation.md`

## 1. 추출 단계

- [x] 규칙 확인 — Infrastructure Design 단계 정의와 7개 범주(Deployment Environment·Compute·Storage·Messaging·Networking·Monitoring·Shared)
- [x] 선행 설계 읽기 — `u0-foundation/nfr-requirements/`·`nfr-design/`(단일 리전·다중 AZ, SEC·RES·OBS 이연분), U1·U6 tech-stack(Redis 결정 변화), U5 BR-U5-11(사진 서버 비저장), `aidlc-state.md` Extension Configuration·복원력 결정
- [x] Terraform 추출 — `infra/terraform/stack/{network,eks,data,registry-secrets,variables,versions,outputs}.tf` · `environments/{dev,prd}.tfvars`
- [x] 부트스트랩 추출 — `infra/bootstrap/template.json`(state 버킷·IAM 역할·OIDC 신뢰) · `.github/workflows/aws-bootstrap.yml`
- [x] Helm 추출 — `deploy/eks/chart/values{,-dev,-prd}.yaml` · `templates/{backend,ai,embedding,gateway,gateway-config,services,network-policy,hpa,pdb,_helpers}`
- [x] 배포 도구 추출 — `deploy/eks/runtime_secrets.py`(시크릿 allowlist·시드·검증) · `deploy/eks/bootstrap.sql`(DB 롤·`ai_kb`·pgvector) · `runtime_smoke.py`
- [x] CI/CD 추출 — `aws-deploy.yml`(수동·OIDC·atomic) · `backend-ci`·`frontend-ci`·`ai-ci`(GHCR) · 스케줄 배치 6종 · `legal-pages.yml` · `infra/scripts/workflow_config.py`
- [x] 앱 설정 대조 — `backend/app/src/main/resources/application.yml`(시크릿 env·OTLP) · `backend/gradle/libs.versions.toml`(Redis 클라이언트 부재·ShedLock) · `OutboxRelay.kt`·`ShedLockConfig.kt`·스케줄러 멱등 주석 · `backend/Dockerfile`·`ai/Dockerfile`
- [x] 로컬 스택 대조 — `docker-compose.yml` · `deploy/README.md`(kind·SigNoz)
- [x] 클라이언트 배포 추출 — `frontend/eas.json` · `frontend/app.config.ts` · `frontend/src/app/entrypoint/initSentry.ts`
- [x] 운영 가이드 대조 — `docs/guides/aws-eks-deployment.md`(코드와 어긋난 곳은 G-04·G-16 으로 기록)
- [x] 논리 컴포넌트 → AWS 자원 매핑(§3), 7개 범주 서술(§4), 시크릿 흐름(§5), CI/CD·롤백(§6), 외부 의존(§7), 클라이언트(§8)
- [x] SECURITY-01..15 · RESILIENCY-01..15 판정(§9) — 충족 / 부분 / 간극 / 범위 밖 / 확인 불가
- [x] 간극 목록(§10, G-01~G-16) — 증거 경로 포함
- [x] 다이어그램 검증 — Mermaid 노드 ID 는 영숫자만, 라벨은 모두 큰따옴표로 감싸고 안쪽 따옴표·괄호 없음, 텍스트 대안 병기(content-validation 규칙)
- [x] 아래 질문 답변 반영 → `shared-infrastructure.md` §4·§9·§10 갱신 *(2026-10-12 — AI 권고 일괄 적용: Q1=A · Q2=A · Q3=A · Q4=A · Q5=A · Q6=B. 확정 결정은 `shared-infrastructure.md` §12, 영향받는 NFR 줄은 각 문서의 `[개정 · 2026-10-12 · Infra 결정]` 블록)*
- [ ] 사용자 승인 → `audit.md` 기록 · `aidlc-state.md` 의 Infrastructure Design 상태 갱신(이번 작업에서는 다른 파일을 편집하지 않는다는 지시에 따라 미실시)

## 2. 범주별 처리 근거 (질문을 만들지 않은 이유)

| 범주 | 처리 | 근거 |
|---|---|---|
| Deployment Environment | 코드로 확정(리전·환경 2종·브랜치 매핑). **운영 환경의 정체만 미결** → Q1 | `variables.tf` · `workflow_config.py` |
| Compute | 코드로 확정(EKS Auto Mode·복제본·HPA·자원) | 차트 · `eks.tf` |
| Storage | 코드로 확정. **Redis 처분만 미결** → Q5 | `data.tf` · `libs.versions.toml` |
| Messaging | 코드로 확정(브로커 없음·아웃박스·ShedLock). U0 결정과 일치해 물을 것이 없다 | `OutboxRelay.kt` · U0 §9 |
| Networking | 코드로 확정. 공개 엔드포인트 CIDR 은 판단 사항이지만 GitHub 호스팅 러너 의존이라는 근거가 코드에 있어 묻지 않는다 | `variables.tf` `eks_public_access_cidrs` 설명 |
| Monitoring | **알람·로그 수집 소유가 미결** → Q3 | `eks.tf` · tfvars |
| Shared Infrastructure | 코드로 확정(환경 간 공유 0, 환경 안 클러스터·RDS 공유). 멀티테넌시 해당 없음 | `network.tf` `local.name` · `bootstrap.sql` |
| 복원력 결정 지점 | RESILIENCY 규칙상 사용자가 골라야 하는 두 가지(RTO/RPO·롤백 방식) → Q4·Q6 | `resiliency-baseline.md` User Decision Points |

## 3. 질문

> 코드로는 답할 수 없는 것만 남겼다. 각 질문 아래 `[Answer]:` 에 문자를 적어 주세요.

## Question 1
실사용(스토어 출시) 트래픽을 받는 **운영 환경**은 무엇입니까? 코드는 "dev 스택으로 출시를 받고 prd 신설은 비용 보류"(`values-dev.yaml`·`variables.tf`)를 가리키지만, prd 가 apply 됐는지는 리포로 알 수 없습니다.

A) dev 스택이 운영을 겸한다. prd 는 apply 되지 않았고 당분간 만들지 않는다

B) dev 스택이 운영을 겸하고 있지만, 정해진 시점에 prd 를 신설해 옮긴다(시점을 적어 주세요)

C) prd 스택이 이미 apply 돼 있고 운영 트래픽은 prd 에 있다(eas.json 의 api-dev 는 정정 대상)

X) Other (please describe after [Answer]: tag below)

[Answer]: A *(AI 권고 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ", 근거: prd 를 비용 문제로 보류한 결정(2026-10-04)이 코드 세 곳(`variables.tf` `data_protection_enabled` 설명 · `values-dev.yaml` 머리 주석 · `eas.json` production → `api-dev`)에 일관되게 남아 있고, prd 로 옮길 시점을 정한 기록은 리포 어디에도 없다. 그래서 B 에 적을 날짜가 없다. C 는 eas.json 과 정면으로 어긋난다. 재평가 트리거를 둔다: 유료 매출 발생, DAU 가 SCALE-01 가정(1만)의 30% 도달, 또는 Q2 의 99.5% 를 실측으로 못 지킨 달이 생기면 B 로 다시 묻는다. 후속(팀): prd 가 실제로 apply 되지 않았는지 콘솔에서 확인 [라이브 미확인]. 운영을 겸하는 GitHub Environment `dev` 에 required reviewers 를 건다(배포 브랜치가 `develop` 이라 머지가 곧 운영 배포 후보다). `docs/guides/aws-eks-deployment.md` 의 "DEV" 서술을 운영 겸용으로 고친다(G-16).)*

## Question 2
운영 트래픽이 dev 에 있다면, dev 의 **단일 AZ 데이터 계층**(RDS Multi-AZ 꺼짐·Redis 노드 1·NAT 1)을 어떻게 다룹니까? AVAIL-01(월 99.9%, 다중 AZ 전제)과 충돌합니다(G-02).

A) 비용 우선으로 수용한다. 가용성 목표를 낮춰(예: 99.5%) 문서에 명시한다

B) dev 에서도 RDS Multi-AZ 를 켠다(`multi_az` 를 환경이 아니라 별도 변수로 분리. NAT·Redis 는 유지)

C) 운영을 prd(3 AZ)로 옮겨 해소한다(Q1-B 와 연동)

X) Other (please describe after [Answer]: tag below)

[Answer]: A *(AI 권고 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ", 근거: Q1=A 와 비용 기조에 맞춘다. 운영 dev 의 RDS 는 단일 AZ 지만 데이터 보호(삭제 보호·백업 14일·PITR·최종 스냅숏)는 켜져 있다(`data.tf` · `variables.tf` `data_protection_enabled` 기본 true). 그래서 AZ 장애가 나도 데이터는 잃지 않고 **복구 시간**만 늘어난다. 그 시간은 Q4 의 RTO 4시간 안에 든다. 99.9% 는 월 43분이라 단일 AZ 데이터 계층으로는 약속할 수 없는 값이다. 그래서 목표를 **월 99.5%**(월 약 3.6시간)로 낮춰 문서와 실제를 맞춘다. B(dev RDS Multi-AZ)는 RDS 요금이 대략 두 배가 되고, NAT·Redis 단일점은 그대로 남는다. 재평가 트리거: Q1 트리거에 걸리거나 AZ 장애로 99.5% 를 못 지킨 달이 생기면 B 를 다시 묻는다(`multi_az` 를 `local.production` 에서 떼어 별도 변수로 만드는 작은 Terraform 변경). 개정 대상: U0 `nfr-requirements.md` AVAIL-01 · SCALE-03.)*

## Question 3
**관측·알림 기준선**을 누가, 무엇으로 맡습니까? 지금은 알람 0건이고, 컨테이너 로그 수집과 앱 메트릭이 꺼져 있습니다(G-03·G-04·G-05). U0 OBS-02 보안 이벤트 라우팅이 이 단계로 이연돼 있습니다.

A) CloudWatch 로 간다 — `container_logs_enabled=true` 로 켜고, 핵심 알람(5xx·RDS CPU/스토리지·파드 재시작)을 SNS → Slack 으로 보낸다. 담당자를 지정한다

B) 최소안 — 컨테이너 로그만 켜고, 알람은 클라이언트 Sentry 알림에 의존한다

C) 당분간 현 상태(kubectl 로그·알람 없음)를 수용하고, 간극으로 기록만 한다

X) Other (please describe after [Answer]: tag below)

[Answer]: A *(AI 권고 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ", 근거: 라이브 스토어 앱에 알람 0건·중앙 로그 0건은 받아들일 수 없는 간극이다. SECURITY-14 와 RESILIENCY-05·07 은 blocking 이고, U0 OBS-02 라우팅도 이 단계로 이연돼 있다. B 는 서버 장애(5xx·DB 포화)를 클라이언트 Sentry 만으로 보게 돼 사각이 크다. C 는 blocking 기준선 위반을 그대로 둔다. 준비물은 이미 있다: 수집 애드온 조건 분기(`eks.tf`), `cloudwatch-pod` 역할 정의(`infra/bootstrap/template.json`), 켜는 순서 주석(`environments/dev.tfvars`). 그래서 비용은 저트래픽 기준 로그 수집·보존 요금과 알람 몇 개로 작다. 범위: (1) `container_logs_enabled=true`. 운영 환경(dev)의 보존 일수는 SECURITY-14 에 맞춰 90일로 올린다. (2) 최소 알람 — NLB/gateway 5xx 비율, RDS CPU·여유 스토리지·연결 수, 파드 재시작·Ready 아님, 그리고 OBS-02 보안 이벤트 5분류 중 건당 즉시 대상인 리프레시 재사용 감지(로그 메트릭 필터) → SNS → Slack. (3) 담당자는 팀이 지정한다(work-graph 기준 Terraform·배포 담당과 같은 사람이 기본값이며 확정은 팀 몫). 앱 메트릭·트레이스(OTel, G-05)는 이번 결정 범위 밖이고 간극으로 남긴다. 후속(팀): bootstrap 재실행으로 `cloudwatch-pod` 역할 생성 → tfvars 변경 → deploy, 알람·SNS Terraform 추가, 가이드의 로그 서술 정정(G-04).)*

## Question 4
**RTO / RPO** 목표는 무엇입니까? 단일 리전·다중 AZ(Q3=E)는 정해졌지만 수치가 없습니다(RESILIENCY-02, G-15). 현재 인프라가 낼 수 있는 값은 RDS PITR(보존 14일)과 수동 재배포입니다.

A) RTO 4시간 · RPO 15분 — 현재 인프라(PITR + 수동 배포)로 달성 가능한 수준을 목표로 확정하고, 복원 리허설을 1회 실시한다

B) RTO 1시간 · RPO 5분 — 더 엄격하게 잡는다(Multi-AZ 상시화와 런북 자동화가 필요)

C) 수치는 정하지 않고 "최선 노력"으로 둔다(간극 유지)

X) Other (please describe after [Answer]: tag below)

[Answer]: A *(AI 권고 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ", 근거: 현재 인프라가 실제로 낼 수 있는 값으로 확정한다. RPO 15분: RDS PITR(보존 14일)의 복원 가능 시점은 보통 최근 5분 이내이므로 여유를 둔 값이다. RTO 4시간: 단일 AZ RDS 를 다른 AZ 로 PITR 복원하는 시간, 엔드포인트 교체(Secrets·Helm 재배포), 수동 배포 시간을 합친 값이다. B 는 Multi-AZ 상시화가 필요해 Q2=A 와 충돌한다. C 는 RESILIENCY-02 간극을 남긴다. 조건: 복원 리허설 1회(PITR → 별도 인스턴스 복원 → 앱 연결 확인 → 소요 시간 기록)를 실시해야 이 수치가 근거를 갖는다. 리허설 결과가 4시간을 넘으면 수치를 다시 묻는다. Redis 는 Q5=A 로 제거하므로 복구 대상이 아니다. `SOCIAL_TOKEN_ENCRYPTION_KEY` 는 Secrets 복구 창(30일)에 묶여 있어 RPO 범위 안이다. 개정 대상: U0 `nfr-requirements.md` §4 가용성(RTO/RPO 행 추가).)*

## Question 5
**ElastiCache Redis**(프로비저닝됨, 앱 미사용 — G-01)를 어떻게 처리합니까? 설계 문서도 U0 미도입 → U1 도입 → U6 보류로 갈려 있습니다.

A) 제거한다 — Terraform 리소스와 Helm env 를 걷어내고, U1 의 Redis 결정은 "보류 → 철회"로 정리한다

B) 유지한다 — U1 조회 캐시 구현이 예정돼 있다(티켓이나 시점을 적어 주세요)

C) 유지하되 비용을 줄인다(노드 최소화). 구현 시점 미정

X) Other (please describe after [Answer]: tag below)

[Answer]: A *(AI 권고 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ", 근거: 백엔드에 Redis 클라이언트가 0건이다(`backend/gradle/libs.versions.toml`). 구현 티켓도 없다 — 유휴는 TRIP-895 로 지적만 됐다(`backend/docs/design/work-graph.toml`). U6 는 "보류 유지"로 갔다(`u6-.../tech-stack-decisions.md`). U1 설계 자체가 "캐시 미스·Redis 장애 시 PG 직읽기"(P-PERF-U1-2)라서 Redis 없이도 정합성·기능이 같다. 이 상태는 U1 이 걸어 둔 역방향 재평가("실측 캐시 효용이 낮으면 인메모리로 축소")에 해당한다. 남겨 두면 비용, 인증 없는 공격면(네트워크 격리에만 의존, `data.tf` 주석), 문서 드리프트만 남는다. B 는 적을 티켓·시점이 없고, C 는 노드가 이미 최소(`cache.t4g.micro` 1개)라 줄일 것이 없다. 다시 들일 때는 Terraform 리소스 하나와 Spring 의존 하나라 비용이 낮다. U0 재평가 트리거("병목 실측 시 Redis 재평가")가 그 경로다. 개정 대상: U1 `tech-stack-decisions.md` U1-TS-4, `nfr-requirements.md`, `nfr-design/nfr-design-patterns.md` P-PERF-U1-2, `nfr-design/logical-components.md` Redis 행. 후속(팀): Terraform `aws_elasticache_*`·Redis SG·`redis_node_type`·`redis_host/port` 출력 제거, Helm `config.redisHost/Port`·backend env 5개 제거, `deploy/eks/runtime.py` 의 `redis_host` 필수 출력 제거, 관련 테스트(tftest·python) 갱신, `docker-compose.yml` redis 서비스 정리(로컬, 선택).)*

## Question 6
**롤백 방식**을 확정해 주세요. NFR 은 "이전 아티팩트 버전 재배포(버전 핀)"를 골랐지만, as-built 는 "Helm `--atomic` 자동 복귀 + revert 커밋 후 재배포"이고 이미지 태그를 지정하는 입력이 없습니다(G-07). RESILIENCY-04 는 이 선택을 사용자에게 요구합니다.

A) as-built 를 승인한다(atomic + revert 재배포). NFR P-DEP-3 문구를 이에 맞춰 정정한다

B) 버전 핀을 구현한다 — `aws-deploy.yml` 에 기존 이미지 태그를 지정하는 입력(재빌드 없는 재배포)을 추가한다

C) `helm rollback` 수동 런북으로 보완한다(`--history-max 10` 범위 안에서)

X) Other (please describe after [Answer]: tag below)

[Answer]: B *(AI 권고 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ", 근거: NFR 이 이미 버전 핀을 골랐고(P-DEP-3 · Q7=A), RT-9 를 "최초 프로덕션 배포 전 1회 필수"로 정해 두었다. ECR 이 `IMMUTABLE` 태그(`registry-secrets.tf`)로 이전 이미지를 그대로 보존하므로, 핀 재배포는 `aws-deploy.yml` 에 기존 태그 입력을 받아 build-push 를 건너뛰는 작은 변경으로 된다. A 는 앱 결함 롤백마다 재빌드가 필요해 RTO 가 빌드 시간만큼 늘고, 테스트하지 않은 새 바이너리로 "되돌리는" 셈이다(G-14). C 는 운영자 로컬에 클러스터 권한이 있어야 하고, 시크릿 동기화·스모크를 거치지 않는 우회로가 된다. as-built 의 Helm `--atomic`(롤아웃 실패 자동 복귀)은 그대로 1차 안전망으로 둔다. 핀 입력이 구현되기 전까지는 A(revert 재배포)가 잠정 절차다. 후속(팀): `aws-deploy.yml` 에 `image_tag` 입력(존재·형식 검증, 지정 시 build-push 생략, 앱 이미지 3종 동일 태그) 추가, `infra/tests/test_workflow_contracts.py` 계약 갱신, RT-9 리허설 1회와 기록. 개정 대상: U0 `nfr-design-patterns.md` P-DEP-3 — 메커니즘 문구는 유지하고, 구현 상태와 1차 안전망(`--atomic`)만 덧붙인다.)*
