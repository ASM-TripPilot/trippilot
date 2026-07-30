# 2026-07-30 20260729-trip182-stay-search-states

> 이 파일은 옵시디언 개발로그의 축약본이다(볼트 없는 사람·MCP 실패 시 폴백). 상세는 `TripPilot/개발로그/2026-07-30 20260729-trip182-stay-search-states.md` 참조.

## 대상

**TRIP-182 [FE] e02 숙소 검색 상태 변형 5종 + SafeArea 이관**(US-STAY-10/11, 상위 TRIP-70·유닛 U1). TRIP-181이 만든 default 화면에 나머지 5개 얼굴(loading·empty·filter-zero·partial-failure·error)을 얹고 TRIP-181 이관 SafeArea 결함을 같은 파일에서 해소 — **e02가 이번 사이클로 완결**. 신규 프로덕션 5파일(핵심 4부품 196줄) + 편집 3파일(순증 568줄) + 신규 테스트 4·편집 1(37 red). 직전 사이클: `2026-07-29-20260729-trip181-stay-search-list.md`.

## 게이트·검증

- **⚠️ 자율 실행 사이클** — 사용자 위임 계약으로 게이트①·②를 오케스트레이터가 대리 승인(해시·red 로그·환경 지문은 원장에 그대로 기록, 생략된 것은 실시간 대화뿐). 이번 사이클만 예외로 게이트 노트에 전줄 주해도 문서로 남김.
- **게이트①-1** 자율 승인 — 테스트 5파일, red 37건(02a 예상과 정확 일치).
- **게이트②-1** 자율 승인 — 구현 8파일(신규5·편집3), 37건 green + 동결 13건 green 유지.
- **검증 n=1 PASS**(`04_qa-verifier_report_1_PASS.md`): 정적 검사 4/4 · 해시 6/6+8/8 일치(재제시 불필요) · 변경집합 자체도출=신고 일치 · red 소급 확인(stash 안전 처리) · 경계면 QA(openapi·INV-3) 클린. 구조 지도 불일치 5건 → scribe 이관, 이번 [기록]에서 해소(`structure-index.cjs --check` → OK 120행/120파일).
- **실기 스모크 n=1 PASS**(`04b_smoke_1_PASS.md`): 판정 4항목 전부 통과. SafeArea 결함 실기 해소 확인, 5상태+겹침 육안 확인, 03b W-1·W-2 수정이 실기에서 동작 확인. **⚠️ P1 어긋남 1건 신규 발견(미처리)** — filter-zero 배지 아이콘이 Figma(분홍)와 달리 먹색(`FilterSlidersGlyph`에 색 prop 없음) → 후속 티켓 P1 일괄분 이월.
- **적대적 리뷰(5-b)**: 차단 0 · 경고 4(W-1~W-4) · 참고 4(N-1~N-4). W-1·W-2·W-3·N-3 **처리(5-c)**, W-4 **부분 처리**(크래시만 봉합, 타입 좁히기는 별도 사이클), N-1·N-2·N-4 **미룸**(후속 티켓 후보). 스타일 지적 0%.
- **Ponytail**: 제안 3(아이콘 근사·버튼폭 분리·파일 분리) · 채택 0.

## 예상과 달랐던 것 (요지)

1. 동결 헬퍼(`getCardTestIds`)를 카드 0장 단언에 그대로 쓰면 영원히 통과 불가능한 계약이 됨을 4-b가 실측으로 발견 — `queryCardTestIds()` 신설(4-a/4-b 분할 가치 사례).
2. 오케 프롬프트가 `toHaveTextContent`를 "부분 포함"으로 반대로 주입 — 매처 실검증 의무가 잡음.
3. 03b가 자기 신고 누락 5건을 스스로 잡음(특히 정본이 콕 집은 `flexGrow` 함정에 대한 판단이 구현 노트에 없었던 것).
4. 부트스트랩 목 응답을 평면 형태로 주면 스플래시에서 조용히 멈춤 — 3필드 형태로 교정 후 딥링크 다상태 스모크 성립.

상세(설계 근거 11건·03b 8건 전문·정본 반영 A~D 근거·구조 지도 갱신·모델 배치·하네스 규칙 후보 3건)는 옵시디언 개발로그 참조.

## 다음에 이어서 할 일

- `/stays` 라우트가 여전히 `Stack.Protected` 밖 — TRIP-183 선행 조건 유지.
- P1 전면 픽셀 대조 누적 미실행(TRIP-181분 포함 6노드) + filter-zero 아이콘 색 수정 — 후속 P1 일괄 티켓.
- W-4 타입 좁히기(`reasons: [string, ...string[]]`) — 게이트①부터 여는 별도 사이클.
- 필터 UI(US-STAY-02)·목적지 없는 버튼 3개(register/region 라우트) — 별도 티켓, 디자인 선행 필요.
- 미상환 이해부채 18건/상한 10건 — 정리 세션 판단 계속 유예.
- `aidlc-docs/audit.md` append 여부 — 이번엔 지시대로 미기록, 오케 판정 필요(옵시디언 개발로그 "정본 반영" 절 참조).

## 관련

