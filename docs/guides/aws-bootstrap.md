# AWS 배포 초기 설정

TripPilot 배포는 GitHub Actions의 수동 `workflow_dispatch`로 실행한다. 먼저 각 환경에서 **AWS bootstrap (manual)** 워크플로를 한 번 실행하면 Terraform 원격 상태 저장소, 해당 환경의 배포 IAM Role, EKS cluster/node 서비스 Role을 생성한다. 이 작업도 push, PR, tag, schedule 이벤트로 실행되지 않는다.

실제 서비스 구성과 배포 방법은 [AWS EKS 배포 가이드](aws-eks-deployment.md)를 따른다.

## AWS 계정의 최초 인증 준비

아직 AWS를 신뢰할 인증 경로가 없는 워크플로가 자기 자신의 최초 권한을 만들 수는 없다. AWS 관리자가 기존 관리자/SSO 세션으로 다음 두 가지를 사전에 준비한다. AWS 액세스 키를 GitHub에 저장할 필요는 없다.

1. IAM의 기존 GitHub OIDC provider를 확인한다. 없으면 IAM 콘솔에서 provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`으로 등록한다. 계정에 이미 있는 provider를 중복 생성하지 않는다.
2. 환경별 `trippilot-dev-github-bootstrap`, `trippilot-prd-github-bootstrap` IAM Role을 준비한다. [신뢰 정책 예시](../../infra/bootstrap/bootstrap-trust.example.json)의 `<AWS_ACCOUNT_ID>`, `<ENVIRONMENT>`를 실제 값으로 바꾸고, [권한 정책 예시](../../infra/bootstrap/bootstrap-policy.example.json)의 `<AWS_REGION>`도 바꿔 인라인 정책으로 등록한다. 환경은 소문자 `dev` 또는 `prd`이다. 역할의 최대 세션 시간은 기본 1시간 이상으로 두며, workflow는 30분 세션을 요청한다.

초기 Role은 해당 환경의 CloudFormation stack, 상태 bucket 설정, 배포 Role과 EKS 서비스 Role 생성/수정을 담당한다. 상태 객체 읽기/삭제, 자신의 권한 수정, 일반 애플리케이션 리소스 생성 권한은 없다. 다만 배포 Role의 인라인 정책을 작성하는 권한 자체는 권한 위임에 해당하므로, **bootstrap Role을 일반 배포 Role과 같은 수준으로 취급하면 안 된다**. 조직에서 IAM permissions boundary 또는 SCP를 사용한다면 관리자 정책으로 별도 적용하고, 허용 범위를 이 예시보다 넓히지 않는다. 초기 구성이 끝난 뒤 `AWS_BOOTSTRAP_ROLE_ARN` 변수를 제거하거나 bootstrap Role 신뢰를 비활성화할 수 있으며, 권한 정책 갱신 시에만 다시 활성화한다.

GitHub OIDC의 environment 기반 `sub`는 repository와 environment를 제한한다. workflow 파일 이름이나 `workflow_dispatch` 여부까지 증명하는 것은 아니다. 수동 실행 제한은 커밋된 workflow 트리거가 담당하므로 `.github/workflows/` 변경에 대한 branch protection과 코드 리뷰가 필요하다. [AWS OIDC 신뢰 정책 설명](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)을 참고한다.

## GitHub Environment 변수

Repository **Settings → Environments**에서 `dev`, `prd`를 각각 생성한다.

| 변수 | 예시 / 설명 |
| --- | --- |
| `AWS_ACCOUNT_ID` | 해당 환경의 12자리 계정 ID |
| `AWS_REGION` | 선택. 기본값 `ap-northeast-2` |
| `AWS_BOOTSTRAP_ROLE_ARN` | 위에서 만든 해당 환경의 bootstrap Role ARN |
| `AWS_GITHUB_OIDC_PROVIDER_ARN` | 선택. 생략 시 같은 계정의 기본 GitHub provider ARN 사용 |
| `DEPLOY_BRANCH` | 선택. 기본값: DEV `develop`, PRD `main` |

Environment의 deployment branch를 위 값과 같게 제한한다. PRD에는 required reviewers와 prevent self-review를 설정하는 것을 권장한다. OIDC 토큰의 environment claim에는 branch가 포함되지 않으므로 Environment 자체의 branch restriction도 설정해야 한다.

## 초기 워크플로 실행

1. workflow 파일이 repository 기본 branch에 존재하도록 반영한다.
2. **Actions → AWS bootstrap (manual) → Run workflow**에서 환경에 맞는 branch와 `dev` 또는 `prd`를 선택한다.
3. 워크플로가 만든 아래 리소스를 확인한다. 별도 환경은 같은 절차로 실행한다.

| 항목 | DEV | PRD |
| --- | --- | --- |
| CloudFormation stack | `trippilot-dev-bootstrap` | `trippilot-prd-bootstrap` |
| S3 bucket | `trippilot-tfstate-<account>-<region>-dev` | `trippilot-tfstate-<account>-<region>-prd` |
| 배포 IAM Role | `trippilot-dev-github-deploy` | `trippilot-prd-github-deploy` |
| Terraform state key | `terraform.tfstate` | `terraform.tfstate` |

4. 실행 summary의 `DeploymentRoleArn`을 **같은 GitHub Environment**의 `AWS_ROLE_ARN` 변수로 등록한다.
5. 이후 일반 AWS 배포 workflow에서 먼저 `plan`을 실행하고 원하는 환경에 명시적으로 배포한다. bootstrap과 일반 배포는 같은 `aws-<environment>` concurrency group을 사용하므로 동시에 상태나 권한을 변경하지 않는다.

CloudFormation은 Terraform backend가 준비되기 전에 실행할 수 있고, bootstrap stack과 Terraform 애플리케이션 state를 분리해 보관한다. 같은 bootstrap workflow를 다시 실행하면 stack을 갱신하며 변경이 없어도 성공한다. stack에는 termination protection을 켜며 bucket에는 `DeletionPolicy`와 `UpdateReplacePolicy`를 `Retain`으로 설정했다.

## 상태와 권한 범위

상태 bucket은 public access를 차단하고 bucket owner enforced, TLS 필수, SSE-S3 암호화, versioning을 적용한다. 배포 Role은 해당 환경의 `terraform.tfstate`만 읽고 쓸 수 있고, `DeleteObject`는 잠금 파일 `terraform.tfstate.tflock`에만 허용된다. 별도 Terraform workspace를 생성하지 않는다. S3 versioning은 과거 상태 복구를 위한 것이며 비밀 값은 state에 들어갈 수 있으므로 state/plan을 일반 artifact로 공개하지 않는다. [Terraform S3 backend 권한](https://developer.hashicorp.com/terraform/language/backend/s3)에 맞춘 구성이다.

배포 Role은 자체 IAM 정책과 EKS 서비스 Role의 신뢰 정책을 수정할 수 없다. bootstrap이 `trippilot-<env>-cluster`, `trippilot-<env>-node`를 생성하고 각각 `eks.amazonaws.com`, `ec2.amazonaws.com`만 신뢰하도록 고정한다. Terraform은 이 Role을 조회하며, 배포 Role은 두 Role을 AWS EKS/EC2에 전달하는 `PassRole`만 가진다. 연결된 AWS 관리 정책은 EKS Auto Mode에 필요한 명시적 목록으로 제한한다. VPC 리소스는 `Project=trippilot`, `Environment=<env>` 태그를 요구하며 EKS, ECR, RDS, ElastiCache, Logs, 애플리케이션 Secret은 환경 이름으로 ARN 범위를 제한한다. RDS master secret은 AWS가 이름을 생성하므로 `aws:rds:primaryDBInstanceArn` 시스템 태그가 해당 환경 DB ARN과 일치할 때만 읽을 수 있다. [RDS의 Secrets Manager 연동](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)에 필요한 secret 생성/태깅과 KMS DescribeKey 권한도 포함했다.

같은 AWS 계정의 DEV/PRD는 리소스·상태·접근 Role을 나누지만, 완전한 보안 격리를 제공하지 않는다. 예를 들어 account/region 단위 Describe API, AWS 서비스 연결 Role, RDS 자동 Secret 생성 권한, AWS 관리 EKS 정책 내부의 서비스 권한이 공유된다. PRD를 강하게 격리해야 한다면 두 GitHub Environment의 `AWS_ACCOUNT_ID`를 서로 다른 AWS 계정으로 설정하고 각 계정에서 bootstrap을 실행한다.

## 로컬 검증

AWS 인증이나 리소스 생성 없이 실행한다.

```bash
python3 -m unittest discover -s infra/bootstrap/tests -v
cfn-lint infra/bootstrap/template.json
actionlint .github/workflows/aws-bootstrap.yml
```

실제 AWS 리소스 생성/변경은 GitHub Actions의 수동 workflow 실행에서만 수행한다. 제공된 테스트는 정책·템플릿의 회귀 검증이며 실제 계정의 SCP, 서비스 quota, 조직 permissions boundary를 검증하는 AWS 통합 테스트는 아니다.
