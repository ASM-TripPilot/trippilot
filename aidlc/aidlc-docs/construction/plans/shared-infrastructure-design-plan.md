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
- [ ] 아래 질문 답변 반영 → `shared-infrastructure.md` §4·§9·§10 갱신
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

[Answer]: 

## Question 2
운영 트래픽이 dev 에 있다면, dev 의 **단일 AZ 데이터 계층**(RDS Multi-AZ 꺼짐·Redis 노드 1·NAT 1)을 어떻게 다룹니까? AVAIL-01(월 99.9%, 다중 AZ 전제)과 충돌합니다(G-02).

A) 비용 우선으로 수용한다. 가용성 목표를 낮춰(예: 99.5%) 문서에 명시한다

B) dev 에서도 RDS Multi-AZ 를 켠다(`multi_az` 를 환경이 아니라 별도 변수로 분리. NAT·Redis 는 유지)

C) 운영을 prd(3 AZ)로 옮겨 해소한다(Q1-B 와 연동)

X) Other (please describe after [Answer]: tag below)

[Answer]: 

## Question 3
**관측·알림 기준선**을 누가, 무엇으로 맡습니까? 지금은 알람 0건이고, 컨테이너 로그 수집과 앱 메트릭이 꺼져 있습니다(G-03·G-04·G-05). U0 OBS-02 보안 이벤트 라우팅이 이 단계로 이연돼 있습니다.

A) CloudWatch 로 간다 — `container_logs_enabled=true` 로 켜고, 핵심 알람(5xx·RDS CPU/스토리지·파드 재시작)을 SNS → Slack 으로 보낸다. 담당자를 지정한다

B) 최소안 — 컨테이너 로그만 켜고, 알람은 클라이언트 Sentry 알림에 의존한다

C) 당분간 현 상태(kubectl 로그·알람 없음)를 수용하고, 간극으로 기록만 한다

X) Other (please describe after [Answer]: tag below)

[Answer]: 

## Question 4
**RTO / RPO** 목표는 무엇입니까? 단일 리전·다중 AZ(Q3=E)는 정해졌지만 수치가 없습니다(RESILIENCY-02, G-15). 현재 인프라가 낼 수 있는 값은 RDS PITR(보존 14일)과 수동 재배포입니다.

A) RTO 4시간 · RPO 15분 — 현재 인프라(PITR + 수동 배포)로 달성 가능한 수준을 목표로 확정하고, 복원 리허설을 1회 실시한다

B) RTO 1시간 · RPO 5분 — 더 엄격하게 잡는다(Multi-AZ 상시화와 런북 자동화가 필요)

C) 수치는 정하지 않고 "최선 노력"으로 둔다(간극 유지)

X) Other (please describe after [Answer]: tag below)

[Answer]: 

## Question 5
**ElastiCache Redis**(프로비저닝됨, 앱 미사용 — G-01)를 어떻게 처리합니까? 설계 문서도 U0 미도입 → U1 도입 → U6 보류로 갈려 있습니다.

A) 제거한다 — Terraform 리소스와 Helm env 를 걷어내고, U1 의 Redis 결정은 "보류 → 철회"로 정리한다

B) 유지한다 — U1 조회 캐시 구현이 예정돼 있다(티켓이나 시점을 적어 주세요)

C) 유지하되 비용을 줄인다(노드 최소화). 구현 시점 미정

X) Other (please describe after [Answer]: tag below)

[Answer]: 

## Question 6
**롤백 방식**을 확정해 주세요. NFR 은 "이전 아티팩트 버전 재배포(버전 핀)"를 골랐지만, as-built 는 "Helm `--atomic` 자동 복귀 + revert 커밋 후 재배포"이고 이미지 태그를 지정하는 입력이 없습니다(G-07). RESILIENCY-04 는 이 선택을 사용자에게 요구합니다.

A) as-built 를 승인한다(atomic + revert 재배포). NFR P-DEP-3 문구를 이에 맞춰 정정한다

B) 버전 핀을 구현한다 — `aws-deploy.yml` 에 기존 이미지 태그를 지정하는 입력(재빌드 없는 재배포)을 추가한다

C) `helm rollback` 수동 런북으로 보완한다(`--history-max 10` 범위 안에서)

X) Other (please describe after [Answer]: tag below)

[Answer]: 
