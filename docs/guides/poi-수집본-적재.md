# POI 수집본 배포 환경 적재

수집한 장소를 배포 환경(DEV/PRD) DB 에 넣는 절차다. **수동 작업이고, 수동인 것이 설계다** — 아래 "왜"를 먼저 읽는다.

## 왜 필요한가

증상은 "api-dev 의 장소가 거의 없다. 로컬에는 많다"다. 로컬이 많은 이유는 시드(`R__seed_stub_pois.sql`)가 있어서이고, 배포 환경이 빈 이유는 **수집 워크플로가 DB 에 쓰지 않기 때문**이다. `.github/workflows/ai-poi-collect.yml` 의 선언이 그대로다:

> 산출물은 "등록 제안" JSON일 뿐이다 (INV-1) — POI 정본은 backend C7 단일 소유라 DB에 직접 쓰지 않는다. 백엔드 수신 API 협의 전까지는 artifact(30일 보존)로만 남긴다.

수신 API(`POST /internal/pois/proposals`)는 그 뒤에 생겼지만 **워크플로를 자동 적재로 바꾸지는 않았다**. 그래서 수집은 매일 돌아 산출물이 쌓이고, 그걸 DB 로 옮기는 마지막 한 걸음만 사람에게 남아 있다. 이 문서가 그 한 걸음이다.

적재하면 같이 들어오는 것:

- **장소 본체** — 이름·좌표·카테고리·지역·영업시간 원문. 탐색/일정 생성의 후보풀(INV-1 닫힌 집합)이 이것이다.
- **장소 사진** — TourAPI `firstimage` → 수집본 `provenance.image_url` → `poi.image_url`. 별도 이미지 적재 작업이 없다. 사진이 비어 보이는 화면은 대부분 "이미지 기능이 없다"가 아니라 "수집본이 안 들어갔다"다.
- **지역 코드** — 주소 첫 토큰(시도명)으로 결정된다(TRIP-359). 지역별 커버리지 집계가 이 값에 달려 있다.

## 사전 준비

| 필요한 것 | 확인 |
|---|---|
| AWS 자격 + EKS 접근 | `aws sts get-caller-identity` · `aws eks update-kubeconfig --name trippilot-dev --region ap-northeast-2` |
| 네임스페이스 | `trippilot` (배포 도구 기본값 — `deploy/eks/runtime.py`) |
| 서비스 토큰 | k8s secret `trippilot-shared` 의 `SERVICE_AUTH_TOKEN` |
| 수집 산출 문서 | 아래 §무엇을 넣는가 |

클러스터 준비·자격 발급 자체는 [aws-eks-deployment.md](aws-eks-deployment.md) 소관이다.

토큰을 꺼낸다. **셸 히스토리에 값이 남지 않게** 변수로 받는다:

```bash
export SERVICE_AUTH_TOKEN=$(kubectl get secret trippilot-shared -n trippilot \
  -o jsonpath='{.data.SERVICE_AUTH_TOKEN}' | base64 -d)
[ -n "$SERVICE_AUTH_TOKEN" ] || echo "토큰이 비었다 — secret 이름/키 확인"
```

토큰이 비면 `/internal/**` 은 **아무도 호출할 수 없다**(fail-closed, `ServiceTokenAuth.kt`). 401 이 나면 먼저 이 값을 의심한다.

## 무엇을 넣는가

소스가 둘이고, **기본은 첫 번째**다.

### 1. 팀 공유본 — `ai/data/collected_pois.json` (권장)

수집 워크플로가 매일 `merge_pois_docs.py` 로 금일 산출물을 공유본에 **병합**하고 롤링 PR(`chore/poi-data-sync`)로 올린다. 같은 `content_id` 는 나중 수집분이 이기고, 합본이 기존보다 작아지면 축소 사고로 보고 워크플로가 실패한다. 즉 **공유본은 이미 여러 run 의 누적본**이다 — artifact 를 하나하나 받을 일이 보통은 없다.

