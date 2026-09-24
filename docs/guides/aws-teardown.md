# AWS 서비스·bootstrap 수동 삭제

사용하지 않는 DEV·PRD의 서비스 리소스를 정리할 때 **Actions → AWS 수동 삭제**를 실행한다. [배포 workflow](aws-eks-deployment.md)와 같은 환경별 동시 실행 제한을 사용한다. PR·push·develop/main 병합은 삭제를 시작하지 않는다. 먼저 `service`, 완료 후 필요한 경우 `bootstrap`을 별도로 실행한다.

## 준비와 입력

workflow 파일이 저장소 기본 브랜치 `main`에 있어야 Run workflow 메뉴가 표시된다. develop 대상 PR 병합만으로 기본 브랜치에 파일이 생기지는 않는다. 기존 릴리즈 절차로 main에도 반영한 뒤 실행한다. DEV는 기본 `develop`, PRD는 기본 `main`이며 `DEPLOY_BRANCH`를 사용하면 해당 브랜치와 GitHub Environment의 허용 브랜치를 함께 설정한다.

기존 `dev`/`prd` Environment의 `AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_ROLE_ARN`을 사용한다. bootstrap에는 스택 밖에 미리 만든 `AWS_BOOTSTRAP_ROLE_ARN`이 필요하다. 서비스는 배포 역할, bootstrap은 외부 역할을 사용하며 다른 계정·역할로 인증되면 중단한다. 정리 권한은 [bootstrap 권한 예시](../../infra/bootstrap/bootstrap-policy.example.json)를 확인한다. 기존 환경은 먼저 외부 bootstrap 역할에 최신 권한 정책을 적용하고 **AWS bootstrap (manual)을 다시 실행**한다. 새 조회 권한과 state 버킷 정책의 Retain 보호가 스택에 반영되어야 정리 검증을 통과한다.

| 입력 | 의미와 기본값 |
| --- | --- |
| `environment` | `dev` 또는 `prd` |
| `scope` | `service`(기본) 또는 `bootstrap` |
| `operation` | `plan`(기본)으로 검토 후 `destroy`를 별도로 실행 |
| `commit_sha` | 실행 브랜치에 포함된 정리 도구의 40자리 commit SHA |
| `snapshot_policy` | `retain`(기본): RDS 최종 수동 스냅샷 보존. `skip`: 스냅샷 없이 DB 폐기 |
| `purge_state` | `false`(기본): state S3 보존. bootstrap에서만 `true`로 영구 삭제 가능 |
| `confirmation` | destroy일 때 정확히 `DELETE <환경> <12자리 AWS 계정>` |

권한 없는 preflight가 실행 브랜치와 SHA의 포함 관계를 검사하고, 다음 job은 그 SHA를 checkout한다. 환경·계정·옵션·확인 문구·checkout 상태를 검사한 뒤 OIDC 인증을 요청한다. Environment의 승인·브랜치 제한은 [초기 설정](aws-bootstrap.md)대로 유지한다. bootstrap 역할의 최대 세션 시간은 이 workflow가 요청하는 2시간 이상으로 설정한다.

현재 Kubernetes API는 GitHub hosted runner에서 접근 가능한 public endpoint다. API CIDR을 제한한 환경에서는 해당 CIDR에 속한 runner로 `runs-on`을 조정한다. 그 runner는 삭제할 EKS·VPC 밖에 있어야 한다.

## 1. 서비스 계획 확인

`scope=service`, `operation=plan`, `snapshot_policy=retain`, `purge_state=false`로 실행한다. plan은 서비스·삭제 보호를 변경하지 않지만 Terraform backend 초기화, AWS 조회와 잠금을 사용한다. 출력은 삭제 대상 주소와 작업 요약이며 민감한 state·계획 원문을 artifact로 올리지 않는다.

서비스 삭제 대상은 EKS·RDS·ElastiCache Redis·ECR 이미지·앱 Secret·CloudWatch log group·VPC와 NAT 등 Terraform 관리 리소스와 Helm 서비스다. Redis 데이터는 삭제되며 이 절차는 Redis 최종 스냅샷을 만들지 않는다. Terraform state와 bootstrap은 이 단계에서 보존한다.

## 2. 서비스 삭제

검토한 SHA와 같은 환경·정책으로 `operation=destroy`와 확인 문자열을 입력한다.

1. state 리소스의 환경 태그·ARN·VPC·리소스 참조를 검사한다. 임시 작업 디렉터리에서만 RDS 삭제 보호·최종 스냅샷 정책과 ECR 이미지 정리 옵션을 조정한다. EKS 삭제 보호가 있는 경우도 임시 override로 해제한다. 저장 계획에 생성·교체·허용하지 않은 속성 변경이 있으면 중단한다.
2. `trippilot/gateway` Service와 NLB의 Helm·클러스터 소유권을 확인한다. Service를 삭제하고 NLB가 사라질 때까지 기다린 뒤 Helm release를 정리한다. finalizer를 강제로 제거하거나 임의 NLB를 직접 삭제하지 않는다.
3. 검증한 준비 계획을 적용하고 새 destroy 계획을 생성한다. 삭제 대상과 보호·스냅샷 정책을 다시 확인한 뒤 저장 계획을 적용한다.
4. Terraform state가 비었는지 확인한다. 실패하면 bootstrap으로 진행하지 않는다.

