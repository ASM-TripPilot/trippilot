---
session: 8e5af015-cf40-4f45-ae35-dfeb7fa59221
area: root
cwd: .
branches_seen: [develop, feat/assistant-open-search, feat/planb-open-search, fix/replan-day-window, fix/replan-consistency-memory, feat/replan-memory-wire, chore/kb5-overview-final, chore/overview-collect-manual-only, fix/fe-structure-map-drift]
current_branch: 없음(모두 머지·삭제, 작업트리 미커밋 없음)
span_kst: "11-02 → 11-09"
ended_by: user-close (사용자가 세션을 닫음)
status: 확인-대기
resume_local: "claude --resume 8e5af015-cf40-4f45-ae35-dfeb7fa59221"
related_prs: [1681, 1703, 1771, 1793, 1888, 1892, 1925, 1939, 1964, 1965, 1969, 1970, 1982, 1983]
tickets: [TRIP-1740, TRIP-1782]
session_name: PlanB RAG·KB-5·열린 검색·다시 짜기 일관성 세션(trippilot-7f)
handed_to:
  - "trippilot-79(상황 감지·다시 짜기 시각 세션) — 아래 1~5"
  - "trippilot-3b(도우미 세션) — 아래 6"
picked_up_by: "claude-code trippilot-3b 2026-11-09 01:33 KST — 6(열린 검색 운영 켜기: 개발 5일 14건 판정 뒤 배포 담당에 운영 스위치 요청) · 1~5(79 도 닫혀 7f 요청으로 함께)"
---
# 다시 짜기 일관성·요청 기억과 KB-5 열린 검색 — 코드는 다 운영, 남은 것은 실사용 확인과 백로그

## 목적
- PlanB(다시 짜기) RAG 품질과 KB-5 장소 문서 커버리지를 넓혔다.
- 운영 신고 4건(11-04, 다시 짜기)을 고쳤다: 09시 고정, 다른 날 지정 무시, 방문 수 급감, 앞 요청 소실.
- 사용자 요청으로 "쿼리와 비슷한 문서를 찾는" 열린 검색(BM25 + KURE 임베딩 RRF)을 도우미 탐색과 다시 짜기 후보에 넣었다.

## 이 세션이 머지한 것
| PR | 내용 | 운영 |
|---|---|---|
| #1703 · #1970 | KB-5 관광공사 개요 증분 → **35,524곳·57,685조각**(관광공사 장소 99.1%). 적재 Job "기적재 40163 건너뜀 · 17522 적재" 확인 | 반영 |
| #1969 | 개요 수집 정기 실행 제거(수동 실행만) | 반영 |
| #1892 | KB-3 상황 원칙을 구성 프롬프트(0.10.0)에 — 쌍대 판정 46:20 | 반영 |
| #1925 | 도우미 탐색 열린 검색 — **SQL 행이 있으면 SQL 먼저, 반경 답에만 문서 순위를 섞음**(실 NL2SQL 쌍대 판정에서 SQL 대신 쓰는 전환은 4:5, p=1.0 이라 철회) | **스위치 off**(개발만 on) |
| #1939 | 다시 짜기 후보 순위에 같은 검색 — 쌍대 판정 42:20(p≈0.008), 같은 스위치 `TRIPPILOT_KB5_OPEN_SEARCH` | **스위치 off**(개발만 on) |
| #1964 (BE) | 다시 짜기 창 시작 = min(여행 설정 시작, 그날 원 일정의 남은 첫 슬롯), 수리 창도 같은 출처 | 반영 |
| #1965 | 방문 수 보존(구성 실패 폴백도 원 일정 필수), 같은 날 앞 요청 기억 근사, 추출 0.5.0 `places[].day`, 구성 앞 준비 겹치기, 찾음/읽음 보고 | 반영 |
| #1982 (AI+BE 와이어) | `requested_poi_ids`→세션 저장→`prior_requests`(이름으로 집은 곳까지 기억), `deferred_places`(다른 날 장소 → 앱 `deferredPlaces`), **BE 가 AI 에 여행 기간을 보냄**(#1965 의 다른 날 판정이 이것 없이 운영에서 한 번도 안 돌았다), 옛 AI 파드 422 면 그 칸 빼고 1회 재시도, 다시 짜기 문서 질의 임베딩 미리 시작 | 반영 |
| #1983 | FE 구조 지도 합계 drift(#1982 리베이스 부산물) | 반영 |

## 멈춘 지점 (11-09)
- 코드는 전부 운영에 있다. 11-06 운영 실회차 3번에서 확인한 것:
  - `replan_memory_source: prior_requests=1→2` 가 찍혀 기억이 돌았다.
  - `compose_left` 는 13~14s 였다(종전 실패 회차 7.8s).
  - 구성 상한이 원 일정 수(10)까지 올라갔다.
  - 임베딩 호출은 24h 22건 모두 200 이었다.
- **"2일차에" → `nl_place_other_day`·`deferredPlaces` 는 운영에서 아직 한 번도 안 찍혔다**(그 말을 쓴 다시 짜기가 없었다).
- 열린 검색 개발 표본은 30h 3건뿐이었다: 도우미 TIMEOUT 474ms·OK 439ms, 다시 짜기 TIMEOUT 1,166ms. 개발 스택 문서 단계가 로컬(p50 150ms)보다 3~8배 느리다. 다시 짜기 warm 은 #1982 로 들어갔고 그 뒤 표본은 아직 없다.
- 앱: 다른 날 안내 버튼 TRIP-1782(FE 세션 진행 중), 사진 3유형 TRIP-1740(frontend-6e 진행 중) — 둘 다 FE 몫.

