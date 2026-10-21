---
session: 3a974fff-f720-44d2-8ff9-ac62465cd11b
area: ai
cwd: ai
branches_seen: [develop]
current_branch: develop (worktree /Users/juna/dev/trippilot/wt-regen 은 detached, 정리 가능)
span_kst: "10-18 18:32 → 10-20 18:01"
ended_by: idle-since-18:01
status: 완료 — 운영 반영 확인 대기
resume_local: "claude --resume 3a974fff-f720-44d2-8ff9-ac62465cd11b"
related_prs: [1451, 1452, 1454]
tickets: []
---
# (완료) 서울 2박3일이 사흘 모두 을지로 — 날마다 다른 동네 #1451·취향 반영 #1452·다시 짜기 지역 이동 #1454 머지

## 목적
"다시짜기 눌러도 안 바뀐다"(10-18) → 오늘 "서울 2박3일이 전부 을지로, '을지로 말고 강남에서' 재계획도 안 먹음, 취향 반영하라!!!" 피드백 반영.

## 오늘(10-20) 한 일
- 15:57~16:29 PR 3건 CI 통과·머지(배포 담당이 개발→운영 승격 흐름에 실음):
  - **#1451 날마다 다른 동네**: 숙소 없으면 기준점이 시청 + 여러 날은 반경 7km 로 줄어 강남(8.8km)·성수(7.3km)가 후보에 없었음 → 반경 10km, 취향 점수 높은 동네를 서로 4km 이상 떨어지게 날마다 하나씩
  - **#1452 취향 반영**: 서울처럼 후보가 많으면 상위 250곳만 LLM 취향 점수, 나머지는 기본 점수인데 기본 점수가 더 커서 LLM 이 안 본 명소가 이김 → 미채점 후보는 LLM 채점 중간값을 넘지 못하게
  - **#1454 다시 짜기 지역 이동**: "을지로 말고 강남에서 놀고 싶어" → 그 지역 3km 안으로 후보 재수집, 지역 밖 일정 제거(다녀온 곳·고정은 유지). 서울·부산·제주·강릉·경주 동네 60곳 중심 좌표 표(연희동처럼 가게 이름에 동네가 안 붙는 곳용)
  - 실측(서울 2박3일): 카페 취향 을지로·홍대·여의도 → 성수·서촌·홍대·합정 / 야경 → 남산·여의도·압구정·청담 / 역사 → 궁·박물관·코엑스·전쟁기념관. 재계획 "강남" 6/6, "연희동" 7곳
- 17:59 사용자 규칙 **"AWS 키 재발급 필요하면 사이트를 바로 띄워라, 모든 세션에 알려"** → 18:00 떠 있는 세션 20곳에 SendMessage 로 전파, 전역 `~/.claude/CLAUDE.md` 끝과 메모리(`open-aws-portal-on-expiry.md`)에 기록

## 멈춘 지점 (현재 상태)
완료. 운영 반영은 10-20d(#1460, develop 00d197a7) 승격에 포함됐을 가능성 — 배포 세션 문서 "카페 9,105곳·동네 분산·지역 이동 다시 짜기" 가 10-20d 제목이라 **운영 반영됨(추정)**.

## 다음에 이어서 할 일
1. 운영 앱에서 서울 2박3일 생성 → 사흘이 다른 동네인지, "강남에서" 재계획이 옮겨 가는지 실기 확인(사용자).
2. `wt-regen` worktree(detached fdf569d76) 정리: `git worktree remove /Users/juna/dev/trippilot/wt-regen`.

## 함정 / 주의
- 동네 좌표표 60곳은 **5개 도시만**. 다른 도시 동네 이름은 지어내지 않고 기존 경로.
- 미채점 후보 보충 규칙은 "LLM 척도" 기준 — 기본 점수 상수를 다시 올리면 #1452 가 무효가 된다.
- 전 세션 규칙(이 세션이 발신): AWS 키 포털 `https://isb.etslearning.co.kr/` 띄우기, 키 값은 출력하지 않고, 갱신했다고 할 때까지 같은 세션에서 반복 띄우지 않음. 관광공사·기상청 키도 같은 방식.

## 참조
- `ai/src/trippilot/assembly_engine/day_focus.py`, `ai/src/trippilot/agents/schedule/agent.py`, `ai/src/trippilot/agents/planb/request_verification.py`, `ai/prompts/replan_request_extraction.yaml`, `ai/scripts/measure/measure_generate_area_spread.py`
- 관련 세션: `wt-mlops-serving-c9fb725e-deploy-release.md`
