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
(merge_pois_docs 멱등 병합 + 축소 가드) — 리뷰 후 머지만 하면 된다. 아래 수동 절차는 백업용.

새 수집분으로 갈아끼우려면(수동 백업 절차 — 갈아끼우기 금지, **병합**할 것):

```bash
gh run list --workflow=ai-poi-collect.yml --limit 5
gh run download <RUN_ID> -n collected-pois -D /tmp/poi
cp /tmp/poi/collected_pois.json ai/data/collected_pois.json
```

`collect_state.json`(수집 커서)은 **여기 두지 않는다** — 워크플로가 전용 브랜치에 이미 영속한다.

### 이 파일의 출처

- 워크플로 실행 `32060590511` (2026-08-17 수집분)
- `schema_version` 1 · `source` TOURAPI · 제안 1,104건 · 광역 17개 지역
- 스키마 정본: `ai/src/trippilot/poi_curation/sourcing/pipeline.py` 의 `to_output_document`

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