```bash
git fetch origin develop && git checkout origin/develop -- ai/data/collected_pois.json
python3 backend/scripts/ingest_pois.py --dry-run ai/data/collected_pois.json   # 건수 확인
```

**함정**: 공유본 갱신 PR 은 **머지가 사람 몫**이다(TRIP-392 결정 — 리뷰 가능하게). 그 PR 이 며칠 안 머지되면 공유본은 그 시점에서 멈춰 있고, 그 사이 수집분은 artifact 에만 있다. "어제 돌린 수집이 왜 안 보이지"의 답은 대개 이것이다. 확인: `gh pr list --head chore/poi-data-sync --state open`.

### 2. 개별 run artifact (공유본이 밀렸거나, 특정 회차만 넣을 때)

```bash
gh run list --workflow ai-poi-collect.yml --limit 10        # 성공한 run 고르기
gh run download <RUN_ID> -n collected-pois -D /tmp/poi/<RUN_ID>
# → /tmp/poi/<RUN_ID>/ai/collected_pois.json (collect_state.json 동봉, 적재 대상 아님)
```

보존은 **30일**이다. 그보다 오래된 회차는 artifact 가 없고 공유본에만 남는다.

**artifact 한 장은 전국이 아니다.** 수집은 run 당 호출 예산(키당 상한 × 키 수) 안에서 광역 17개를 공평 순회하므로, 한 회차는 전국의 일부만 담는다. 그래서 artifact 로 전국 수준을 만들려면 **여러 회차를 순차 적재**해야 한다(§여러 run 누적). "한 번 부었는데 왜 아직 적지"는 버그가 아니라 이 구조다.

## port-forward

게이트웨이(nginx)가 `/internal` 을 외부에 **404 로 막는다**(`deploy/eks/chart/templates/gateway-config.yaml` — `location / { return 404; }`). 외부 API 주소로는 닿지 않으므로, 클러스터 내부 Service 로 터널을 뚫는다.

```bash
kubectl port-forward svc/backend 8080:8080 -n trippilot   # 별 터미널에서 띄워 둔다
# 도달·인증 확인 — **빈 제안 문서**를 보낸다. 아무것도 바꾸지 않고 0 만 돌려주는 비파괴 호출이다.
# (GET 으로 찔러 보지 마라 — 405 가 아니라 500 이 온다. 2026-10-03 실측)
curl -s -X POST localhost:8080/internal/pois/proposals \
  -H "X-Service-Token: $SERVICE_AUTH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"source":"TOURAPI","proposals":[]}' -w ' [%{http_code}]\n'
```

- `{"received":0,...} [200]` — 도달·인증 모두 정상. 적재로 넘어간다.
- `401`/`403` — 도달은 했고 토큰 문제다.
- `404` — 터널이 아니라 게이트웨이로 가고 있다(외부 주소를 쓰고 있지 않은지 확인).

## 적재

```bash
# 1) 드라이런 — 무엇을 어디로 몇 건 보낼지만 출력한다(전송 없음)
python3 backend/scripts/ingest_pois.py --dry-run ai/data/collected_pois.json

# 2) 실제 적재
python3 backend/scripts/ingest_pois.py ai/data/collected_pois.json
```

스크립트는 **문서를 그대로 태운다** — 수집 산출물의 모양이 곧 수신 DTO 계약이라 변환 단계가 없다(생산 `ai/src/trippilot/poi_curation/sourcing/pipeline.py` 의 `to_output_document`, 소비 `backend/modules/place-data/.../PoiProposalDtos.kt`). 하는 일은 쪼개서 보내고 응답을 합산하는 것뿐이다.

기본 500건씩 나눠 보낸다. 수신은 **문서 한 건 = 트랜잭션 한 개**라서, 2만 건을 한 요청에 담으면 24MB 요청 하나가 원격 RDS 상대로 트랜잭션을 길게 붙잡는다. 쪼개도 결과는 같다(멱등 키가 제안마다 따로다). 한 번에 보내고 싶으면 `--chunk-size 0`.

