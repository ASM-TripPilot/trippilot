r"""도우미 장소 탐색 열린 검색(KB-5 문서 순위, `place_search` + `hybrid_rank`) — 결정론 측정(LLM 0, 승인 불필요).

실행(ai/ 에서 — 로컬 서빙 임베딩 컨테이너만 부른다, 실 LLM·외부 API 0):
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 uv run python scripts/measure/measure_assistant_open_search.py
    EVAL_CASES=서울/비,제주/비 … 로 사례를 고른다(이름 앞부분 일치). 결과 JSON 은 `EVAL_OUT` 경로에도 쓴다.
  쌍대 판정(2단계 — **유료, 실 Claude 호출이라 사용자 승인 뒤에만**. 키는 환경 변수로만 받는다):
    ANTHROPIC_API_KEY=… TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 uv run python \
        scripts/measure/measure_assistant_open_search.py judge [반복=1]     # EVAL_JUDGE_MODEL(기본 claude-sonnet-5)·EVAL_WORKERS
    팔 짝 A-B(본 비교)·B-B3. **자리 일관성 대조** — 짝마다 두 자리(목록 A/B 로 보이는 쪽)를 다 묻고, 두 판정이 같을 때만 승패·같음으로
    센다. 자리를 바꾸자 바뀐 판정(`position_flip`)이 판정의 흔들림, 낱판에서 첫 자리가 이긴 수(`first_wins` 대 `second_wins`·`position_p`)가
    자리 편향이다 — B 는 이 흔들림보다 확실히 이겨야 켠다. 결과 JSON 에 짝마다 승패·같음·흔들림·판정 실패(`judge_fail` — 0 이 아니면
    승패로 읽지 말 것)·부호 검정 p. 두 목록이 같은 사례는 판정하지 않는다(`identical`). 종전 A-A(같은 목록 두 개)는 A 가 결정론이라
    판정자가 바이트까지 같은 목록을 받아 흔들림이 0 근처로만 나왔다(리뷰 2026-11-04 — 선례 KB-5 A/B 의 흔들림은 선택 LLM 몫이었다).
    **판정이 닿는 범위**: A 는 반경 규칙 순서다 — SQL 실패·0건 턴·일정 근처·이어 받은 지역·추천(반경이 먼저)에서 B 가 바꾸는 답이다.
    SQL 이 행을 내는 지역 앵커 탐색(운영 — DIALOGUE_SQL 배정)에서 B 가 바꾸는 답은 A 가 아니라 SQL 행이라, A-B 판정은 그 분기를 켤
    근거가 아니다. 그 분기는 SQL 팔을 더한 판정(SQL-B)이 먼저다 — 아래 `capture-sql` 고정본을 `EVAL_SQL_ROWS` 로 주면 judge 가 그 행을
    운영 핸들러로 되돌려 SQL 팔을 짓는다(`sql_answer`). 고정본이 없으면 SQL 대역(`_SqlRows`)은 "행이 있었다"만 흉내 내는 가짜 한 행이라
    SQL 답의 질을 재지 않는다. SQL 이 실패·0건이거나 거르기 뒤 빈 행인 사례는 반경이 답이므로 SQL 팔 없이 A-B 로 센다(`radius_answer`).
    판정 입력에는 사용자가 말한 지역(분류 인자 원문)과 장소마다 위치(시·도 시·군·구)를 싣는다 — 반경은 지역 중심 반경(서울은 시청 5km)이라
    도심으로 좁아지고 SQL 행은 시·도 전체에서 온다(조건 2a). SQL-B 는 스위치가 실제로 B 를 고른 사례만(`SQL-B@switch`)·doc_backed 별로
    (`SQL-B@doc_backed`)도 낸다 — 문턱 `dialogue_handlers._DOC_SWITCH_MIN` 을 고르는 재료다.
  실 NL2SQL 고정본(유료 — 실 Claude 호출, 사용자 승인 뒤에만. 키는 환경 변수로만, 로컬 백엔드 DB 는 읽기 전용 연결·문장 시한):
    ANTHROPIC_API_KEY=… uv run python scripts/measure/measure_assistant_open_search.py capture-sql <scratchpad>/sql_rows.json
    운영 경로 그대로(`PlaceSqlLookup` + 운영 프롬프트·출구 게이트 `DialogueSqlGate` + 실행기 `PgPlaceSql`, ai_user 롤 — EVAL_PLACE_DB_URL).
    모델은 EVAL_SQL_MODEL, 없으면 정본(.env.example)의 DIALOGUE_SQL 배정, 정본에 없으면(2026-11-04 지금 — 운영 시크릿에만 있다) 도우미
    기능(DIALOGUE_*) 한 모델(claude-haiku-5-5, 티어 LIGHT). 게이트가 열린 탐색만 부른다(추천·닫힌 말은 스위치가 답을 안 바꾼다). 행마다
    원천 키·태그를 붙여 둔다(EVAL_POI_DB_URL — 판정 참고 설명이 반경 목록과 같은 자료로 붙게). 시한은 15s 로 풀고 2.8s 넘은 사례를 센다.
  지연(LLM 0, 승인 불필요): `latency [반복=3]` — 게이트가 열린 사례의 탐색 작업을 스위치 꺼짐/켜짐 나란히, 문서 단계(검색기 `search`)를
    따로 p50/p95. 로컬 벡터 DB(EVAL_VECTOR_DB_URL, 기본 localhost:5433 ai_kb)에 KB-5 조각이 범위의 95% 이상 있을 때만 실 `PgVectorStore`
    로도 잰다 — 아니면 적재 수만 보고하고 인메모리만(적재는 하지 않는다).

**무엇을 재나.** 운영 핸들러가 짓는 순서(규칙 정렬 `_explore_rank`)에 KB-5 문서 순위를 섞었을 때 **명백한 오답**이 줄어드는가.
판정 LLM 없이 코드가 셀 수 있는 것만 센다 — 비·실내를 물었는데 야외(자연·야경·액티비티 분류·'야외' 태그), 북카페를 물었는데 카페가
아닌 곳, 아이 동반을 물었는데 술집. 그 밖의 사례는 순서가 얼마나 바뀌는지(겹침 @3·@5)·문서 보유율만 본다.

**팔**: A 현행(규칙 정렬 — 반경 분기의 현행 답. SQL 이 행을 내는 분기의 현행 답은 SQL 행이다) · B 규칙+문서 RRF(키워드 근거 문턱,
`hybrid_rank.fuse` — 질의의 이름 낱말이 이름에 든 곳이 앞) · B1 문서만(근거 있는 곳을 문서 순위로 앞에, 나머지 규칙
순서) · B3 임베딩만·문턱 없음(게이트도 없이 말 그대로 질의 — 2026-11-02 다시 짜기 '문서 몫' #1796 의 실패 재현 대조).
**변수**: 문서 무게 w ∈ {0.5, 1.0} · 게이트 G1(속성 낱말은 게이트를 안 연다)/G2(연다) · 질의 Q1(분류 theme)/Q2(지역을 뺀 발화).

**재료**는 운영과 같다 — POI 는 공유본(`measure_kb5_overview._pois`, 관광공사 contentid 를 source_ref 로), 풀은 운영 풀 조립
(`CandidatePoolBuilder(StaticPoiDb, M7Config)` — 지역 표 중심·반경), 정렬·자르기는 운영 함수(`dialogue_handlers._explore_rank`), 문서는
리포의 미리 계산 벡터(범위 조각만 `InMemoryVectorStore` 에 싣는다) + 질의만 로컬 KURE. B(w=1.0·G1·Q1)는 운영 핸들러
(`HANDLERS[...]` + `HandlerPorts.place_search`)로도 한 번 더 돌려 직접 계산과 같은지 대조한다(`e2e_mismatch` 0 이어야 한다).
그 대조는 SQL 미배정(= SQL 실패·0건) 분기다 — **운영 분기**(DIALOGUE_SQL 배정, SQL 이 행을 낸다)는 SQL 대역(`_SqlRows`, 고정본이 있으면
실 행)을 붙여 한 번 더 돌려, 열린 검색 순서가 답에 닿는지(`reach`)·같은 SQL 행에서 스위치가 답을 바꾸는지(`switch`)를 센다. 지연은 `latency`.

**5회차(2026-11-04 — 도우미 오케스트레이터·NL2SQL 담당 세션의 BR-AO-27 개정 동의 조건 반영, 44사례)**:
- 조건 1 — 반경이 SQL 행을 이기려면 보일 다섯 곳(종류 상한·보인 곳 제외 뒤) 중 문서 순위가 붙은 곳이 `_DOC_SWITCH_MIN`(3) 곳 이상
  (`doc_backed`, 반경 작업 결과에만 — Facts 밖). doc OK 30턴의 doc_backed 분포 1:2 · 2:3 · 3:7 · 4:8 · 5:10 — 1~2곳뿐인 턴(`thin_doc`) 5
  (서울/공예3·강릉/바다카페·강릉/비·인천/차이나·겨눔/성수북카페). 그래서 운영 분기에서 답에 닿는 사례가 28 → 26(서울/공예3 은 추천이라
  반경이 먼저 — 그대로 닿는다). 오답이 준 비 넷(서울·부산·제주·경주, doc_backed 3·5·5·5)은 그대로 닿는다. 오답 수 모든 팔 그대로(A 16 ·
  B 9 · B0.5 13 · B1 9 · B3 8), `e2e_mismatch` 0, 대조군 바이트 동일.
- 조건 2b — 태그 대조군 셋(태그/강릉주차카페는 속성 낱말뿐이라 게이트가 닫힌다 · 태그/부산아이실내·태그/제주반려견카페는 열리고 운영 분기에
  닿는다). 상위 다섯 곳의 태그 적중(`tag_hits`)은 A·B 모두 0 — 반경 풀 상위에 '주차'·'아이동반' 태그가 든 곳이 없다. SQL 팔은 고정본 뒤에 본다.
- 조건 3 — `latency`(인메모리, 게이트 열린 30사례 × 3): 탐색 작업 꺼짐 p50 70·p95 87ms → 켜짐 161·282ms, 문서 단계 p50 88·p95 192·최대
  264ms, 운영 시한 초과 0. 로컬 벡터 DB 의 poi_desc 컬렉션은 통문서 위키 1,470행뿐이고 조각은 0/53,716 이라 pgvector 는 못 쟀다.
  (종전 註 "인메모리 전수 스캔은 수천 조각에 수 초"는 이 측정과 맞지 않는다 — 2,077조각 사례도 0.2s 대)

**2026-11-04 규칙 변경(사용자 결정 "묘사형 말이면 열린 검색 우선", BR-AO-27 개정·BR-AO-36)** — 아래 '닿는 범위'는 변경 **전** 값이다.
이제 탐색도 SQL 과 나란히 열린 검색을 돌리고, 문서 순위가 실제로 섞이면(doc OK) 반경 결과가 SQL 행을 이긴다(리뷰 뒤 조건 둘 — 아래
4회차) — `prod_reach` 는 B 가 답을 바꾼 사례 전부가 된다. 변경 뒤 6사례 재측정(EVAL_CASES=서울/비,부산/비,제주/비실내,경주/비,대조/서울,
서울/공예3): SQL 분기에서 닿는 비 탐색 0/4 → **4/4** — 그 넷에서 B(오답 1)가 운영 분기 답이 된다. 바뀌기 전 그 분기의 답은 A(오답 9)가
아니라 SQL 행이었고, SQL 행의 오답은 재지 않았다(대역은 가짜 한 행). 대조/서울은 게이트가 닫혀 SQL 분기 그대로, `e2e_mismatch` 0.
쌍대 판정(`judge`)은 반경 분기 쪽 켜기 근거다(위 '판정이 닿는 범위').

**4회차(2026-11-04 리뷰 반영 — 41사례 전체, 공유본 112,161건)**: 갱신된 공유본에서도 3회차 숫자 그대로 시작했다(오답 A 16 · B 9 · B0.5 13 ·
B1 9 · B3 8, `e2e_mismatch` 0, 대조군 바이트 동일). 바꾼 것 셋:
- SQL 이 이기는 조건(`_assemble_explore` — `_doc_beats_sql`): 말한 지역이 전부 표 이름이고("서울 연남동"은 반경 중심이 서울 시청이다) SQL 행
  이름에 질의의 이름 낱말이 없을 때만 반경이 이긴다("서울 전주비빔밥"의 '전주비빔밥 명동점'은 SQL 이 이름으로 맞춘 행이다). 게이트는 표에
  없는 고유명('전주비빔밥'·'명동교자'·'연남동'·'해리단길')에도 열린다. 대역 행 이름이 'SQL 행'이라 이 측정의 `reach` 는 28 그대로다.
- 융합의 이름 낱말 우선(`hybrid_rank.fuse(named=OpenQuery.names)`): 규칙 1위라도 문서가 없으면 1/61 이라 근거 있는 곳 거의 전부에 밀렸다.
  오답 수 모든 팔 그대로, 문서 보유율 B 0.77 → 0.71, A 와 겹침 @5 2.03 → 2.21. 이름 적중이 돌아온 곳: 전주/비빔밥(하숙영가마솥비빔밥이
  다섯 곳 밖 → 1위)·속초/생선구이(등대생선구이)·겨눔/성수북카페(놀숲북카페·북카페세모·서울북카페 센버스가 1~3위)·서울/비·강릉/비(이름에
  '실내'가 든 수영장·빙상장이 앞, 그 아래 미술관·회관). 버린 안 둘 — ① 규칙 적중 층 전체(태그 포함)를 섞기 위에: 오답 합은 9 그대로지만
  서울/북카페·겨눔/북카페·겨눔/성수북카페가 B = A 가 됐고('조용한'이 잇는 속성 태그 '분위기'가 든 식당·카페가 층을 채워 문서 순위가 아무것도 못 바꿨다)
  제주/아이는 '아이동반' 태그가 든 국숫집·핫도그집·카페 넷이 앞, 문서 보유율 0.64 · ② 이름 낱말에 속성 낱말까지: '아이'가 아이더 신제주점·루스트플레이스
  아이파크점·아이코히를 앞에 세웠다. 남은 것: 겨눔/북카페(종류 없음)는 이름에 '북카페'가 든 산책로('[북악하늘길 3산책로] 북카페~숲속다리')가
  1위로 왔다(오답 4 그대로), '거리'(인천/차이나)는 먹거리타운·해물탕거리에도 걸린다(A 의 규칙 적중도 같다),
  '차이나타운'의 '운'을 관형형 끝으로 떼 '차이나타'가 된다(`_ADJ_END`).
- 이어 묻기도 이번 턴 주제로 열린 검색을 돈다(측정 사례에는 이어 묻기가 없다 — 핸들러 시험으로 묶었다).

**2026-11-04 결정론 측정 결론 — 반경 분기에서 B 가 명백한 오답을 줄였다. 그러나 운영 분기에서 그 사례들에 닿지 않는다(아래 '닿는 범위')
→ 2단계(유료 쌍대 판정) 전에 닿는 범위부터 정해야 한다.** 41사례(도시 10 × 날씨·분위기·동반·주제·개수형 30 + 대조군 7 + 11-02 겨눔 4),
오답 판정이 있는 17사례:
- 오답 합계 A 16 → **B(w=1.0·G1·Q1) 9**(줄어든 사례 4 · 늘어난 사례 1) · B(w=0.5) 13(4 → 3 · 늘어남 0) · B1 문서만 9(늘어남 0) ·
  B3 임베딩만 8(늘어남 1 — 겨눔/제주비). 줄어든 몫은 거의 **비·실내**다 — 게이트가 열린 비 사례 7개에서 A 10 → B 2(서울: 낙산공원·
  북악스카이 팔각정 → 서울시립미술관·세종문화회관 · 부산: 광안리해수욕장·황령산 → 부산문화회관·카페). 아이 동반(술집)은 규칙 정렬이 이미
  나이트라이프를 빼 모든 팔이 0 — 이 판정으로는 아무것도 못 가른다.
- **늘어난 1건(겨눔/북카페, 종류를 안 정한 "조용한 북카페")은 반쯤 판정 탓이다** — B 가 올린 북파크라운지는 개요가 "프리미엄 북카페"인데
  분류가 CULTURE 라 오답으로 셌다. 진짜 오답은 서대문 안산(자연 — 개요에 "북카페와 전망지가 있는" 숲길)이다. 종류를 CAFE 로 받은
  "서울 조용한 북카페"·"성수 조용한 북카페"는 두 팔 모두 0 이고 B 만 순서가 바뀐다.
- **11-02 겨눔의 날씨 둘("비 오는 날" — 서울·제주)은 게이트가 닫혀 B = A** 다(묘사 낱말이 '비' 한 글자뿐). 고치려면 날씨 말 확장(비 →
  실내, 계획 8(d))이 따로 필요하다. B3 는 같은 말에 레인리포트 경리단(이름이 '비')·채석장 전망대를 올렸다 — 11-02 실패가 재현된다.
- **B3 는 오답 수만 낮고 쓸 수 없다** — A 와의 겹침 @5 0.29(B 2.03), 대조군 일곱의 순서를 전부 바꾼다(B·B1 은 대조군 바이트까지 같다).
- **문서 보유율**(상위 목록 중 KB-5 조각이 있는 곳) A 0.53 → B 0.77 · B1 0.80 · B3 1.00 — 근거 문턱 때문에 문서가 있는 곳만 오를 수
  있어서다(설계상 편향). 유료 판정은 두 팔 모든 장소에 같은 참고 설명을 주고 "설명 없음은 부적합이 아님"을 명시해야 한다(계획 3단계).
- **닿는 범위(운영 분기)**: 운영은 DIALOGUE_SQL 이 배정돼 지역 앵커 탐색(EXPLORE)에서 NL2SQL 이 나란히 돌고, 행이 있으면 SQL 행이 답이다
  — 그래서 그때는 열린 검색을 돌리지도 않는다(`_plan_explore`, 버려질 순서에 임베딩·pgvector 를 쓰지 않게). 열린 검색이 답을 바꾼 28사례
  중 SQL 행이 있는 분기에서도 답에 닿는 것은 **추천 4사례뿐**(서울/공예3·부산/국밥2·경주/한옥카페2·대구/비3 — 추천은 반경이 먼저다)이고,
  오답이 준 4사례(서울·부산·제주·경주 비, 전부 EXPLORE)는 하나도 닿지 않는다. 반경 분기가 답이 되는 것은 SQL 실패·0건 턴·일정 근처·이어
  받은 지역뿐이다. 2단계 전에 고를 것: SQL 이 0건인 비율을 재거나(유료 — 실 NL2SQL), SQL 행에도 문서 순위를 섞을지(설계 변경).
- **게이트**: G1·Q1 열림 28/34, 대조군 0/7, 열린 사례 중 NO_EVIDENCE 0(2-gram BM25 > 0 은 쉽게 찬다 — 문턱은 '근거 없음'을 가르지
  못하고 순위의 바닥 역할만 한다). G2 는 4사례를 더 연다(속성 낱말만 — 아이랑·바다 보이는·조용한 작업) — 오답 차이 0, 순서만 더 흔든다
  → **G1**. Q2(지역을 뺀 발화)는 '쉬고·싶어·가지' 같은 빈말이 낱말에 남아 Q1 보다 나을 것이 없다 → **Q1**. 무게는 **w=1.0**(0.5 는 비 오답을
  10 → 7 만 줄인다).
- **범위 크기**: 규칙 정렬을 지난 장소 p50 571 · p95 3,805, 그중 조각이 있는 곳 p50 122 · p95 541, 조각 id p50 268 · p95 2,077
  (대조군 넷을 더하기 전 37사례는 370 · 246) → `place_search.MAX_IDS` 2,100(측정 사례는 안 잘린다).
- **출처 충돌**: 관광공사가 아닌 POI 의 원천 id 가 관광공사 contentid 와 같은 경우 0. 조각 표에 제 id 로 든 Overture 66·카카오 16 은
  위키 수집이 그 장소 id 로 적재한 같은 장소의 문서다(`_collisions` 註).
- 운영 핸들러 대조 `e2e_mismatch` 0(41/41) · 코퍼스 조각과 벡터 머리 불일치 0.
- 1회차(2-gram 끝 떼기 전)와 G1·Q1 오답 수는 같았다(Q2 는 10 → 9). 바뀐 것은 판정 밖 사례의 순서다 — '산책하기'의 '하기'가 생선찜집 개요에 걸렸고
  ('강릉/숲길'), Q2 의 '오는데'가 빈말로 게이트를 열었다(`hybrid_rank._VERB_ENDS` 註).
- 3회차(리뷰 반영 — 종류 이름 2-gram 을 BM25 항에서 빼고, 요청 꼴·복수 '들'·끝 붙은 종류 낱말로 게이트가 열리던 것을 닫았다): 오답 수는
  모든 팔이 같다(A 16 · B 9 · B0.5 13 · B1 9 · B3 8). 바뀐 것은 북카페 세 사례의 순서뿐이다 — 근거 장소가 서울/북카페 45 → 3 · 겨눔/북카페
  99 → 12 · 겨눔/성수북카페 36 → 3 으로 줄었다(그전 근거는 거의 '카페' 2-gram 하나였다). 겨눔/북카페의 늘어난 1건은 그대로다 — 서대문 안산은
  개요에 '북카페'가 실제로 들어 '북카' 근거가 남고, 다른 근거가 빠지자 1위로 올랐다. 새 대조군 넷(핫플레이스·인기 많은·먹을 만한·관광지들)은 닫혀 B = A(바이트까지).
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from collections import Counter
from dataclasses import asdict, fields
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TRIPPILOT_EMBEDDING_BASE_URL", "http://localhost:8100")
if urlparse(os.environ["TRIPPILOT_EMBEDDING_BASE_URL"]).hostname not in ("localhost", "127.0.0.1"):
    raise SystemExit("결정론 측정은 로컬 임베딩 컨테이너만 쓴다 — TRIPPILOT_EMBEDDING_BASE_URL 을 localhost 로")

from measure_kb5_overview import _Knowledge, _pois  # noqa: E402
from measure_prompt_ab import _INDOOR_AVOID  # noqa: E402
from trippilot.agents.adapters.memory_vector_store import InMemoryVectorStore  # noqa: E402
from trippilot.agents.planb import place_search as ps  # noqa: E402
from trippilot.agents.planb.kb_retrieval import collection_for, retrieve  # noqa: E402
from trippilot.api.wiring import StaticPoiDb  # noqa: E402
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId, TraceId, TransportMode  # noqa: E402
from trippilot.domain.dialogue.intent import Intent  # noqa: E402
from trippilot.domain.kb import KbKind  # noqa: E402
from trippilot.domain.llm.llm import LlmFeature, ModelTier  # noqa: E402
from trippilot.domain.poi.poi import NIGHTLIFE_TAG, DataQuality, Poi, PoiCategory, PoiSource  # noqa: E402
from trippilot.domain.poi.poi_curation import CandidatePoolRequest  # noqa: E402
from trippilot.llm_gateway.adapters.caching_embedding import CachingEmbedding  # noqa: E402
from trippilot.llm_gateway.config import C1Config  # noqa: E402
from trippilot.llm_gateway.gates.dialogue.dialogue_sql import DialogueSqlGate  # noqa: E402
from trippilot.llm_gateway.gateway import GatewayFacade  # noqa: E402
from trippilot.llm_gateway.prompts import PromptRegistry  # noqa: E402
from trippilot.llm_gateway.workers.dialogue.dialogue_sql import DialogueSqlWorker  # noqa: E402
from trippilot.orchestrator.dialogue import dialogue_handlers as dh  # noqa: E402
from trippilot.orchestrator.dialogue.dialogue_handlers import (  # noqa: E402
    HANDLERS, HandlerPorts, TaskResult, TurnContext, TurnSnapshot,
)
from trippilot.orchestrator.dialogue.place_sql import PlaceSqlLookup  # noqa: E402
from trippilot.poi_curation import hybrid_rank as hr  # noqa: E402
from trippilot.poi_curation.adapters.pg_place_sql import PgPlaceSql, PlaceRow  # noqa: E402
from trippilot.poi_curation.chunking import chunk_corpus  # noqa: E402
from trippilot.poi_curation.config import M7Config  # noqa: E402
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder  # noqa: E402

_KST = timezone(timedelta(hours=9))
_NOW = datetime(2026, 11, 4, 11, 0, tzinfo=_KST)
_SNAP = TurnSnapshot(surface="HOME", trip=None, base_stays=(), itinerary_status=None, days=())
_EX, _RC = Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES
_CORPUS_FILES = ("place_corpus_overview.jsonl.gz", "place_corpus_wiki.jsonl.gz")

# (이름, 의도, 분류 인자, 발화, 오답 판정) — 인자는 분류가 낼 법한 꼴로 고정한다(분류가 묘사 낱말을 theme 에 남기는지는 2단계 유료 측정).
# 오답 판정: rain(비·실내 → 야외) · book(북카페 → 카페 아닌 곳) · kids(아이 동반 → 술집) · None(오답 기준 없음 — 순서 변화만 본다)
# · tag:<태그>(오답이 아니라 상위 목록에 그 태그가 든 수 `tag_hits` 만 센다 — 아래 태그 대조군)
CASES: tuple[tuple, ...] = (
    ("서울/비", _EX, {"region": "서울", "theme": "비 오는 날 실내"}, "서울 비 오는 날 실내 갈 만한 곳 알려줘", "rain"),
    ("서울/북카페", _EX, {"region": "서울", "category": "CAFE", "theme": "조용한 북카페"}, "서울 조용한 북카페 추천해줘", "book"),
    ("서울/아이", _EX, {"region": "서울", "theme": "아이랑 가기 좋은"}, "서울에서 아이랑 가기 좋은 곳", "kids"),
    ("서울/역사", _EX, {"region": "서울", "theme": "역사 체험"}, "서울 역사 체험할 곳", None),
    ("서울/공예3", _RC, {"region": "서울", "category": "CULTURE", "theme": "전통 공예 체험", "count": "3"},
     "서울 전통 공예 체험할 곳 세 군데 골라줘", None),
    ("부산/비", _EX, {"region": "부산", "theme": "비 오는 날 실내"}, "부산에 비 오는 날 실내로 갈 데", "rain"),
    ("부산/바다카페", _EX, {"region": "부산", "category": "CAFE", "theme": "바다 보이는 조용한"}, "부산 바다 보이는 조용한 카페", None),
    ("부산/시장", _EX, {"region": "부산", "theme": "전통 시장 구경"}, "부산 전통 시장 구경할 곳", None),
    ("부산/국밥2", _RC, {"region": "부산", "category": "FOOD", "theme": "돼지국밥", "count": "2"}, "부산 돼지국밥 두 곳만 골라줘", None),
    ("제주/비실내", _EX, {"region": "제주", "theme": "비 오는 날 실내 체험"}, "제주 비 오는 날 실내 체험할 곳", "rain"),
    ("제주/아이", _EX, {"region": "제주", "theme": "아이랑 체험"}, "제주에서 아이랑 체험할 곳", "kids"),
    ("제주/오름", _EX, {"region": "제주", "category": "NATURE", "theme": "오름 산책"}, "제주 오름 산책 추천", None),
    ("경주/신라", _EX, {"region": "경주", "theme": "신라 역사 유적"}, "경주 신라 역사 유적 보고 싶어", None),
    ("경주/비", _EX, {"region": "경주", "theme": "비 오는 날 실내"}, "경주 비 오는 날 실내 갈 만한 곳", "rain"),
    ("경주/한옥카페2", _RC, {"region": "경주", "category": "CAFE", "theme": "한옥 카페", "count": "2"}, "경주 한옥 카페 두 곳 골라줘", None),
    ("전주/한옥", _EX, {"region": "전주", "theme": "한옥 전통 체험"}, "전주 한옥 전통 체험", None),
    ("전주/비빔밥", _EX, {"region": "전주", "category": "FOOD", "theme": "비빔밥"}, "전주 비빔밥 맛집", None),
    ("전주/아이", _EX, {"region": "전주", "theme": "아이와 가볼 만한"}, "전주 아이와 가볼 만한 곳", "kids"),
    ("강릉/바다카페", _EX, {"region": "강릉", "category": "CAFE", "theme": "바다 전망"}, "강릉 바다 전망 카페", None),
    ("강릉/비", _EX, {"region": "강릉", "theme": "비 오는 날 실내"}, "강릉 비 오는 날 실내 놀거리", "rain"),
    ("강릉/숲길", _EX, {"region": "강릉", "theme": "산책하기 좋은 숲길"}, "강릉 산책하기 좋은 숲길", None),
    ("여수/해산물", _EX, {"region": "여수", "category": "FOOD", "theme": "해산물"}, "여수 해산물 맛집", None),
    ("여수/비", _EX, {"region": "여수", "theme": "비 오는 날 실내"}, "여수 비 오는 날 실내 갈 곳", "rain"),
    ("속초/생선구이", _EX, {"region": "속초", "category": "FOOD", "theme": "생선구이"}, "속초 생선구이 잘하는 곳", None),
    ("속초/아이", _EX, {"region": "속초", "theme": "아이랑 체험"}, "속초 아이랑 체험할 곳", "kids"),
    ("대구/근대", _EX, {"region": "대구", "theme": "근대 골목 역사"}, "대구 근대 골목 역사 여행", None),
    ("대구/작업카페", _EX, {"region": "대구", "category": "CAFE", "theme": "조용한 작업하기 좋은"}, "대구 조용히 작업하기 좋은 카페", None),
    ("대구/비3", _RC, {"region": "대구", "theme": "비 오는 날 실내", "count": "3"}, "대구 비 오는 날 실내 세 곳 추천", "rain"),
    ("인천/아이", _EX, {"region": "인천", "theme": "아이랑 가기 좋은 박물관"}, "인천 아이랑 가기 좋은 박물관", "kids"),
    ("인천/차이나", _EX, {"region": "인천", "theme": "차이나타운 근대 거리"}, "인천 차이나타운 근대 거리 구경", None),
    # 대조군 — 게이트가 닫혀야 한다(B = A, 바이트까지). 뒤 넷은 리뷰(2026-11-04)가 찾은 꼴 — 낱말 안 조각만 지워 남은 꼬리
    # ('레이스'·'많은'·'먹을')와 복수 '들'이 게이트를 열었다
    ("대조/서울", _EX, {"region": "서울", "theme": "가볼 만한"}, "서울 가볼 만한 곳", None),
    ("대조/부산", _EX, {"region": "부산", "category": "FOOD", "theme": "맛집"}, "부산 맛집", None),
    ("대조/제주", _EX, {"region": "제주", "category": "CAFE", "theme": "카페 추천"}, "제주 카페 추천", None),
    ("대조/핫플", _EX, {"region": "서울", "theme": "핫플레이스"}, "서울 핫플레이스 알려줘", None),
    ("대조/인기", _EX, {"region": "서울", "theme": "인기 많은"}, "서울 인기 많은 곳", None),
    ("대조/먹을", _EX, {"region": "부산", "category": "FOOD", "theme": "먹을 만한"}, "부산 먹을 만한 곳", None),
    ("대조/관광지", _EX, {"region": "제주", "theme": "관광지들"}, "제주 관광지들 알려줘", None),
    # 11-02 실패 겨눔(#1796 — 비 오는 날에 숭례문·용두암, 북카페에 라멘집)
    ("겨눔/서울비", _EX, {"region": "서울", "theme": "비 오는 날"}, "비 오는 날 서울에서 갈 만한 곳", "rain"),
    ("겨눔/제주비", _EX, {"region": "제주", "theme": "비 오는 날"}, "제주에 비 오는데 어디 가지", "rain"),
    ("겨눔/북카페", _EX, {"region": "서울", "theme": "조용한 북카페"}, "서울 조용한 북카페에서 쉬고 싶어", "book"),
    ("겨눔/성수북카페", _EX, {"region": "성수", "category": "CAFE", "theme": "조용한 북카페"}, "성수 조용한 북카페", "book"),
    # 태그 대조군(조건 2b, 2026-11-04) — 묘사에 태그 조건(주차·아이 동반·반려견)이 섞인 말. NL2SQL 은 태그 칸을 읽어 그 조건을 맞출 수 있어,
    # 반경이 SQL 행을 이기면 태그를 맞춘 행을 버리는 꼴이 된다(판정 SQL-B 짝에서 본다). 태그는 방문자 투표라 성기다 — 태그가 없다고 주차가
    # 안 되는 곳은 아니라 오답으로 세지 않는다. 반려견은 태그가 없어 순서만 본다
    ("태그/강릉주차카페", _EX, {"region": "강릉", "category": "CAFE", "theme": "주차 되는 조용한"}, "강릉 주차 되는 조용한 카페",
     "tag:주차"),
    ("태그/부산아이실내", _EX, {"region": "부산", "theme": "아이 동반 실내 놀거리"}, "부산 아이 동반 실내 놀거리", "tag:아이동반"),
    ("태그/제주반려견카페", _EX, {"region": "제주", "category": "CAFE", "theme": "반려견 동반 바다"}, "제주 반려견 동반 바다 카페", None),
)
_WRONG_KINDS = ("rain", "book", "kids")
VARIANTS = tuple((g, q) for g in hr.GATES for q in ("Q1", "Q2"))
WEIGHTS = (0.5, 1.0)
UNCAPPED = 10 ** 9


def _wrong(kind: str | None, p) -> bool:
    if kind == "rain":  # 이름이 실내라고 말하는 곳(실내수영장·실내암벽 — 분류는 액티비티)은 빼고 센다 — A 의 이름 적중이 오답으로 부풀지 않게
        return (p.category in _INDOOR_AVOID or "야외" in p.tags) and "실내" not in p.name
    if kind == "book":
        return p.category is not PoiCategory.CAFE
    if kind == "kids":
        return NIGHTLIFE_TAG in p.tags or p.category is PoiCategory.BAR
    return False


def _doc_first(rule: list, ranks: dict[str, int]) -> list:
    """근거 있는 곳을 그 순위로 앞에, 나머지는 규칙 순서 — B1·B3."""
    doc = sorted((p for p in rule if p.source_ref in ranks), key=lambda p: ranks[p.source_ref])
    return doc + [p for p in rule if p.source_ref not in ranks]


def _collisions(index) -> tuple[Counter, Counter]:
    """(우연한 겹침, 제 문서) — 관광공사가 아닌 출처 POI 의 원천 id 가 관광공사 contentid 와 같은 수(우연한 겹침 — 0 이 아니면 남의 문서가
    붙는다, 중단), 그리고 조각 표에 제 id 로 든 수(위키 수집이 Overture·카카오 장소를 그 id 로 적재했다 — 같은 장소의 문서라 정상).
    2026-11-04 확인: 제 문서 82건(Overture 66·카카오 16) 중 77건은 제목이 이름과 같고 나머지 5건도 같은 곳의 다른 이름(양재시민의숲 ↔
    매헌시민의숲 등)이다. 관광공사 id 는 최대 4,140,736 이고 카카오 id 는 숫자라 그 아래로 내려오면 겹칠 수 있다 — 이 수가 그 경보다."""
    doc = json.loads((_AI / "data/collected_pois.json").read_text(encoding="utf-8"))
    tour = {str(pr["provenance"]["content_id"]) for pr in doc["proposals"] if pr.get("source") == "TOURAPI"}
    accidental, own = Counter(), Counter()
    for pr in doc["proposals"]:
        ref = str((pr.get("provenance") or {}).get("content_id") or "")
        if pr.get("source") == "TOURAPI" or not ref:
            continue
        if ref in tour:
            accidental[pr.get("source")] += 1
        elif ref in index:
            own[pr.get("source")] += 1
    return accidental, own


def _turn(case, ports: HandlerPorts, tag: str, remaining_ms: int = 600_000) -> TurnContext:
    """사례 → 운영 핸들러에 넘길 턴. 시한은 기본 600s — 대조·고정본은 시한을 풀어 순서·행만 본다(지연·시한 초과는 `latency` 가
    따로 잰다)."""
    name, _, args, utt, _ = case
    return TurnContext(snapshot=_SNAP, arguments=args, now=_NOW, tz=_KST, trace_id=TraceId(f"{tag}-{name}"),
                       remaining_ms=lambda: remaining_ms, ports=ports, utterance=utt, heard=utt)


def _picked(cases=CASES) -> tuple:
    picks = tuple(filter(None, os.environ.get("EVAL_CASES", "").split(",")))
    return tuple(c for c in cases if not picks or c[0].startswith(picks))


class _SqlRows:
    """운영 분기 대역 — 운영 시크릿에는 DIALOGUE_SQL 이 배정돼 있어(`.env.example`) 지역 앵커 탐색은 NL2SQL 이 반경 탐색과 나란히 돌고, SQL 이
    행을 내면 탐색(EXPLORE)은 그 행을 쓴다(`_assemble_explore` — 11-04 부터 문서 순위가 섞인 탐색은 예외).
    실 LLM 없이 "행이 있었다"만 흉내 낸다 — 그 지역 시·도의 한 행."""

    writes_sql = True

    def __init__(self, sido: str | None) -> None:
        self._row = PlaceRow(poi_id="sql-row", name="SQL 행", category="명소", sido=sido or "", sigungu=None, trending=False,
                             nightlife=False)

    def lookup(self, utterance, arguments, trace_id, now, *, timeout_sec):
        return [self._row]


_ROW_FIELDS = tuple(f.name for f in fields(PlaceRow))
_KO_CATEGORY = {ko: code for code, ko in dh._CATEGORY_KO.items()}


class _Replay:
    """`capture-sql` 이 남긴 실 NL2SQL 행을 그대로 돌려준다(LLM·DB 0). `rows=None` 은 고정본에서 NL2SQL 이 실패한 사례 — 운영처럼 None 을
    돌려 반경으로 간다. 거르기(지역·밤·보인 곳·다섯 곳)는 핸들러(`_explore_by_sql`)가 운영 그대로 한다."""

    writes_sql = True

    def __init__(self, rows: list[dict] | None) -> None:
        self._rows = None if rows is None else [PlaceRow(**{f: d[f] for f in _ROW_FIELDS}) for d in rows]

    def lookup(self, utterance, arguments, trace_id, now, *, timeout_sec):
        return None if self._rows is None else list(self._rows)


def _row_poi(d: dict) -> Poi:
    """고정본 행(+ 원천 키·태그) → 판정용 Poi — 참고 설명(`_reference`, 원천 키로 찾는다)·사실 카드가 반경 목록과 같은 자료로 붙게."""
    return Poi(poi_id=PoiId(d["poi_id"]), name=d["name"], category=PoiCategory(_KO_CATEGORY.get(d["category"], "SIGHT")),
               coord=GeoPoint(0.0, 0.0), open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None, tags=tuple(d.get("tags") or ()), source_ref=d.get("source_ref"))


def sql_answer(case, entry: dict, builder) -> list[Poi] | None:
    """SQL 팔 — 고정본 행을 운영 핸들러로 돌려(스위치 꺼짐, 열린 검색 없음) 지금 운영이 내는 답. NL2SQL 이 실패·0건이거나 거르기 뒤 남은
    행이 없어 반경이 답이면 None — **그 사례는 반경이 답이므로 (A, B) 로 센다**(꺼짐 = A, 켜짐 = B). 추천은 반경이 먼저라 늘 None."""
    if case[1] is not _EX:
        return None
    ctx = _turn(case, HandlerPorts(pool_builder=builder, place_sql=_Replay(entry.get("rows"))), "sqlarm")
    handler = HANDLERS[case[1]]
    results = {t.name: TaskResult.ok(t.name, t.fn()) for t in handler.plan(ctx)}
    sql = results.get("explore_sql")
    if sql is None or not dh._candidates_if_ok(sql.value):
        return None
    facts = handler.assemble(ctx, results)
    rows = {d["poi_id"]: d for d in entry["rows"]}
    return [_row_poi(rows[p.poi_id]) for p in facts.places]


class _Corpus:
    """`_Knowledge` 의 코퍼스 행·미리 계산 벡터로 범위 조각만 스토어에 싣는다."""

    def __init__(self, kn: _Knowledge) -> None:
        self.kn = kn
        self.missing = 0

    def store(self, refs: list[str], ids: frozenset[str], model_id: str) -> InMemoryVectorStore:
        store, coll = InMemoryVectorStore(), collection_for(KbKind.POI_DESC, model_id)
        for name in _CORPUS_FILES:
            rows, vectors = self.kn.rows[name], self.kn.vectors[name]
            for d in chunk_corpus(rows[r] for r in refs if r in rows):
                if d.doc_id not in ids:
                    continue
                try:
                    store.upsert(coll, d.doc_id, vectors.vector(d.doc_id), d.payload())
                except KeyError:
                    self.missing += 1  # 코퍼스 조각과 벡터 머리가 어긋났다 — 적재 정합 문제(요약에 센다)
        return store


def _top(rank: list, intent: Intent, count: str | None) -> list:
    n = int(count) if intent is _RC and count in ("1", "2", "3", "4", "5") else dh.MAX_CANDIDATES
    return rank[:n]


def measure(case, builder, emb, corpus, index, keep: dict | None = None, sql: dict | None = None) -> dict:
    """`keep` 을 주면 팔별 상위 목록(Poi)을 거기 담는다 — 쌍대 판정(`judge`)이 같은 목록을 판정에 넘긴다. `sql`(고정본의 이 사례 몫,
    `capture-sql`)을 주면 운영 분기를 가짜 한 행(`_SqlRows`) 대신 실 NL2SQL 행으로 돌리고, 탐색이면 SQL 팔(`sql_answer`)을 `keep["SQL"]`
    에 담는다."""
    name, intent, args, utt, kind = case
    category, theme = args.get("category"), args.get("theme")
    ctx = _turn(case, HandlerPorts(pool_builder=builder), "m", 7000)
    anchor = dh._explore_anchor(ctx)
    pool = builder.build(CandidatePoolRequest(anchor=anchor.center, dates=(_NOW.date(),), budget=BudgetLevel.HIGH,
                                              transport=TransportMode.PUBLIC, radius_override_km=anchor.radius_km), _NOW)
    captured: list[list] = []
    a_rank = dh._explore_rank(pool.pois, category, theme, utt, fuse=lambda r: captured.append(list(r)) or r)
    rule = captured[0]

    def ranked(order: list) -> list:
        return _top(dh._explore_rank(pool.pois, category, theme, utt, fuse=lambda r: order), intent, args.get("count"))

    refs = [p.source_ref for p in rule if p.source_ref]
    all_refs, all_ids = ps.scope_ids(refs, index, UNCAPPED)
    scope_refs, ids = ps.scope_ids(refs, index, ps.MAX_IDS)
    order = {r: i for i, r in enumerate(scope_refs)}
    store = corpus.store(scope_refs, ids, emb.model_id)
    hits_of: dict[str, tuple] = {}

    def hits(text: str) -> tuple:
        if text not in hits_of:
            hits_of[text] = retrieve(KbKind.POI_DESC, text, emb, store, top_k=len(ids), item_ids=ids) if ids else ()
        return hits_of[text]

    night = dh._said_night(category, theme, utt)
    # 운영 `_open_query` 와 같은 조건(이어 묻기 사례는 없다) — SQL 미배정·SQL 실패/0건 분기다. SQL 이 행을 내는 분기는 아래 `prod`
    runs = anchor.kind in ("region", "itinerary") and not night
    kind_ko = dh._CATEGORY_KO.get(category or "")
    arms: dict[str, list] = {"A": _top(a_rank, intent, args.get("count"))}
    variants: dict[str, dict] = {}
    for gate, q in VARIANTS:
        text = theme if q == "Q1" else utt
        query = hr.open_query(text, kind_ko, generic=dh._GENERIC_WORDS, gate=gate) if runs else None
        tag = f"{gate}{q}"
        if query is None or not ids:
            status, ranks = ("CLOSED" if query is None else "EMPTY"), {}
        else:
            ranks = hr.doc_rank(hits(query.text), query.words, order)
            status = "OK" if ranks else "NO_EVIDENCE"
        variants[tag] = {"status": status, "evidence": len(ranks), "words": list(query.words) if query else []}
        for w in WEIGHTS:
            arms[f"B{w}/{tag}"] = ranked(hr.fuse(rule, ranks, w, named=query.names if query else ()))
        arms[f"B1/{tag}"] = ranked(_doc_first(rule, ranks))
    # B3 — 게이트·문턱 없이 말 그대로(질의 = theme 또는 발화 + 종류) 임베딩 순위만
    for q in ("Q1", "Q2"):
        raw = " ".join(x for x in ((theme if q == "Q1" else utt) or "", kind_ko or "") if x).strip()
        emb_ranks = hr.ranks(hr.embedding_scores(hits(raw)), order) if raw and ids else {}
        arms[f"B3/{q}"] = ranked(_doc_first(rule, emb_ranks))

    # 운영 경로 대조 — A(검색기 없음)·B(w=W_DOC, G1, Q1)를 핸들러 그대로 돌려 직접 계산과 같은지
    def e2e(searcher, place_sql=None) -> tuple[list[str], dict]:
        c = _turn(case, HandlerPorts(pool_builder=builder, place_search=searcher, place_sql=place_sql), "e2e")
        handler = HANDLERS[intent]
        results = {t.name: TaskResult.ok(t.name, t.fn()) for t in handler.plan(c)}
        return [p.name for p in handler.assemble(c, results).places], results["explore"].value

    t0 = time.monotonic()
    e2e_b, radius_b = e2e(ps.PlaceSearch(emb, store, index=lambda: index))
    e2e_ms = int((time.monotonic() - t0) * 1000)
    e2e_a, _ = e2e(None)
    expect_b = [p.name for p in arms[f"B{hr.W_DOC}/G1Q1"]]
    mismatch = (e2e_a != [p.name for p in arms["A"]]) + (e2e_b != expect_b)
    # 운영 분기(SQL 배정, 행 있음) — 열린 검색 순서가 답에 닿는가. 탐색은 문서 순위가 섞이고(doc OK) 보일 다섯 곳 중 `_DOC_SWITCH_MIN` 곳
    # 이상에 붙었을 때만 반경이 SQL 행을 이기고(BR-AO-27 개정), 추천은 반경이 먼저다. 고정본(`sql`)이 있으면 실 NL2SQL 행으로 돈다
    sido = dh.region_area(anchor.label)[0] if anchor.kind == "region" else None
    rows = _SqlRows(sido) if sql is None else _Replay(sql.get("rows"))
    prod_names, prod = e2e(ps.PlaceSearch(emb, store, index=lambda: index), rows)
    sql_off, _ = e2e(None, rows)  # 같은 SQL 행·스위치 꺼짐 — 켜짐 답과 다르면 스위치가 답을 바꾼 사례다

    if keep is not None:
        keep.update(arms)
    sql_arm = sql_answer(case, sql, builder) if sql is not None else None
    if keep is not None and sql_arm is not None:
        keep["SQL"] = sql_arm

    def stats(rank: list) -> dict:
        tag = kind[4:] if kind and kind.startswith("tag:") else None
        return {"names": [p.name for p in rank], "cats": [p.category.value for p in rank],
                "wrong": sum(_wrong(kind, p) for p in rank),
                "docs": sum(1 for p in rank if p.source_ref in index), "n": len(rank),
                **({"tag_hits": sum(tag in p.tags for p in rank)} if tag else {})}

    return {"name": name, "kind": kind, "group": name.split("/")[0], "anchor": anchor.label, "pool": len(pool.pois),
            "fits": len(rule), "scope_places": len(all_refs), "scope_ids": len(all_ids), "capped_places": len(scope_refs),
            "capped_ids": len(ids), "variants": variants, "arms": {k: stats(v) for k, v in arms.items()},
            "e2e_status": radius_b.get("doc"), "doc_backed": radius_b.get("doc_backed"), "e2e_ms": e2e_ms,
            "e2e_mismatch": mismatch, "changed": e2e_b != e2e_a, "prod_status": prod.get("doc"),
            "prod_doc_backed": prod.get("doc_backed"), "prod_reach": e2e_b != e2e_a and prod_names == expect_b,
            "switch": prod_names != sql_off, "sql_rows": None if sql is None else sql.get("status"),
            "sql_arm": None if sql_arm is None else stats(sql_arm)}


def _pct(values: list[int], p: float) -> int:
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p * (len(s) - 1))))] if s else 0


def _overlap(a: dict, b: dict, k: int) -> int:
    return len(set(a["names"][:k]) & set(b["names"][:k]))


def summarize(rows: list[dict], collisions: Counter, missing: int) -> dict:
    normal = [r for r in rows if r["group"] != "대조"]
    controls = [r for r in rows if r["group"] == "대조"]
    judged = [r for r in rows if r["kind"] in _WRONG_KINDS]
    arms = list(rows[0]["arms"])
    out: dict = {"cases": len(rows), "judged": len(judged), "collisions_non_tourapi": dict(collisions),
                 "corpus_vector_missing": missing, "e2e_mismatch": sum(r["e2e_mismatch"] for r in rows),
                 "e2e_status": dict(Counter(r["e2e_status"] for r in rows))}
    a_wrong = {r["name"]: r["arms"]["A"]["wrong"] for r in judged}
    out["wrong"] = {}
    for arm in arms:
        worse = [r["name"] for r in judged if r["arms"][arm]["wrong"] > a_wrong[r["name"]]]
        better = [r["name"] for r in judged if r["arms"][arm]["wrong"] < a_wrong[r["name"]]]
        out["wrong"][arm] = {"total": sum(r["arms"][arm]["wrong"] for r in judged), "better": len(better), "worse": worse}
    out["doc_share"] = {arm: round(sum(r["arms"][arm]["docs"] for r in rows) / max(1, sum(r["arms"][arm]["n"] for r in rows)), 3)
                        for arm in arms}
    out["overlap_vs_A"] = {arm: {"@3": round(sum(_overlap(r["arms"]["A"], r["arms"][arm], 3) for r in normal) / len(normal), 2),
                                 "@5": round(sum(_overlap(r["arms"]["A"], r["arms"][arm], 5) for r in normal) / len(normal), 2)}
                           for arm in arms if arm != "A"}
    out["gate_open"] = {}
    for gate, q in VARIANTS:
        tag = f"{gate}{q}"
        opened = [r for r in normal if r["variants"][tag]["status"] != "CLOSED"]
        out["gate_open"][tag] = {
            "cases": f"{len(opened)}/{len(normal)}",
            "controls": f"{sum(r['variants'][tag]['status'] != 'CLOSED' for r in controls)}/{len(controls)}",
            "no_evidence": f"{sum(r['variants'][tag]['status'] == 'NO_EVIDENCE' for r in opened)}/{len(opened)}",
            "empty": sum(r["variants"][tag]["status"] == "EMPTY" for r in opened),
        }
    out["controls_identical"] = {arm: all(r["arms"][arm]["names"] == r["arms"]["A"]["names"] for r in controls)
                                 for arm in arms if not arm.startswith("B3")}
    for key in ("fits", "scope_places", "scope_ids"):
        vals = [r[key] for r in rows]
        out[key] = {"p50": _pct(vals, 0.5), "p95": _pct(vals, 0.95), "max": max(vals)}
    out["capped_cases"] = [r["name"] for r in rows if r["capped_ids"] < r["scope_ids"]]
    # 열린 검색이 답을 바꾼 사례(SQL 미배정·실패 분기) 중 운영 분기(SQL 행 있음)에서도 그 순서가 답에 닿는 사례 — 측정 결론이 닿는 범위
    out["reach"] = {"changed": [r["name"] for r in rows if r["changed"]],
                    "changed_judged": [r["name"] for r in judged if r["changed"]],
                    "with_sql": [r["name"] for r in rows if r["prod_reach"]],
                    "with_sql_status": dict(Counter(str(r["prod_status"]) for r in rows))}
    out["max_ids"] = ps.MAX_IDS
    # 조건 1 의 재료 — 열린 검색이 섞였는데(doc OK) 보일 다섯 곳 중 근거가 1~2곳뿐인 턴. 문턱(`_DOC_SWITCH_MIN`)이 SQL 행을 지키는 사례다
    ok = [r for r in rows if r["e2e_status"] == "OK"]
    out["thin_doc"] = {"k": dh._DOC_SWITCH_MIN, "ok": len(ok), "thin": [r["name"] for r in ok if r["doc_backed"] in (1, 2)],
                       "doc_backed": dict(sorted(Counter(r["doc_backed"] for r in ok).items()))}
    b = f"B{hr.W_DOC}/G1Q1"
    out["tag_hits"] = {r["name"]: {arm: r["arms"][arm]["tag_hits"] for arm in ("A", b)}
                       | ({"SQL": r["sql_arm"]["tag_hits"]} if r["sql_arm"] else {})
                       for r in rows if (r["kind"] or "").startswith("tag:")}
    with_sql = [r for r in rows if r["sql_arm"]]
    if any(r["sql_rows"] for r in rows):  # 고정본(`EVAL_SQL_ROWS`)으로 돈 경우만 — 대역 한 행으로는 SQL 답의 질을 못 잰다
        out["sql"] = {"rows": dict(Counter(str(r["sql_rows"]) for r in rows)), "arm": [r["name"] for r in with_sql],
                      "switch": [r["name"] for r in with_sql if r["switch"]],
                      "wrong": {arm: sum((r["sql_arm"] if arm == "SQL" else r["arms"][arm])["wrong"]
                                         for r in with_sql if r["kind"] in _WRONG_KINDS) for arm in ("A", b, "SQL")}}
    return out


def main() -> None:
    dh._FANOUT_SQL_CAP_S = 120.0  # 위 `e2e` 註(문서 단계 시한은 `_fanout_left` 몫) — 측정 프로세스 안에서만
    t0 = time.monotonic()
    kn = _Knowledge()
    emb = CachingEmbedding(kn.emb)
    pois = _pois()
    builder = CandidatePoolBuilder(StaticPoiDb(tuple(pois)), M7Config())
    index = hr.chunk_index()
    collisions, own = _collisions(index)
    print(f"loaded pois={len(pois)} index_places={len(index)} chunks={sum(map(len, index.values()))} "
          f"accidental={dict(collisions)} own_docs={dict(own)} ({time.monotonic() - t0:.1f}s)", flush=True)
    if sum(collisions.values()):
        print("관광공사가 아닌 출처의 source_ref 가 관광공사 contentid 와 겹친다 — 출처 접두 조인이 먼저 필요하다(중단)")
        raise SystemExit(2)
    corpus = _Corpus(kn)
    captured = sql_capture()
    rows = []
    for case in _picked():
        t = time.monotonic()
        r = measure(case, builder, emb, corpus, index, sql=captured.get(case[0]))
        rows.append(r)
        a, b = r["arms"]["A"], r["arms"][f"B{hr.W_DOC}/G1Q1"]
        v = r["variants"]
        print(f"{r['name']:<14} fits {r['fits']:>5} scope {r['scope_places']:>4}곳/{r['scope_ids']:>5}조각 "
              f"G1Q1 {v['G1Q1']['status']:<11} G2Q1 {v['G2Q1']['status']:<11} G1Q2 {v['G1Q2']['status']:<11} "
              f"오답 A{a['wrong']} B{b['wrong']} B1 {r['arms']['B1/G1Q1']['wrong']} B3 {r['arms']['B3/Q1']['wrong']} "
              f"e2e {r['e2e_status']}·{r['e2e_ms']}ms{' MISMATCH' if r['e2e_mismatch'] else ''} "
              f"근거 {r['doc_backed']} SQL분기 {r['prod_status']}·{r['prod_doc_backed']}{' 닿음' if r['prod_reach'] else ''}"
              f"{' 바뀜' if r['switch'] else ''} ({time.monotonic() - t:.1f}s)", flush=True)
        for label, arm in (("A ", a), ("B ", b), ("B3", r["arms"]["B3/Q1"])):
            print(f"    {label}: " + " / ".join(f"{n}({c})" for n, c in zip(arm["names"], arm["cats"])))
        print(f"    낱말 G1Q1 {v['G1Q1']['words']} · G1Q2 {v['G1Q2']['words']}", flush=True)
    summary = summarize(rows, collisions, corpus.missing)
    summary["own_docs_non_tourapi"] = dict(own)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    out = os.environ.get("EVAL_OUT")
    if out:
        Path(out).write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")


# ── 실 NL2SQL 기준 팔(`capture-sql` — 유료, 실 Claude 호출이라 사용자 승인 뒤에만) ─────────────────────────────────────────────
# 운영 탐색에서 스위치를 켜면 바뀌는 것은 SQL 행이다(BR-AO-27 개정) — 판정의 SQL 팔은 운영 NL2SQL 경로(`PlaceSqlLookup` + 운영 프롬프트·출구
# 게이트 `DialogueSqlGate` + 실행기 `PgPlaceSql`)를 로컬 백엔드 DB(읽기 전용 연결·문장 시한)로 한 번 돌려 고정본으로 남긴다. 판정·결정론
# 측정은 그 행을 `_Replay` 로 되돌려 쓴다(LLM·DB 0). 게이트가 열린 탐색만 담는다 — 닫힌 말·추천은 스위치가 답을 바꾸지 않는다.
_SQL_DB = os.environ.get("EVAL_PLACE_DB_URL", "postgresql://ai_user:ai_user@localhost:5432/trippilot")  # 운영과 같은 롤(뷰만 읽는다)
_POI_DB = os.environ.get("EVAL_POI_DB_URL", "postgresql://postgres:postgres@localhost:5432/trippilot")  # 원천 키·태그(판정 참고 설명)
_READ_ONLY = "-c default_transaction_read_only=on -c statement_timeout=1500 -c search_path=app"
_SQL_BUDGET_MS = 2800  # 운영 NL2SQL 시한 상한(`dh._FANOUT_SQL_CAP_S`) — 고정본은 꼬리까지 받고 넘은 사례를 따로 센다


def _sql_model(env_example: Path = _AI.parent / ".env.example") -> str:
    """EVAL_SQL_MODEL, 없으면 정본(.env.example `AI_LLM_FEATURE_MODELS`)의 DIALOGUE_SQL 배정. 2026-11-04 정본에는 DIALOGUE_SQL 이 없다
    (그 파일 註 — 운영 시크릿에만 있고, 티어맵상 LIGHT). 그때는 정본의 도우미 기능(DIALOGUE_*) 배정이 한 모델로 같으면 그것(같은 티어·
    같은 턴 시한) — 갈리면 고르지 않고 멈춘다."""
    if os.environ.get("EVAL_SQL_MODEL"):
        return os.environ["EVAL_SQL_MODEL"]
    line = next(x for x in env_example.read_text(encoding="utf-8").splitlines() if x.startswith("AI_LLM_FEATURE_MODELS="))
    models = dict(pair.split("=", 1) for pair in line.split("=", 1)[1].split(",") if "=" in pair)
    if "DIALOGUE_SQL" in models:
        return models["DIALOGUE_SQL"]
    dialogue = {m for f, m in models.items() if f.startswith("DIALOGUE_")}
    if len(dialogue) != 1:
        raise SystemExit(f"정본에 DIALOGUE_SQL 배정이 없고 도우미 기능 배정도 갈린다 {sorted(dialogue)} — EVAL_SQL_MODEL 로 정한다")
    return dialogue.pop()


def sql_capture() -> dict[str, dict]:
    """`EVAL_SQL_ROWS` 고정본 → {사례 이름: 그 몫} — 행이 있거나(OK·ZERO) 실패한(NONE) 사례만. 없으면 빈 표(SQL 대역 한 행으로 돈다)."""
    path = os.environ.get("EVAL_SQL_ROWS")
    if not path:
        return {}
    cases = json.loads(Path(path).read_text(encoding="utf-8"))["cases"]
    return {name: entry for name, entry in cases.items() if entry["status"] in ("OK", "ZERO", "NONE")}


class _Recorded:
    """DIALOGUE_SQL 워커 감싸기 — 모델이 쓴 SQL·폴백 사유를 고정본에 싣는다(조회는 운영 `PlaceSqlLookup` 그대로)."""

    def __init__(self, worker: DialogueSqlWorker) -> None:
        self._worker, self.last = worker, None

    def write(self, *args, **kwargs):
        self.last = self._worker.write(*args, **kwargs)
        return self.last


class _Capturing(PlaceSqlLookup):
    """운영 조회 그대로 + 돌려준 행을 남긴다(핸들러는 거른 뒤 다섯 곳만 내놓는다 — 고정본은 거르기 전 행)."""

    rows: list[PlaceRow] | None = None

    def lookup(self, *args, **kwargs):
        self.rows = super().lookup(*args, **kwargs)
        return self.rows


def _enrich_db(rows: list[PlaceRow]) -> dict[str, tuple]:
    """{poi_id: (출처, 원천 키, 태그)} — `poi_public` 뷰에는 원천 키가 없어 표를 읽는다(읽기 전용). 판정 참고 설명이 원천 키로 붙는다."""
    import psycopg

    with psycopg.connect(_POI_DB, connect_timeout=2, options=_READ_ONLY) as conn, conn.cursor() as cur:
        cur.execute("SELECT poi_id::text, source, source_ref, tags FROM app.poi WHERE poi_id = ANY(%s::uuid[])",
                    ([r.poi_id for r in rows],))
        return {r[0]: r[1:] for r in cur.fetchall()}


def _row_doc(row: PlaceRow, extra: dict[str, tuple]) -> dict:
    source, ref, tags = extra.get(row.poi_id, (None, None, ()))
    # 카카오 숫자 id 는 관광공사 id 와 공간이 겹쳐 원천 키로 쓰지 않는다(`_pois` 와 같다)
    return {**asdict(row), "source_ref": None if source == "KAKAO_LOCAL" else ref, "tags": list(tags or ())}


def capture_sql(out: Path, *, llm=None, executor=None, enrich=_enrich_db, cases=None) -> dict:
    """사례마다 운영 NL2SQL 경로를 돌려 행을 `out`(JSON)에 남긴다. `llm`·`executor`·`enrich` 는 시험용 주입 — 비우면 실 Claude(키는
    환경 변수로만)·로컬 백엔드 DB. 시한은 꼬리까지 받으려고 15s 로 풀고(운영 2.8s) 사례마다 걸린 시간을 싣는다."""
    model = _sql_model()
    if llm is None:
        if not model.startswith("claude"):
            raise SystemExit(f"고정본 모델은 Claude 만 — {model!r} (EVAL_SQL_MODEL)")
        if not os.environ.get("ANTHROPIC_API_KEY"):  # 환경 변수로만 — 파일·로그인 프로필에서 읽지 않는다
            raise SystemExit("ANTHROPIC_API_KEY 환경 변수가 없다 — 고정본은 실 Claude 호출이다(사용자 승인 뒤에만)")
        from measure_prompt_ab import _llm

        llm = _llm(model)
    if executor is None:
        import psycopg

        executor = PgPlaceSql(lambda: psycopg.connect(_SQL_DB, connect_timeout=2, options=_READ_ONLY))
    cfg = C1Config(model_ids={t: model for t in ModelTier}, feature_models={LlmFeature.DIALOGUE_SQL: model})
    from measure_prompt_ab import _NullTrace

    worker = _Recorded(DialogueSqlWorker(GatewayFacade(llm, PromptRegistry(_AI / "prompts"), DialogueSqlGate(), cfg, _NullTrace())))
    saved, dh._FANOUT_SQL_CAP_S = dh._FANOUT_SQL_CAP_S, 15.0
    got: dict[str, dict] = {}
    try:
        for case in cases if cases is not None else _picked():
            name, intent, args = case[:3]
            lookup = _Capturing(worker, executor)
            ctx = _turn(case, HandlerPorts(place_sql=lookup), "sql")
            anchor = dh._explore_anchor(ctx)
            if intent is not _EX or anchor is None or dh._open_query(ctx, anchor, args.get("category"), args.get("theme")) is None:
                got[name] = {"status": "SKIPPED"}  # 추천(반경이 먼저)·게이트 닫힘 — 스위치가 답을 안 바꾼다
                continue
            task = next((t for t in HANDLERS[intent].plan(ctx) if t.name == "explore_sql"), None)
            if task is None:
                got[name] = {"status": "SKIPPED", "reason": "no_sql_task"}
                continue
            worker.last = None
            t0 = time.monotonic()
            task.fn()  # 운영 핸들러 작업 그대로 — 조회 인자(종류 한글명)·시한 구성까지
            ms = int((time.monotonic() - t0) * 1000)
            rows, result = lookup.rows, worker.last
            extra = enrich(rows) if rows else {}
            got[name] = {"status": "NONE" if rows is None else "ZERO" if not rows else "OK", "ms": ms,
                         "sql": result.value if result is not None else None,
                         "error": result.error if result is not None else None,
                         "rows": None if rows is None else [_row_doc(r, extra) for r in rows]}
            print(f"{name:<16} {got[name]['status']:<4} rows {len(rows or ())} {ms}ms", flush=True)
    finally:
        dh._FANOUT_SQL_CAP_S = saved
    version = __import__("yaml").safe_load((_AI / "prompts/dialogue_sql.yaml").read_text(encoding="utf-8"))["version"]
    doc = {"model": model, "prompt_version": version, "captured_at": datetime.now(_KST).isoformat(timespec="seconds"),
           "budget_ms": _SQL_BUDGET_MS, "cases": got,
           "over_budget": [n for n, e in got.items() if e.get("ms", 0) > _SQL_BUDGET_MS],
           "status": dict(Counter(e["status"] for e in got.values()))}
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: doc[k] for k in ("model", "prompt_version", "status", "over_budget")}, ensure_ascii=False))
    return doc


# ── 지연(`latency` — LLM 0, 승인 불필요) ─────────────────────────────────────────────────────────────────────────────
# 게이트가 열린 사례의 탐색 작업(풀 조립·정렬 + 문서 단계)을 스위치 꺼짐/켜짐 나란히 잰다. 문서 단계 = 검색기 `search` 한 번(미리 시작한
# 질의 임베딩 기다림 + 스토어 검색 + BM25·RRF) — 운영 시한(팬아웃 몫 2.8s − 그때까지 쓴 시간 − 여유 0.35s)을 넘었으면 `over` 로 센다
# (측정은 시한을 풀어 끝까지 잰다). 임베딩은 캐시 없이 반복마다 다시 부른다. 스토어는 로컬 벡터 DB(pgvector)에 KB-5 조각이 범위의
# `_PG_MIN_COVER` 이상 적재돼 있을 때만 실 `PgVectorStore`, 아니면 적재 수만 보고하고 인메모리만 — 덜 적재된 DB 는 검색이 작아 빠르게 나온다.
# 적재는 하지 않는다
_VECTOR_DB = os.environ.get("EVAL_VECTOR_DB_URL", "postgresql://ai_kb:ai_kb@localhost:5433/ai_kb")
_PG_MIN_COVER = 0.95


def _pg_loaded(collection: str) -> frozenset[str] | str:
    """벡터 DB 에 실린 그 컬렉션의 item_id — 접속·조회가 안 되면 사유(예외 타입) 문자열."""
    try:
        import psycopg

        with psycopg.connect(_VECTOR_DB, connect_timeout=2, options="-c default_transaction_read_only=on") as conn, \
                conn.cursor() as cur:
            cur.execute("SELECT item_id FROM kb_vectors WHERE collection = %s", (collection,))
            return frozenset(r[0] for r in cur.fetchall())
    except Exception as e:  # noqa: BLE001 — 측정 도구: 사유만 보고하고 인메모리로 간다
        return type(e).__name__


def _ms(values: list[float]) -> dict:
    return {"p50": _pct([int(v) for v in values], 0.5), "p95": _pct([int(v) for v in values], 0.95),
            "max": int(max(values)) if values else 0, "n": len(values)}


def latency(reps: int) -> None:
    dh._FANOUT_SQL_CAP_S = 120.0  # 시한을 풀어 끝까지 잰다 — 운영 시한 초과는 `over` 로 센다
    kn = _Knowledge()
    emb = kn.emb  # 캐시 없이 — 반복마다 질의 임베딩을 다시 부른다(운영의 처음 보는 질의와 같게)
    builder = CandidatePoolBuilder(StaticPoiDb(tuple(_pois())), M7Config())
    index = hr.chunk_index()
    corpus = _Corpus(kn)
    collection = collection_for(KbKind.POI_DESC, emb.model_id)
    chunk_ids = frozenset(i for ids in index.values() for i in ids)
    opened = []
    for case in _picked():
        _, intent, args, utt, _ = case
        ctx = _turn(case, HandlerPorts(pool_builder=builder), "lat", 7000)
        anchor = dh._explore_anchor(ctx)
        if anchor is None or dh._open_query(ctx, anchor, args.get("category"), args.get("theme")) is None:
            continue
        pool = builder.build(CandidatePoolRequest(anchor=anchor.center, dates=(_NOW.date(),), budget=BudgetLevel.HIGH,
                                                  transport=TransportMode.PUBLIC, radius_override_km=anchor.radius_km), _NOW)
        rule: list = []
        dh._explore_rank(pool.pois, args.get("category"), args.get("theme"), utt, fuse=lambda r: rule.append(list(r)) or r)
        refs, ids = ps.scope_ids([p.source_ref for p in rule[0] if p.source_ref], index)
        opened.append((case, refs, ids))
    loaded = _pg_loaded(collection)
    need = frozenset().union(*(ids for _, _, ids in opened)) if opened else frozenset()
    have = need & loaded if isinstance(loaded, frozenset) else frozenset()
    cover = len(have) / len(need) if need else 0.0
    pg = {"collection": collection, "rows": len(loaded) if isinstance(loaded, frozenset) else loaded,
          "chunks_loaded": len(chunk_ids & loaded) if isinstance(loaded, frozenset) else 0, "chunks_total": len(chunk_ids),
          "whole_docs": sum("#" not in i for i in loaded) if isinstance(loaded, frozenset) else 0,
          "scope_ids": len(need), "scope_loaded": len(have), "cover": round(cover, 3), "measured": cover >= _PG_MIN_COVER}
    print(f"게이트 열린 사례 {len(opened)} · 벡터 DB {json.dumps(pg, ensure_ascii=False)}", flush=True)
    stores = {"memory": lambda refs, ids: corpus.store(refs, ids, emb.model_id)}
    if pg["measured"]:
        import psycopg

        from trippilot.agents.adapters.pgvector_store import PgVectorStore

        pg_store = PgVectorStore(lambda: psycopg.connect(_VECTOR_DB, connect_timeout=2,
                                                         options="-c default_transaction_read_only=on"))
        stores["pgvector"] = lambda refs, ids: pg_store
    else:
        print(f"pgvector 는 재지 않는다 — 범위 조각 {len(need)} 중 적재 {len(have)}(덮음 {cover:.1%} < {_PG_MIN_COVER:.0%}). "
              f"그 컬렉션 {pg['rows']}행 중 조각 {pg['chunks_loaded']}/{pg['chunks_total']} · 통문서 {pg['whole_docs']}", flush=True)
    report: dict = {"reps": reps, "cases": len(opened), "pgvector": pg}
    for kind, make in stores.items():
        off, on, doc, over, status = [], [], [], 0, Counter()
        for case, refs, ids in opened:
            searcher = ps.PlaceSearch(emb, make(refs, ids), index=lambda: index)
            real, started, probe = searcher.search, [0.0], []

            def timed(query, scope, wait_s, *, _real=real, _probe=probe, _started=started, **kw):
                t = time.monotonic()
                got = _real(query, scope, wait_s, **kw)
                _probe.append(((t - _started[0]) * 1000, (time.monotonic() - t) * 1000, got[0]))
                return got
            searcher.search = timed
            for _ in range(reps):
                for spot, port in ((off, None), (on, searcher)):
                    ctx = _turn(case, HandlerPorts(pool_builder=builder, place_search=port), "lat")
                    task = next(t for t in HANDLERS[case[1]].plan(ctx) if t.name == "explore")
                    started[0] = time.monotonic()
                    task.fn()
                    spot.append((time.monotonic() - started[0]) * 1000)
            for pre_ms, doc_ms, st in probe:
                doc.append(doc_ms)
                status[st] += 1
                over += doc_ms > _SQL_BUDGET_MS - pre_ms - dh._DOC_MARGIN_S * 1000
            print(f"  {kind:<8} {case[0]:<16} 조각 {len(ids):>5} 꺼짐 {int(sum(off[-reps:]) / reps):>6}ms "
                  f"켜짐 {int(sum(on[-reps:]) / reps):>6}ms 문서 {int(sum(d for _, d, _ in probe) / max(1, len(probe))):>6}ms", flush=True)
        report[kind] = {"off_ms": _ms(off), "on_ms": _ms(on), "doc_ms": _ms(doc), "over_budget": over, "status": dict(status)}
    print(json.dumps(report, ensure_ascii=False, indent=1))
    out = os.environ.get("EVAL_OUT")
    if out:
        Path(out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


# ── 쌍대 판정(유료 — 실 Claude 호출, 사용자 승인 뒤에만 돌린다) ──────────────────────────────────────────────────────────────
# 팔 짝: A-B(현행 대 섞인 순서 — 본 비교) · B-B3(섞인 순서 대 임베딩만 — 근거 문턱의 값). 두 목록이 같은 사례는 판정하지 않고
# `identical` 로 센다. **자리 일관성 대조** — 짝마다 두 자리(목록 A/B 로 보이는 쪽)를 결정론으로 모두 묻고, 두 판정이 같을 때만 승패·같음으로
# 센다. 자리를 바꾸자 판정이 바뀐 사례(`position_flip`)가 판정의 흔들림이고, 낱판에서 첫 자리가 이긴 수(`first_wins` 대 `second_wins`)가
# 자리 편향이다. 종전 A-A(같은 목록 두 개)는 대조가 못 됐다 — A 는 결정론이라 판정자는 바이트까지 같은 두 목록을 받고 프롬프트도 같으면
# '같음'이라 지시해, 흔들림·자리 편향이 0 근처로만 나와 '이것보다 확실히 이긴다'는 문턱이 사실상 0 이었다(KB-5 A/B 의 A-A 흔들림
# ≈12:7 은 선택 LLM 이 같은 입력에도 다른 목록을 냈기 때문이다, 리뷰 2026-11-04)
JUDGE = os.environ.get("EVAL_JUDGE_MODEL", "claude-sonnet-5")
JUDGE_ARMS = {"A": "A", "B": f"B{hr.W_DOC}/G1Q1", "B3": "B3/Q1"}  # 판정 이름 → `measure` 의 팔(B 는 운영 설정 w=1.0·G1·Q1)
# SQL-B — 운영 분기(SQL 이 행을 낸 지역 탐색)에서 스위치가 바꾸는 것은 A 가 아니라 SQL 행이다. SQL 팔은 `capture-sql` 고정본이 있는 탐색
# 사례에만 있고(`sql_answer`), 없는 사례(실패·0건·거르기 뒤 빈 행 — 반경이 답)는 (A, B) 로 센다. SQL-B 판정은 스위치가 실제로 B 를 고른
# 사례(`switch`)만 따로(`SQL-B@switch`)·doc_backed 별로(`SQL-B@doc_backed`)도 낸다 — 문턱 `_DOC_SWITCH_MIN` 을 고르는 재료
JUDGE_PAIRS = (("A", "B"), ("B", "B3"), ("SQL", "B"))
_NO_DOC = "설명 없음"


def _reference(kn: _Knowledge, p) -> str:
    """판정자용 참고 설명 — 두 목록에 똑같이: 관광공사 개요 → 위키 도입부 → '설명 없음'(대체 문서는 쓰지 않는다 — 열린 검색도 안 쓴다)."""
    for name in ("place_corpus_overview.jsonl.gz", "place_corpus_wiki.jsonl.gz"):
        row = kn.rows[name].get(p.source_ref or "")
        if row and row.get("sections"):
            return " ".join(row["sections"][0]["text"].split())[:400]
    return _NO_DOC


def _card(p) -> str:
    kind = dh._CATEGORY_KO.get(p.category.value, p.category.value)
    return f"분류: {kind} · 태그: {', '.join(p.tags) or '없음'}"


def _key(p) -> str:
    """같은 장소 — 원천 키(관광공사 contentid 등)가 있으면 그것. SQL 팔(백엔드 DB uuid)과 반경 팔(공유본 id)이 같은 곳을 다른 id 로 낸다."""
    return p.source_ref or str(p.poi_id)


def _where() -> dict[str, str]:
    """{공유본 poi_id: '시·도 시·군·구'} — 주소 앞 두 낱말. 판정자가 목록이 말한 지역의 어디에 몰렸는지 보게(조건 2a)."""
    doc = json.loads((_AI / "data/collected_pois.json").read_text(encoding="utf-8"))
    return {pr["poi"]["poi_id"]: " ".join(addr.split()[:2]) for pr in doc["proposals"]
            if (addr := (pr.get("provenance") or {}).get("address"))}


def judge_prompt(utterance: str, a: list, b: list, kn: _Knowledge, region: str | None = None,
                 where: dict[str, str] | None = None) -> str:
    """`region` = 사용자가 말한 지역 원문(분류 인자), `where` = {poi_id: 위치} — 반경 목록은 지역 중심 반경(서울은 시청 5km)이라 도심으로
    좁아지는데 SQL 행은 시·도 전체에서 온다. 그 차이가 판정자에게 보이게 말한 지역과 장소마다 위치를 싣는다(조건 2a)."""
    places: dict[str, object] = {}
    for p in (*a, *b):  # 두 목록의 모든 장소 — 같은 자료를 한 번씩(같은 곳이 두 팔에서 다른 id 면 먼저 나온 쪽)
        places.setdefault(_key(p), p)
    where = where or {}

    def show(items: list) -> str:
        return "\n".join(f"{i}. {p.name} ({dh._CATEGORY_KO.get(p.category.value, p.category.value)})"
                         for i, p in enumerate(items, 1)) or "(목록 없음)"

    def at(p) -> str:
        return f" · 위치: {where[str(p.poi_id)]}" if where.get(str(p.poi_id)) else ""

    refs = "\n".join(f"- {p.name} — {_card(p)}{at(p)} · 설명: {_reference(kn, p)}" for p in places.values())
    said = f"사용자가 말한 지역: \"{region}\" (장소마다 위치를 참고 자료에 적었다)\n" if region else ""
    return (
        f"여행자가 여행 도우미에게 이렇게 물었다: \"{utterance}\"\n{said}"
        "도우미가 보여 줄 장소 목록이 두 개 있다. 목록은 위에서부터 보이고, 앞 순서일수록 먼저 눈에 든다.\n\n"
        f"[목록 A]\n{show(a)}\n\n[목록 B]\n{show(b)}\n\n"
        f"[참고: 장소 사실 카드와 설명 — 두 목록 모두에 같은 자료]\n{refs}\n\n"
        "어느 목록이 이 요청에 더 잘 맞는지 고르세요. 기준: ① 요청의 묘사·조건에 실제로 맞는 곳이 앞에 있는가 "
        "② 요청과 어긋나는 곳(예: 비 오는 날에 야외)이 앞에 있지 않은가"
        f"{' ③ 사용자가 말한 지역에 맞는가' if region else ''}.\n"
        f"'{_NO_DOC}'은 자료가 없다는 뜻일 뿐 그곳이 부적합하다는 뜻이 아닙니다 — 분류·태그·이름으로 판단하고, 설명이 있다는 이유만으로 "
        "높이 치지 마세요. 목록 길이·문체는 보지 마세요. 두 목록이 같거나 우열이 없으면 \"같음\".\n"
        '답은 JSON 한 줄: {"winner": "A" 또는 "B" 또는 "같음", "why": "한 문장"}'
    )


def read_verdict(text: str, stop_reason: str | None) -> tuple[str | None, str]:
    """(승자 'A'·'B'·'=' 또는 None = 판정 실패, 까닭). **못 읽은 판정을 '같음'으로 삼키지 않는다** — 11-04 사고(KB-5 A/B: 사고가
    `max_tokens` 를 다 먹어 본문이 비었고 32판 전부 '같음'으로 세어졌다, `docs/conventions/anti-patterns.md`)."""
    if stop_reason != "end_turn":
        return None, f"판정 실패: stop_reason={stop_reason}"
    try:
        got = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError:
        return None, f"판정 실패: 파싱 {text[:80]!r}"
    winner = {"A": "A", "B": "B", "같음": "="}.get(str(got.get("winner", "")).strip()) if isinstance(got, dict) else None
    if winner is None:
        return None, f"판정 실패: winner {text[:80]!r}"
    return winner, str(got.get("why", ""))


def sign_test_p(wins: int, losses: int) -> float:
    """양측 부호 검정(같음·판정 실패 제외) — 이항(n, 1/2) 에서 min(승, 패) 이하가 나올 확률의 두 배."""
    n = wins + losses
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, k) for k in range(min(wins, losses) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def _ask_judge(client, prompt: str) -> tuple[str | None, str]:
    import anthropic

    try:
        # effort low + 2000 — 400 으로 두면 사고가 상한을 먹어 본문이 빈다(11-02 KB-5 A/B 1차). Claude 5 세대는 temperature 를 400 으로 거부한다
        out = client.messages.create(model=JUDGE, max_tokens=2000, output_config={"effort": "low"},
                                     messages=[{"role": "user", "content": prompt}])
    except anthropic.APIError as e:  # 호출 실패도 판정 실패로 센다 — 같음으로 접지 않는다
        return None, f"판정 실패: {type(e).__name__}"
    text = "".join(b.text for b in out.content if getattr(b, "type", None) == "text").strip()
    return read_verdict(text, out.stop_reason)


def tally(rows: list[dict]) -> dict:
    """짝마다 사례(이름·반복) 단위로 센다 — 두 자리 판정이 같을 때만 승패·같음, 자리를 바꾸자 판정이 바뀌면 `position_flip`(흔들림),
    한쪽이라도 못 읽었으면 `judge_fail`(0 이 아니면 승패로 읽지 말 것). 자리 편향은 낱판 단위 — 첫 자리(목록 A 로 보인 쪽)가 이긴 수 대
    둘째 자리가 이긴 수와 그 부호 검정 p."""
    out: dict = {}
    for left, right in JUDGE_PAIRS:
        pair = f"{left}-{right}"
        cases: dict[tuple, dict[bool, str | None]] = {}
        identical: set[tuple] = set()
        for r in (r for r in rows if r["pair"] == pair):
            key = (r["name"], r["rep"])
            if r["identical"]:
                identical.add(key)
            else:
                cases.setdefault(key, {})[r["flip"]] = r["winner"]
        first = sum((side == "left") != flip for got in cases.values() for flip, side in got.items() if side in ("left", "right"))
        second = sum(side in ("left", "right") for got in cases.values() for side in got.values()) - first
        whole = [got for got in cases.values() if len(got) == 2 and None not in got.values()]
        agreed = [got[False] for got in whole if got[False] == got[True]]
        lw, rw = agreed.count("left"), agreed.count("right")
        out[pair] = {"left": left, "right": right, "n": len(cases) + len(identical), "identical": len(identical),
                     "left_win": lw, "right_win": rw, "tie": agreed.count("="),
                     "position_flip": len(whole) - len(agreed), "judge_fail": len(cases) - len(whole),
                     "sign_p": round(sign_test_p(lw, rw), 4),
                     "first_wins": first, "second_wins": second, "position_p": round(sign_test_p(first, second), 4)}
    return out


def judge_jobs(built: list, repeat: int) -> list[tuple]:
    """(사례, 팔 목록, 왼팔, 오른팔, 반복, flip) — 짝마다 두 자리를 다 묻는다(자리 일관성 대조, `tally`). 팔이 없는 짝은 묻지 않는다
    — SQL 팔이 없는 사례(고정본 없음·SQL 실패·0건 — 반경이 답)는 SQL-B 없이 (A, B) 로만 센다."""
    return [(case, lists, left, right, rep, flip) for rep in range(repeat) for case, lists in built
            for left, right in JUDGE_PAIRS if left in lists and right in lists for flip in (False, True)]


def judge(repeat: int) -> None:
    """A(현행 반경 순서)·B(섞인 순서)·B3 상위 목록을 사례마다 결정론으로 만들고(위 `measure` 그대로 — 운영 핸들러 대조까지),
    판정 모델이 순서를 모른 채 짝마다 비교한다. 짝마다 두 자리(목록 A/B)를 모두 묻는다(자리 일관성 대조, `tally`). 판정 출력은 평가에만
    쓴다(학습 금지, 2026-09-08)."""
    if not JUDGE.startswith("claude"):
        raise SystemExit(f"판정 모델은 Claude 만 — EVAL_JUDGE_MODEL={JUDGE!r}")
    key = os.environ.get("ANTHROPIC_API_KEY")  # 환경 변수로만 — 파일·로그인 프로필에서 읽지 않는다
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY 환경 변수가 없다 — 판정은 실 Claude 호출이다(사용자 승인 뒤에만)")
    import anthropic

    from measure_prompt_ab import _run

    client = anthropic.Anthropic(api_key=key, max_retries=1)
    dh._FANOUT_SQL_CAP_S = 120.0  # `main` 註와 같다 — 운영 핸들러 대조의 시한만 푼다
    captured = sql_capture()  # 없으면 SQL-B 없이 A-B·B-B3 만
    kn = _Knowledge()
    emb = CachingEmbedding(kn.emb)
    builder = CandidatePoolBuilder(StaticPoiDb(tuple(_pois())), M7Config())
    index = hr.chunk_index()
    corpus = _Corpus(kn)
    where = _where()
    built, meta, mismatch = [], {}, 0
    for case in _picked():
        keep: dict = {}
        entry = captured.get(case[0])
        got = measure(case, builder, emb, corpus, index, keep, sql=entry)
        mismatch += got["e2e_mismatch"]
        lists = {k: keep[v] for k, v in JUDGE_ARMS.items()} | ({"SQL": keep["SQL"]} if "SQL" in keep else {})
        if "SQL" in keep:
            where.update({d["poi_id"]: " ".join(filter(None, (d["sido"], d["sigungu"]))) for d in entry["rows"]})
        built.append((case, lists))
        meta[case[0]] = {"doc_backed": got["prod_doc_backed"], "switch": got["switch"], "sql_rows": got["sql_rows"]}
        print(f"built {case[0]}{' +SQL' if 'SQL' in lists else ''}", flush=True)
    if mismatch:
        raise SystemExit(f"운영 핸들러 대조 불일치 {mismatch} — 판정할 목록이 운영 순서가 아니다(중단)")
    jobs = judge_jobs(built, repeat)

    def one(item) -> dict:
        _, (case, lists, left, right, rep, flip) = item
        name, utt = case[0], case[3]
        a, b = lists[left], lists[right]
        row = {"name": name, "pair": f"{left}-{right}", "rep": rep, "flip": flip,
               "identical": [_key(p) for p in a] == [_key(p) for p in b],
               "lists": {left: [p.name for p in a], right: [p.name for p in b]}, **meta[name]}
        if row["identical"]:
            return {**row, "winner": "=", "why": "두 목록이 같다 — 판정하지 않음"}
        shown = (b, a) if flip else (a, b)  # flip 이면 오른쪽 팔이 목록 A(첫 자리)로 보인다
        got, why = _ask_judge(client, judge_prompt(utt, *shown, kn, case[2].get("region"), where))
        side = None if got is None else "=" if got == "=" else ("left" if (got == "A") != flip else "right")
        return {**row, "winner": side, "why": why}

    rows = _run(one, jobs)
    sql_b = [r for r in rows if r["pair"] == "SQL-B"]
    with_arm = {case[0] for case, lists in built if "SQL" in lists}
    summary = {"judge": JUDGE, "repeat": repeat, "cases": len(built), "pairs": tally(rows),
               "SQL-B@switch": tally([r for r in sql_b if r["switch"]])["SQL-B"],
               "SQL-B@doc_backed": {k: tally([r for r in sql_b if r["doc_backed"] == k])["SQL-B"]
                                    for k in sorted({r["doc_backed"] for r in sql_b}, key=str)},
               # SQL 팔이 없는 탐색 — 고정본이 실패·0건이거나 거르기 뒤 빈 행이라 반경이 답이다. 그 사례는 (A, B) 로 센다
               "radius_answer": sorted(name for name, m in meta.items() if m["sql_rows"] and name not in with_arm)}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    for r in sorted(rows, key=lambda r: (r["pair"], r["name"], r["rep"], r["flip"])):
        mark = {"left": "<", "right": ">", "=": "=", None: "!"}[r["winner"]]
        print(f" {mark} {r['pair']:<5} {r['name']:<14} #{r['rep']}{'↔' if r['flip'] else ' '} {r['why']}")
    out = os.environ.get("EVAL_OUT")
    if out:
        Path(out).write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "judge":
        judge(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    elif mode == "capture-sql":
        if len(sys.argv) < 3:
            raise SystemExit("capture-sql <저장 경로.json> — 고정본을 쓸 scratchpad 경로를 준다")
        capture_sql(Path(sys.argv[2]))
    elif mode == "latency":
        latency(int(sys.argv[2]) if len(sys.argv) > 2 else 3)
    else:
        main()
