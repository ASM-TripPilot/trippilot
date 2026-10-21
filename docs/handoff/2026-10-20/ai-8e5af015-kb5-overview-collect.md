---
session: 8e5af015-cf40-4f45-ae35-dfeb7fa59221
area: ai
cwd: ai
branches_seen: [develop 외 과거 feature 브랜치 다수]
current_branch: develop (작업은 /Users/juna/dev/trippilot/wt-overview 에서, 브랜치 fix/overview-collect-safety)
span_kst: "08-21 14:17 → 10-20 22:37"
ended_by: weekly-limit
status: 리뷰-대기(PR) + 데이터 수집 진행 중
resume_local: "claude --resume 8e5af015-cf40-4f45-ae35-dfeb7fa59221"
related_prs: [1448, 1479]
tickets: []
session_name: KB-5 장소 지식 세션
---
# KB-5 장소 지식 2단계 — 관광공사 개요 수집 17.5%(볼거리 39%), 반영 준비 #1448 머지, 수집 안전성 #1479 CI 통과

## 목적
8-21 PlanB 리허설로 시작한 최장기 세션(Jira MCP·SendMessage 오케스트레이션 다수). 현재 역할은 **KB-5(장소 지식)**: 위키 ~2,000곳에 더해 한국관광공사 `detailCommon2` 개요(overview)를 약 22,000곳에 붙여 Plan-B 대안 선택·장소 소개 답변 재료로 쓰기.

## 오늘(10-20) 한 일
- 15:36~15:45 **#1448 머지** — 개요 반영 준비: 출처별 조각 크기(개요 300자), 검색이 개요 조각도 찾음(위키·개요 공존 시 가장 맞는 조각 + 같은 출처 첫 문장), 벡터 머리/본체 파일 분리(적재 메모리 454→195MB, 배포 적재 Job 한도 512Mi 아래로). 위키 벡터도 재계산 없이 새 형식으로 이행
- 17:38 사용자 요청으로 TourAPI 2번 키 재발급 페이지(data.go.kr 개발계정 목록·API 소개·GitHub Secrets) 띄움 — 키 재발급은 사용자 몫
- 19:44 수집 현황 보고: 전체 3,847/≈21,980(17.5%), 볼거리 3,210/8,220(39%: 명소 67%·문화 5%·자연 4%), 카페·음식·체험·쇼핑 5%. 개요 보유 99.3%, 중앙값 372자. 매일 00:30 약 1,900곳(2번 키 복구 시 2,850)
- 19:48 **#1479** — Codex 리뷰(bb335bd9 경유) 지적 수정: 개요 수집 워크플로가 누적본 조회 일시 실패를 '첫 실행' 으로 착각해 force push 로 누적본을 덮어쓰던 것 → 조회 실패 시 멈춤·복원 성공 때만 갱신, 키 퇴출(403/429)과 서버 오류(5xx) 구분
- 19:58 세션 한도 → 22:32 주간 한도

## 멈춘 지점 (현재 상태)
- PR #1479 `fix/overview-collect-safety`: CI test·image SUCCESS. **머지만 남음.** worktree `wt-overview` 미커밋 없음.
- 개요 수집 cron(KST 00:30)은 계속 돈다. 볼거리 완료 예상 10-23 아침(2번 키 복구 시 하루 앞당김).
- 반영 PR(개요 코퍼스 + 벡터 생성 → KB-5 적재)은 **볼거리가 다 모이는 10-22~23 에 올릴 예정** — 미착수.

## 다음에 이어서 할 일
1. `gh pr merge 1479 --squash`. 머지 뒤 다음 00:30 수집 런 로그에서 "복원 성공 → 갱신" 경로가 정상인지 확인(`gh run list --workflow <개요 수집 워크플로>`).
2. 사용자: `TOUR_API_KEY2` 재발급 → GitHub Secrets 갱신(절차는 세션 17:38 보고. 디코딩 키를 쓴다).
3. 10-22~23 볼거리 수집 완료 시: 개요 코퍼스 조각화(300자) → 벡터 생성(본체 분리 형식) → KB-5 적재 PR. 적재 Job 메모리 512Mi 아래인지 가짜 파일로 먼저 재 본 방식 재사용.
4. 나머지(카페·음식·체험·쇼핑)는 볼거리 반영 뒤 이어서.

## 함정 / 주의
- **`tourapi.py` 는 건드리지 않는다** — 장소 데이터 세션(trippilot-c3)과 분담. 이 세션은 수집기(워크플로·스크립트)만.
- 개요는 contentid 로 1:1 매칭(위키처럼 이름 매칭 오류 없음). `<br>` 태그·전화·주소 문장은 제거.
- 누적본 artifact 는 복구 가능하지만 수동이다 — 덮어쓰기 경로를 다시 열지 않는다.
- Plan-B 에서 KB-5 조각이 프롬프트에 실리는 곳은 `/alternatives` 하나(0b997ca7 sync 에서 확인).
- 이 세션은 Jira MCP(`mcp__atlassian__*`)로 티켓을 직접 만들고 전이시켜 왔다 — 클라우드 세션에는 그 MCP 가 없을 수 있다.

## 참조
- `ai/scripts/collect/`(개요 수집), `ai/src/trippilot/agents/planb/`(KB-5 조각 소비), `ai/data/`(벡터·코퍼스)
- `.github/workflows/` 개요 수집 cron(KST 00:30)
- 관련 세션: `wt-existence-demote-a53b1b44-poi-event-data.md`, `root-bb335bd9-decisions-codex-review-recommend.md`