| 옵션 | 쓸 때 |
|---|---|
| `--base-url` | port-forward 포트를 바꿨거나 로컬 compose 에 넣을 때 |
| `--chunk-size N` | 타임아웃이 나면 줄인다. `0` = 쪼개지 않음 |
| `--timeout N` | 기본 300초 |
| `--dry-run` | 보내기 전 항상. `--close-missing` 과 함께면 닫힐 수를 서버에 묻는다(토큰·터널 필요, 쓰지 않음) |
| `--close-missing` | 문서가 **그 출처의 전부**일 때, 적재 전에 문서에 없는 ACTIVE 를 LOST 로 — §원본에서 빠진 장소 닫기 |
| `--allow-mass-close` | `--close-missing` 의 비율 가드를 넘는다. 의도한 대량 정리일 때만 |
| `--self-check` | 스크립트 자체 점검(파싱·쪼개기·합산·미포함 정리의 호출 순서와 종료 코드) |

`SERVICE_AUTH_TOKEN` 이 비면 스크립트가 **보내기 전에 멈춘다**. 무인증으로 나가면 401 만 쌓이고 이유가 안 보인다.

## 결과 해석

```
ai/data/collected_pois.json: source=TOURAPI 제안=18605건 → 요청 38회
  [1/38] 접수=500 신규=487 갱신=0
  ...
합계 — 접수=18605 신규=17902 갱신=4 지역코드미상=0
탈락(사유별):
  unknown_category: 612
  no_coord: 87
```

| 값 | 뜻 |
|---|---|
| 접수 `received` | 문서에 담겨 온 제안 수. 보낸 건수와 다르면 문서가 잘렸다 |
| 신규 `registered` | 새 행이 생긴 수 |
| 갱신 `updated` | 이미 아는 장소를 덮어쓴 수. **재적재에서는 거의 전부 갱신이 정상이다** |
| 지역코드미상 `regionUnresolved` | 받았지만 지역 코드를 못 정한 수. 탈락이 아니라서 조용히 커버리지만 줄인다 — **0이 아니면 주소 형태가 바뀐 것**(TRIP-359) |
| 탈락 `dropped` | 사유별 집계. 아래 표 |

탈락 사유(`PoiProposalIngestService`):

| 사유 | 의미 | 할 일 |
|---|---|---|
| `no_source_ref` | `provenance.content_id` 가 없다 | 멱등 키가 없어 받을 수 없다. 수집 쪽 문제 |
| `duplicate_in_document` | 같은 문서(청크) 안에 같은 식별자가 둘 | 뒤엣것만 쓴다. 정상 동작 |
| `unknown_category` | 우리 8종 카테고리에 없는 코드(예: AI 내부 전용 `STAY`) | 임의 매핑하지 않는다. 수백 건 나오는 것이 정상 |
| `no_coord` / `no_name` | 좌표·이름 없음 | 수집 게이트 탈락. 정상 |

탈락이 있는 것 자체는 이상이 아니다. 이상한 것은 **전부 탈락**(신규+갱신이 접수의 절반 미만)이거나 **지역코드미상 > 0** 이다.

## 여러 run 누적

artifact 로 전국을 채우는 경우. 문서를 **순서대로** 주면 그 순서로 보낸다 — 같은 `content_id` 는 나중 문서가 이긴다(멱등):

```bash
for RUN in 101 102 103; do gh run download $RUN -n collected-pois -D /tmp/poi/$RUN; done
python3 backend/scripts/ingest_pois.py \
  /tmp/poi/101/ai/collected_pois.json \
  /tmp/poi/102/ai/collected_pois.json \
  /tmp/poi/103/ai/collected_pois.json
```

오래된 회차를 먼저, 최신을 나중에 둔다(최신 값이 남게). 중간에 끊겨도 처음부터 다시 돌려도 된다 — 아래.

적재는 **즉시 등록**이다. 수동 승인 단계가 없고, 응답의 `registered`/`updated` 가 곧 DB 에 반영된 수다.

