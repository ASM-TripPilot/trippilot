# ai/data — 의도 매칭 질문뱅크 데이터

`intent_question_bank.yaml`은 **최종 검수 전 seed 초안(v0.2 — 1차 검수 반영)**이다 — 검수 완료 전에는 임베딩·뱅크 편입 금지 (`reviewed: false` 유지).
검수 절차: 의도별 문장을 사람이 확인 → 의도 간 경계 문장 제거 → 뱅크 편입 시 타 의도 엔트리와 유사도 ≥ 0.90 중복 검사 통과 필수 (intent-matching-design §3.3).
평가셋과는 **완전 분리**한다: 여기 실린 문장(및 그 augment 변형)은 평가셋에 절대 재사용하지 않는다 — leak 금지 (intent-matching-design §6).
의도 라벨 정본은 `orchestrator-delegation-design.md` §5 라우팅 테이블 (closed-set 13종, CONFIRM/CANCEL/UNDO 제외).

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
