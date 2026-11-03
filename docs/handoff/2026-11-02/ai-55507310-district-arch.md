---
session: 55507310-12e5-4627-8439-8d469b6babce
area: ai
cwd: ai
branches_seen: [develop]
current_branch: develop (작업은 /Users/juna/dev/trippilot/wt-* 워크트리 — 전부 머지·정리됨, 미커밋 없음)
span_kst: "10-01 → 11-02"
ended_by: user-consolidation (세션 정리로 종료)
status: 확인-대기
resume_local: "claude --resume 55507310-12e5-4627-8439-8d469b6babce"
related_prs: [1399, 1414, 1462, 1513, 1610, 1621, 1626, 1630, 1683, 1690, 1698, 1777]
tickets: [TRIP-1248, TRIP-1232, TRIP-827, TRIP-1669, TRIP-1674, TRIP-1677]
session_name: ai-d1 — 일정 생성·같이 짜기 구 안 우선·여행 목록 상태·공유본 정리·AI 아키텍처 단일 정본
handed_to:
  - "trippilot-df (일정 품질) — 같이 짜기·구 안 우선 BE 지식, 앱 TRIP-1669·1674 질문 상대(아래 1·2)"
  - "trippilot-c3 (운영·데이터) — TRIP-1248 ③ 마무리·보류 83곳 재판정·TRIP-1232(아래 3·4)"
  - "trippilot-79 (상황 감지·사용자 할 일 페이지) — 사용자 몫 항목 합치기(아래 5)"
  - "ai/src/ 폴더 미사용 항목 정리 — ARCHITECTURE.md §3 하위폴더 지도(아래 6)"
---
# 같이 짜기 구 안 우선·여행 목록 상태·공유본 정리·AI 아키텍처 단일 정본 — 코드는 다 머지, 남은 것은 앱 작업과 확인

## 이 세션이 머지한 것 (10-21 이후 요지)
| PR | 내용 |
|---|---|
| #1399 | 도우미 프롬프트 인젝션 결정론 거름(좁게 — 오탐 사례는 메모리 `prompt-injection-blast-radius`) |
| #1414 #1513 #1610 | 대중교통 700m 이하 걷기, 자차 주차 거점(OR-Tools 무변경) |
| #1621 #1626 #1630 #1683 | 같이 짜기 '찾는 중심'(PREVIOUS·REGION·STAY·POINT) + 구 안 우선(같이 짜기·생성 둘 다), `districtCodesOf` 정확 일치, 옛 여행 동명이지역 REGION 은 409 |
| #1462 | `GET /trips` 에 일정 상태 네 칸(선택 칸 — 앱 전환 때 required) |
| #1690 | 공유본에서 벤더 이탈 TOURAPI 12곳 제거(TRIP-1248 ③), 인허가 영업 중 8곳은 남김 |
| #1698 | INV-U3-03 개정 — 꼭 갈 곳 고정 시각은 사용자가 편집에서 바꿀 수 있다(숙소 제외) |
| #1777 | **`ai/ARCHITECTURE.md` = AI 아키텍처 단일 정본**(2026-11-02), 옛 개요 12개 '대체됨' |