## 원본에서 빠진 장소 닫기 (`--close-missing`)

적재는 `(source, content_id)` **upsert** 라 추가·갱신만 한다. 원본에서 빠진 장소 — 폐업, 선별에서 빠진 식당, 공유본에서 빠진 행 — 는 DB 에 **ACTIVE 로 남아** 탐색·후보풀에 계속 나온다(사용자에게는 문 닫은 식당이 일정에 들어가는 것으로 보인다). 문서가 **그 출처의 전부**일 때 `--close-missing` 을 붙이면 그것까지 정리한다:

```bash
# 1) 드라이런 — 서버가 닫힐 수를 계산만 해서 돌려준다(쓰지 않는다 · 토큰과 터널이 필요하다)
python3 backend/scripts/ingest_pois.py --dry-run --close-missing ai/data/collected_localdata.json
# 2) 실제 — 문서마다 닫기 → 적재 순서로 간다
python3 backend/scripts/ingest_pois.py --close-missing ai/data/collected_localdata.json
```

문서마다 **적재 전에** 그 문서의 `provenance.content_id` 전부를 `POST /internal/pois/close-missing` 으로 한 번 보내고, 이어서 적재한다. 서버는 그 출처의 ACTIVE 중 목록에 없는 것을 **LOST** 로 내린다 — 삭제가 아니고(담은 장소·확정 일정 스냅숏이 그 행을 가리킨다) 폐업 판정(CLOSED)도 아니다. 빠지는 이유 대부분이 폐업이 아니라서다(LOCALDATA 공백 해소·중복 병합, 공유본 `drop_non_travel` 소급 제거). LOST 행은 뒤의 적재에서 문서에 다시 나타나면 ACTIVE 로 돌아온다(§되돌리기). **순서가 거꾸로면 가드가 무너진다** — 적재 뒤에 대조하면 방금 만든 행이 스스로를 "목록에 있음"으로 세어, 식별자 형식이 통째로 바뀐 문서나 출처 라벨이 틀린 문서도 기존 행 수만큼만 크면 비율 가드를 넘고 기존 행이 전부 닫힌다(실측: 1,000건 재키잉 → 2,000 중 1,000 = 50% 로 통과). 닫히는 집합은 적재 전후가 같다 — 적재는 목록 안의 행만 건드린다(만들기·갱신·LOST 되살리기). 출력은 문서마다 이렇다:

```
  미포함 정리 — LOCALDATA ACTIVE <activeBefore> 중 목록에 있음 <present> · LOST <closed>
  되돌리기 SQL → close-missing-undo-LOCALDATA-<시각>.sql — 잘못 닫혔는데 다시 부을 문서가 없을 때만 psql 로 먹인다(…)
```

드라이런은 같은 줄을 `미포함 정리(드라이런 — 닫지 않았다) … · 닫을 것 <closed>` 로 찍는다. 실제 실행도 적재 전에 같은 상태로 대조하므로, 그 사이 다른 적재가 끼지 않으면 **이 숫자가 그대로 닫힌다** — 첫 운영 실행 전에 이 숫자를 보고 판단한다.

| 값 | 뜻 |
|---|---|
| `activeBefore` | 호출 시점 그 출처의 ACTIVE(식별자 있는 행). 적재 전이라 이 문서로 새로 생기거나 되살아날(지난번 LOST) 행은 들어 있지 않다 |
| `present` | 그중 목록에 있어 남은 수 — **요청 목록의 크기가 아니다**(아직 행이 없는 신규 제안은 세지 않는다) |
| `closed` | 이번에 LOST 로 내린 수(드라이런이면 내릴 수) — 키 이름은 동작(닫기)을 따른 것이지 상태값 CLOSED 가 아니다. 동시 변경이 없으면 `activeBefore = present + closed` |