- 옵시디언 개발로그: `TripPilot/개발로그/2026-07-30 20260729-trip182-stay-search-states.md`
- 게이트①-1: `TripPilot/게이트/2026-07-30 20260729-trip182-stay-search-states 게이트①-1.md`
- 게이트②-1: `TripPilot/게이트/2026-07-30 20260729-trip182-stay-search-states 게이트②-1.md`
- 문제로그(신설): `TripPilot/문제로그/2026-07-30 getAllBy는 무매칭 시 throw — queryCardTestIds 신설 (TRIP-182).md` · `TripPilot/문제로그/2026-07-30 오케 프롬프트 주입 오류를 매처 실검증 의무가 잡았다 (TRIP-182).md` · `TripPilot/문제로그/2026-07-30 딥링크 다상태 실기 스모크 절차 지식 3건 (TRIP-182).md`
- 문제로그(갱신): `TripPilot/문제로그/2026-07-29 실기 스모크에서만 SafeAreaView 누락이 잡혔다 (TRIP-181).md`(해결로 갱신)
- 개념(신설): `TripPilot/개념/degraded (부분 저하).md` · `TripPilot/개념/filterZeroReasons (0건 사유).md` · `TripPilot/개념/스켈레톤 로딩.md` · `TripPilot/개념/판별 유니온.md` · `TripPilot/개념/ListEmptyComponent와 contentContainerStyle 짝.md`
- 작업 공간: `_workspace/20260729-trip182-stay-search-states/`

---

## 후속 (2026-07-30 08:13) — 사용자 판정 + 브랜치 상황

사용자 승인 발화: `1. 승인 2. 승인 다 진행시키고`

### ✅ P1-1 해소 — 게이트②-2 재제시

6-b 실기 스모크가 잡은 시각 결함(`filter-zero` 배지 아이콘이 Figma의 분홍이 아니라 먹색)을
**이번 사이클에서 고쳤다.** `FilterSlidersGlyph`에 `tone?: 'body' | 'primary'`를 더하고
(기본값 `body`라 기존 필터 칩 색 불변) `FilterZeroNotice`가 `tone="primary"`를 넘긴다 —
`WarningTriangleGlyph`가 이미 쓰던 형태를 그대로 따랐다(새 패턴 도입 0).

승인 해시가 박제된 뒤의 변경이라 **게이트②-2로 새 차수 재제시**하고 ②-1을 `무효(재제시됨)`로
표기했다. 커밋 `5a38757`. 검증 재통과(node 440/440 · integration 64/64 · tsc 0 · lint 0 errors),
실기 재확인 `smoke-8-filterzero-p1fix.png`(배지 분홍 + 칩 먹색 유지 동시 확인).

**교훈 — 심판 사정거리**: 이 결함은 jest 두 층 어디에도 안 걸렸다. 렌더 단언은 배지 서브트리의
`bg-primary-pale`(**배경**)만 보고 아이콘 색은 단언 대상이 아니며(원형 배지에 testID를 일부러
안 붙였다 — 마크업 구조를 테스트가 지시하지 않게), 글리프 색은 SVG `stroke` **속성**이라
className 스캔에도 안 걸린다. `*Glyphs.tsx`는 V1 raw hex 스캔에서 정당하게 제외돼 있다.
**실기 스크린샷이 유일한 심판이었다** — 6-b가 없으면 그대로 배포됐을 결함이다.

### ✅ `aidlc-docs/audit.md` 편차 승인

소급 append 하지 않는다. 사용자 지시가 "`frontend-components.md` 그 파일 외 `aidlc/` 쓰기 금지"
였고 그대로 따른 결과이며, TRIP-179(A1)·TRIP-181(D1~D3) 선례와 다른 처리임을 인지한 상태로
확정했다.

### ⚠️ 병행 작업 4커밋 — 충돌 0건, 그러나 스텁 근거 하나가 만료됐다

게이트②-1 커밋 이후 **이 세션 밖에서** 같은 브랜치에 4커밋이 landed했다:
`87a0a88`(TRIP-202 `/stays/search` 좌표 파라미터) · `bec17e4`(codegen 재생성 + 계약 가드) ·
`bd74f03`(TRIP-183 e00 지역 선택) · `9e5d375`(devlog).

- **충돌 0건** — 게이트②·① 승인 14파일 **어느 것도 건드리지 않았다**(diff 실측).
- **테스트 총량 증가는 그 작업분이다**(node 406→440 · integration 52→64). 6-a의 `PASS(406/52)`는
  불완전한 실행이 아니라 **그 시점의 정확한 기준선**이었다. 4번째 린트 경고(`registerRoute.ts`
  생성물)도 그 작업분이다. — **여러 세션이 한 브랜치를 공유할 때 "테스트 수가 왜 늘었나"를
  내 변경 탓으로 오진하지 않으려면 커밋 로그를 먼저 봐야 한다는 실측 사례다.**
- ⚠️ **스텁 근거 만료**: TRIP-183이 `src/app/explore/region.tsx`를 추가했다. empty 상태
  `지역 바꾸기`를 "정직한 스텁"으로 둔 근거가 *"목적지 라우트가 리포에 없다"*였는데 **이제
  존재한다.** 게이트②-1 §1 핵심 개념 6번의 서술도 이 시점부터 낡았다.
  → **후속 티켓 후보**: empty `지역 바꾸기` → `explore/region.tsx` 배선.

### 최종 커밋 3개 (미푸시)

- `07542d5` feat: e02 숙소 검색 상태 변형 5종 + SafeArea 이관 (TRIP-182) — 16파일
- `4d35ae6` docs: 밴드 맵 드리프트 3건 반영 (정본 반영 E) — 하네스 파일 1개(분리 커밋)
- `5a38757` fix: filter-zero 배지 아이콘을 Figma대로 분홍으로 (P1-1) — 2파일
