핵심 구성과 대부분의 설정 수치는 정본과 일치하지만, 무중단·자동 복구·배포 검증·비밀값 보관·비용을 단정한 문장은 수정이 필요합니다. CRITICAL 지적은 없습니다.
다이어그램은 실제로 고정하지 않은 AZ 배치, IAM의 리전 배치, 개발용 NLB와 웹 원본·배포 연결 누락을 우선 보완해야 합니다.
대학생 19장·심사 14장 스크린샷에서 본문이 겹치거나 화면 밖으로 잘린 중대 문제는 발견하지 못했으나, 구조도 가독성과 현재 HTML·스크린샷의 문구 불일치는 개선해야 합니다.

## 검수 범위와 판정 기준

- 기준: 로컬 `develop`, HEAD `7ce2a53f5`, 2026-10-30. 지정한 Terraform·tfvars·bootstrap·Helm·워크플로·배포 게이트·가이드·AI 모델 문서·`.env.example`를 대조했습니다. 필요한 경우 이들이 호출하는 배포 도구까지 확인했습니다.
- `students.html`·`report.html`은 검수 중 갱신된 **2026-10-30 19:07:41 수정본**을 최종 대조했습니다. 이하 `src/…`는 `docs/presentations/aws-architecture/src/…`입니다. 줄 번호는 이 확인본 기준입니다. 그림은 `aws-architecture.png` 및 덱에 삽입된 그림을 확인했습니다.
- 33개 PNG가 모두 1920×1080임을 확인하고 전체 화면을 시각 검토했습니다. 실제 AWS 리소스·운영 로그·청구서·모델 평가 원본을 조회한 검수는 아닙니다. 코드의 목표 설정과 실서비스의 현재 상태를 구분했습니다. 테스트 실행이나 배포는 하지 않았습니다.
- HIGH는 제출 전 고칠 사실 오류·중요 보장 과장, MEDIUM은 범위·조건·구조 오해, LOW는 교육·표현·보완 제안입니다. 그림의 수정안은 붙여 넣을 라벨·캡션과 배치 지시를 함께 적었습니다.

## A. 사실 오류·과장

### A01 [HIGH] 무중단과 복제본 분산을 보장하는 표현

- **대상:** `src/students.html` 9장, `src/report.html` 2·5·14장, `src/aws-architecture.html` 그림 1.
- **원문:** “gateway·backend·ai는 늘 둘 이상 떠 있어요.” / “복제본은 AZ·노드별로 흩어 배치합니다” / “무중단과 자가 회복” / “PDB · 노드 교체 중 무중단”.
- **문제:** 복제본 수는 유지하려는 목표입니다. AZ·노드 분산은 `ScheduleAnyway`여서 강제되지 않으며, PDB는 자발적 축출을 제한합니다. 갑작스러운 노드 장애나 같은 노드에 놓인 복제본의 동시 손실까지 막지 못합니다. 현재 단일 AZ DB·단일 NAT 구성까지 포함한 서비스 전체의 무중단으로 확장해서도 안 됩니다.
- **근거:** `deploy/eks/chart/values-dev.yaml:17`의 비보장 설명, `deploy/eks/chart/templates/_helpers.tpl:29`·`:38`, `deploy/eks/chart/templates/pdb.yaml:1`, `infra/terraform/stack/data.tf:49`, `infra/terraform/stack/network.tf:114`.
- **수정안(학생):** “운영 서버는 둘 이상 유지하도록 설정했어요. 계획된 노드 교체 때는 하나를 남기도록 제한하고, 서로 다른 AZ와 노드에 배치되도록 유도해요. 갑작스러운 장애까지 모두 막아 주는 건 아니에요.”
- **수정안(보고):** “복제본 2개 이상과 PDB로 계획된 노드 교체에 대비하고, AZ·노드 분산을 선호하도록 설정했습니다.” 제목은 “중단 위험을 줄이는 이중화와 복구”로 변경합니다.
- **수정안(그림):** “PDB · 자발적 축출 시 최소 1개 유지”.

### A02 [HIGH] 자동 롤백을 배포 전체의 자동 복구로 확대

- **대상:** `src/students.html` 13장, `src/report.html` 2·5·8·14장.
- **원문:** “실패하면 자동 복구” / “실패하면 이전 릴리스로 되돌립니다” / “실패하면 자동 롤백”.
- **문제:** `helm --atomic`의 보호 범위는 Helm 업그레이드입니다. 그 뒤의 연결 점검·KB·POI 적재 실패에 자동 Helm 롤백이 연결되어 있지 않습니다. Terraform 변경, DB 마이그레이션, Helm 밖에서 동기화한 런타임 Secret도 되돌리지 않습니다.
- **근거:** `.github/workflows/aws-deploy.yml:331`·`:335`·`:336`·`:352`·`:369`, `docs/guides/aws-eks-deployment.md:87`·`:128`.
- **수정안(학생):** “Helm 배포가 실패하면 앱 릴리스를 되돌려요. DB·인프라·비밀값 변경과 배포 뒤 점검 실패는 따로 복구해야 해요.”
- **수정안(보고):** “Helm 업그레이드 실패 시 이전 릴리스로 롤백합니다. 인프라·DB·런타임 Secret 변경과 후속 점검 실패는 별도 복구 대상입니다.”

### A03 [HIGH] 운영 배포 게이트의 예외와 비교 대상을 누락

- **대상:** `src/students.html` 13장, `src/report.html` 2·8장.
- **원문:** “최근 72시간 안에 개발 서버에서 검증된 코드여야 나가요.” / “개발 서버에서 검증된 코드만 운영에 나갑니다.” / “72시간 안에 검증된 커밋과 같아야 통과”.
- **문제:** 정기 릴리스만 개발 배포 성공 이력을 검사합니다. 핫픽스는 Jira 키·사유를 요구하고 해당 검사를 건너뜁니다. 동일 커밋 SHA가 아니라 `.github`를 제외한 코드 트리의 동일성을 확인합니다. 코드가 확인하는 ‘검증’도 최근 성공한 개발 앱 배포이며, 모든 기능의 사람 검수 완료를 뜻하지 않습니다.
- **근거:** `infra/scripts/deploy_gate.py:3`·`:6`·`:25`·`:58`·`:65`, `infra/scripts/workflow_config.py:66`·`:69`·`:70`.
- **수정안(학생):** “정기 배포는 최근 72시간 안에 개발 서버 배포에 성공한 코드와 비교해요. 긴급 수정은 이슈 번호와 사유를 남기고 별도로 검증해요.”
- **수정안(보고):** “정기 릴리스는 최근 72시간 내 성공한 개발 앱 배포와 .github를 제외한 코드 트리가 같아야 합니다. 긴급 수정은 Jira 키와 사유를 기록하고 이 게이트를 건너뜁니다.”

### A04 [HIGH] 비밀값의 실제 보관·전달 경로와 불일치