사용자에게는 이렇게 보인다: 탐색·후보풀에서 사라진다 · 담기 목록에 **'미확인' 배지**가 붙는다('폐업' 배지는 폐업 판정 CLOSED 의 몫이다) · 그 장소가 든 **확정 전 일정은 확정이 409 로 막힌다**(`일정에 포함된 장소가 더 이상 유효하지 않아 확정할 수 없습니다`) · 이미 확정된 일정은 스냅숏이라 그대로다 · 뒤의 적재에서 **문서에 다시 나타나면 ACTIVE 로 돌아와** 배지가 사라지고 후보에 다시 오른다.

막아 두는 것:

- **목록에 있는 것이 그 출처 ACTIVE 의 절반 미만이면 409** — 아무것도 닫지 않고 그 문서는 **적재도 하지 않는다**(스크립트는 0 이 아닌 코드로 끝난다. 식별자 형식이 바뀐 문서를 부으면 같은 장소가 새 식별자로 한 벌 더 생기기 때문이다). 청크 하나·회차 artifact 한 장·다른 출처의 목록·식별자 형식이 바뀐 문서가 이렇게 보인다. 정말 절반 넘게 빠지는 정리(선별 기준을 바꿔 다시 만든 경우 등)일 때만 `--allow-mass-close` 를 붙인다.
- **같은 출처 문서를 두 장 이상 주면 보내기 전에 거부한다**(exit 1) — 문서 한 장을 그 출처의 전부로 읽으므로 둘째 문서가 첫째 문서의 행을 닫는다.
- **`MANUAL` 은 400** — 시드는 문서에서 온 것이 아니다. 모르는 출처도 400(적재와 같다).
- **닫은 뒤 적재 청크가 실패해도 닫은 것은 맞다**(닫히는 집합은 적재 전후가 같다). 원인을 고쳐 같은 명령을 다시 돌리면 닫기는 0, 적재가 나머지를 채운다.
- 로컬 compose 자동 적재(`poi-ingest`)는 이 플래그를 쓰지 않는다 — 기본은 upsert 만이다.

**TourAPI 에는 공유본으로만 쓴다.** 회차 artifact 는 전국이 아니라 쓰면 안 된다. 공유본은 매일 병합되는 누적본이고 축소되면 워크플로가 실패하지만, 빠지는 행이 **사람이 지운 행만은 아니다** — 병합이 관광 무관 규칙을 소급해 빼는 행(`ai/scripts/merge_pois_docs.py` 의 `drop_non_travel` — 편의점 지점 같은 이름 규칙)도 빠지고, 그 행은 여기서 LOST(담기 목록의 '미확인' 배지)가 된다. 그리고 **공유본보다 앞서 artifact 로 부은 적이 있으면 공유본에 그 행이 들어올 때까지 TourAPI 에는 쓰지 않는다** — 공유본에 아직 없는 그 행들이 그동안 후보에서 빠지고, 비율 가드는 이 정도 몫을 못 잡는다(공유본에 들어온 뒤 다시 부으면 돌아오기는 한다).

### 되돌리기

**대부분은 다시 붓기로 돌아온다.** 수신은 문서에 다시 나타난 **LOST** 행을 ACTIVE 로 되살린다(`Poi.refreshed`) — 잘못 닫힌 행이 맞는 문서에 있으면 그 문서를 다시 붓는 것이 곧 되돌리기다(`--close-missing` 을 붙여도 된다: 닫기는 ACTIVE 만 보고, 이어지는 적재가 LOST 를 되살린다). 다음 달 문서에 다시 뽑힌 식당도 따로 할 일이 없다. **CLOSED·UNVERIFIED 는 되살리지 않는다** — 폐업 판정(V2.50)·사람이 내린 값이라 대량 수집이 덮지 않는다.

다시 부을 문서가 없을 때(그 행이 어느 문서에도 없다):