## 다음에 이어서 할 일
1. **[79] 사용자가 다시 짜기를 돌렸다고 하면 운영 로그로 확인한다**(로컬 전용). `gh workflow run aws-dev-logs.yml --ref develop -f source=cloudwatch -f since=6h -f namespace=trippilot -f component=all -f 'pattern=replan|place_search'`. 볼 것은 다섯 가지다.
   - AI `replan_window {"time_window": …}`: 06:00 설정 여행이면 06:00~
   - BE `replan notes:` 의 `replan_memory_source`, `nl_place_other_day`
   - `stage_ms: compose_left`(10s 미만이면 구성 타임아웃 위험)
   - `compose_docs_unread`
   - `replan_nl_window`(79 #2013)
2. **[79 · 백로그] 저녁에 여는 곳(클럽)이 든 하루는 첫 방문이 11:00 으로 늦게 잡힌다.** 조립 B단계 재정렬(`ortools_assembler._reorder`, 거리 우선 사전식 + 식사창 유지)이 원인이고 생성과 공유하는 코드라 wiring 만으로 못 고친다. 사용자가 "6시 시작인데 늦게 시작"으로 다시 볼 수 있는 모양이다.
3. **[79 · 백로그] 구성이 고른 곳을 조립이 못 놓아 폴백되는 `composed_unplaced`** — 운영 10-13~11-04 6건(10-14 ×5·10-23 ×1, 운영 폴백 전수 세션 수치).
4. **[79 · 백로그] 프리필터 카테고리 몫(하루 상한×4=12석, 60석)이 6번째 이하 카테고리를 0 으로 자른다** — 원 일정은 F-4 로 보호되지만 새 후보 다양성에는 남는다. 생성과 공유하는 값(TRIP-1183)이라 다시 짜기 전용 플래그로 시작하고 종로·부산 덤프로 회귀를 잰다.
5. **[79 · 확인 대기] 자유입력 "전부 다른 곳으로 새로 짜줘" + 구성 실패면 원 일정을 지킨다** — "다시 맞춰줘"와 가를 결정론 신호가 없어서다. 바꾸려면 추출에 의도 칸이 필요하고(프롬프트 A/B), 사용자에게 아직 묻지 않았다(U4 BR 에 '사용자 확인 대기'로 적힘).
6. **[3b] 열린 검색 운영 켜기 판단**(스위치 하나로 도우미·다시 짜기 둘 다). 순서:
   - 개발 `namespace=trippilot-dev` 에서 `place_search status=` 를 하루 이상 모은다. `trace=planb-` 면 다시 짜기, 아니면 도우미다.
   - OK 비율과 ms 를 본다. 도우미는 SQL 나란히일 때 0.4s 상한이라 TIMEOUT 이 나도 화면은 그대로다. 다시 짜기는 1s 상한이다.
   - OK 가 대부분이면 배포 담당(f7)에 `runtime_switches TRIPPILOT_KB5_OPEN_SEARCH=on` 을 운영 열차로 요청한다. TIMEOUT 이 많으면 상한 조정이나 임베딩 지연부터 본다.
   - **운영 ns 에서 이 줄을 세면 늘 0 이다**(스위치 off) — 한 번 헛짚었다.

## 함정 / 주의
- **기각·결정(재제안 금지)**:
  - '묘사형 말이면 SQL 행 대신 섞은 반경' 전환 — 실 NL2SQL 판정 4:5 로 철회(사용자 결정 "SQL 우선, 반경 안에서만 섞기").
  - 문서 검색 +8 후보·여행코스 가산은 효과 없음.
  - 관광공사 사진 3유형은 **11-02 에 이미 결정**됐다(자르지 않고 전체 + 출처 표시, TRIP-1740) — 11-05 에 실수로 다시 물었다.
- **판정 러너 함정**:
  - Claude 판정은 max_tokens 2000·판정 실패 따로·A/A 대조.
  - 한 팔 빈 목록(구성 실패)은 승패에서 뺀다(`measure_doc_quota` 가 '구성 실패'로 기록).
  - 결정론 대역(SQL 한 행)으로 잰 결론은 실 NL2SQL 에서 뒤집혔다.
- **와이어 배포 순서**: BE·AI 는 helm 한 번에 함께 롤링된다(AI 2파드, maxSurge 1). 새 요청 칸은 "새 응답 뒤에만 싣는다"로 못 닫는다 → #1982 는 422 재시도로 닫았다.
- **CI 결과를 공백 분리로 요약하지 말 것**: `test (checks)` 의 fail 을 놓치고 머지했다(#1982 → #1983). `gh pr checks N --json name,bucket` 으로 bucket 을 앞에 두고 센다.
- **다시 짜기 프롬프트**: 구성 0.10.0 은 측정 없이 바꾸지 않았다. 추출 0.5.0 은 haiku 20문장 비교에서 16 동일·4 는 day 만 달랐고 지어냄 0 이었다.
- 로컬 Anthropic 기본 키(운영 키 1번)는 11-04 워크스페이스 한도에 걸린 적이 있다. 유료 측정은 사용자 승인으로 2번 키를 썼다(키 값 비기록).
- 메모리(로컬): `replan-consistency-memory-1105`, `open-rag-hybrid-retriever`, `replan-shortlist-docs-decision`, `kb5-chunking-measured`.