- **대상:** `src/students.html` 12장, `src/report.html` 6장.
- **원문:** “배포할 때 메모리로만 읽어서 넣어요.” / “비밀값은 Secrets Manager에만 둡니다.”
- **문제:** Kubernetes Secret으로 복제·저장해 파드에 주입합니다. Secrets Manager 갱신은 권한을 제한한 임시 파일을 거친 뒤 삭제합니다. 공공데이터 키의 원본은 GitHub Secret입니다. ‘Terraform state에 비밀값을 넣지 않는다’는 설명은 맞지만, 이를 ‘메모리에만 존재’ 또는 ‘단일 저장 장소’로 설명하면 틀립니다.
- **근거:** `deploy/eks/runtime_secrets.py:74`·`:79`·`:84`·`:90`·`:331`·`:342`, `docs/guides/aws-eks-deployment.md:101`·`:112`.
- **수정안(학생):** “비밀값은 인프라 기록 파일에 넣지 않아요. 전용 보관함에서 쿠버네티스 Secret으로 전달하고, 갱신 중 잠깐 쓰는 파일은 접근 권한을 제한한 뒤 바로 지워요.”
- **수정안(보고):** “비밀값은 Terraform state와 Helm values에 넣지 않고 Secrets Manager에서 Kubernetes Secret으로 동기화합니다. 공공데이터 키는 GitHub Secret을 원본으로 사용하며, 갱신용 임시 파일은 접근 권한을 제한하고 삭제합니다.”

### A05 [HIGH] 모든 AWS 반영이 수동이라는 설명

- **대상:** `src/students.html` 13장, `src/report.html` 8장, `src/aws-architecture.html` GitHub Actions 설명.
- **원문:** “push하면 바로 배포되는 게 멋있어 보이죠. 일부러 안 했어요.” / “push로 AWS가 바뀌지 않습니다. 모든 반영은 … 수동 실행입니다.” / “CI 테스트 · 수동 배포(OIDC)”.
- **문제:** EKS 서버 배포는 수동이지만, 웹은 경로 필터에 해당하는 `main` push로 S3 파일과 CloudFront 캐시를 갱신합니다. 가이드 첫 문장의 수동 배포 설명도 서버 워크플로 범위로 해석해야 합니다.
- **근거:** `.github/workflows/frontend-web-deploy.yml:9`·`:12`·`:132`·`:151`, `.github/workflows/aws-deploy.yml:7`, `docs/guides/aws-eks-deployment.md:3`.
- **수정안(학생):** “서버 배포는 사람이 버튼을 눌러요. 웹 화면 파일은 main에 관련 변경이 반영되면 자동으로 배포돼요.”
- **수정안(보고):** “서버 인프라와 EKS 앱 배포는 수동으로 통제합니다. 웹 정적 파일은 main의 관련 변경 시 자동 배포합니다.”
- **수정안(그림):** “CI 테스트 · 서버 수동 배포 · 웹 자동 배포(OIDC)”.

### A06 [HIGH] prd 전환을 설정 파일 하나로 즉시 완료한다고 설명

- **대상:** `src/students.html` 16장, `src/report.html` 2·10·14장, `src/aws-architecture.html` 우측 규모 메모.
- **원문:** “설정 파일 하나로 바로 바꿀 수 있어요” / “설정 파일 하나로 3 AZ·Multi-AZ로 올라갑니다” / “트래픽이 늘면 바로 적용합니다”.
- **문제:** 규모 설정은 준비됐지만 prd는 별도 환경·리소스·state입니다. 부트스트랩, 권한, 인증서, DNS, 비밀값 준비가 필요합니다. 특히 현재 `prd.tfvars`는 컨테이너 로그가 꺼져 있어 현 운영 관측 설정까지 그대로 따라오지 않습니다. 기존 서비스 데이터를 새 DB로 옮기거나 연결하는 전환 절차가 필요하다는 점은 별도 스택 구조에서 도출한 **추론**이며, 완성된 이전 자동화를 확인한 것은 아닙니다.
- **근거:** `infra/terraform/environments/prd.tfvars:1`·`:3`·`:7`, `docs/guides/aws-eks-deployment.md:11`·`:17`·`:44`·`:48`·`:91`·`:97`, `infra/terraform/stack/network.tf:2`.
- **수정안(학생):** “prd용 규모 설정은 준비해 뒀어요. 권한·인증서·비밀값·관측 설정을 준비하고 데이터 전환을 검증한 뒤 옮길 수 있어요.”
- **수정안(보고):** “prd용 3 AZ·AZ별 NAT·Multi-AZ DB 설정을 마련했습니다. 별도 환경 준비와 데이터 전환 검증을 거쳐 적용할 계획입니다.”
- **수정안(그림):** “환경별 규모 설정 준비 · prd 전환은 별도 준비·검증 필요”.

### A07 [HIGH] Bedrock 무호출 시 총비용 0원

