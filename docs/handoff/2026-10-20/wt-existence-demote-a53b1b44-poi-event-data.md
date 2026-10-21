---
session: a53b1b44-1f14-4210-a1ae-1974ed435d59
area: wt-existence-demote
cwd: .claude/worktrees/wt-existence-demote
branches_seen: [장소·행사 데이터 브랜치 100여 개 — 마지막 docs/tourapi-429-comment]
current_branch: docs/tourapi-429-comment (PR #1477 OPEN, 원격과 동일, 미커밋 0)
span_kst: "08-22 19:55 → 10-20 19:57"
ended_by: session-limit 19:57 (20:40 리셋 뒤 재개 안 함)
status: 리뷰-대기(PR)
resume_local: "claude --resume a53b1b44-1f14-4210-a1ae-1974ed435d59"
related_prs: [1437, 1477]
tickets: [TRIP-1471]
session_name: trippilot-c3 (장소·행사 데이터 담당)
---
# 장소·행사 데이터 담당(trippilot-c3) — 공유본 60,521곳, PR #1477 CI 통과 머지 대기

## 목적
8-22 부터 POI 수집·정제·공유본(`ai/data/collected_pois.json`) 관리, TourAPI 축제·행사 수집, Overture·공공데이터 병합, 존재 확인(existence) 등 장소 데이터 전반. 다른 세션이 **trippilot-c3** 로 부른다.

## 오늘(10-20) 한 일
- 06:20~07:21 `fix/sido-truncated-prefix` — 관광공사 원본에서 시·도 이름 끝이 잘린 주소('부산광역 사하구', '제주특별자치 서귀포시') 2곳 때문에 backend-ci(`PoiProposalRealDocumentIT regionUnresolved == 0`) 빨강 → 수정 PR #1437
- 10:35 **#1437 닫음** — 팀원이 7시간 전 같은 수정 #1431(TRIP-1471)을 먼저 머지. "고치기 전에 열린 PR 부터 찾기" 를 메모리에 남김
- 10:46 develop backend-ci 초록(`aa407262`). 공유본 60,521곳(새벽 서울·부산·제주 797 + 자동 강원 148·충북 107). 랜드마크 6곳(경복궁·해운대·광안리·감천문화마을·천지연폭포·남산서울타워) 영업시간 포함 확보. 배포 담당에 기대치 전달: 접수 60,521 · 신규 1,052 · 닫을 것 0 · 지역 코드 미상 0
- 19:47 Codex 리뷰 지적(bb335bd9 경유) — `tourapi.py` 주석 2곳이 "429 는 일시 장애" 라고 적혀 있으나 #1418 이후 429 = 키 퇴출 → **PR #1477** (주석만, 동작 변화 없음). KB-5 세션에 "tourapi.py 는 건드리지 말고 수집기만" 분담 통보
- 19:57 세션 한도

## 멈춘 지점 (현재 상태)
- PR #1477 `docs/tourapi-429-comment`: CI test·image SUCCESS. **머지만 남음.**
- worktree 미커밋 없음, 원격과 동일.
- 관광공사 2번 키(`TOUR_API_KEY2`)는 403 — **재발급 필요(사용자 작업)**. 그때까지 하루 호출 2,000건.

## 다음에 이어서 할 일
1. `gh pr merge 1477 --squash` → 원격 브랜치 삭제. 이 worktree 는 `git switch --detach origin/develop` 으로 비워 두거나 다음 작업 브랜치로.
2. 사용자가 `TOUR_API_KEY2` 재발급(data.go.kr 개발계정 → 일반 인증키(Decoding) → GitHub Secrets 갱신)하면 다음 00:30 수집부터 3키로 돈다 — KB-5 세션 문서에 절차 있음.
3. 매일 수집 결과(공유본 건수·regionUnresolved) 모니터링은 평소대로.

## 함정 / 주의
- **고치기 전에 열린 PR 을 먼저 찾는다**(오늘 중복 PR 실수). `gh pr list --search "<키워드>"`.
- 429 는 그 키의 하루 한도 → **키 퇴출**(`_KEY_DEAD_HTTP = {403, 429}`). 일시 장애는 타임아웃·5xx 만.
- 백엔드 region 결정은 시·도 약칭 표의 "끝 글자 떼기" 꼴로 처리(#1431) — 수집 쪽에서 또 펴지 않는다.
- 공유본 병합 테스트는 실제 문서로 돌아 느리다(`PoiProposalRealDocumentIT`).
- 이 worktree 는 리포 안 `.claude/worktrees/` 에 있어 **클라우드 세션에는 없다**. 브랜치는 push 되어 있으니 클라우드는 `docs/tourapi-429-comment` 를 체크아웃하면 된다.

## 참조
- `ai/src/trippilot/poi_curation/sourcing/tourapi.py`, `ai/scripts/collect/merge_pois_docs.py`, `ai/data/collected_pois.json`
- `.github/workflows/{ai-poi-collect,ai-event-collect}.yml`
- 관련 세션: `ai-8e5af015-kb5-overview-collect.md`(KB-5 개요 수집, 같은 TourAPI 키 공유)
