# ai/data — 의도 매칭 질문뱅크 데이터

`intent_question_bank.yaml`은 **v0.5 — seed 125(사람 전수 검수) + 증강 292(관문 통과 자동 채택) = 417문장**이다.
평가셋 `intent_eval_set.yaml` 도 검수를 마쳤다(v1.0, 87문장).
검수 절차: 의도별 문장을 사람이 확인 → 의도 간 경계 문장 제거 → 뱅크 편입 시 타 의도 엔트리와 유사도 ≥ 0.90 중복 검사 통과 필수 (intent-matching-design §3.3).

**증강분(§3.2 ②)은 전수 검수하지 않는다 — 관문에 걸린 것만 사람이 본다** (팀 결정 2026-09-14, §3.2 ②
"생성 후 사람 검수 필수"의 운용 변경). 수백 문장 전수 검수는 실행이 안 된다 — 직전 209줄 검수도 한계였다.
대신 `scripts/augment_bank.py` 의 관문 5종을 통과하고 margin ≥ 0.05 인 것만 자동 채택하고, 경계에 걸린 것만 올린다.
⚠️ 따라서 뱅크의 `reviewed: true` 는 **의도 그룹 단위 표시일 뿐 증강 문장 하나하나를 사람이 봤다는 뜻이 아니다.**
사람이 전수로 본 것은 seed 125 뿐이다. §3.2 ③ mined 는 아직 이 경로를 쓰지 않는다.
평가셋과는 **완전 분리**한다: 여기 실린 문장(및 그 augment 변형)은 평가셋에 절대 재사용하지 않는다 — leak 금지 (intent-matching-design §6).
의도 라벨 정본은 `orchestrator-delegation-design.md` §5 라우팅 테이블 (closed-set 13종, CONFIRM/CANCEL/UNDO 제외).

**검수 도구·기록**
- 기계 검사: `uv run python scripts/check_intent_bank.py` — 의도 간 유사도 ≥ 0.90 위반(§3.3)과 0.80~0.90 경계 후보를 뽑는다(임베딩만, LLM 0).
- 증강(§3.2 ②): `uv run python scripts/augment_bank.py --per-seed 3` → 제안 파일 `data/intent_bank_augment_<날짜>.yaml`,
  `--apply <제안파일>` 로 뱅크에 합친다(`--approve "문장a||문장b"` 로 검수 대기분을 함께 채택). **LLM 을 부른다 — 오프라인 전용이다.**
  관문 순서: 형태(빈 문자열·원문 동일·자리표시자 소실) → 같은 의도 중복 ≥`--dup` → 타 의도 ≥`--cross`(§3.3) →
  평가셋 leak ≥`--leak`(§6) → margin ≥`--auto-margin` 이면 자동 채택, 미만은 검수 대기.
- 평가셋: `intent_eval_set.yaml`(라벨 발화, 뱅크와 분리) — `scripts/trace_intents.py --eval` 이 §6 지표를 채점하고, 평가 문장이 뱅크(원문 + `{장소}` 등 자리표시자를 채운 변형)와 ≥ 0.90 이면 leak 로 경고한다.
- **평가셋으로 뱅크를 보강하지 않는다** — 평가 발화의 일반화형을 뱅크에 넣으면 그 항목의 회귀 판정이 무력화된다(§6). 뱅크 보강 근거는 개발용 발화(계측 30건 등)에서만 취한다.
- 2026-09-08 기계 검수 1차(TRIP-678): v0.2 기준 위반 0·경계 후보 23 → 경계 문장 3개 개작(추가 없음) → v0.3-draft 위반 0·경계 후보 17.
- **2026-09-14 증강(v0.5, TRIP-842)**: 375문장 생성 → 자동 채택 292 · 검수 대기 33 · 기각 50(같은 의도 중복 31 · 평가셋 leak 17 · 타 의도 2) → 417문장, 위반 0·경계 후보 47.
  **leak 17건은 게이트가 실제로 잡은 것이다** — 생성기는 평가셋을 본 적이 없는데도 평가 발화에 0.90 이상 붙는 문장을 만든다.
  ⚠️ **관문은 과거의 사람 판단을 못 본다.** v0.3 에서 사람이 `EDIT_SCHEDULE` seed 를 "저녁에 맛집 하나 넣어줘" → "저녁 일정에 식당 한 곳 추가해줘" 로
  고쳐 범위 밖 발화와의 유사도를 0.783 → 0.715 로 낮췄는데, 증강이 그 seed 에서 "저녁 계획에 음식점 하나 넣어주세요"(0.757) 등을 다시 만들어
  `t_mid` 를 도로 넘겼다 — 거절이던 발화가 확신 오답이 됐다. 폐기 표현 장부 / 같은 seed 변형 간 중복 문턱은 후속 결정 사항.
