---
session: dddebc4b-5855-4df9-a91b-c02e9acddde8
area: root
cwd: .
branches_seen: [develop]
current_branch: develop (작업은 스크래치 worktree — 열린 브랜치는 fix/bedrock-stale-connection 하나, push 됨)
span_kst: "08-23 → 11-02"
ended_by: user-consolidation (세션 정리로 종료)
status: 확인-대기
resume_local: "claude --resume dddebc4b-5855-4df9-a91b-c02e9acddde8"
related_prs: [742, 750, 753, 1390, 1445, 1510, 1550, 1570, 1691, 1700, 1712, 1781]
tickets: [TRIP-973, TRIP-974, TRIP-961]
session_name: 리마인드 문구 학생 모델·Bedrock 서빙·서빙 판정기 + 도우미 잡담 LLM·입구 인젝션 그림자 (trippilot-31)
handed_to:
  - "trippilot-f7 (배포·MLOps 서빙) — 1~4"
  - "trippilot-3b (도우미 에이전트) — 5 (6 은 종료 직전 해결)"
---
# 리마인드 학생 모델 서빙·판정기·도우미 잡담·인젝션 그림자 — 코드는 다 머지, 남은 것은 #1781 머지·배포와 관찰

## 목적
REMINDER_COPY(일정 알림 문구)를 파인튜닝한 학생 모델(Qwen3-4B LoRA)로 돌리는 트랙의 주인. AWS Bedrock Custom Model Import 로 서빙하고, EKS GPU 로 옮길 시점을 매주 재는 판정기를 둔다. 10-21 부터는 도우미 챗봇의 인사·잡담 LLM 과 입구 인젝션 그림자 분류기도 맡았다.

## 이 세션이 머지한 것 (요지)
| PR | 내용 |
|---|---|
| #742 | Bedrock 배포 환경 — boto3·compose `~/.aws` 마운트·EKS 시크릿 2키·Pod Identity(Auto Mode 는 IMDS 홉 1이라 노드 역할 못 씀) |
| #750 | ADR AI-D08 — Bedrock CMI 운영, EKS GPU 는 측정 실험, 판정기 자동화 |
| #753 · #1390 · #1445 | 서빙 판정기(`ai/scripts/mlops/serving_judge.py`, 주간 `ai-serving-judge.yml`, 원장 `ai/docs/mlops/serving-ledger.md`) · Codex 리뷰 확정분(같은 날 재실행 1주 집계·list_metrics 페이징). 원장 PR 즉시 머지는 #1444(다른 세션) |
| #1510 · #1550 · #1570 | 도우미 인사·잡담 — 고정 문장 → `DIALOGUE_SMALLTALK` LLM(배정이 곧 켜기, 실패면 고정 문장) → 프롬프트 0.1.1(직전 말 되풀이 금지). 개발·운영 켜짐(10-23) |
| #1691 | 리마인드 게이트가 지어낸 시각("오후 3시"·"15:00") 차단(INV-2) + 로컬 Bedrock 자격 별도 파일(compose `AI_AWS_CREDENTIALS_FILE`) |
| #1700 · #1712 | 도우미 입구 인젝션 소형 분류기 — 오프라인 측정 → **개발 서버만** 그림자(임베딩 서비스 `/classify/injection`, 판정값만 로그) |

## 멈춘 지점
- **PR #1781 열림(CI 대기)** — 리마인드 배치 첫 알림이 끊긴 재사용 연결로 매번 상수 문구가 되던 것. 3일 로그: 운영 46건·개발 10건 `Connection was closed before we received a valid response`(배치 첫 항목, 1~2ms). EKS 는 NAT 게이트웨이(쉬는 TCP 약 350초에 끊음)를 거쳐 나가서 생긴다(추정 — 로컬은 NAT 가 없어 5분 쉬어도 미재현). 고친 것: 500ms 안의 `ConnectionClosedError`·EOF 꼴 `SSLError` 만 새 연결로 한 번 더. 일반 재시도(`max_attempts=0`, 09-29 504)는 그대로. AI 전체 7,419 passed.