RDS 최종 스냅샷 이름은 환경과 실행 ID·attempt를 포함한다. 같은 이름이 이미 있으면 새 workflow attempt로 재실행한다. 최종 스냅샷은 DB 복구용이며 ECR·Secret·Redis·전체 환경을 복원하는 백업은 아니다. 일반 배포의 PRD 보호 설정은 수정하지 않는다.

## 3. bootstrap 계획과 삭제

서비스 삭제가 완료되면 `scope=bootstrap`, `snapshot_policy=retain`으로 먼저 plan을 실행한다. 다음 조건을 모두 확인한다.

- 현재 state가 비어 있고 활성 잠금이 없다. 기본 state·lock 이외의 객체나 다른 workspace/backend 키가 있으면 중단한다. state가 손상되었거나 현재 버전이 삭제된 경우 과거 버전을 읽고 임의로 삭제를 계속하지 않는다.
- 실제 EKS·RDS·Redis·VPC·ECR·앱 Secret·관련 Load Balancer가 남아 있지 않다.
- CloudFormation 스택의 계정·리전·환경·저장소와 예상 리소스가 맞고 state 버킷에 `Retain` 정책이 있다.

`operation=destroy`는 이 조건을 재확인하고 스택의 termination protection을 해제한 뒤 CloudFormation 삭제 완료를 기다린다. 배포 역할과 EKS cluster/node 역할이 함께 삭제되므로 스택 밖의 bootstrap 역할로 실행한다. 스택 삭제 실패 시 S3 영구 삭제로 넘어가지 않는다.

`purge_state=false`면 S3 버킷과 과거 state 버전, TLS 강제 버킷 정책을 보존한다. `true`를 명시하면 스택 삭제 완료 후 해당 버킷의 모든 버전·삭제 마커·미완료 multipart upload를 정리하고 버킷을 삭제한다. 부분 실패나 소유권 불일치는 중단 조건이다. 이 작업은 되돌릴 수 없다.

## 남는 자원과 재사용

최종 수동 RDS 스냅샷, Terraform이 관리하지 않는 RDS 로그, 외부 runner, DNS 레코드, ACM 인증서, 공유 GitHub OIDC provider와 외부 bootstrap 역할은 별도 관리한다. 잔존 자원에는 비용이 발생할 수 있다. DNS가 삭제한 NLB를 계속 가리키지 않도록 도메인 담당자가 정리한다.

Secrets Manager의 복구 유예는 Terraform 설정대로 DEV 7일·PRD 30일이다. 삭제 예약된 Secret은 즉시 같은 이름으로 만들 수 없으며 만료를 기다리거나 운영자가 복구·정리해야 한다. bootstrap 검사는 삭제 예약된 Secret을 서비스 잔존과 구분한다.

state 버킷을 보존한 채 bootstrap을 삭제했다면 동일 이름의 새 CloudFormation 스택 생성은 기존 버킷과 충돌한다. 일반 bootstrap workflow가 자동으로 버킷을 import하지 않는다. state를 다시 쓸 목적이라면 bootstrap까지 삭제하지 않는 편이 단순하다. 삭제 후 복구가 필요하면 보존 state와 버킷을 검토해 운영자가 import 절차를 준비하거나, 보존 필요가 끝난 뒤 별도 bootstrap purge를 검토한다.

삭제 전 코드는 PR revert로 복구할 수 있다. 이미 삭제한 리소스·이미지·영구 삭제 state는 revert로 돌아오지 않는다. 준비 계획 이후 중단되면 검증한 SHA로 삭제를 재시도하거나 정상 배포 plan을 검토해 보호 설정을 복원한다. DB 복구는 보존한 스냅샷에서 별도로 수행한다. 비어 있는 state만으로 삭제 성공을 추정하지 않고 bootstrap의 실제 서비스 조회까지 확인한다.

## 검증 범위

`Infrastructure checks`는 PR에서 Python 단위·모의 통합·CLI 시험, coverage 80% 기준, bootstrap·Helm 계약과 Terraform mock-provider 시험을 실행한다. AWS 인증이나 실제 삭제는 수행하지 않는다.

```bash
python -m coverage run --rcfile=infra/.coveragerc -m unittest discover -s infra/tests -v
python -m coverage run --rcfile=infra/.coveragerc --append -m unittest discover -s deploy/eks/tests -v
python -m coverage report --rcfile=infra/.coveragerc
python -m unittest discover -s infra/bootstrap/tests -v
actionlint .github/workflows/aws-destroy.yml .github/workflows/infra-checks.yml
cfn-lint infra/bootstrap/template.json
```

참고: [SceneTrip 정리 구현](https://github.com/mz2az/SceneTrip/pull/100), [Terraform override](https://developer.hashicorp.com/terraform/language/files/override), [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