## 멈춘 지점 / 다음에 이어서 할 일
1. **앱 TRIP-1669(같이 짜기 찾는 중심 고르기)·TRIP-1674(꼭 갈 곳 시각 편집)** — frontend-01 에 전달·수락됨. 기본은 '자동(추천)' = `center` 안 보냄(사용자 지시 "웬만하면 우리가 판단해서 좋게"). 앱 쪽 질문은 일정 품질 세션(trippilot-df)이 받는다. TRIP-1674 는 FE 한 줄(`EditorView.tsx` `canEditTime`) + 시각 변경 뒤 재정렬 — BE·AI 는 이미 됨.
2. **앱 TRIP-1677(여행 목록 일정 상태를 목록 칸으로, 429 근본 해결)** — 전달 메시지가 승인 만료로 **안 갔다**. 사용자가 앱 세션에서 `TRIP-1677 사이클 시작해` 로 시작하면 된다(티켓에 전부).
3. **TRIP-1248 ③ 마무리** (로컬 전용 자료 있음) — #1690 의 12곳이 개발·운영 DB 에서 LOST 됐는지 확인하고 티켓을 닫는다. 12곳 content_id 는 TRIP-1248 마지막 코멘트·`/Users/juna/dev/trippilot/handoff-artifacts/ai-d1-poi-retire/retire_12.json`. **보류 83곳**(법정동 조회 #1350 뒤 깨끗한 회차 4회 미만)은 같은 스크립트(`rewind_evidence.py`·`clean_lists.py`·`retire_set.py`)로 재판정. 인허가 OPEN 은 빼지 않는다.
4. **TRIP-1232**(`openingHoursKnown` 이 원문만 있으면 true) — 내 티켓. 선행 TRIP-827(승윤님 담당)에 추천 (a) "확정 뒤에도 값 유지"를 댓글로 남김. 최소 경로: 수집 때 'AI 가 영업시간을 실제로 읽었나' 표식을 제안 DTO 기본값 칸 + 마이그레이션 + SlotSurface getter 로(같은 PR 에 BE 와이어 기본값).
5. **사용자 몫** — [사용자 손이 필요한 일 — 10-30](https://claude.ai/artifact/AqZLYdkEonM1EN4MRP7k5d): 두 번째 관광공사 키(TOUR_API_KEY2 403, data.go.kr) · 네이버 로그인 빌드 값 `EXPO_PUBLIC_NAVER_URL_SCHEME` · TRIP-1677 시작. 상황 감지 세션의 「내가 할 일」 페이지에 합친다.
6. **`ai/ARCHITECTURE.md` §3** — 폴더 정리 세션의 `orchestrator`·`domain`·`llm_gateway` 하위폴더 재배치가 끝나면 패키지 지도 반영(그 세션이 재배치 PR 에서 직접 고쳐도 됨). 구조·흐름이 바뀌는 PR 은 이 문서를 같이 고친다.

## 함정 / 주의
- **사용자 결정**(재제안 금지): 구를 고르면 구 안 우선·모자라면 이웃 구(시도는 안 가림) · 찾는 중심 4가지 + 기본 자동 · 꼭 갈 곳 시각은 조립이 먼저, 사용자가 바꿀 수 있다(숙소 제외) · 결정이 필요한 것은 웬만하면 추천안대로 진행, 사용자 손이 필요한 것은 문서·사이트로 띄운다.
- `districtCodesOf` 는 **정확 일치**다 — POI 코드는 `RegionResolver` 가 행정구를 상위 시로 접어 붙인다(펼치기 재도입 금지).
- 공유본 퇴출 규칙: 목록 부재 4회+ ∧ 되감기 상세 빈 응답(레포츠 28 제외), 14·38 은 원문 없이 영업시간만 오는 응답과 구별 안 되면 제외, 인허가 OPEN 은 남긴다. 실행 단위로 세면 #1350 뒤 완전한 회차가 0이라 (지역,타입) 목록 단위로 센다.
- frontend-ci 의 codegen 드리프트 게이트: openapi 를 바꾸면 `pnpm codegen` + `structure-index --write` 생성물을 같이 커밋. 새 칸을 required 로 두면 앱 픽스처가 깨진다.
- 롤백 배포 때 옛 공유본이 새 POI 를 덮는 캐빗은 배포 담당(trippilot-f7)이 우선순위 낮음으로 받아 둠.
- 다른 세션에 보낸 메시지는 상대가 승인 모드면 사용자 승인 전까지 보류되고 만료될 수 있다 — 중요한 건 Jira 티켓에 다 적어 두고 키로 시작하게 한다.