## 다음에 이어서 할 일
1. **(f7) #1781** CI 초록이면 squash 머지 → 개발·운영 배포. 배포 뒤 CloudWatch(`/aws/containerinsights/trippilot-dev/application`, 운영·개발 네임스페이스 둘 다 있음)에서 `llm_reminder_copy` 사유의 `Connection was closed` 가 사라지고 배치 첫 항목도 `llm_cost … REMINDER_COPY … success: true` 인지 본다.
2. **(f7) 서빙 판정기** — 매주 화 07:00 KST 자동(원장 행만 든 PR 은 즉시 머지). 지금 판정은 늘 HOLD(GPU 쿼터 없음). TRIP-973 '진행 중'. **GPU 쿼터(TRIP-961)가 오면** `measure()` 에 EC2 GPU 노드 가동시간 직접 세기를 넣는다(Cost Explorer 는 계정 SCP 로 거부 — 사용자 결정 (b)).
3. **(f7) 인젝션 그림자 임베딩 쪽** — 개발 임베딩 파드 메모리 실측 3.28GiB(운영 2.83) / 한도 6Gi. 임베딩 이미지를 다시 구울 때 분류기(int8 ONNX 268MB)도 구워진다(빌드 `check_ready.py` 가 판정까지 확인).
4. **(f7) 로컬 자격** — 로컬 Bedrock 프로필은 `~/.aws/trippilot-bedrock.credentials`(샌드박스 갱신이 config·credentials 를 통째로 덮어 세 번 사라졌다). 로컬 `trippilot-ai` 컨테이너는 `wt-fe-sim` 작업트리의 옛 compose 로 떠 있어 `~/.aws/credentials` 사본 블록으로 버틴다 → 다음 샌드박스 갱신 뒤 재시작하면 Bedrock 이 끊긴다. wt-fe-sim 을 develop 으로 올리고 그 `.env` 에 `AI_AWS_CREDENTIALS_FILE=trippilot-bedrock.credentials`.
5. **(3b) 인젝션 그림자 관찰** — 개발 로그 `dialogue_injection_shadow` 의 `flagged` 비율 = 오탐 상한. 10-30~11-02 실트래픽 16턴: 울림 0·오류 0·p50 72ms. **1~2주 뒤 1% 미만이면** 입구 거름(0′ 정규식)에 OR 로 올릴지 정한다 — 그때는 응답 경로 안이라 지연 예산과 "시한 초과 시 통과"가 조건. 근거 `ai/docs/security/injection-classifier-shadow.md`.
6. ~~(3b) 잡담 LLM 이 Claude 로 바뀐 뒤 실제로 도는지~~ — **해결(11-02, 세션 종료 직전)**. 로컬 키를 서버와 같은 새 운영 키로 바꾼 뒤 운영 프롬프트·실 게이트로 haiku-5-5(개발)·opus-5-5(운영) 각 4건 = 8/8 통과, 0.9~2.5초, 거듭 인사엔 "또 인사해 주시네요". 3일 호출 0건은 인사가 없었던 것으로 본다.

## 함정 / 주의
- **학습 데이터 약관**: Claude·GPT 출력으로 어떤 모델도 학습 금지(팀 결정 09-08) — 교사는 오픈 웨이트(Qwen3-235B)만, Sonnet 은 평가 전용.
- **학생 모델 프롬프트는 동결**(09-19): 프롬프트를 고치면 A/B 에서 진다 — 고치려면 그 프롬프트로 데이터 재생성 + 재학습.
- 사용자 결정: Cost Explorer 거부 처리는 (c) 쿼터까지 그대로, 쿼터가 오면 (b) EC2 노드시간(ISB 권한 요청 (a)는 안 함) · 잡담은 1번(호스팅 경량 모델, 별도 feature — 로컬 LLM 은 쿼터·판정기 전환 때 배정만 바꿈) · 인젝션 분류기는 그림자부터(10-30 "결정 필요한 건 추천대로").
- 로컬 Bedrock 키 회전: 샌드박스 프로필로 `iam create-access-key` → 파일 스크립트로 바로 씀(출력 금지) → sts 확인(전파 몇 초) → 옛 키 삭제. 키 값은 어느 리포 파일에도 없다.
- 판정기 원장 PR 이 안 머지되면 다음 주 force-push 가 행을 덮는다(10-06 실제 유실) — #1444 이후 즉시 머지.
- Bedrock 콜드 스타트(5분 무호출 → 약 2분 ModelNotReady)는 백엔드가 3분 뒤 재채움으로 받는다(TRIP-974 완료) — AI 쪽 워밍은 만들지 않기로.
