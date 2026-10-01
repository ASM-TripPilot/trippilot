# Terraform에서 만든 AWS 구성 그림

발표 자료의 첫 구성도는 `aws-architecture.svg`(DEV)입니다. `aws-architecture-prd.svg`는 같은 코드와 PRD 입력값으로 만든 비교용 그림입니다. 그림은 **배포하려는 코드의 구성**이며 현재 AWS 계정을 조회한 결과가 아닙니다.

## 사용한 도구와 선택 이유

| 도구 | 확인한 기능 | 이번 자료에서의 사용 |
|---|---|---|
| [Terraform graph](https://developer.hashicorp.com/terraform/cli/commands/graph) + [Graphviz](https://graphviz.org/) | Terraform이 실제 리소스 의존관계를 DOT으로 출력하고 Graphviz가 SVG로 렌더링 | **선택·실행**. `terraform-dependencies.dot` / `.svg`에 실제 도구 출력을 보존 |
| [InfraMap](https://github.com/cycloidio/inframap) | HCL/state에서 중요한 리소스의 관계를 추려 표시. 공식 문서에 provider별 지원 범위와 미연결 노드 제거 동작 안내 | 네트워크를 간추리기에 유용하지만 이 자료에서는 리소스 누락 없이 공식 Terraform 그래프를 보존하는 방식을 선택 |
| [Rover](https://github.com/im2nguyen/rover) | plan/configuration을 읽어 대화형 탐색 및 SVG 생성 | 배포 계획·state를 탐색할 때 유용. 이번 작업은 AWS 연결 없이 소스만 설명하므로 사용하지 않음 |

확인일: 2026-09-19. 실제 실행 버전: Terraform **1.13.5**(배포 workflow와 동일), AWS provider **6.64.0**(저장소 lockfile), Graphviz **16.1.0**, Python **3.13**, python-hcl2 **7.3.1**.

## 두 종류의 그림을 구분합니다

1. **실제 Terraform 의존관계 그래프** — `terraform-dependencies.svg`는 `terraform graph`의 DOT을 그대로 Graphviz로 렌더링했습니다. 화살표 `A → B`는 A가 B에 의존한다는 뜻입니다. 트래픽 방향이나 실제 AZ별 인스턴스 수가 아닙니다. `count`/`for_each` 리소스는 코드 블록 단위로 표현됩니다.
2. **발표용 전체 구성도** — `aws-architecture.svg`는 python-hcl2로 실제 `.tf`와 `dev.tfvars`를 읽고 Graphviz로 렌더링한 **교육용 재배치**입니다. Terraform graph의 원본 출력이라고 주장하지 않습니다. CIDR, AZ/NAT 수, EKS 버전·Auto Mode pool, PostgreSQL/Redis 버전과 환경별 복제 설정은 코드에서 추출합니다. 전체 흐름을 설명하는 고정 배치와 연결 의미를 추가했습니다.

발표용 그림의 파란 상자는 Terraform의 AWS 리소스/설정, 보라색 점선 상자는 CloudFormation bootstrap 또는 사전 준비 항목, 주황색 점선 상자는 Helm 배포 단계입니다. `infra/bootstrap/template.json`의 S3/IAM과 `deploy/eks/chart/templates/services.yaml`의 NLB 설정을 함께 확인했습니다. GitHub OIDC provider와 DNS/ACM은 사전 준비 항목입니다. RDS 관리자 비밀번호는 RDS가 Secrets Manager에 생성하며, Terraform은 앱 secret의 **컨테이너만** 생성합니다.

네트워크 구역과 설명은 한국어로 표기하고 AWS 서비스명은 유지했습니다. SVG 텍스트는 `Apple SD Gothic Neo`를 사용하며, 이 글꼴이 없는 환경에서는 브라우저의 한국어 대체 글꼴로 표시됩니다. `EKS → CloudWatch Logs`만 로그 전송 관계이며, ECR의 점선은 실행 노드의 이미지 사용 관계입니다.

- EKS는 **Auto Mode**입니다. 별도 `aws_eks_node_group` 리소스는 없습니다. 파란 compute 상자는 Auto Mode 설정·관리 범위를 요약하며 실제 EC2 노드 개수를 뜻하지 않습니다.
- Public/compute/data 칸의 AZ 목록은 각 tier에 속한 subnet들의 집합입니다. AZ 1/2/3은 자리표시자입니다. 실제 AZ 이름은 `aws_availability_zones` data source로 선택합니다.
- DEV의 RDS와 Redis를 AZ마다 복제해서 그리지 않았습니다. DEV RDS는 Single-AZ이며 실제 배치 AZ는 생성 시 선택됩니다. PRD는 RDS Multi-AZ와 Redis 3노드입니다.
- Data subnet에는 Internet/NAT 기본 경로가 없습니다. RDS/Redis 보안 그룹은 EKS cluster security group에서 각각 5432/6379 접근을 허용합니다.
- 인터넷 게이트웨이(IGW)는 VPC에 연결되며 public subnet의 기본 경로가 이를 가리킵니다. 구성도에서 public 영역에 함께 묶은 것은 경로 설명을 위한 것입니다.
- Redis는 생성 대상이지만 현재 앱 adapter는 연결되지 않았으므로 요청 흐름 화살표를 그리지 않았습니다. Frontend도 이 EKS Helm 배포 대상이 아닙니다.
- 구성도는 IAM policy, route table association, lifecycle policy 등 세부 리소스를 접어 표시합니다. 전체 Terraform 리소스와 의존관계는 원본 그래프에서 확인합니다.

## 다시 생성하기

사전 설치: Python 3, 프로젝트와 호환되는 Terraform(워크플로 기준 1.13.5), Graphviz의 `dot` 실행 파일. [Terraform 설치 안내](https://developer.hashicorp.com/terraform/install), [Graphviz 설치 안내](https://graphviz.org/download/).

저장소 루트에서 실행합니다.

```sh
python3 -m venv /tmp/trippilot-diagram-venv
/tmp/trippilot-diagram-venv/bin/pip install -r docs/education/assets/requirements-diagrams.txt
/tmp/trippilot-diagram-venv/bin/python docs/education/assets/generate_diagrams.py
```

Terraform의 경로를 지정할 수도 있습니다.

```sh
/tmp/trippilot-diagram-venv/bin/python docs/education/assets/generate_diagrams.py --terraform /path/to/terraform
```

스크립트는 임시 디렉터리에 `.tf`와 `.terraform.lock.hcl`을 복사하고 그 **복사본에서만 S3 backend 블록을 제거**합니다. 원본 리소스 설정은 그대로 둡니다. 이어서 아래 순서로 실행하고 임시 디렉터리를 정리합니다.

```sh
terraform init -backend=false -input=false -lockfile=readonly -no-color
terraform graph > terraform-dependencies.dot
dot -Tsvg terraform-dependencies.dot -o terraform-dependencies.svg
```

Provider 다운로드에는 인터넷이 필요합니다. AWS 자격 증명, state 읽기, `plan`, `apply`, `destroy`는 사용하지 않습니다. 실제 계정에 연결하거나 배포하지 않습니다. Backend 제거는 S3 초기화를 피하기 위한 것으로, backend 자체는 리소스 의존관계 그래프의 대상이 아닙니다.

전체 구성도만 다시 만들려면 `--overview-only`를 지정합니다. 이 경우 Terraform/provider 다운로드도 필요하지 않습니다. `diagram-provenance.json`에는 읽은 소스의 SHA-256과 DEV/PRD 추출값이 기록됩니다. 제한된 HCL 표현식만 처리하며, 지원하지 않는 수식이나 주요 topology 변경은 오류로 중단합니다. 그런 변경 뒤에는 교육용 배치도 함께 검토해야 합니다.

## 검증

```sh
/tmp/trippilot-diagram-venv/bin/coverage run --source=generate_diagrams -m unittest discover -s docs/education/assets -p 'test_generate_diagrams.py'
/tmp/trippilot-diagram-venv/bin/coverage report -m
```

테스트는 DEV/PRD CIDR·NAT·복제수, Auto Mode, subnet count 및 RDS/Redis subnet-group 참조의 변경 감지, 임시 복사본의 원본 보존, 외부 도구 호출 범위, SVG 렌더링을 확인합니다. Terraform 호출 계약 테스트에서는 Terraform만 대체하고 Graphviz는 실제 실행합니다. 제공한 원본 의존관계 그림은 실제 Terraform 실행으로 별도 검증했습니다.