- **대상:** `src/students.html` 11장, `src/report.html` 10장.
- **원문:** “요청이 없으면 요금도 없어요.” / “요청이 없으면 0원”.
- **문제:** 지정 정본 `ai-models-for-clients.md`에도 같은 단순화가 있으나, AWS Custom Model Import의 추론 과금은 활성화된 5분 구간 단위이고 모델 저장 비용은 별도입니다. **정본 문서 자체의 표현도 공식 요금 설명과 불일치합니다.** 무호출 즉시 전체 비용이 0원이 되는 것은 아닙니다.
- **근거:** `ai/docs/ai-models-for-clients.md:42`, `.env.example:311`; 2026-10-30 확인한 [AWS Bedrock 공식 요금표의 Custom Model Import](https://aws.amazon.com/bedrock/pricing/) 및 [추론 비용 계산 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/import-model-calculate-cost.html).
- **수정안(학생):** “한동안 호출이 없으면 추론 용량이 0으로 줄어들어요. 추론은 활성화된 5분 구간 단위로 과금되고, 모델 저장 비용은 별도예요.”
- **수정안(보고):** “무호출 시 추론 용량을 0으로 축소해 유휴 추론 비용을 줄입니다. 추론은 활성화된 5분 구간 단위로 과금되며 모델 저장 비용은 별도입니다.”

### A08 [MEDIUM] 데이터 보호 수치의 적용 대상을 운영 자원으로 한정

- **대상:** `src/students.html` 10장, `src/report.html` 2·7장.
- **원문:** “매일 백업, 14일 보관” / “30일” / “인스턴스를 지워도 남는 최종 스냅숏과 자동 백업” / “마지막 스냅숏 … 무조건”.
- **문제:** 운영 DB·운영 앱 시크릿에는 근거가 있습니다. 다만 덱과 그림에 함께 등장하는 개발용 RDS는 백업 1일, 삭제 보호 없음, 최종 스냅숏 없음이며 자동 백업도 삭제합니다. 개발용 앱 시크릿의 복구 유예는 7일입니다. 모든 자원의 공통 기본값처럼 말하지 않아야 합니다. ‘무조건’도 현재 Terraform의 삭제 설정이라는 범위를 붙이는 편이 정확합니다.
- **근거:** `infra/terraform/stack/data.tf:49`·`:60`·`:64`·`:65`·`:116`·`:120`, `infra/terraform/stack/registry-secrets.tf:55`·`:65`.
- **수정안(학생):** “실사용자 데이터를 담는 운영 DB는 백업을 14일 보관해요. 이 Terraform 설정으로 삭제할 때는 삭제 보호를 풀어도 마지막 스냅숏과 자동 백업을 남기도록 했어요.”
- **수정안(보고):** “운영 DB에는 백업 14일·삭제 보호·삭제 시 최종 스냅숏 및 자동 백업 보존을 적용합니다. 운영 앱 시크릿의 삭제 복구 유예는 30일이며, 개발용 자원에는 별도 보존 정책을 적용합니다.”

### A09 [MEDIUM] nginx 제한은 사람당 10번째 요청 이후 즉시 차단이 아님

- **대상:** `src/students.html` 7장, `src/report.html` 4장, `src/aws-architecture.html` gateway.
- **원문:** “한 사람이 1초에 10번 넘게 두드리면 잠시 막아요.” / “IP마다 초당 10건으로 제한합니다.” / “/api만 통과”.
- **문제:** 사용자 계정이 아니라 IP를 기준으로 하며 `burst=60 nodelay`를 허용합니다. 제한 상태는 gateway 인스턴스별이므로 서비스 전체의 엄밀한 초당 10건 상한도 아닙니다. `/api`, `/api/` 외에 `/healthz`도 열려 있습니다.
- **근거:** `deploy/eks/chart/templates/gateway-config.yaml:26`·`:29`·`:60`·`:65`·`:70`, `deploy/eks/chart/values-dev.yaml:38`.
- **수정안(학생):** “안내 데스크는 API와 상태 확인 요청을 받아요. 같은 IP의 지속 요청은 초당 10건을 기준으로 제한하되, 순간적으로 몰리는 요청에는 60건의 여유를 둬요.”
- **수정안(보고):** “gateway별로 IP당 지속 요청률 10r/s와 burst 60을 적용하며, /api·/api/ 및 /healthz만 노출합니다.”
- **수정안(그림):** “API·상태 확인만 노출 / gateway별 IP당 10r/s · burst 60”.

### A10 [MEDIUM] 모든 컨테이너가 새 파드부터 띄우는 것은 아님

- **대상:** `src/students.html` 9장, `src/report.html` 5장.
- **원문:** “새 버전이 준비된 걸 확인한 뒤에 옛 버전을 내려요.” / “maxUnavailable: 0”.
- **문제:** gateway·backend·ai에 대한 설명으로 한정해야 합니다. embedding은 메모리 비용과 배포 성공을 고려해 `maxUnavailable: 1, maxSurge: 0`을 사용하며 교체 공백을 의도적으로 허용합니다.
- **근거:** `deploy/eks/chart/templates/embedding.yaml:12`·`:18`·`:20`, `deploy/eks/chart/templates/backend.yaml:12`, `deploy/eks/chart/templates/ai.yaml:14`.
- **수정안(학생):** “gateway·backend·ai는 새 파드가 준비된 뒤 바꿔요. 임베딩은 교체 중 잠시 비울 수 있고, 그동안 규칙 기반 추천을 사용해요.”
- **수정안(보고):** “주요 API 워크로드에는 maxUnavailable 0을 적용합니다. 임베딩은 교체 공백을 허용하고 규칙 기반 추천으로 기능 저하를 처리합니다.”

### A11 [MEDIUM] 긴 요청의 완료를 보장하는 표현

- **대상:** `src/report.html` 5장.
- **원문:** “일정 생성처럼 오래 걸리는 요청은 끝까지 마치고 내려갑니다”.
- **문제:** 종료 유예와 대기 시간은 유한합니다. 강제 노드 종료나 제한 시간을 넘긴 작업의 완료까지 보장하지 않습니다.
- **근거:** `deploy/eks/chart/templates/_helpers.tpl:17`·`:18`, `docs/guides/aws-eks-deployment.md:126`.
- **수정안:** “종료 유예 660초와 최대 630초의 처리 대기로 진행 중 요청의 완료 기회를 확보합니다. 강제 종료와 시간 초과는 별도 복구 대상입니다.”

### A12 [MEDIUM] NetworkPolicy의 POI 적재 예외 누락

- **대상:** `src/report.html` 4장.
- **원문:** “backend는 gateway·ai에서만, ai는 backend에서만 받습니다(배포 점검 Job 제외).”
- **문제:** backend에는 점검 Job 외에 POI 적재 Job도 허용합니다. 해당 정책은 인바운드 제어이며 양방향 통신 전체에 대한 허용 목록은 아닙니다.
- **근거:** `deploy/eks/chart/templates/network-policy.yaml:14`·`:21`·`:34`·`:37`·`:38`.
- **수정안:** “backend는 gateway·ai·배포 점검·POI 적재 Job에서, ai는 backend·배포 점검 Job에서 오는 지정 포트의 인바운드 연결만 허용합니다.”

### A13 [MEDIUM] 별도 DB 인스턴스를 운영·개발의 완전한 영향 격리로 설명

- **대상:** `src/students.html` 14장, `src/report.html` 12장.
- **원문:** “개발 쪽에서 DB를 흔들어도 운영 DB는 멀쩡해요.” / “개발 DB는 장비 자체를 분리해 운영 DB에 영향이 없습니다”.
- **문제:** 별도 RDS 인스턴스로 데이터·DB 부하·마이그레이션의 직접 영향을 줄이는 것은 맞습니다. 하지만 클러스터·VPC·NAT·Redis와 일부 보안 구성을 공유하므로 개발 환경의 모든 변경과 장애가 운영에 무영향이라는 보장은 아닙니다. Bedrock 연결도 네임스페이스별로 나누지만 IAM 역할 자체는 같습니다.
- **근거:** `infra/terraform/stack/data.tf:78`·`:82`·`:97`·`:114`, `infra/terraform/stack/eks.tf:89`·`:96`·`:103`, `deploy/eks/chart/values-dev-target.yaml:2`·`:5`.
- **수정안(학생):** “개발 DB를 따로 둬서 개발 중 데이터 변경과 DB 부하가 운영 DB에 직접 섞이지 않게 했어요. 클러스터와 네트워크는 함께 써요.”
- **수정안(보고):** “개발용 RDS 인스턴스를 분리해 데이터 변경·마이그레이션·DB 부하의 직접 영향을 줄였습니다. 클러스터와 네트워크는 공유합니다.”

### A14 [MEDIUM] AI와 임베딩 사이의 장애 전파를 완전히 차단했다는 설명

- **대상:** `src/report.html` 11장.
- **원문:** “서로의 확장과 장애가 번지지 않게 했습니다.”
- **문제:** 배포와 자원 설정은 분리했지만 AI가 embedding을 호출하는 의존성은 남습니다. 정본은 임베딩 실패 시 추천 품질이 낮아지는 폴백을 설명합니다. 장애 영향의 축소이지 영향 소멸이 아닙니다.
- **근거:** `deploy/eks/chart/templates/ai.yaml:89`, `deploy/eks/chart/templates/embedding.yaml:18`, `ai/docs/ai-models-for-clients.md:60`·`:66`.
- **수정안:** “ai와 embedding의 배포·자원 설정을 분리하고, 임베딩 장애 시 규칙 기반 추천으로 전환해 영향 범위를 줄였습니다.”

### A15 [MEDIUM] LLM 실패 알람의 실제 집계 범위 누락

- **대상:** `src/students.html` 15장, `src/report.html` 9·11·14장.
- **원문:** “LLM 호출 실패” / “LLM이 실패하면 … 실패 건수는 알람으로 따로 셉니다.” / “조용한 실패까지 Slack으로 알립니다”.
- **문제:** 실제 필터는 운영 네임스페이스의 ai 컨테이너에서 모델명이 c/g로 시작하는 Claude·GPT 실패만 셉니다. Bedrock 자체 모델 `local-*`는 의도적으로 제외합니다. 같은 슬라이드에 자체 모델이 등장하므로 범위를 명시해야 합니다.
- **근거:** `infra/terraform/stack/alerts.tf:87`·`:90`·`:97`·`:147`·`:151`·`:154`.
- **수정안(학생):** “운영 AI의 Claude·GPT 호출 실패를 따로 세서 30분에 5건 이상이면 알려 줘요. 자체 알림 문구 모델은 이 집계에서 제외해요.”
- **수정안(보고):** “운영 AI의 Claude·GPT 호출 실패를 집계해 30분에 5건 이상이면 Slack으로 알립니다. 자체 Bedrock 모델은 이 알람의 집계 대상에서 제외합니다.”

### A16 [MEDIUM] 알람의 즉시성·선제 인지를 보장

- **대상:** `src/students.html` 15장, `src/report.html` 9장.
- **원문:** “늘어나는 순간” / “증가 즉시 · 10분” / “사용자가 알기 전에 팀이 먼저 압니다”.
- **문제:** 재시작은 5분 구간 최대값의 차이를 평가합니다. 같은 워크로드 내 일부 파드의 재시작은 최대값에 가려 누락될 수도 있습니다. 노드 장애는 10분 지속 조건이며 사용자 영향보다 먼저 발견한다는 보장은 없습니다. DB 조건도 단순 수치 외에 방향·지속 시간이 있습니다.
- **근거:** `infra/terraform/stack/alerts.tf:162`·`:165`·`:175`·`:191`·`:206`·`:211`·`:226`·`:231`·`:236`·`:251`.
- **수정안(학생):** “파드 재시작은 5분 단위 지표로 살피고, 노드 장애가 10분 이어지면 알려 줘요.”
- **수정안(보고 제목):** “로그와 지표에서 장애 징후를 감지해 팀에 알립니다”.
- **수정안(보고 표):** “재시작: 5분 구간 최대값의 증가 / 노드: NotReady 10분 지속”. DB 행은 “CPU: 5분 평균 80% 초과가 3구간 / 여유 공간: 5분 최솟값 1GiB 미만 / 연결: 5분 최댓값 150개 초과가 2구간”으로 교체합니다.

### A17 [MEDIUM] 모든 운영 알람이 네임스페이스로 분리된다는 표현

- **대상:** `src/report.html` 12장.
- **원문:** “운영 알람은 운영 네임스페이스만 셉니다”.
- **문제:** 앱 로그·파드 재시작에는 맞지만 노드 장애는 공유 클러스터 전체, DB 알람은 운영 RDS 인스턴스를 대상으로 합니다.
- **근거:** `infra/terraform/stack/alerts.tf:62`·`:97`·`:193`·`:209`·`:249`.
- **수정안:** “앱 로그·파드 재시작 알람은 운영 네임스페이스로 한정합니다. 노드 장애는 공유 클러스터 전체, DB 알람은 운영 RDS를 감시합니다.”

### A18 [MEDIUM] 데이터 서브넷의 ‘바깥 경로 없음’을 절대적 방어로 설명

- **대상:** `src/students.html` 6장, `src/report.html` 4·7장, `src/aws-architecture.html` 데이터 설명.
- **원문:** “바깥으로 난 문이 아예 없어요.” / “데이터 서브넷에서 밖으로 나가는 경로 0개” / “설정 실수로 열릴 수 있는 문이 처음부터 없는 구조입니다.”
- **문제:** 없는 것은 인터넷·NAT 기본 경로입니다. VPC 내부의 통신 경로는 있어야 앱과 DB가 통신합니다. 현재 라우팅 설정은 수정 가능한 자원이므로 향후 설정 실수로도 절대 열리지 않는다는 보장은 성립하지 않습니다. 여러 통제를 모두 직렬로 통과하는 ‘여섯 관문’이라 부르는 것도 securityContext 같은 실행 정책의 성격을 흐립니다.
- **근거:** `infra/terraform/stack/network.tf:124`·`:125`·`:130`, `infra/terraform/stack/data.tf:7`·`:10`·`:135`, `deploy/eks/chart/templates/_helpers.tpl:22`·`:44`.
- **수정안(학생):** “금고에는 인터넷으로 바로 나가는 문이 없어요. 사무실에서 오는 허용된 연결로만 데이터를 주고받아요.”
- **수정안(보고 제목·본문):** “네트워크·접근·실행 정책을 여섯 가지 통제로 나눴습니다. 데이터 서브넷에는 인터넷·NAT 기본 경로를 두지 않고, 보안 그룹으로 DB·캐시 연결을 제한합니다.”
- **수정안(수치 라벨):** “인터넷·NAT 기본 경로 0개”.

### A19 [MEDIUM] OIDC를 일회용 자격, Pod Identity를 파드 한 개의 권한으로 설명

- **대상:** `src/students.html` 12·18장.
- **원문:** “한 번 쓰고 버리는 출입증” / “키 없이 1회용 자격을 받는 방식” / “AI 파드 하나에만 '모델 호출' 권한 딱 하나를 줘요.”
- **문제:** 발급받은 AWS 단기 자격은 유효 기간 동안 여러 요청에 사용합니다. 배포 세션 설정은 7200초입니다. Pod Identity는 단일 파드가 아니라 네임스페이스와 서비스 계정에 연결되어 여러 AI 복제본에 적용됩니다. 운영·개발 AI에도 각각 연결합니다.
- **근거:** `.github/workflows/aws-deploy.yml:158`·`:164`, `infra/terraform/stack/eks.tf:89`·`:97`, `deploy/eks/chart/templates/ai.yaml:26`.
- **수정안:** “배포할 때마다 유효 기간이 짧은 출입증을 받아요. AI 서비스용 계정에도 Bedrock 호출 권한을 연결해서, 그 계정으로 뜬 파드들이 키 파일 없이 임시 자격을 받아요.”
- **수정안(용어집):** “OIDC: 외부 신원을 확인해 단기 AWS 자격을 받는 데 쓰는 인증 방식”.

### A20 [MEDIUM] 개발 파드 0대를 무조건적인 상태로 제시

- **대상:** `src/students.html` 14·16장, `src/report.html` 10·12장, `src/aws-architecture.html` 개발 서버 메모.
- **원문:** “검증이 끝나면 0대로 내립니다” / “검증할 때만 켜고 평소 0대”.
- **문제:** 기본 운영 방침으로는 맞지만 배포 성공 및 `dev_sleep_after=true` 조건이 있습니다. 실패하면 조사용으로 남기며 옵션을 끌 수도 있습니다. 0이 되는 대상은 Deployment의 파드 수로, 개발 RDS·NLB 등 전체 환경의 자원이 제거되거나 전체 비용이 0원이 되는 것은 아닙니다.
- **근거:** `.github/workflows/aws-deploy.yml:68`·`:378`·`:381`·`:382`, `deploy/eks/chart/values-dev-target.yaml:10`·`:23`, `infra/terraform/stack/data.tf:97`, `deploy/eks/chart/templates/services.yaml:40`.
- **수정안(학생):** “개발 파드는 검증에 성공하면 기본적으로 0개로 내려요. 실패했거나 계속 켜 두기로 한 경우에는 남겨 둬요. DB 같은 자원은 유지돼요.”
- **수정안(보고):** “개발 파드는 검증 성공 후 기본적으로 0개로 축소하며, 실패 시 조사용으로 유지합니다. DB·NLB 등 별도 자원은 유지합니다.”

### A21 [LOW] HPA 70%의 기준 설명 누락

- **대상:** `src/students.html` 9장, `src/report.html` 5장.
- **원문:** “ai는 CPU가 70%를 넘으면 2대에서 3대로 늘어나요.” / “HPA 2→3 · CPU 70%”.
- **문제:** 노드 전체 CPU의 70%가 아니라 파드의 CPU 요청량 대비 평균 사용률 목표입니다. 순간 문턱을 넘자마자 정확히 한 대가 추가되는 스위치처럼 설명하지 않는 편이 좋습니다.
- **근거:** `deploy/eks/chart/values.yaml:47`·`:48`·`:51`, `deploy/eks/chart/values-dev.yaml:34`, `deploy/eks/chart/templates/hpa.yaml:24`.
- **수정안(학생):** “AI 파드가 요청한 CPU 몫의 평균 70%를 목표로, 파드 수를 2~3개 사이에서 조절해요.”
- **수정안(보고):** “AI 파드의 CPU 요청량 대비 평균 사용률 70%를 목표로 2~3개 사이에서 자동 확장합니다.”

### A22 [LOW] 이미지 태그 규칙을 모든 이미지에 일반화

- **대상:** `src/students.html` 13장, `src/report.html` 8장.
- **원문:** “커밋별 고유 태그” / “SHA+실행 ID 태그”.
- **문제:** backend·ai에는 맞지만 embedding은 빌드 맥락의 내용 해시를 사용해 기존 이미지를 재사용합니다. gateway도 별도 고정 버전입니다. ‘이미지 발행’ 전체의 단일 규칙으로 읽히지 않게 하면 됩니다.
- **근거:** `.github/workflows/aws-deploy.yml:141`·`:242`·`:267`, `deploy/eks/chart/templates/embedding.yaml:28`, `deploy/eks/chart/values.yaml:14`.
- **수정안(학생):** “backend·ai 이미지는 커밋과 배포 실행별 태그로 구분하고, 임베딩은 소스가 같으면 기존 이미지를 다시 써요.”
- **수정안(보고):** “backend·ai는 SHA·실행 ID·재실행 번호로, embedding은 소스 내용 해시로 이미지를 식별합니다.”

### A23 [LOW] 임베딩의 5GiB는 고정 실사용량이 아니라 요청량

- **대상:** `src/students.html` 11장, `src/report.html` 10·11장, `src/aws-architecture.html` embedding.
- **원문:** “메모리 5GiB” / “메모리 5GiB를 쓰는 임베딩”.
- **문제:** 설정은 메모리 요청량 5Gi, 상한 6Gi입니다. 주석의 프로세스 실측은 4.2~4.4GiB로, 요청·제한·실사용을 구분하면 숫자의 의미가 정확해집니다.
- **근거:** `deploy/eks/chart/values.yaml:61`·`:65`·`:66`.
- **수정안(학생):** “임베딩 파드에는 메모리 5GiB를 요청하고, 최대 6GiB까지 쓰도록 해 뒀어요.”
- **수정안(보고·그림):** “임베딩 메모리 요청 5GiB · 상한 6GiB”.

## B. 다이어그램 정합성

아래 항목은 별도 그림뿐 아니라 같은 그림을 사용하는 학생 5장·보고 3장에도 적용됩니다.

### B01 [HIGH] 논리 구성과 실제 AZ 배치를 혼합

- **대상:** `src/aws-architecture.html` 그림 1, `aws-architecture.png`.
- **원문:** “가용 영역 1” 내부에 운영 gateway·backend 복제본과 DB 2개, “가용 영역 2” 쪽에 개발 네임스페이스·Redis를 배치한 그림.
- **문제:** 운영·개발 네임스페이스는 AZ 구분이 아닙니다. 파드 분산도 선호 설정이며, RDS·Redis는 여러 데이터 서브넷을 가진 그룹만 지정하고 이 그림처럼 AZ를 고정하지 않습니다. 물리 경계 위에 논리 상자를 걸쳐 그려 실제 배치·장애 범위를 오해하기 쉽습니다. 특히 각 AZ의 컴퓨팅 서브넷 사이를 EKS 상자가 덮어 서브넷 경계가 불명확합니다.
- **근거:** `src/aws-architecture.html:190`·`:194`·`:212`·`:215`·`:225`·`:234`, `infra/terraform/stack/network.tf:44`·`:59`, `infra/terraform/stack/data.tf:16`·`:45`·`:112`·`:144`·`:160`, `deploy/eks/chart/templates/_helpers.tpl:29`·`:38`.
- **수정안(캡션):** “AZ·노드 분산을 선호하는 논리 구성도입니다. 운영·개발 네임스페이스는 AZ와 무관하며, 파드와 단일 AZ DB·캐시의 실제 배치는 이 그림에서 고정하지 않습니다.”
- **수정안(배치):** AZ별 서브넷 경계를 각각 닫고, 네임스페이스·서비스 의존성은 별도 논리 영역으로 표시합니다. 파드 배치를 예시로 그릴 경우 “배치 예시”라고 표시합니다.

### B02 [MEDIUM] 개발 대상의 별도 NLB와 DB 연결 누락

- **대상:** `src/aws-architecture.html` 그림 1, `aws-architecture.png`.
- **원문:** NLB는 하나만 표시하고 개발 네임스페이스에는 gateway·backend·ai·embedding 이름만 표시.
- **문제:** 동일 차트를 다른 네임스페이스에 배포하므로 개발 gateway도 별도 LoadBalancer Service를 가집니다. 코드가 개발 전용 인증서·호스트명을 요구합니다. 개발 RDS는 그림에 있지만 개발 backend·ai에서 해당 DB로 가는 관계도 빠져 운영 DB 공유처럼 읽힐 수 있습니다. 파드 0개가 되어도 이 Service를 삭제하는 동작은 없습니다.
- **근거:** `src/aws-architecture.html:206`·`:225`·`:237`, `deploy/eks/chart/templates/services.yaml:25`·`:35`·`:40`, `infra/scripts/workflow_config.py:78`·`:86`·`:89`, `.github/workflows/aws-deploy.yml:331`·`:382`, `docs/guides/aws-eks-deployment.md:63`.
- **수정안(라벨):** “운영 NLB → trippilot gateway” / “개발 NLB → trippilot-dev gateway · 개발 전용 도메인·인증서” / “개발 backend·ai → 개발 RDS”.
- **수정안(배치):** 개발 진입점을 별도로 추가하고 개발 DB 연결선을 그립니다. 운영 요청 흐름만 남길 의도라면 “개발 환경의 진입·데이터 연결은 생략”이라고 표시합니다.

### B03 [MEDIUM] IAM을 서울 리전 서비스로 배치

- **대상:** `src/aws-architecture.html` 그림 1, `aws-architecture.png`.
- **원문:** “리전 관리형 서비스” 상자 안의 “IAM”.
- **문제:** IAM 사용자·역할은 글로벌 자원입니다. 서울 리전 내부 서비스 상자에 두면 리전별 독립 역할처럼 보입니다. 웹 S3 버킷도 전역 CloudFront와 같은 바깥 상자에 있어, 물리 리전 배치가 아니라 기능 묶음임을 명시하면 좋습니다. 웹 버킷의 실제 리전은 저장소 값만으로 확정하지 않았습니다.
- **근거:** `src/aws-architecture.html:163`·`:168`·`:246`·`:251`, `infra/terraform/stack/variables.tf:37`의 리전 필드 없는 IAM ARN; [AWS의 IAM 글로벌 서비스 설명](https://aws.amazon.com/blogs/security/how-to-monitor-and-query-iam-resources-at-scale-part-2/).
- **수정안(라벨):** “IAM · 전역 서비스 — 배포 역할·워크로드 권한”. 웹 상자에는 “기능별 묶음: CloudFront는 전역, S3 버킷은 해당 리전에 생성”을 추가합니다.
- **수정안(배치):** IAM을 AWS Cloud 내부·서울 리전 외부로 옮깁니다. S3 버킷은 실제 리전 확인 후 해당 리전에 두거나 기능 묶음임을 명확히 표시합니다.

### B04 [MEDIUM] CloudFront–S3 및 웹 배포 연결 단절

- **대상:** `src/aws-architecture.html` 그림 1, `aws-architecture.png`.
- **원문:** 브라우저→CloudFront 선만 있고 S3 원본과의 연결이 없음. GitHub Actions 배포선은 ECR·EKS로만 연결.
- **문제:** 웹 파일의 원본과 실제 배포 경로가 빠졌습니다. 웹 브라우저가 API를 직접 호출하는 선은 타당하며 유지해도 됩니다.
- **근거:** `src/aws-architecture.html:167`·`:168`·`:285`·`:292`, `.github/workflows/frontend-web-deploy.yml:3`·`:132`·`:139`·`:151`.
- **수정안(연결 라벨):** “CloudFront → S3 정적 파일 원본” / “GitHub Actions → S3 업로드 → CloudFront 캐시 무효화”.
- **수정안(캡션):** “웹 화면은 CloudFront가 S3 원본에서 제공하고, API 요청은 별도 NLB로 전달됩니다.”

### B05 [MEDIUM] EKS 관리 API와 파드 영역의 경계 보완

- **대상:** `src/aws-architecture.html` 그림 1, `src/report.html` 4장.
- **원문:** VPC 안 “Amazon EKS · Auto Mode” 상자로 직접 들어오는 배포선 / “외부에는 HTTPS 443 하나만 열려 있습니다.”
- **문제:** EKS 상자를 논리 클러스터로 그리는 것 자체가 오류는 아닙니다. 다만 서브넷까지 표시한 물리 그림에서는 워커·파드와 AWS 관리형 제어부가 구분되지 않습니다. 별도 공개 EKS 관리 API도 활성화되어 있습니다. **EKS API도 443을 쓰므로 포트 숫자 자체가 틀린 것은 아닙니다.** 앱 진입점만 설명한다는 범위와 관리 API 경계를 보완해야 합니다.
- **근거:** `src/aws-architecture.html:211`·`:286`, `src/report.html:131`, `infra/terraform/stack/eks.tf:30`·`:35`·`:55`·`:73`, `infra/terraform/stack/variables.tf:53`, `docs/guides/aws-eks-deployment.md:38`; [AWS EKS 제어부 구조](https://docs.aws.amazon.com/eks/latest/best-practices/control-plane.html).
- **수정안(그림):** “EKS Auto Mode 워커 노드·파드(고객 VPC)”와 “EKS 관리형 제어부 · 공개/비공개 API”를 구분하고 배포선을 관리 API로 연결합니다.
- **수정안(보고):** “앱 진입점은 NLB의 HTTPS 443으로 제한합니다. 별도 공개 EKS 관리 API에는 IAM과 EKS Access Entry 인증을 적용합니다.”

### B06 [MEDIUM] Bedrock 호출선과 네트워크 경로 혼동

- **대상:** `src/aws-architecture.html` 그림 1, `aws-architecture.png`.
- **원문:** “AI 파드 → Bedrock (Pod Identity, 키 없음)” 직결선.
- **문제:** Pod Identity는 권한 부여 방식이며 전용 네트워크 연결이 아닙니다. 이 스택의 프라이빗 서브넷 외부 통신은 NAT 경유입니다. 다른 외부 API는 NAT·IGW 경유로 그렸으므로 Bedrock만 직접 연결하면 사설 연결 또는 NAT와 무관한 경로처럼 읽힙니다. 논리 호출선으로 남기는 경우에도 설명이 필요합니다.
- **근거:** `src/aws-architecture.html:306`·`:312`·`:314`, `infra/terraform/stack/network.tf:109`, `infra/terraform/stack/eks.tf:89`, `.env.example:296`.
- **수정안(라벨):** “논리 호출선 · 실제 통신은 NAT·인터넷 게이트웨이 경유 HTTPS / 인증: Pod Identity”.

### B07 [LOW] 애드온과 Kubernetes 정책 자원을 같은 종류로 분류

- **대상:** `src/aws-architecture.html` 그림 1.
- **원문:** “클러스터 애드온” 아래 “Pod Identity”, “NetworkPolicy”, “PDB”.
- **문제:** NetworkPolicy·PDB는 차트가 생성하는 정책 자원이며, 표시된 Pod Identity의 정본은 연결 리소스입니다. 설치 애드온 목록과 구분해야 합니다.
- **근거:** `src/aws-architecture.html:228`·`:230`, `infra/terraform/stack/eks.tf:89`·`:130`·`:164`, `deploy/eks/chart/templates/network-policy.yaml:4`, `deploy/eks/chart/templates/pdb.yaml:1`.
- **수정안:** 묶음 제목을 “클러스터 운영 구성”으로 변경합니다. PDB 라벨은 A01의 수정안을 적용합니다.

## C. 대학생 덱의 이해도·비유

### C01 [MEDIUM] 파드·API·LLM 등 첫 등장에 필요한 짧은 설명

- **대상:** `src/students.html` 7·8·11·13·18장.
- **원문:** “'/api' 요청”, “LLM”, “파드가 하나뿐이면”, “Terraform plan”, “Helm 배포”, “4B … 235B”.
- **문제:** 건물·안내 데스크 비유는 흐름을 이해하는 데 유효하지만 파드는 반복 등장한 뒤 18장에서야 설명됩니다. API·LLM·Helm·B의 의미도 설명 없이 이어집니다. 8장의 도시락→관제실 사이에 ‘관제실이 실제로 관리하는 단위’를 짚으면 9장 복제본 설명이 자연스럽습니다. 이는 사실 오류보다 대상 청중에 대한 편집 판단입니다.
- **근거:** `src/students.html:187`·`:189`·`:203`·`:204`·`:233`·`:286`·`:314`·`:321`·`:446`.
- **수정안(7장):** “API는 앱이 서버에 일을 부탁하는 창구예요. LLM은 문장을 이해하고 만들어 주는 AI 모델이에요.”
- **수정안(8장):** “파드는 컨테이너 하나 이상을 묶어 실행하는 단위예요. 쿠버네티스는 이 파드를 어디에 몇 개 띄울지 관리해요.”
- **수정안(13장):** “Terraform은 인프라 설계도이고, plan은 바뀔 내용의 미리보기예요. Helm은 쿠버네티스 앱 설정을 묶어서 배포하는 도구예요.”
- **수정안(11장):** “B는 모델의 매개변수 10억 개를 뜻해요. 이번 알림 문구 비교에서는 4B 모델이 235B 모델보다 더 많이 선택됐어요.”

### C02 [LOW] 컨테이너를 어디서나 결과가 동일한 도시락으로 표현

- **대상:** `src/students.html` 8장.
- **원문:** “어디서 열어도 맛이 같아요.”
- **문제:** 의존성을 함께 묶는 비유는 좋지만 하드웨어·OS·설정·외부 서비스 차이까지 제거하지는 않습니다. 실제 차트도 linux/amd64를 지정합니다. ‘실행 환경 차이를 줄인다’로 설명하면 비유를 유지하면서 정확해집니다.
- **근거:** `src/students.html:203`, `deploy/eks/chart/templates/_helpers.tpl:19`·`:21`, `docs/guides/aws-eks-deployment.md:38`.
- **수정안:** “컨테이너는 도시락처럼 앱과 필요한 라이브러리를 한 통에 담아요. 지원하는 서버에서 같은 준비물로 실행해서 환경 차이를 줄이는 거예요.”

## D. 심사 설득력을 높일 근거 있는 보완

### D01 [LOW·제안] 인증 설정 누락 시 기동 차단을 다층 방어에 추가

- **대상:** `src/report.html` 4·6장.
- **원문:** “파드 간 허용 목록”, “키 없는 권한 모델” — 인증 설정 누락 시 기동 차단 설명 없음.
- **문제:** 네트워크 접근 제한과 키 보관뿐 아니라, 필수 인증 설정이 빠진 상태로 실행하지 않게 한다는 구현된 강점이 빠져 있습니다. 새 기능을 제안하는 것이 아니라 현재 코드의 설명 보완입니다.
- **근거:** `deploy/eks/chart/templates/backend.yaml:49`·`:54`, `deploy/eks/chart/templates/ai.yaml:69`·`:74`, `docs/guides/aws-eks-deployment.md:116`.
- **수정안:** “서비스 토큰과 JWT 키를 필수 설정으로 두어, 인증 설정이 빠진 상태로 기동하지 않도록 합니다.”

### D02 [LOW·제안] 개발 환경의 실제 사용자 영향 방지 장치를 추가

- **대상:** `src/report.html` 12장.
- **원문:** “개발 DB는 장비 자체를 분리해 운영 DB에 영향이 없습니다”.
- **문제:** A13의 절대 표현을 줄인 자리에 실제로 강제하는 개발용 안전장치를 제시하면 더 설득력 있습니다. 개발 배포는 공유 Terraform 변경을 하지 않고 실제 푸시 모드를 강제로 끕니다.
- **근거:** `infra/scripts/workflow_config.py:51`·`:79`·`:82`·`:85`·`:101`, `docs/guides/aws-eks-deployment.md:63`.
- **수정안:** “개발 배포는 공유 인프라의 Terraform 변경을 수행하지 않으며, 실제 푸시 발송을 강제로 비활성화합니다.”

### D03 [LOW·제안] 임베딩 비용 절감과 교체 공백 축소의 구체적인 구현

- **대상:** `src/report.html` 8·10장.
- **원문:** “메모리 5GiB를 쓰는 임베딩은 필요할 때만 배포”.
- **문제:** 단순히 켜고 끄는 것뿐 아니라 내용 해시와 rollout nonce 제외로 불필요한 교체를 피하는 구현이 있습니다. A10의 교체 공백을 인정하면서 이를 줄이는 선택을 함께 설명할 수 있습니다.
- **근거:** `.github/workflows/aws-deploy.yml:242`, `deploy/eks/chart/templates/embedding.yaml:14`·`:20`·`:28`·`:30`.
- **수정안:** “임베딩 이미지는 소스 내용 해시로 재사용하고 매 배포 강제 재시작에서 제외해, 불필요한 모델 로딩과 교체 공백을 줄입니다.”

## E·F. 한국어·레이아웃·산출물 일치

### F01 [MEDIUM] 현재 HTML과 제공 스크린샷의 문구 불일치

- **대상:** `src/students.html` 4·10장, `src/report.html` 8·14장 및 해당 PNG.
- **원문:** `students-10.png` 제목 “데이터는 지하 금고에 둡니다” ↔ 현재 HTML “데이터는 지하 금고에 둬요”. `report-08.png` “전부 코드로” ↔ 현재 HTML “핵심 인프라는 코드로”. `report-14.png` “모든 인프라가 코드” ↔ 현재 HTML “핵심 인프라가 코드”.
- **문제:** 스크린샷은 현재 수정본의 검증 결과가 아닙니다. 학생 4장에도 “두 곳에 나눠 둡니다”가 남아 최신 HTML의 구어체와 다릅니다. ‘모든 인프라’는 웹 호스팅을 콘솔에서 준비하는 정본과 충돌하지만, 현재 HTML에서는 이미 ‘핵심’으로 완화되었으므로 현 소스의 미수정 오류로 중복 지적하지 않습니다.
- **근거:** `/tmp/deck-shots/students-04.png`, `/tmp/deck-shots/students-10.png`, `/tmp/deck-shots/report-08.png`, `/tmp/deck-shots/report-14.png`; `src/students.html:135`·`:243`·`:325`, `src/report.html:236`·`:394`; `.github/workflows/frontend-web-deploy.yml:4`.
- **수정안(반영 문장):** 학생 10장 “데이터는 지하 금고에 둬요”. 보고 8장 “핵심 서버 인프라는 코드로 관리합니다. 웹 호스팅 자원과 최초 DNS·인증서 검증은 별도로 준비합니다.”
- **수정안(작업):** 사실 수정과 문체 수정을 완료한 HTML에서 33장 스크린샷을 다시 생성하고, 동일 문구인지 대조합니다. 현재 PNG로 최신 HTML의 최종 시각 검증을 대신하지 않습니다.

### F02 [MEDIUM] 전체 구조도의 투사·정적 제출 가독성

- **대상:** 학생 5장·보고 3장 스크린샷 및 `aws-architecture.png`.
- **원문:** “그림을 클릭하면 크게 볼 수 있어요.” / “그림을 누르면 원본 크기로 볼 수 있습니다.”
- **문제:** 슬라이드에서 구조도는 1300×780으로 축소되어 세부 설정·범례·작은 연결 라벨이 대략 8~12px 수준으로 보입니다. 1920×1080 원본 화면에서도 상세 텍스트 판독이 어렵고, 투사 환경에서는 더 불리할 것으로 **추정**됩니다. 클릭 확대는 HTML 발표에서는 보완책이지만 PNG·PDF 제출에서는 작동하지 않습니다. 별도 PNG도 화살표·보조선이 밀집한 영역은 발표용 핵심 흐름과 운영 상세를 한 번에 읽기 어렵습니다.
- **근거:** `/tmp/deck-shots/students-05.png`, `/tmp/deck-shots/report-03.png` 시각 확인; `src/students.html:150`, `src/report.html:107`·`:108`, `src/aws-architecture.html:298`·`:313`·`:317`.
- **수정안(캡션):** “핵심 요청 흐름: 앱 → NLB → gateway → backend → AI·DB. 세부 설정은 별첨 구조도에서 확인할 수 있습니다.”
- **수정안(작업):** 발표 장면에서는 요청 경로를 중심으로 단순화하거나 부분 확대를 사용하고, 심사 제출본에는 별도 고해상도 구조도를 함께 제공합니다. 기존 장 수를 유지하려면 서비스 이름 나열 영역을 줄여 핵심 흐름의 글자 크기를 확보합니다.

### E01 [LOW] 심각한 한국어 오류는 별도로 발견하지 못함

- **대상:** `src/students.html` 1~19장, `src/report.html` 1~14장.
- **원문:** 학생 덱의 “~예요/~거든요”, 보고 덱의 “~습니다” 중심 서술.
- **문제:** 최종 확인 HTML의 문체는 대상별 의도와 대체로 맞습니다. 내용 판단을 바꾸는 심각한 번역투·비문은 별도로 발견하지 못했습니다. 기술 오해를 부르는 ‘무조건·늘·즉시·영향이 없습니다’는 문체 문제가 아니라 A항목의 사실·범위 문제로 처리했습니다. 화자의 나이는 저장소 코드로 검증할 수 없는 사용자 지정 전제입니다.
- **근거:** `src/students.html:111`·`:233`·`:264`, `src/report.html:85`·`:151`·`:348`. 구어체와 다른 기존 PNG 표현은 F01 참조.
- **수정안:** 별도 문장 수정 없음. A·C·F 항목의 해당 문장만 반영합니다.

## 문제를 발견하지 못한 핵심 수치·구성

- **현재 dev 스택과 prd 준비값:** dev 2 AZ·단일 NAT·단일 AZ RDS·Redis 1노드, prd 3 AZ·AZ별 NAT·Multi-AZ RDS·Redis 3노드 자동 장애조치라는 구분은 맞습니다. `infra/terraform/environments/dev.tfvars:1`, `infra/terraform/environments/prd.tfvars:1`, `infra/terraform/stack/network.tf:3`, `infra/terraform/stack/data.tf:49`·`:157`·`:159`에 근거가 있습니다. 실제 prd가 배포되었다는 뜻으로 사용해서는 안 됩니다.
- **Kubernetes 1.35·PostgreSQL 16·서울 기본 리전:** 설정과 일치합니다. `infra/terraform/environments/dev.tfvars:2`, `infra/terraform/stack/data.tf:35`, `infra/terraform/stack/variables.tf:24`가 근거입니다. AWS 실환경의 현재 버전을 조회한 것은 아닙니다.
- **운영 복제본 목표와 HPA 범위:** gateway·backend 2개, ai 2~3개라는 설정은 맞습니다. `deploy/eks/chart/values-dev.yaml:22`·`:34`·`:38` 참조. 가용성 보장과의 차이는 A01입니다.
- **로그 90일·Chatbot 오하이오:** 현재 dev 설정과 일치합니다. `infra/terraform/environments/dev.tfvars:12`, `infra/terraform/stack/alerts.tf:36` 참조. prd 로그 보존 설정은 30일이고 현재 활성화 값은 false입니다(`infra/terraform/environments/prd.tfvars:7`·`:8`).
- **383건 실패·알람 0, 하루 두 차례 노드 교체, CPU 500m→200m, 4B 대 235B의 12:8:** 각각 `infra/terraform/stack/alerts.tf:87`·`:88`, `deploy/eks/chart/values-dev.yaml:13`, `deploy/eks/chart/values.yaml:34`·`:38`, `ai/docs/ai-models-for-clients.md:39`·`:53`에 기록이 있습니다. 발표에서 “저장소에 기록된 당시 실측/비교 결과”로 인용할 수 있습니다. 본 검수에서 원시 운영 로그나 평가 표본을 다시 재현한 수치는 아니며, 12:8을 일반적인 모델 우수성으로 확대하면 안 됩니다.
- **Redis 미사용·AI 임베딩/자체 모델 역할·TLS·기본 컨테이너 보안 설정·오프라인 검증 체계:** `docs/guides/aws-eks-deployment.md:118`, `ai/docs/ai-models-for-clients.md:24`·`:39`, `infra/terraform/stack/data.tf:162`, `deploy/eks/chart/templates/_helpers.tpl:22`·`:44`, `.github/workflows/infra-validate.yml:46`·`:71`과 대체로 일치합니다. ‘어댑터 구현 후 사용’이라고 설명한 Redis의 미구현 상태를 숨길 필요는 없습니다.
- **레이아웃:** 제공된 33장에서는 핵심 본문·표가 서로 겹치거나 화면 밖으로 잘리는 중대 결함은 발견하지 못했습니다. 이 판단은 제공 PNG에 한하며 최신 HTML을 다시 렌더링한 결과가 아닙니다. F01·F02를 해결한 뒤 최종 산출물로 재확인해야 합니다.