1. **스크립트가 남긴 되돌리기 SQL**(기본) — 닫은 행이 있으면 실행한 디렉토리에 `close-missing-undo-<출처>-<시각>.sql` 이 생긴다. 서버가 돌려준 **닫은 식별자 그대로** LOST → ACTIVE 로 되돌린다(그 사이 CLOSED 로 바뀐 행은 건드리지 않는다 · 지우지 말고 둔다). §확인의 변수(`PGHOST`·`PGUSER`·`PGPASSWORD`)를 잡은 셸에서 먹인다:

   ```bash
   kubectl run poi-undo --rm -i --restart=Never -n trippilot --image=postgres:16-alpine \
     --env=PGHOST="$PGHOST" --env=PGDATABASE=trippilot --env=PGUSER="$PGUSER" \
     --env=PGPASSWORD="$PGPASSWORD" --env=PGSSLMODE=require --env=PGOPTIONS="-c search_path=app" \
     -- psql --no-psqlrc -v ON_ERROR_STOP=1 < close-missing-undo-LOCALDATA-<시각>.sql
   ```

2. **파일도 없을 때** — 한 호출이 닫은 행은 같은 `updated_at` 을 가진다. LOST 를 만드는 경로는 이 정리뿐이라 다른 상태와 섞이지 않는다(TOURAPI 의 V2.50 폐업 행은 CLOSED 다):

   ```sql
   -- 최근 닫힌 묶음 — 응답의 closed 와 건수가 같은 줄이 그 호출이다
   SELECT source, updated_at, count(*) FROM poi WHERE data_status = 'LOST'
    GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 5;
   UPDATE poi SET data_status = 'ACTIVE'
    WHERE data_status = 'LOST' AND source = '<위 출처>' AND updated_at = '<위 시각>';
   ```

## 실패하면

**되돌릴 것이 없다.** 멱등 키가 `provenance.content_id` 이므로 같은 문서를 몇 번 넣어도 행이 늘지 않는다(신규 대신 갱신으로 집계된다). 원인을 고친 뒤 **같은 명령을 다시 돌린다**. 그래서 스크립트에 재시도·이어가기 장치를 두지 않았다. (`--close-missing` 도 다시 돌려 안전하다. 그것이 닫은(LOST) 행은 문서에 다시 나타나면 적재가 되살린다 — §되돌리기.)

| 증상 | 원인 |
|---|---|
| 404 | 터널을 안 거쳐 게이트웨이로 갔다. port-forward 확인 |
| 401 | `SERVICE_AUTH_TOKEN` 불일치. secret 을 다시 꺼낸다 |
| 400 `알 수 없는 출처입니다` | 문서 `source` 가 `KAKAO_LOCAL`/`TOURAPI`/`MANUAL`/`LOCALDATA` 가 아니다(`LOCALDATA` 는 V2.61 이후 백엔드만 받는다) |
| 409 `CONFLICT`(미포함 정리) | 목록에 있는 것이 그 출처 ACTIVE 의 절반 미만 — 부분 문서·식별자 형식 변경 의심. 닫힌 행도, 그 문서의 적재도 없다. §원본에서 빠진 장소 닫기 |
| 연결 실패 | port-forward 가 죽었다(세션이 끊기면 조용히 닫힌다) |
| 타임아웃 | `--chunk-size` 를 줄인다 |

진짜로 넣은 것을 **지워야** 하는 상황이라면(스키마 사고 등) `DELETE FROM poi WHERE source_ref IS NOT NULL` 이 수집분만 고른다(수동 시드는 `source_ref IS NULL`). 다만 `saved_place.poi_id` 가 `poi` 를 FK 로 참조하고 `ON DELETE` 가 없어, 사용자가 담아 둔 장소가 있으면 삭제가 거부된다. 운영 데이터가 생긴 뒤에는 삭제가 아니라 재적재로 고친다.

**`LOCALDATA` 를 부은 DB 에서 백엔드를 V2.61 이전 이미지로 되돌리지 않는다.** 그 이미지의 `PoiSource` 에는 `LOCALDATA` 가 없어 그 행을 읽는 조회마다 `PoiSource.valueOf` 가 터진다(공백 지역 반경 조회·탐색 목록이 500). 되돌려야 하면 먼저 `DELETE FROM poi WHERE source = 'LOCALDATA'` 를 한다(위 FK 제약은 같다). `data_status` 를 `CLOSED` 로 바꾸는 것만으로는 모자라다 — 상태를 보지 않는 id 조회(`PoiRepositoryAdapter.findById`·`findByIds`)가 여전히 그 행을 읽는다.

