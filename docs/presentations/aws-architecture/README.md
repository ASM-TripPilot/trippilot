# TripPilot AWS 인프라 자료

develop 브랜치(`7ce2a53`, 2026-10-30) 기준으로 만든 AWS 아키텍처 다이어그램과 발표 자료 두 벌이다.
인프라가 바뀌면 다이어그램·덱의 사실이 어긋나므로, 아래 "근거" 파일이 바뀐 PR에서는 이 자료도 함께 확인한다.

## 산출물

| 파일 | 용도 |
|---|---|
| `aws-architecture.png` | AWS 아키텍처 다이어그램(4200×2520, AWS 공식 아이콘). 문서·PPT에 그대로 붙인다 |
| `01-infra-intro-students.html` (+ `.pdf`) | 대학생 대상 소개 덱 19장. 구어체, 비유 중심 |
| `02-infra-strengths-report.html` (+ `.pdf`) | 최종 보고·심사 제출용 덱 14장. 보고서체, 장점마다 근거 파일 표기 |

HTML 덱은 CSS·JS·이미지를 모두 안에 넣은 단일 파일이라 그대로 보내도 된다(폰트만 CDN에서 받는다).
조작: `← →`·스페이스·휠·스와이프로 넘기고, `F`는 전체 화면, 구조도를 클릭하면 원본 크기로 본다. 주소 끝 `#7`처럼 번호로 바로 갈 수 있다.

## 글쓴이 페르소나(대학생 덱)

- 34세, 백엔드·인프라 엔지니어 9년 차. TripPilot 인프라 담당.
- 후배에게 설명하듯 "~예요/~거든요" 존댓말 구어체. 비유는 생활 사물(건물, 도시락, 출입증)로.
- 잘한 점만 말하지 않는다. 아낀 것과 감수한 것, 실제로 겪은 장애를 같이 말한다.
- 실제 사례는 저장소 주석·문서에 근거가 있는 것만 쓴다(예: 노드 교체 관찰 `values-dev.yaml`, LLM 조용한 실패 `alerts.tf`).

심사 덱은 페르소나 없이 "~습니다" 보고서체로 썼다. 장점은 강조하되, 슬라이드마다 근거 파일을 달아 심사위원이 확인할 수 있게 했다.

## 다시 빌드하기

```bash
cd docs/presentations/aws-architecture
python3 src/build.py            # 다이어그램 PNG → 덱 묶기 → 넘침 검사·스크린샷 → PDF
python3 src/build.py diagram    # 다이어그램만
python3 src/build.py decks      # 단일 HTML만
python3 src/build.py qa         # 슬라이드 넘침 검사(+ /tmp/deck-shots 스크린샷)
```

필요한 것: macOS의 Google Chrome(헤드리스 렌더링), `cwebp`. 내용은 `src/`에서만 고친다 — 최상위 HTML은 빌드 산출물이다.

| 소스 | 내용 |
|---|---|
| `src/aws-architecture.html` | 다이어그램 원본(2100×1260 고정 캔버스, 절대 좌표) |
| `src/students.html` · `src/report.html` | 덱 원본 |
| `src/deck.css` · `src/deck.js` | 두 덱 공용 엔진(1920×1080 아트보드 스케일, 탐색, 확대 보기, `?qa` 넘침 검사) |
| `assets/icons/` | AWS Architecture Icons(`aws-icons` 3.3.0, MIT) · 브랜드 로고(`simple-icons`, CC0) |
| `assets/img/` | 삽화 3장(codex 이미지 생성) · 다이어그램 WebP |
| `review/` | humanize-korean 윤문 결과(`humanize-changes.md`)와 codex 검수 원문(`codex-review.md`)·반영 기록(`codex-applied.md`) |

## 근거(정본)

| 주제 | 파일 |
|---|---|
| 네트워크·EKS·데이터·알람 | `infra/terraform/stack/{network,eks,data,alerts,registry-secrets}.tf` |
| 환경별 규모 | `infra/terraform/environments/{dev,prd}.tfvars` |
| IAM·OIDC·상태 버킷 | `infra/bootstrap/template.json` |
| 워크로드·게이트웨이·보안 | `deploy/eks/chart/` |
| 배포 절차·운영 게이트 | `.github/workflows/aws-deploy.yml`, `infra/scripts/deploy_gate.py`, `docs/guides/aws-eks-deployment.md` |
| AI 모델 | `ai/docs/ai-models-for-clients.md` |

주의: `trippilot-dev` 스택이 출시 앱을 받는 실제 운영 환경이다(prd 스택은 비용 때문에 보류, 설정 파일만 준비). 같은 클러스터 안에 운영(`trippilot`)과 개발(`trippilot-dev`) 네임스페이스가 함께 있다.