- **2026-09-13 사람 검수(v0.4)**: 121문장 전수 확인. 이동 4건(`GET_NEXT_SLOT` 3 → `SHOW_SCHEDULE`, `GENERATE_SCHEDULE` 1 → `REGENERATE`) · 제외 0 · `GET_NEXT_SLOT` 보강 4문장(후보 8개 중 평가셋 leak 1·저margin 3 기각) → 125문장, 위반 0·경계 후보 22. 평가셋은 라벨 이동 1·제외 1 → 87문장 v1.0.

**측정값을 읽을 때** — 평가 정확도는 실행마다 ±1 흔들린다. 2·3차가 LLM 이고, Claude(PARAPHRASE)도 `temperature 0` 에서 결정론이 아니다: 경계 발화 "이번 여행 회고 좀 만들어줘"를 3회 돌리면 득표율이 1.000 / 0.760 / 0.758 로 갈려 의도가 뒤집힌다(2026-09-13 실측). 그래서 **한 번 재고 "좋아졌다/나빠졌다"를 말하지 않는다** — 최소 2회 돌려 고정 오답과 유동 오답을 가른다. CI 게이트는 이래서 LLM 응답 기록·재생이 필요하다(§6, 후속 티켓).

---

## `collected_pois.json` — 수집본 팀 공유

AI 수집 파이프라인이 만든 **등록 제안 문서**를 팀이 같은 상태로 쓰기 위해 여기 둔다.

### 왜 DB 덤프·이미지가 아닌가

- **INV-1** — POI 등록 조건은 "수집 게이트를 통과했을 것"이다. DB 를 복사하면 게이트를 안 거친 행이 섞이고,
  게이트 규칙이 바뀌어도 그 데이터는 옛 판정을 유지한다.
