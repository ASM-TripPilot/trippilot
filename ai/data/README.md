# 수집 데이터 — 팀 공유본

AI 수집 파이프라인이 만든 **등록 제안 문서**를 팀이 같은 상태로 쓰기 위해 여기 둔다.

## 왜 DB 덤프·이미지가 아닌가

- **INV-1** — POI 등록 조건은 "수집 게이트를 통과했을 것"이다. DB 를 복사하면 게이트를 안 거친 행이 섞이고,
  게이트 규칙이 바뀌어도 그 데이터는 옛 판정을 유지한다.
- **정본 소유** — POI 정본은 backend C7 단독 소유다(PR #76). 덤프를 공유하면 정본이 둘이 된다.
- **리뷰** — JSON 은 diff 가 되고 볼륨은 안 된다. 갈라져도 아무도 모르는 상태를 만들지 않는다.

## 쓰는 법

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

## 갱신

`ai-poi-collect` 워크플로가 매일 KST 04:00 에 돌고 산출물을 artifact 로 남긴다(**보존 30일**).
새 수집분으로 갈아끼우려면:

```bash
gh run list --workflow=ai-poi-collect.yml --limit 5
gh run download <RUN_ID> -n collected-pois -D /tmp/poi
cp /tmp/poi/collected_pois.json ai/data/collected_pois.json
```

`collect_state.json`(수집 커서)은 **여기 두지 않는다** — 워크플로가 전용 브랜치에 이미 영속한다.

## 이 파일의 출처

- 워크플로 실행 `32060590511` (2026-08-17 수집분)
- `schema_version` 1 · `source` TOURAPI · 제안 1,104건 · 광역 17개 지역
- 스키마 정본: `ai/src/trippilot/poi_curation/sourcing/pipeline.py` 의 `to_output_document`
