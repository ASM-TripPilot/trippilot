---
session: dddebc4b-5855-4df9-a91b-c02e9acddde8
area: ai
cwd: ai
branches_seen: [develop 외 과거 poi 브랜치]
current_branch: develop (임시 worktree 정리됨)
span_kst: "08-23 22:32 → 10-20 18:00"
ended_by: idle-since-15:58 (18:00 broadcast 반영만)
status: 완료
resume_local: "claude --resume dddebc4b-5855-4df9-a91b-c02e9acddde8"
related_prs: [1436, 1444, 1445]
tickets: []
session_name: 서빙 트랙(Bedrock 학생 모델) 세션 — 원래 8-23 "세션 8→4 정리" 메인 세션
---
# (완료) Bedrock 서빙 트랙 Codex 리뷰 — 확정 4건 중 3건 #1445 머지, 1건은 #1444 로 선행

## 목적
8-23 "Orca 터미널 8개를 4개로 줄여라" 로 시작해 원장(ledger)·인계 체계를 만든 세션. 현재 역할은 Bedrock 학생 모델 서빙 트랙(어댑터·리마인드 게이트·판정기·워크플로·IAM).

## 오늘(10-20) 한 일
- 15:28 지시 "codex code review 진행, 결정 다 선택했다고 전달" → 결정 수집 세션에 전달(그쪽은 이미 10곳에 전파 완료)
- Codex 읽기 전용 리뷰 지적 7건 → 코드로 검증, 확정 4건:
  - 리마인드 게이트가 다른 날 장소명을 **본문에서만** 걸러 제목으로 새던 것 → 제목·본문 함께 대조
  - 판정기가 같은 날 수동 재실행 2회를 "2주 연속" 으로 셈 → 주(끝) 날짜당 1판정, 오늘 행 제외
  - 판정기 CloudWatch 모델 목록 첫 페이지만 읽음 → 페이지 끝까지
  - 원장 PR auto-merge 가 한 번도 안 걸림(develop 비보호 브랜치) → **다른 세션 #1444 가 먼저 머지**, 내 변경은 버림
- 15:58 **#1445 머지**(f090e906e), #1436 주간 원장 PR 머지. 테스트 2파일 52건·CI 통과
- 안 고친 3건(검증 후 수용): 계정 전체 임포트 모델 합산(모델 1개뿐), Pod 역할 모든 임포트 모델 호출 가능(부트스트랩 시점 ARN 없음), CloudWatch·Cost Explorer 측정 창 어긋남(CE 경로 막혀 있어 열릴 때)
- 18:00 broadcast 반영: AWS 자격 메모를 "포털 띄우기 + credentials 섹션 3줄 교체" 로 갱신

## 멈춘 지점 (현재 상태)
완료. 열린 PR·worktree 없음.

## 다음에 이어서 할 일
1. 없음. Cost Explorer 경로가 열리면 CloudWatch 와 측정 창 맞추기(미결 메모).

## 함정 / 주의
- Codex 심각도는 전부 medium 이었지만 실제는 low~medium — **지적마다 코드로 재현**한 뒤 판단.
- 원장 주간 PR 은 `--auto` 가 아니라 직접 머지(#1444).
- 같은 워크플로 파일을 두 세션이 동시에 고쳤던 사례 — 머지 전 `git log origin/develop -- <파일>` 확인.

## 참조
- `ai/scripts/mlops/serving_judge.py`, `ai/src/trippilot/llm_gateway/gates/reminder_copy.py`, `ai/tests/scripts/test_serving_judge.py`, `.github/workflows/ai-serving-judge.yml`, `ai/docs/mlops/serving-ledger.md`
- 관련 세션: `wt-mlops-serving-c9fb725e-deploy-release.md`
