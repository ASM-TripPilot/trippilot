---
session: f916bf14-2af2-4028-8e56-221d24e9dcdd
area: root
cwd: .
branches_seen: [develop]
current_branch: develop (작업은 /Users/juna/dev/trippilot/wt-place-*, wt-sql-* worktree 에서)
span_kst: "10-18 22:13 → 10-20 21:05"
ended_by: weekly-limit
status: 진행중
resume_local: "claude --resume f916bf14-2af2-4028-8e56-221d24e9dcdd"
related_prs: [1458, 1459, 1461, 1466, 1469, 1478]
tickets: []
---
# 챗봇 장소 탐색 — NL2SQL(#1461)·일정 밖 장소 정보(#1466)·장소 소개 KB-5(#1469)·캐시 키(#1478), 다음은 rich 정렬

## 목적
"챗봇이 서울 요즘 핫한 곳·가볼 만한 곳을 데이터로 답하게, NL2SQL 도 활용" (10-20 16:31 지시).
10-18 에는 CoT/few-shot 적용 검토·Codex 리뷰·배포, 10-19 챗봇 실동작 점검 보고서. 다른 세션(답변 담당 053ac554, 계획 단계 ai-e3 895e45c9, 날씨 ea9f15f0)과 겹치지 않게 빈 곳만 메우는 역할.

## 오늘(10-20) 한 일
- #1458 대신 갈 곳에 식당 섞임 수정 · #1459 질문뱅크 로드 실패 시 기동 사망 수정 (둘 다 머지)
- 18:07 **#1461 머지** — NL2SQL: LLM 이 SQL 작성, 방어 3겹(읽기 전용 뷰 `poi_public` V2.77 · SQL 허용 목록 검사 · 1.5s/20행 상한). 실패·0건이면 반경 탐색 폴백, 같은 조건 1시간 캐시
- 18:18 **#1466 머지** — 일정 밖 장소 영업시간·입장료·두 곳 거리(정확한 이름 일치만, LLM 없음, 지역 이름은 중심 좌표)
- 18:35 **#1469 머지** — 장소 소개 질문에 KB-5 한 조각을 답변 재료로(시각·소요 문장 제외, 카드엔 안 실음)
- 18:55 사용자 질문 "NL2SQL 만 돈 거야?" → 5턴 중 2턴은 POI_INFO Provider + 후보 풀 에이전트 경로였음을 로그로 확인해 답함
- 19:27 "인젠션 탐지되면 계속 못 쓰나?" → 그 턴만 거절, 차단 없음, `refusal_streak` 2회면 사용 안내로 전환
- 20:41 **#1478 머지** — Codex 리뷰 지적: NL2SQL 캐시 키에 발화가 빠져 다른 사용자 SQL 재사용 → 발화 포함
- 20:48~20:52 **rich 정렬 작업 시작**: `poi_public` 뷰에 `rich` 칸(대표사진+영업시간 둘 다 있으면 FULL, BE 정의와 동일) 추가(V2.78), 프롬프트가 `ORDER BY rich DESC, poi_id` 를 붙이게. LLM 6/6 정렬 부착 확인, 실행기 정렬 테스트 333건 통과, BE 뷰 테스트에 rich 확인 추가 중
- 21:05 한도

## 멈춘 지점 (현재 상태)
- rich 정렬 작업은 worktree `wt-sql-rank` 브랜치 `fix/ai-place-sql-rich-order` 에 **미커밋 상태로 남아 있었다** → 인수인계 시점에 `wip(handoff 2026-10-20)` 커밋(d8ab19c67)으로 push 했다. PR 없음. 포함 파일:
  `ai/prompts/dialogue_sql.yaml`, `ai/src/trippilot/llm_gateway/gates/dialogue_sql.py`, `ai/src/trippilot/poi_curation/adapters/pg_place_sql.py`, `ai/tests/llm_gateway/test_dialogue_sql.py`, `backend/app/src/test/kotlin/com/trippilot/app/PoiPublicViewIT.kt`, **신규** `backend/app/src/main/resources/db/migration/V2.78__poi_public_rich.sql`
- 마지막 발화: "테스트 화면을 다시 켜서 실제 후보가 어떻게 나오는지 봅니다" — 실측 전.
- 개발 서버: NL2SQL·이름 찾기·장소 소개 켜짐(기동 로그 확인). **실제 장소 조회는 한 번도 안 들어와 DB 권한이 실제로 통하는지 미확인.**
- 운영: #1478 포함 승격 뒤 `DIALOGUE_SQL` 배정 예정이었음(배포 세션 참조) — 실행 여부 미확인.

## 다음에 이어서 할 일
1. `fix/ai-place-sql-rich-order` 를 `origin/develop` 위로 rebase. **V2.78 번호 충돌 확인**: `git ls-tree --name-only origin/develop backend/app/src/main/resources/db/migration/ | sort -V | tail -3` — 다른 PR 이 V2.78 을 먼저 썼으면 번호를 올린다.
2. `cd ai && PYTHONPATH=src:. pytest tests/llm_gateway/test_dialogue_sql.py tests/orchestrator/test_place_sql.py -q` + `cd backend && ./gradlew :app:test --tests "*PoiPublicViewIT*"` 통과 확인 후 wip 를 squash 해 PR.
3. 개발 앱에서 "서울 요즘 핫한 곳" 한 번 물어 `InsufficientPrivilege` 없이 조회되는지 로그 확인(사용자 또는 로컬 세션).
4. 운영에 `DIALOGUE_SQL=gpt-5.6-luna` 배정됐는지 확인(`wt-mlops-serving-c9fb725e-deploy-release.md` 참조).

## 함정 / 주의
- 뷰에는 영업시간·좌표·내부값이 **없어야 한다**(인젝션 피해 범위 제한). rich 칸은 "있음/없음" 요약만.
- 캐시 키는 "분류 인자 + 발화" 다. 띄어쓰기만 다른 질문은 같은 키로 둔다.
- 지역을 말하면 NL2SQL, 안 말하면 일정 근처(POI_INFO Provider → 후보 풀 에이전트). 두 경로를 섞어 재지 않는다.
- 로컬 DB 에는 경복궁·남산서울타워 등이 없어 로컬 측정은 비어 나온다 — 개발·운영 DB 로 확인.
- 메모리(로컬 전용): `~/.claude/projects/-Users-juna-dev-trippilot-trippilot/memory/{assistant-nl2sql-place-db.md,squash-soft-reset-reverts.md}`.

## 참조
- AI: `ai/src/trippilot/orchestrator/place_sql.py`, `place_intro.py`, `ai/src/trippilot/llm_gateway/{gates,workers}/dialogue_sql.py`, `ai/prompts/dialogue_sql.yaml`
- BE: `backend/app/src/main/resources/db/migration/V2.77__poi_public_view.sql`, `PoiPublicViewIT.kt`
- 관련 세션: 답변 프롬프트 `ai-053ac554-dialogue-answer-prompt.md`, 계획 단계 `ai-895e45c9-dialogue-plan-intent.md`, 추천 의도 `root-bb335bd9-decisions-codex-review-recommend.md`