## 확인

적재 뒤 DB 를 직접 본다. 임시 psql Pod 를 띄우되 자격은 백엔드가 쓰는 secret 에서 그대로 꺼낸다:

```bash
ENV_OF() { kubectl get deploy backend -n trippilot \
  -o jsonpath="{.spec.template.spec.containers[0].env[?(@.name==\"$1\")].value}"; }
DB_URL=$(ENV_OF DB_URL)          # jdbc:postgresql://<host>:5432/trippilot?currentSchema=app&sslmode=require
PGHOST=${DB_URL#*//}; PGHOST=${PGHOST%%:*}
PGUSER=$(ENV_OF DB_USER)
PGPASSWORD=$(kubectl get secret trippilot-database -n trippilot \
  -o jsonpath='{.data.DB_PASSWORD}' | base64 -d)

# 스키마는 app 이고 RDS 는 TLS 를 요구한다 — 둘 다 빠뜨리면 "relation poi does not exist" 나 연결 거부가 난다
kubectl run poi-check --rm -it --restart=Never -n trippilot --image=postgres:16-alpine \
  --env=PGHOST="$PGHOST" --env=PGDATABASE=trippilot --env=PGUSER="$PGUSER" \
  --env=PGPASSWORD="$PGPASSWORD" --env=PGSSLMODE=require --env=PGOPTIONS="-c search_path=app" \
  -- psql --no-psqlrc -c "
    SELECT count(*) AS 전체,
           count(*) FILTER (WHERE data_status = 'ACTIVE')  AS 활성,
           count(*) FILTER (WHERE source_ref IS NOT NULL)  AS 수집분,
           count(*) FILTER (WHERE image_url IS NOT NULL)   AS 사진있음,
           round(100.0 * count(*) FILTER (WHERE image_url IS NOT NULL) / greatest(count(*), 1), 1) AS 사진률,
           count(*) FILTER (WHERE region_code IS NULL)      AS 지역코드없음
    FROM poi;
    SELECT left(region_code, 2) AS 시도, count(*) FROM poi
     WHERE source_ref IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;"
```

봐야 하는 것:

- **수집분**이 적재 합계의 신규+갱신과 맞는가.
- **사진률** — 수집본 자체가 전 건 이미지를 주지는 않는다(TourAPI `firstimage` 가 없는 장소가 있다). 비율은 수집본의 `image_url` 보유율과 비교한다. 0% 면 적재가 아니라 배선 문제다.
- **시도 분포** — 한 지역에만 몰렸으면 회차를 더 넣어야 한다(§여러 run 누적). 광역 17개가 고르게 나오는 것이 수집의 의도다.
- **지역코드없음** — 0 이어야 한다.

DB 자격 없이 확인만 하려면 같은 port-forward 로 읽기 경계를 쓴다(장소가 응답에 실리는지만 본다):

```bash
curl -s -H "X-Service-Token: $SERVICE_AUTH_TOKEN" \
  "localhost:8080/internal/pois?centerLat=37.5665&centerLng=126.9780&radiusKm=5" | head -c 400
```

## 자동화하지 않은 이유

수집 워크플로가 바로 DB 로 밀어 넣게 바꿀 수는 있다. 하지 않은 이유는 적재가 **즉시 등록**이고 되돌리기가 FK 때문에 간단하지 않아서다 — 수집 쪽 회귀(카테고리 매핑 변경, 주소 형태 변화)가 그대로 사용자 화면에 나간다. 현재는 공유본 PR 리뷰가 그 완충이다. 자동 적재를 켤 거라면 그 완충을 무엇으로 대체할지가 먼저다.
