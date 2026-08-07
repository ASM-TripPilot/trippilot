# 로컬 개발환경 설치 가이드

이 문서는 macOS에서 Docker와 Kubernetes 기반의 로컬 개발환경을 구성하는 방법을 설명합니다.

> **모든 팀원은 가능한 한 동일한 개발환경을 사용해야 합니다.**
> 이 프로젝트의 로컬 Kubernetes는 **kind**입니다. Docker Desktop 내장 Kubernetes,
> Minikube, Colima, Rancher Desktop 등 다른 환경을 임의로 쓰지 마세요.
>
> **Docker Desktop은 계속 필요합니다** — kind가 그 위에서 노드를 컨테이너로 띄우기 때문입니다.
> 다만 Docker Desktop의 *내장 Kubernetes 기능*은 켜지 않습니다(7장 참조).
>
> kind를 쓰는 이유는 클러스터 정의를 **코드로 고정**할 수 있어서입니다.
> 노드 수와 포트 매핑이 `deploy/kind/cluster.yaml`에 있으므로 팀원 간 환경 차이가 생기지 않고,
> 깨졌을 때 GUI를 헤매는 대신 클러스터를 지우고 한 줄로 다시 만들 수 있습니다.

---

## 목차

- [로컬 개발환경 설치 가이드](#로컬-개발환경-설치-가이드)
  - [목차](#목차)
  - [1. 개발환경 구성](#1-개발환경-구성)
  - [2. 시스템 요구사항](#2-시스템-요구사항)
  - [3. Homebrew 설치](#3-homebrew-설치)
  - [4. Git 설치](#4-git-설치)
  - [5. Docker Desktop 설치](#5-docker-desktop-설치)
  - [6. Docker Desktop 리소스 설정](#6-docker-desktop-리소스-설정)
    - [메모리가 8GB인 경우](#메모리가-8gb인-경우)
    - [메모리가 16GB 이상인 경우](#메모리가-16gb-이상인-경우)
  - [7. Kubernetes 활성화 (kind)](#7-kubernetes-활성화-kind)
  - [8. kubectl 설치](#8-kubectl-설치)
  - [9. Helm 설치](#9-helm-설치)
  - [10. k9s 설치](#10-k9s-설치)
    - [10.1 실행](#101-실행)
    - [10.2 기본 조작](#102-기본-조작)
    - [10.3 자주 쓰는 화면](#103-자주-쓰는-화면)
    - [10.4 읽기 전용 모드](#104-읽기-전용-모드)
  - [11. AWS CLI v2 설치](#11-aws-cli-v2-설치)
  - [12. 프로젝트 저장소 내려받기](#12-프로젝트-저장소-내려받기)
  - [13. 설치 상태 일괄 확인](#13-설치-상태-일괄-확인)
  - [14. Kubernetes 동작 테스트](#14-kubernetes-동작-테스트)
    - [14.1 Namespace 생성](#141-namespace-생성)
    - [14.2 테스트 Deployment 생성](#142-테스트-deployment-생성)
    - [14.3 테스트 서비스 생성](#143-테스트-서비스-생성)
    - [14.4 로컬에서 접속](#144-로컬에서-접속)
    - [14.5 테스트 리소스 삭제](#145-테스트-리소스-삭제)
  - [15. 프로젝트 컨테이너 이미지 빌드](#15-프로젝트-컨테이너-이미지-빌드)
  - [16. 로컬 Kubernetes에 프로젝트 배포](#16-로컬-kubernetes에-프로젝트-배포)
  - [17. 배포 상태 확인](#17-배포-상태-확인)
  - [18. 코드 변경 후 다시 배포하기](#18-코드-변경-후-다시-배포하기)
  - [19. Apple Silicon 주의사항](#19-apple-silicon-주의사항)
  - [20. Kubernetes 컨텍스트 주의사항](#20-kubernetes-컨텍스트-주의사항)
  - [21. AWS 인증 설정](#21-aws-인증-설정)
  - [22. 민감 정보 관리 규칙](#22-민감-정보-관리-규칙)
  - [23. 자주 사용하는 명령어](#23-자주-사용하는-명령어)
    - [클러스터 정보](#클러스터-정보)
    - [리소스 확인](#리소스-확인)
    - [상세 정보와 로그](#상세-정보와-로그)
    - [리소스 적용과 삭제](#리소스-적용과-삭제)
    - [Deployment 관리](#deployment-관리)
    - [로컬 포트 연결](#로컬-포트-연결)
    - [Helm](#helm)
    - [k9s](#k9s)
  - [24. 문제 해결](#24-문제-해결)
    - [`docker: command not found`](#docker-command-not-found)
    - [`Cannot connect to the Docker daemon`](#cannot-connect-to-the-docker-daemon)
    - [`kubectl: command not found`](#kubectl-command-not-found)
    - [현재 컨텍스트가 `kind-trippilot`이 아님](#현재-컨텍스트가-kind-trippilot이-아님)
    - [`The connection to the server ... was refused`](#the-connection-to-the-server--was-refused)
    - [노드가 `NotReady` 상태](#노드가-notready-상태)
    - [Pod가 `Pending` 상태](#pod가-pending-상태)
    - [`ImagePullBackOff` 또는 `ErrImagePull`](#imagepullbackoff-또는-errimagepull)
    - [`CrashLoopBackOff`](#crashloopbackoff)
    - [localhost로 서비스에 접속할 수 없음](#localhost로-서비스에-접속할-수-없음)
    - [`exec format error`](#exec-format-error)
    - [k9s 실행 시 클러스터에 연결되지 않음](#k9s-실행-시-클러스터에-연결되지-않음)
    - [k9s 화면이 깨져 보임](#k9s-화면이-깨져-보임)
    - [디스크 사용량이 너무 큼](#디스크-사용량이-너무-큼)
  - [25. 로컬 환경 초기화](#25-로컬-환경-초기화)
    - [프로젝트 리소스만 삭제](#프로젝트-리소스만-삭제)
    - [Namespace 전체 삭제](#namespace-전체-삭제)
    - [Kubernetes 클러스터 전체 초기화](#kubernetes-클러스터-전체-초기화)
  - [26. 설치 완료 체크리스트](#26-설치-완료-체크리스트)
  - [27. 공식 문서](#27-공식-문서)

---

## 1. 개발환경 구성

이 프로젝트에서는 다음 도구를 사용합니다.

| 도구 | 용도 |
| --- | --- |
| Docker Desktop | 컨테이너 이미지 빌드 및 실행 |
| kind | 로컬 Kubernetes 클러스터 (Docker Desktop 위에서 노드를 컨테이너로 실행) |
| kubectl | Kubernetes 클러스터 관리 |
| Helm | Kubernetes 애플리케이션 설치 및 관리 |
| k9s | Kubernetes 리소스 터미널 UI 모니터링 |
| AWS CLI v2 | AWS 및 EKS 접근 |
| Git | 소스 코드 버전 관리 |

로컬 개발과 실제 서비스 배포 환경은 다음과 같이 구성됩니다.

```text
로컬 개발
└── kind (Docker Desktop 위)

팀 통합 테스트
└── AWS EKS 개발 클러스터

실제 서비스
└── AWS EKS 스테이징/운영 클러스터
```

---

## 2. 시스템 요구사항

다음 조건을 확인하세요.

- macOS가 설치된 MacBook
- macOS 14(Sonoma) 이상 (최신 Docker Desktop의 요구사항)
- 최소 8GB 메모리 (권장 16GB 이상)
- 최소 20GB 이상의 여유 디스크 공간
- Apple Silicon 또는 Intel 프로세서
- 관리자 권한
- 안정적인 인터넷 연결

Mac 프로세서 종류는 다음 명령으로 확인할 수 있습니다.

```bash
uname -m
```

출력 결과에 따라 프로세서를 구분합니다.

| 출력 | 프로세서 |
| --- | --- |
| `arm64` | Apple Silicon Mac |
| `x86_64` | Intel Mac |

---

## 3. Homebrew 설치

먼저 Homebrew가 설치되어 있는지 확인합니다.

```bash
brew --version
```

버전 정보가 출력되면 이미 설치된 상태이므로 다음 단계로 이동합니다.
명령어를 찾을 수 없다는 메시지가 나오면 Homebrew를 설치합니다.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치가 끝나면 터미널에 표시되는 **Next steps**의 명령을 실행해야 합니다.
Apple Silicon Mac에서는 일반적으로 다음 명령을 실행합니다.

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

> Intel Mac에서는 Homebrew가 일반적으로 `/usr/local` 아래에 설치됩니다.

설치 확인:

```bash
brew --version
```

---

## 4. Git 설치

Git이 설치되어 있는지 확인합니다.

```bash
git --version
```

설치되어 있지 않다면 다음 명령을 실행합니다.

```bash
brew install git
```

설치 확인:

```bash
git --version
```

Git 사용자 정보를 설정합니다. 아래 이름과 이메일 주소는 **자신의 정보로 변경**하세요.

```bash
git config --global user.name "YOUR_NAME"
git config --global user.email "YOUR_EMAIL@example.com"
```

설정 확인:

```bash
git config --global --list
```

---

## 5. Docker Desktop 설치

Docker Desktop을 설치합니다.

```bash
brew install --cask docker-desktop
```

> **주의**
> Homebrew에는 이름이 비슷한 두 가지가 있습니다. 반드시 `--cask docker-desktop`을 사용하세요.
>
> | 명령 | 설치되는 것 |
> | --- | --- |
> | `brew install --cask docker-desktop` | Docker Desktop 앱 (이 가이드에서 사용) |
> | `brew install docker` | Docker CLI 바이너리만 (Docker Desktop 아님) |
>
> 과거에는 cask 이름이 `docker`였으나 현재는 `docker-desktop`으로 변경되었습니다.

설치가 끝나면 Applications 폴더에서 Docker를 실행합니다. 또는 Spotlight에서 `Docker`를 검색해 실행합니다.

Docker Desktop 최초 실행 시 다음 사항을 확인합니다.

1. 사용 약관을 확인합니다.
2. 필요한 시스템 권한을 허용합니다.
3. Docker Engine이 실행될 때까지 기다립니다.
4. Docker Desktop 화면에 Engine이 실행 중인 상태가 표시되는지 확인합니다.

터미널에서 Docker 설치를 확인합니다.

```bash
docker version
```

다음 명령도 실행합니다.

```bash
docker run --rm hello-world
```

정상적으로 Docker 안내 메시지가 출력되면 설치가 완료된 것입니다.

> **주의**
> Docker 관련 명령을 실행하기 전에 Docker Desktop이 실행 중이어야 합니다.
> 다음과 같은 오류가 발생하면 Docker Desktop이 실행 중인지 확인하세요.
>
> ```text
> Cannot connect to the Docker daemon
> ```

---

## 6. Docker Desktop 리소스 설정

Docker Desktop에서 다음 메뉴로 이동합니다.

```text
Docker Desktop → Settings → Resources
```

MacBook 메모리에 따라 다음 값을 권장합니다.

### 메모리가 8GB인 경우

| 항목 | 권장값 |
| --- | --- |
| CPU | 2 |
| Memory | 4GB |
| Swap | 1GB 이상 |
| Disk | 30GB 이상 |

### 메모리가 16GB 이상인 경우

| 항목 | 권장값 |
| --- | --- |
| CPU | 4 |
| Memory | 6~8GB |
| Swap | 1~2GB |
| Disk | 40GB 이상 |

설정을 변경했다면 **Apply & Restart**를 선택합니다.

> 리소스를 지나치게 많이 할당하면 macOS가 느려질 수 있습니다.

---

## 7. Kubernetes 활성화 (kind)

### 7.1 Docker Desktop 내장 Kubernetes는 끕니다

```text
Docker Desktop → Settings → Kubernetes → Enable Kubernetes 해제
```

이미 꺼져 있다면 그대로 둡니다. 켜 두면 `kubectl` 컨텍스트가 `docker-desktop`과 `kind-trippilot` 둘로 늘어나, 어느 클러스터에 배포했는지 헷갈리고 메모리도 이중으로 씁니다.

### 7.2 kind 설치

```bash
brew install kind
```

설치 확인:

```bash
kind version
```

### 7.3 클러스터 생성

클러스터 정의는 저장소에 있습니다(`deploy/kind/cluster.yaml`). 직접 만들지 말고 스크립트를 쓰세요.

```bash
cd <프로젝트 루트>
./deploy/bin/cluster-up.sh
```

이 스크립트는 **멱등**입니다. 이미 클러스터가 있으면 생성을 건너뛰고, SigNoz도 이미 있으면 설치를 건너뜁니다. 클러스터 생성과 SigNoz 설치를 함께 하므로 3~4분 걸립니다.

생성 확인:

```bash
kind get clusters          # trippilot
kubectl config current-context   # kind-trippilot
kubectl get nodes
```

```text
NAME                      STATUS   ROLES           AGE   VERSION
trippilot-control-plane   Ready    control-plane   1m    v1.36.1
```

### 7.4 포트 매핑을 미리 알아둘 것

`deploy/kind/cluster.yaml`이 노드 컨테이너의 포트를 호스트로 끌어옵니다.

| 호스트 | NodePort | 용도 |
|---|---|---|
| `localhost:8081` | 30081 | 백엔드 API |
| `localhost:8080` | 30080 | SigNoz UI |

덕분에 `kubectl port-forward` 없이 바로 접근됩니다.

> **`extraPortMappings`는 클러스터 생성 시점에만 정할 수 있습니다.** 포트를 추가하려면 클러스터를 다시 만들어야 합니다.
>
> 그리고 이 매핑이 이미 호스트 포트를 잡고 있으므로, 같은 포트로 `port-forward`를 겹쳐 열지 마세요. 리스너가 둘 생겨 어느 쪽이 응답할지 OS 바인딩 우선순위에 달리게 됩니다.

### 7.5 클러스터를 새로 만들려면

```bash
kind delete cluster --name trippilot
./deploy/bin/cluster-up.sh
```

> 수집한 로그·트레이스와 DB 데이터가 **전부 사라집니다.**

---

## 8. kubectl 설치

kubectl은 Kubernetes 클러스터를 제어하는 명령줄 도구입니다.

```bash
brew install kubectl
```

설치 확인:

```bash
kubectl version --client
```

현재 Kubernetes 컨텍스트를 확인합니다.

```bash
kubectl config current-context
```

다음 결과가 출력되어야 합니다.

```text
kind-trippilot
```

다른 값이 나온다면 kind 컨텍스트로 변경합니다.

```bash
kubectl config use-context kind-trippilot
```

클러스터 연결 상태와 노드를 확인합니다.

```bash
kubectl cluster-info
kubectl get nodes
```

```text
NAME                      STATUS   ROLES           AGE   VERSION
trippilot-control-plane   Ready    control-plane   ...   v1.36.1
```

단일 노드입니다. 백엔드가 단일 배포 모놀리스(D04)라 노드 간 분산은 검증 대상이 아니고, 노드를 늘리면 이미지를 노드마다 적재해야 하며 메모리만 더 듭니다. 필요해지면 `deploy/kind/cluster.yaml`의 `nodes`에 `- role: worker`를 추가합니다.

> **컨텍스트 이름은 `kind-trippilot`, 노드 이름은 `trippilot-control-plane`입니다.** kind는 컨텍스트 이름에 `kind-` 접두사를 붙이므로 둘이 다릅니다 — 혼동하지 마세요.

시스템 Pod를 확인합니다.

```bash
kubectl get pods --all-namespaces
```

대부분의 Pod가 `Running` 상태여야 합니다.

---

## 9. Helm 설치

Helm은 Kubernetes 애플리케이션을 패키지 형태로 설치하고 관리하는 도구입니다.

```bash
brew install helm
```

설치 확인:

```bash
helm version
```

---

## 10. k9s 설치

k9s는 터미널에서 Kubernetes 리소스를 실시간으로 조회하고 관리할 수 있는 TUI(터미널 UI) 도구입니다.
`kubectl get`, `kubectl describe`, `kubectl logs`를 반복해서 입력하지 않고 한 화면에서 확인할 수 있습니다.

```bash
brew install k9s
```

설치 확인:

```bash
k9s version
```

### 10.1 실행

현재 `kubectl` 컨텍스트를 그대로 사용해 실행됩니다.

```bash
k9s
```

특정 Namespace로 바로 진입하려면:

```bash
k9s -n <NAMESPACE>
```

모든 Namespace를 대상으로 실행하려면:

```bash
k9s -A
```

특정 컨텍스트를 지정해 실행하려면:

```bash
k9s --context <CONTEXT_NAME>
```

> **주의**
> k9s는 실행 시점의 kubectl 컨텍스트를 그대로 사용합니다.
> EKS 컨텍스트에서 실행하면 운영 클러스터를 조작할 수 있으므로, 실행 전에 반드시 컨텍스트를 확인하세요.
>
> ```bash
> kubectl config current-context
> ```

### 10.2 기본 조작

| 키 | 동작 |
| --- | --- |
| `:pod` `Enter` | Pod 목록으로 이동 (`:deploy`, `:svc`, `:ns` 등도 동일) |
| `:ctx` `Enter` | 컨텍스트 전환 |
| `:ns` `Enter` | Namespace 전환 |
| `/` | 현재 목록에서 검색 |
| `Enter` | 선택한 리소스의 상세 화면으로 이동 |
| `d` | describe (리소스 상세 정보) |
| `l` | 로그 보기 |
| `s` | 컨테이너 셸 접속 |
| `y` | YAML 보기 |
| `Ctrl + d` | 선택한 리소스 삭제 |
| `Esc` | 이전 화면으로 이동 |
| `?` | 단축키 도움말 |
| `:q` 또는 `Ctrl + c` | 종료 |

### 10.3 자주 쓰는 화면

```text
:pod        Pod 목록
:deploy     Deployment 목록
:svc        Service 목록
:ing        Ingress 목록
:cm         ConfigMap 목록
:secret     Secret 목록
:node       Node 목록
:ev         클러스터 이벤트
```

리소스 이름은 kubectl의 축약어(`po`, `deploy`, `svc`, `cm`, `ing` 등)와 정식 이름을 모두 사용할 수 있습니다.

> **주의**
> `Ctrl + d`는 확인 절차가 짧아 실수로 리소스를 삭제하기 쉽습니다.
> 로컬 `kind-trippilot` 컨텍스트가 아닌 곳에서는 사용하지 마세요.

### 10.4 읽기 전용 모드

EKS 등 공용 클러스터를 확인할 때는 읽기 전용 모드 사용을 권장합니다.

```bash
k9s --readonly
```

읽기 전용 모드에서는 삭제나 수정 명령이 비활성화됩니다.

---

## 11. AWS CLI v2 설치

AWS CLI는 ECR과 EKS를 사용하기 위해 필요합니다. Homebrew를 이용해 설치합니다.

```bash
brew install awscli
```

설치 확인:

```bash
aws --version
```

출력에 `aws-cli/2`가 포함되어 있는지 확인합니다.

```text
aws-cli/2.x.x ...
```

> AWS 계정 및 인증 설정은 담당자가 별도로 안내합니다.
> **개인 AWS Access Key를 Git 저장소에 저장하면 안 됩니다.**

---

## 12. 프로젝트 저장소 내려받기

프로젝트 저장소를 내려받고 디렉터리로 이동합니다.

```bash
git clone <REPOSITORY_URL>
cd <REPOSITORY_DIRECTORY>
```

예:

```bash
git clone git@github.com:example/example-project.git
cd example-project
```

원격 저장소 정보를 확인합니다.

```bash
git remote -v
```

---

## 13. 설치 상태 일괄 확인

다음 명령을 순서대로 실행합니다.

```bash
git --version
docker version
kubectl version --client
kubectl config current-context
kubectl get nodes
helm version
k9s version
aws --version
```

필수 확인 항목:

- `docker version`이 오류 없이 실행됨
- `kubectl config current-context` 결과가 `kind-trippilot`
- `kubectl get nodes`의 노드가 `Ready`
- Helm 버전이 출력됨
- k9s 버전이 출력됨
- AWS CLI 버전이 `2.x`임

---

## 14. Kubernetes 동작 테스트

다음 실습은 로컬 Kubernetes가 정상적으로 작동하는지 확인하기 위한 것입니다.

### 14.1 Namespace 생성

개인 개발용 Namespace를 생성합니다. `SERVICE`은 영문 소문자로 변경하세요.

```bash
kubectl create namespace SERVICE-dev
```

예:

```bash
kubectl create namespace fronend-dev
```

생성 확인:

```bash
kubectl get namespaces
```

기본 Namespace로 설정하면 이후 명령에 `-n` 옵션을 반복하지 않아도 됩니다.

```bash
kubectl config set-context \
  --current \
  --namespace=SERVICE-dev
```

현재 Namespace 확인:

```bash
kubectl config view --minify \
  --output 'jsonpath={..namespace}'
```

### 14.2 테스트 Deployment 생성

Nginx Deployment를 생성합니다.

```bash
kubectl create deployment nginx \
  --image=nginx:alpine
```

Deployment와 Pod를 확인합니다.

```bash
kubectl get deployments
kubectl get pods
```

Pod가 `Running` 상태가 될 때까지 기다립니다. 상태 변화를 계속 확인하려면 다음 명령을 사용합니다.

```bash
kubectl get pods --watch
```

종료하려면 <kbd>Control</kbd> + <kbd>C</kbd>를 누릅니다.

> k9s가 설치되어 있다면 `k9s`를 실행해 `:pod` 화면에서 상태 변화를 실시간으로 확인할 수도 있습니다.

### 14.3 테스트 서비스 생성

Deployment를 Service로 노출합니다.

```bash
kubectl expose deployment nginx \
  --port=80 \
  --target-port=80
```

Service 확인:

```bash
kubectl get services
```

### 14.4 로컬에서 접속

다음 명령을 실행합니다.

```bash
kubectl port-forward service/nginx 8080:80
```

명령을 실행한 터미널은 그대로 유지합니다. 브라우저에서 다음 주소를 엽니다.

```text
http://localhost:8080
```

Nginx 환영 화면이 보이면 Kubernetes가 정상적으로 작동하는 것입니다.
port-forward를 종료하려면 터미널에서 <kbd>Control</kbd> + <kbd>C</kbd>를 누릅니다.

### 14.5 테스트 리소스 삭제

테스트가 끝나면 생성한 리소스를 삭제합니다.

```bash
kubectl delete service nginx
kubectl delete deployment nginx
```

Namespace 전체를 삭제하려면 다음 명령을 사용할 수 있습니다.

```bash
kubectl delete namespace dev-YOUR_NAME
```

Namespace를 삭제한 경우 기본 Namespace로 돌아갑니다.

```bash
kubectl config set-context \
  --current \
  --namespace=default
```

---

## 15. 프로젝트 컨테이너 이미지 빌드

```bash
./deploy/bin/build.sh
```

이 스크립트가 하는 일은 두 가지입니다.

1. `docker build -t trippilot-backend:dev backend`
2. `kind load docker-image trippilot-backend:dev --name trippilot`

> **2번을 빠뜨리면 배포가 안 됩니다.**
> kind 노드는 호스트 Docker와 **별도의 이미지 스토어**를 씁니다. `docker build`만 하면 노드에서는 그 이미지가 보이지 않아 파드가 `ErrImageNeverPull`로 멈춥니다. `kind load`가 이미지를 노드 안으로 복사합니다.
>
> Docker Desktop 내장 Kubernetes를 쓸 때는 이 단계가 필요 없었습니다. 같은 이미지 스토어를 공유했기 때문입니다. kind로 옮기면서 새로 생긴 단계이니 특히 주의하세요.

백엔드는 11개 모듈을 컨테이너 안에서 전부 빌드하므로 **첫 빌드는 5분 이상** 걸립니다. Gradle 캐시를 BuildKit 캐시 마운트에 두었으므로 두 번째부터는 훨씬 빠릅니다.

이미지 생성 확인:

```bash
docker image ls | grep trippilot-backend
```

---

## 16. 로컬 Kubernetes에 프로젝트 배포

```bash
./deploy/bin/deploy.sh
```

PostgreSQL을 먼저 세우고 기동을 기다린 뒤 백엔드를 적용합니다.

> **DB가 먼저 떠야 합니다.** 백엔드는 기동 시 Flyway 마이그레이션을 돌리므로, DB 없이 뜨면 접속 실패로 죽습니다. `deploy.sh`가 순서를 지키고, Deployment의 initContainer가 한 번 더 기다립니다.

`just`를 설치했다면 클러스터 생성부터 배포까지 한 번에 할 수 있습니다.

```bash
brew install just
just up            # cluster-up → build → deploy
```

배포 후 접근:

```bash
curl http://localhost:8081/api/health     # port-forward 불필요
open http://localhost:8080                # SigNoz UI
```

> 매니페스트 구성과 트러블슈팅은 [`deploy/README.md`](../../deploy/README.md)에 정리돼 있습니다.

---

## 17. 배포 상태 확인

전체 리소스를 확인합니다.

```bash
kubectl get all
```

특정 Namespace를 확인하려면:

```bash
kubectl get all -n <NAMESPACE>
```

Pod 상태 및 상세 정보 확인:

```bash
kubectl get pods
kubectl describe pod <POD_NAME>
```

애플리케이션 로그 확인:

```bash
kubectl logs <POD_NAME>
```

로그를 실시간으로 확인하려면:

```bash
kubectl logs -f <POD_NAME>
```

Deployment에 속한 Pod 로그를 확인하려면:

```bash
kubectl logs -f deployment/<DEPLOYMENT_NAME>
```

컨테이너 내부에 접속하려면:

```bash
kubectl exec -it <POD_NAME> -- /bin/sh
```

Pod에 여러 컨테이너가 있다면 컨테이너 이름을 지정합니다.

```bash
kubectl exec -it <POD_NAME> \
  -c <CONTAINER_NAME> \
  -- /bin/sh
```

> 위 작업들은 k9s에서 Pod를 선택한 뒤 `d`(describe), `l`(로그), `s`(셸 접속) 키로도 수행할 수 있습니다.

---

## 18. 코드 변경 후 다시 배포하기

```bash
./deploy/bin/update.sh      # 또는: just update
```

빌드 → **노드 적재** → 롤링 재시작을 한 번에 합니다.

수동으로 한다면 순서는 이렇습니다.

```bash
docker build -t trippilot-backend:dev backend
kind load docker-image trippilot-backend:dev --name trippilot   # ← 빠뜨리기 쉬움
kubectl rollout restart deployment/trippilot-backend -n trippilot
kubectl rollout status  deployment/trippilot-backend -n trippilot
```

> **`kind load`를 빼면 옛 코드가 계속 돕니다.**
> `docker build`는 호스트 이미지 스토어만 갱신합니다. 노드 안의 이미지는 그대로이므로 재시작해도 새 파드가 옛 이미지를 씁니다. 오류가 나지 않고 **조용히 옛 동작을 유지**하기 때문에 가장 헷갈리는 실수입니다.

이미지 태그(`:dev`)는 그대로 둡니다. 태그가 같아도 `kind load`가 노드의 이미지를 교체했으므로 새 파드는 새 이미지를 씁니다. 태그를 매번 바꾸면 노드에 옛 이미지만 쌓입니다.

새 Pod가 생성되었는지 확인합니다.

```bash
kubectl get pods -n trippilot
```

---

## 19. Apple Silicon 주의사항

Apple Silicon Mac은 기본적으로 `linux/arm64` 이미지를 생성합니다.
AWS EKS 노드가 `linux/amd64`인 경우 로컬에서는 정상적으로 실행되지만 EKS에서는 실행되지 않을 수 있습니다.

현재 Mac 아키텍처 확인:

```bash
uname -m
```

Docker 이미지 아키텍처 확인:

```bash
docker image inspect <IMAGE_NAME> \
  --format '{{.Architecture}}'
```

EKS 배포용 amd64 이미지를 빌드하려면:

```bash
docker buildx build \
  --platform linux/amd64 \
  -t <IMAGE_NAME>:<TAG> \
  .
```

여러 아키텍처를 지원하는 이미지를 빌드하려면:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t <REGISTRY>/<IMAGE_NAME>:<TAG> \
  --push \
  .
```

> 프로젝트의 CI/CD가 이미 이미지를 빌드한다면 로컬에서 EKS용 이미지를 직접 빌드하지 않아도 됩니다.

---

## 20. Kubernetes 컨텍스트 주의사항

로컬 Kubernetes와 EKS는 동일한 `kubectl`을 사용합니다.
따라서 명령을 실행하기 전에 현재 컨텍스트를 반드시 확인해야 합니다.

```bash
kubectl config current-context
```

전체 컨텍스트 목록:

```bash
kubectl config get-contexts
```

로컬 Kubernetes로 변경:

```bash
kubectl config use-context kind-trippilot
```

EKS 컨텍스트는 담당자가 제공한 이름을 사용합니다.

```bash
kubectl config use-context <EKS_CONTEXT_NAME>
```

> **중요**
> 다음과 같은 변경·삭제 명령을 실행하기 전에는 현재 컨텍스트를 반드시 확인하세요.
>
> ```text
> kubectl delete
> helm uninstall
> kubectl apply
> kubectl replace
> kubectl scale
> ```
>
> k9s에서 리소스를 삭제(`Ctrl + d`)할 때도 동일하게 적용됩니다.

권장 습관:

```bash
kubectl config current-context
kubectl get nodes
```

두 명령으로 대상 클러스터를 확인한 후 변경 명령을 실행합니다.

---

## 21. AWS 인증 설정

AWS 계정과 권한을 받은 후 담당자의 안내에 따라 인증을 설정합니다.

AWS SSO를 사용하는 경우 일반적으로 다음 명령을 사용합니다.

```bash
aws configure sso
```

로그인:

```bash
aws sso login --profile <PROFILE_NAME>
```

현재 인증 정보 확인:

```bash
aws sts get-caller-identity \
  --profile <PROFILE_NAME>
```

EKS kubeconfig를 등록하는 일반적인 형식:

```bash
aws eks update-kubeconfig \
  --region <AWS_REGION> \
  --name <EKS_CLUSTER_NAME> \
  --profile <PROFILE_NAME>
```

등록 후 컨텍스트 목록을 확인합니다.

```bash
kubectl config get-contexts
```

> AWS 계정, Region, Profile 및 EKS Cluster 이름은 담당자가 별도로 제공합니다.

---

## 22. 민감 정보 관리 규칙

다음 정보는 **Git에 커밋하면 안 됩니다.**

- AWS Access Key
- AWS Secret Access Key
- AWS Session Token
- 개인 인증서
- 비밀번호
- 실제 운영 DB 접속 정보
- Kubernetes Secret 원문
- `.env` 파일
- 개인 kubeconfig
- Docker Registry 비밀번호

커밋 전 확인:

```bash
git status
git diff --staged
```

`.gitignore`에 최소한 다음 항목이 포함되어 있는지 확인합니다.

```gitignore
.env
.env.*
!.env.example
*.pem
*.key
*.p12
kubeconfig
kubeconfig.*
.DS_Store
```

> 민감 정보를 실수로 커밋했다면 단순히 파일을 삭제하는 것으로 끝내지 말고 **즉시 담당자에게 알리세요.**
> 이미 노출된 키는 폐기하고 새로 발급해야 합니다.

---

## 23. 자주 사용하는 명령어

### 클러스터 정보

```bash
kubectl cluster-info
kubectl get nodes
kubectl get namespaces
```

### 리소스 확인

```bash
kubectl get all
kubectl get pods
kubectl get deployments
kubectl get services
kubectl get ingress
kubectl get configmaps
kubectl get secrets
```

### 상세 정보와 로그

```bash
kubectl describe pod <POD_NAME>
kubectl logs <POD_NAME>
kubectl logs -f <POD_NAME>
kubectl logs deployment/<DEPLOYMENT_NAME>
```

### 리소스 적용과 삭제

```bash
kubectl apply -f <FILE_OR_DIRECTORY>
kubectl delete -f <FILE_OR_DIRECTORY>
```

### Deployment 관리

```bash
kubectl rollout status deployment/<DEPLOYMENT_NAME>
kubectl rollout restart deployment/<DEPLOYMENT_NAME>
kubectl rollout history deployment/<DEPLOYMENT_NAME>
kubectl rollout undo deployment/<DEPLOYMENT_NAME>
```

### 로컬 포트 연결

```bash
kubectl port-forward service/<SERVICE_NAME> 8080:<SERVICE_PORT>
```

### Helm

```bash
helm list --all-namespaces
helm status <RELEASE_NAME> -n <NAMESPACE>
helm upgrade --install <RELEASE_NAME> <CHART_PATH>
helm uninstall <RELEASE_NAME> -n <NAMESPACE>
```

### k9s

```bash
k9s                        # 현재 컨텍스트로 실행
k9s -n <NAMESPACE>         # 특정 Namespace로 실행
k9s -A                     # 모든 Namespace
k9s --context <CONTEXT>    # 특정 컨텍스트로 실행
k9s --readonly             # 읽기 전용 모드
```

---

## 24. 문제 해결

### `docker: command not found`

Docker Desktop이 설치되어 있는지 확인합니다.

```bash
brew install --cask docker-desktop
```

설치 후 Docker Desktop을 직접 실행하세요.

---

### `Cannot connect to the Docker daemon`

Docker Desktop이 실행되고 있지 않은 상태입니다.

1. Docker Desktop을 실행합니다.
2. Docker Engine이 준비될 때까지 기다립니다.
3. 다시 실행합니다.

```bash
docker version
```

---

### `kubectl: command not found`

kubectl을 설치합니다.

```bash
brew install kubectl
```

---

### 현재 컨텍스트가 `kind-trippilot`이 아님

컨텍스트를 변경합니다.

```bash
kubectl config use-context kind-trippilot
```

확인:

```bash
kubectl config current-context
```

---

### `The connection to the server ... was refused`

다음 내용을 확인합니다.

1. Docker Desktop이 실행 중인지 확인합니다.
2. kind 클러스터가 살아 있는지 확인합니다.

   ```bash
   kind get clusters          # trippilot 이 나와야 합니다
   docker ps | grep trippilot-control-plane
   ```

3. 현재 컨텍스트를 확인합니다.

   ```bash
   kubectl config current-context   # kind-trippilot
   ```

4. 그래도 안 되면 클러스터를 다시 만듭니다.

   ```bash
   kind delete cluster --name trippilot
   ./deploy/bin/cluster-up.sh
   ```

   > 수집한 로그·트레이스와 DB 데이터가 전부 사라집니다.

---

### 노드가 `NotReady` 상태

잠시 기다린 후 다시 확인합니다.

```bash
kubectl get nodes
```

계속 `NotReady`라면 Docker Desktop을 재시작합니다.
그래도 해결되지 않으면 Docker Desktop에서 다음 메뉴를 사용합니다.

```text
Settings → Kubernetes → Reset Kubernetes Cluster
```

> Reset을 실행하면 로컬 Kubernetes에 생성한 리소스가 모두 삭제됩니다.

---

### Pod가 `Pending` 상태

Pod 상세 정보를 확인하고 출력 하단의 **Events**를 확인합니다.

```bash
kubectl describe pod <POD_NAME>
```

흔한 원인:

- CPU 또는 메모리 부족
- PersistentVolume 미생성
- 스케줄링 조건 불일치

Docker Desktop 리소스가 부족하다면 CPU 또는 메모리를 늘립니다.

---

### `ImagePullBackOff` 또는 `ErrImagePull`

Pod 상세 정보를 확인합니다.

```bash
kubectl describe pod <POD_NAME>
```

흔한 원인:

- 이미지 이름 오타
- 존재하지 않는 이미지 태그
- Private Registry 인증 실패
- 로컬 이미지와 Kubernetes 이미지 저장소의 차이
- 잘못된 `imagePullPolicy`

Deployment 이미지 설정을 확인합니다.

```bash
kubectl get deployment <DEPLOYMENT_NAME> \
  -o jsonpath='{.spec.template.spec.containers[*].image}'
```

> 프로젝트에서 정한 로컬 이미지 빌드 및 로드 방법을 사용하세요.

---

### `CrashLoopBackOff`

애플리케이션 로그를 확인합니다.

```bash
kubectl logs <POD_NAME>
```

이전 컨테이너 로그가 필요하다면:

```bash
kubectl logs <POD_NAME> --previous
```

흔한 원인:

- 환경 변수 누락
- 잘못된 DB 주소
- 애플리케이션 시작 오류
- 포트 설정 오류
- ConfigMap 또는 Secret 누락

---

### localhost로 서비스에 접속할 수 없음

먼저 port-forward를 사용하세요.

```bash
kubectl port-forward \
  service/<SERVICE_NAME> \
  8080:<SERVICE_PORT>
```

그리고 다음 주소로 접속합니다.

```text
http://localhost:8080
```

---

### `exec format error`

컨테이너 이미지 아키텍처가 실행 환경과 맞지 않을 수 있습니다.

이미지 아키텍처 확인:

```bash
docker image inspect <IMAGE_NAME> \
  --format '{{.Architecture}}'
```

필요한 플랫폼으로 다시 빌드합니다.

```bash
docker buildx build \
  --platform linux/amd64 \
  -t <IMAGE_NAME>:<TAG> \
  .
```

---

### k9s 실행 시 클러스터에 연결되지 않음

k9s는 `kubectl`과 동일한 kubeconfig를 사용합니다. 먼저 kubectl이 정상 동작하는지 확인합니다.

```bash
kubectl config current-context
kubectl get nodes
```

kubectl이 정상인데 k9s만 실패한다면 kubeconfig 경로를 명시해 실행합니다.

```bash
k9s --kubeconfig ~/.kube/config
```

---

### k9s 화면이 깨져 보임

터미널이 UTF-8 및 256색을 지원해야 합니다. 다음 환경 변수를 확인하세요.

```bash
echo $TERM
echo $LANG
```

필요하다면 `~/.zshrc`에 다음을 추가합니다.

```bash
export TERM=xterm-256color
export LANG=en_US.UTF-8
```

---

### 디스크 사용량이 너무 큼

Docker 사용량 확인:

```bash
docker system df
```

사용하지 않는 Docker 리소스 삭제:

```bash
docker system prune
```

사용하지 않는 이미지까지 모두 삭제하려면:

```bash
docker system prune --all
```

> 삭제 후 필요한 이미지를 다시 내려받거나 빌드해야 합니다.
> 볼륨까지 삭제하는 명령은 데이터베이스 데이터도 삭제할 수 있으므로 **담당자 안내 없이 실행하지 마세요.**

---

## 25. 로컬 환경 초기화

### 프로젝트 리소스만 삭제

일반 YAML:

```bash
kubectl delete -f k8s/
```

Kustomize:

```bash
kubectl delete -k k8s/overlays/local
```

Helm:

```bash
helm uninstall <RELEASE_NAME> \
  --namespace <NAMESPACE>
```

### Namespace 전체 삭제

```bash
kubectl delete namespace <NAMESPACE>
```

### Kubernetes 클러스터 전체 초기화

kind에서는 클러스터를 지우고 다시 만듭니다. GUI 메뉴가 아니라 명령 한 줄입니다 — 이것이 kind를 쓰는 이유이기도 합니다.

```bash
kind delete cluster --name trippilot
./deploy/bin/cluster-up.sh
```

> 이 작업은 로컬 클러스터의 **모든 리소스를 삭제**합니다.
> SigNoz가 수집한 로그·트레이스·대시보드와 PostgreSQL 데이터가 전부 사라지며 되돌릴 수 없습니다.

DB만 비우고 싶다면 클러스터를 지울 필요가 없습니다.

```bash
just db-reset
```

---

## 26. 설치 완료 체크리스트

다음 항목을 모두 확인하세요.

- [ ] Homebrew가 설치되어 있다.
- [ ] Git이 설치되어 있다.
- [ ] Docker Desktop이 실행 중이다.
- [ ] `docker run --rm hello-world`가 성공한다.
- [ ] kind 클러스터 `trippilot`이 생성되어 있다(`kind get clusters`).
- [ ] Docker Desktop 내장 Kubernetes는 꺼져 있다.
- [ ] kubectl이 설치되어 있다.
- [ ] 현재 Kubernetes 컨텍스트가 `kind-trippilot`이다.
- [ ] `kubectl get nodes`의 노드 상태가 `Ready`이다.
- [ ] Helm이 설치되어 있다.
- [ ] k9s가 설치되어 있고 `k9s` 실행 시 클러스터가 조회된다.
- [ ] AWS CLI v2가 설치되어 있다.
- [ ] 테스트 Nginx를 배포하고 브라우저로 접속했다.
- [ ] 테스트 리소스를 삭제했다.
- [ ] 프로젝트 저장소를 clone했다.
- [ ] 프로젝트 이미지를 빌드하고 `kind load`로 노드에 적재할 수 있다.
- [ ] 민감 정보 관리 규칙을 확인했다.

설치가 완료되면 다음 명령의 출력 결과를 담당자에게 공유합니다.

```bash
echo "=== Mac Architecture ==="
uname -m
echo "=== macOS Version ==="
sw_vers
echo "=== Git ==="
git --version
echo "=== Docker ==="
docker version --format \
  'Client: {{.Client.Version}} / Server: {{.Server.Version}}'
echo "=== kubectl ==="
kubectl version --client
echo "=== Kubernetes Context ==="
kubectl config current-context
echo "=== Kubernetes Nodes ==="
kubectl get nodes
echo "=== Helm ==="
helm version --short
echo "=== k9s ==="
k9s version --short
echo "=== AWS CLI ==="
aws --version
```

> 출력 내용에 토큰, 비밀번호 또는 AWS 키가 포함되지 않았는지 확인한 후 공유하세요.

---

## 27. 공식 문서

설치 화면이나 명령이 이 문서와 다르게 보일 경우 다음 공식 문서를 참고하세요.

- [Docker Desktop for Mac 설치 문서](https://docs.docker.com/desktop/setup/install/mac-install/)
- [kind 문서](https://kind.sigs.k8s.io/)
- [Kubernetes macOS용 kubectl 설치 문서](https://kubernetes.io/docs/tasks/tools/install-kubectl-macos/)
- [Helm 설치 문서](https://helm.sh/docs/intro/install/)
- [k9s 공식 문서](https://k9scli.io/)
- [AWS CLI v2 설치 문서](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

공식 문서를 확인했는데도 문제가 해결되지 않으면 다음 정보를 포함해 담당자에게 문의하세요.

1. Mac 모델 및 프로세서 종류
2. macOS 버전
3. 실행한 명령
4. 전체 오류 메시지
5. `kubectl config current-context` 결과
6. `kubectl get nodes` 결과
7. 문제 발생 직전 수행한 작업

> **비밀번호, Access Key, Secret Key, Session Token은 공유하지 마세요.**
