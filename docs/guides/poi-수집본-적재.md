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
| `--dry-run` | 보내기 전 항상 |
| `--self-check` | 스크립트 자체 점검(파싱·쪼개기·합산) |

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

## 실패하면

**되돌릴 것이 없다.** 멱등 키가 `provenance.content_id` 이므로 같은 문서를 몇 번 넣어도 행이 늘지 않는다(신규 대신 갱신으로 집계된다). 원인을 고친 뒤 **같은 명령을 다시 돌린다**. 그래서 스크립트에 재시도·이어가기 장치를 두지 않았다.

| 증상 | 원인 |
|---|---|
| 404 | 터널을 안 거쳐 게이트웨이로 갔다. port-forward 확인 |
| 401 | `SERVICE_AUTH_TOKEN` 불일치. secret 을 다시 꺼낸다 |
| 400 `알 수 없는 출처입니다` | 문서 `source` 가 `KAKAO_LOCAL`/`TOURAPI`/`MANUAL`/`LOCALDATA` 가 아니다(`LOCALDATA` 는 V2.61 이후 백엔드만 받는다) |
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