- **정본 소유** — POI 정본은 backend C7 단독 소유다(PR #76). 덤프를 공유하면 정본이 둘이 된다.
- **리뷰** — JSON 은 diff 가 되고 볼륨은 안 된다. 갈라져도 아무도 모르는 상태를 만들지 않는다.

### 쓰는 법

```bash
# 1) DB·앱 기동 (마이그레이션·시드는 앱이 알아서 돈다)
docker compose up -d db
SPRING_PROFILES_ACTIVE=local ./backend/gradlew -p backend bootRun

# 2) 로그인해서 받은 액세스 토큰으로 넣는다 (몇 번 넣어도 행은 늘지 않는다)
curl -X POST http://localhost:8080/internal/pois/proposals \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     --data-binary @ai/data/collected_pois.json
```

응답은 접수·신규·갱신과 **탈락 사유별 집계**를 준다. 탈락이 있으면 그 사유가 곧 수집 쪽에 넘길 정보다.

### 갱신

`ai-poi-collect` 워크플로가 매일 KST 04:00 에 돌고 산출물을 artifact 로 남긴다(**보존 30일**).
**자동 갱신 (TRIP-392)**: ai-poi-collect가 매일 병합본을 `chore/poi-data-sync` 브랜치 PR로 올린다
(merge_pois_docs 멱등 병합 + 축소 가드) — 리뷰 후 머지만 하면 된다. 아래는 그 자동 경로가 막혔을 때의 수동 백업 절차다.

artifact 는 **실행 한 번 분량**이고 누적본은 어디에도 없다 — 최신 실행 하나로 갈아끼우면
앞선 실행에서만 나온 POI 가 조용히 사라진다. 그래서 갈아끼우지 말고 살아있는 artifact 를 모두 받아 **합친다**:

```bash
cd ai
for id in $(gh api repos/ASM-TripPilot/trippilot/actions/artifacts --paginate \
              -q '.artifacts[] | select(.name=="collected-pois" and .expired==false) | .id'); do
  gh api repos/ASM-TripPilot/trippilot/actions/artifacts/$id/zip > /tmp/poi-$id.zip
  unzip -oq /tmp/poi-$id.zip collected_pois.json -d /tmp/poi/$id
done
uv run python scripts/merge_pois_docs.py -o data/collected_pois.json /tmp/poi/*/collected_pois.json
```

같은 `content_id` 는 나중 수집분이 이긴다(재제안 = 변경 감지분). 실행별 stats 원문은
합본의 `merged_from` 에 그대로 남는다 — 합본 `stats` 는 합본에 대해 참인 것만 담는다.

`collect_state.json`(수집 커서)은 **여기 두지 않는다** — 워크플로가 전용 브랜치에 이미 영속한다.

### 이 파일의 출처

- `ai-poi-collect` 실행분의 **누적 병합본**이다 — 위 「갱신」의 TRIP-392 자동 PR 이 매일 병합해 올린다.
  병합하면 이전 합본이 `merged_from` 에서 1건으로 접히므로 "실행 N회 합본"으로는 세지 않는다
- **건수·비율은 여기 적지 않는다** — 매일 갱신되므로 산문에 박으면 반드시 낡는다(PR #388 규칙).
  정본은 파일 자신이고, 실행별 내역은 그 안의 `merged_from` 이다
- 사진(`provenance.image_url`) 보유율은 카테고리마다 다르고 **FOOD 가 가장 낮다**. 사진 없음은 탈락 사유가 아니라
  `quality` 를 PARTIAL 로 낮출 뿐이다(`collection_gate.py` 4·5단) — 편차는 수집 결과이지 게이트 결함이 아니다
- 스키마 정본: `ai/src/trippilot/poi_curation/sourcing/pipeline.py` 의 `to_output_document`

세려면:

```bash
# 규모·수집 시각·지역 수
jq '{schema_version, source, collected_at, stats, areas: (.area_codes|length)}' ai/data/collected_pois.json

# 카테고리별 사진 보유율
jq -r '.proposals[] | [.poi.category, (.provenance.image_url // "")] | @tsv' ai/data/collected_pois.json \
  | awk -F'\t' '{n[$1]++; if($2!="")w[$1]++} END{for(c in n) printf "%s %d %.1f%%\n", c, n[c], 100*w[c]/n[c]}'
```

---

## `planb_situation_kb.yaml` — Plan-B 상황 KB(KB-3) seed

**초안 v0.1 — 내용 검수 전.** "상황 → 대안 선택 지침" 문서로, PlanB RAG(TRIP-424)의
검색 컨텍스트가 된다. 구조 정본은 `agents/planb/kb_retrieval.py`의 `load_kb_documents`
(루트 `kb` 단일 라벨 · doc_id 유일 · text 필수), 어휘 정렬 근거는 파일 머리 주석 참조.

실 적재(멱등 upsert — 몇 번 실행해도 행이 늘지 않는다):

```bash
docker compose --profile full up -d ai-vectordb
TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \
OPENAI_API_KEY=... \
    uv run python scripts/load_kb.py
```

FakeEmbedding 적재는 스크립트가 거부한다 — 해시 벡터는 의미 유사도가 없어
"적재됐는데 검색이 엉터리"인 오염 상태가 된다. 실임베딩 검증은 `scripts/smoke_vector.py`.

---

## `collected_events.json` — 행사 저장소 (실행 배선본)

`ai-event-collect` 배치가 만드는 **행사 저장소 문서**다. POI 제안과 달리 백엔드에 넣지 않는다 —
행사는 POI 가 아니고(INV-1), AI 가 `EventProvider` 로 **직접 읽는** 런타임 자산이다.

정본은 `collect-state` 브랜치의 `collected_events.json`(배치가 매일 갱신). 여기 있는 것은
**컨테이너에 실어 보내기 위한 동봉본**이다 — `ai/Dockerfile` 이 `COPY data ./data` 로 담고,
compose 가 `EVENTS_STORE=data/collected_events.json` 으로 가리킨다.

```bash
# 갱신 — collect-state 정본을 그대로 떠온다 (합칠 것 없음: 배치가 누적·만료청소까지 한다)
git fetch origin collect-state
git show origin/collect-state:collected_events.json > ai/data/collected_events.json
```

### 알아둘 것

- **기동 시 1회 읽는다**(`JsonEventStore.__init__`). 파일을 갈아끼웠으면 컨테이너를 다시 띄운다.
- **누적본이 아니다.** 종료 +7일이 지난 행사는 배치가 물리 삭제한다(`EXPIRE_GRACE_DAYS`) —
  "지금 유효한 행사"의 스냅샷이라 오래 묵히면 비어 간다.
- **좌표 없는 행사가 다수다**(2026-08-22 기준 76건 중 54건이 `coord: null`). 좌표가 없으면
  근접 POI 부착 보너스에서 제외된다(`event_affinity.py`) — 목록에는 남지만 점수에는 안 붙는다.
- 끄려면 `.env` 에 `AI_EVENTS_STORE=` (빈 값). 미배선 = 행사 보너스 없이 기존 경로 그대로.

---

## `poi_business_status.json` — 음식점·카페 영업상태 (폐업 필터 근거)

수집 POI 를 **LOCALDATA 지방행정 인허가 데이터**와 대조해 뽑은 `{content_id → 영업상태·인허가일자}` 다.
수집 게이트 2단(실재)이 이 파일을 읽어 **폐업 업소를 후보에서 뺀다**.

### 왜 필요했나

2026-09-08 실측 — 수집분의 음식점·카페 7,837건 중 **210건(2.7%)이 폐업**이었다.
8년 전(2018-11)에 닫은 곳까지 후보 풀에 있었다. 좌표는 멀쩡하니 기존 실재 검사로는 안 걸린다.

### 갱신 (수동 — 자동 경로가 없다)

`localdata.go.kr` 은 **TCP 연결 자체가 막혀 있고**(국내 IP 에서도), data.go.kr 파일 다운로드는 로그인이 필요하다.
그래서 사람이 받아야 한다. 월 1회 `ai-business-status-reminder` 워크플로가 60일 넘으면 이슈로 알린다.

```bash
# 1) CSV 2건 내려받기 (합계 약 862MB)
#    전국일반음식점표준데이터  https://www.data.go.kr/data/15096283/standard.do
#    행정안전부_휴게음식점     https://www.data.go.kr/data/15006730/fileData.do
# 2) 매칭 (약 10초 — 294만 행을 스트리밍하되 우리 주소키에 걸리는 행만 담는다)
cd ai
LOCALDATA_DIR=<받은 경로> uv run python scripts/match_business_status.py
# 3) 갱신된 poi_business_status.json 만 PR
```

⚠️ **원본 CSV 는 커밋하지 않는다** (862MB). 산출물만 470KB 다.

### 매칭 규칙 (실측으로 정한 것)

주소를 문자열로 비교하면 매칭률이 **35.5%** 에 그친다 — 쉼표 뒤 상세주소·읍면 유무·층/동 표기가 다르기 때문이다.
`(시도, 시군구, 도로명, 건물번호)` **키로 뽑아 비교하면 83.3%** 가 된다.

주소가 같아도 **이름이 안 맞으면 붙이지 않는다**(실측 12.3%). 같은 건물의 다른 가게라, 붙이면 엉뚱한 가게의 폐업 여부를 가져온다.

## `overture/` — Overture Maps 수집 제안 (지역별)

TourAPI 단일 출처의 구조적 한계를 메우는 **두 번째 POI 출처**다 (TRIP-684).
경계 8종 중 유일하게 0건이던 **NIGHT_VIEW** 가 여기서 처음 채워진다.

실측(릴리스 `2026-08-19.0`, 한국 bbox, DuckDB + S3):

```
한국 POI          691,968건        TourAPI 수집분 18,607건의 37배
한글 이름         439,468 (63.5%)  로마자만 있는 건 제안하지 않는다
화이트리스트 통과   208,507건
  FOOD 130,760 · CAFE 45,309 · SIGHT 15,879 · SHOPPING 6,527
  NATURE 5,248 · CULTURE 4,060 · ACTIVITY 683 · NIGHT_VIEW 41
```

**ACTIVITY 는 TourAPI 가 더 강하다**(2,981 vs 683) — 덮어쓰지 말고 합칠 것.

### 왜 지역별 파일인가

전국 20만 건을 `collected_pois.json` 에 넣으면 14MB → 약 150MB 가 된다.
git 커밋·백엔드 수신·리뷰가 다 감당 못 한다. 그래서 광역 17개로 쪼갠다.
제주 실측: 7,960건 / 4.8MB.

⚠️ **공유본과 아직 합류하지 않았다.** `collected_pois.json` 은 백엔드
IT(`PoiProposalRealDocumentIT`)·`merge_pois_docs.py`·`match_business_status.py`·
`backend-ci.yml` 경로 필터가 물고 있어, 분할·합류는 그 넷을 함께 옮기는
별건이다.

### 갱신

```bash
uv run --with duckdb python scripts/collect_overture.py --out data/overture
uv run --with duckdb python scripts/collect_overture.py --areas 제주,부산
```

인증이 필요 없다(공개 S3). 좌표는 이미 WGS84 라 변환도 없다.
**월 1회 재수집이 필요하다** — 공개본은 최신 2릴리스(약 60일)만 유지된다.
`_RELEASE` 상수를 올려야 하며, 낡은 릴리스는 404 가 난다.

### 라이선스 — 출처 표시 의무가 있다

places 테마는 **CDLA Permissive 2.0** 이다. share-alike 가 없어 파생물을 같은
라이선스로 공개할 의무는 없고 상업 이용도 자유지만, **출처 표시는 해야 한다**:

- 앱 정보 화면 또는 배포물에 `Overture Maps Foundation (overturemaps.org)` 고지
- 레코드별 원출처가 섞여 있다(`provenance.dataset`: meta · microsoft ·
  foursquare · alltheplaces …). **Foursquare 출처분은 NOTICE 보존 의무가 별도로
  붙는다**(Apache 2.0) — 그래서 `dataset` 을 버리지 않고 보존한다.

⚠️ **places 테마만 CDLA 다.** `buildings`·`transportation` 등은 OSM 기반
**ODbL(share-alike)** 이라 같은 테이블에 섞으면 의무가 생긴다. 이 수집기는
places 만 읽는다.
