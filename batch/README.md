# batch — 수집 파이프라인(로컬, Airflow)

수집 → **검증** → 게시를 DAG 로 묶어, 깨진 수집 결과가 정본을 덮지 못하게 구조로 막는다(TRIP-1468).
운영 배치는 지금처럼 GitHub Actions(`ai-poi-collect.yml`·`ai-event-collect.yml`)가 돈다. 운영 이전용 실 수집 DAG 는 아래 §실 수집 DAG.

## 실행

```bash
docker compose --profile batch up -d airflow     # http://localhost:8090 — 계정·비밀번호는 `docker logs trippilot-airflow`
docker exec trippilot-airflow airflow dags test poi_collect 2026-10-20
docker exec trippilot-airflow airflow dags test event_collect 2026-10-20
docker compose --profile batch down
```

게시본은 `batch/.out/published/`(git 제외)에 쌓인다. 실제 API 는 부르지 않는다 — 리포의 수집본(`ai/data/collected_*.json`)을
수집 결과로 삼는다. Linux 에서는 `AIRFLOW_UID=$(id -u)` 를 주고 띄운다
(이미지가 uid 50000 으로 돈다).

| DAG | 주기(KST) | 태스크 |
|---|---|---|
| `poi_collect` | 04:00 | collect → validate(건수 하한·이름·**백엔드가 시도를 읽는가**) → publish |
| `event_collect` | 04:40 | collect → validate(**그날 유효한 행사 수** 하한·**가장 오래된 운영 지역의 마지막 수집 4일 이내**) → publish |

- 실제 수집은 운영 워크플로의 몫이다 — 이 DAG 는 그 결과물(리포 사본)을 검증 게이트에 통과시키는 구조만 돌린다.
  신선도는 따로 DAG 를 두지 않고 `event_collect.validate` 안에서 본다 — 저장소의 `coverage`(지역별 마지막 수집 시각) 중
  **운영 수집 지역**(수집기 `ai/scripts/collect/collect_events.py` 의 `DEFAULT_REGIONS` 17곳 — 목록을 따로 적지 않고 그 파일에서
  읽는다)의 **가장 이른 것**(가장 오래 수집되지 않은 지역)이 실행 날짜보다 `max_age_days`(기본 4일)를 넘게 앞서면 막는다(운영 지역이
  하나라도 없거나 시각을 읽을 수 없어도 막는다). 운영 지역이 아닌 키는 보지 않고 로그에만 남긴다 — 저장소는 키를 지우지 않고 수동
  실행의 지역 입력은 자유 텍스트라, 한 번 들어간 다른 이름(예 `서울특별시`)이 영영 막지 않게. 가장 늦은 것을 보면 전체가 멈춰도 한
  지역만 돌면 계속 게시한다. 그날 유효 건수만으로는 늦다: 사본에 미래 행사가 남아 있으면 수집이 멈춰도 몇 주 동안 하한 위에 머문다
  (2026-10-19 사본은 12-07 에야 하한 아래로 떨어진다).
  4일(수집·검증 시차 1 + 폴백 1 + 하드캡 이월 1 + 여유 1)인 이유: 운영 수집은 `vars.EVENT_REGIONS_PER_RUN=17` 이라 17개 지역을
  **매일 전부** 돈다(`NAVER_MAX_CALLS` 하드캡 1000). 다만 운영 coverage 는 04:40 뒤에 찍혀(cron 이 늦게 돌고 시각은 실행 시작 때 —
  collect-state 실측 06:46~15:30 KST) 04:40 의 validate 는 정상인 날도 전날 시각을 본다(시차 1). LLM 폴백한 지역은 coverage 를 찍지
  않고 하드캡에 걸리면 남은 지역은 다음 날로 밀리지만, 둘 다 다음 날 다시 찍힌다 — collect-state 이력(10-11~10-20)에서 17곳 모두
  거의 매일 찍혔고 가장 늦은 것은 10-16 두 곳이 하루 늦은 것이다. 여유 1 은 GitHub 가 예약 실행을 한 번 건너뛰는 날 등이다.
  대가: 전체 정지를 닷새째에 잡고(유효 건수만으로는 7주), 위 셋이 겹친 날까지 통과시킨다. 실행당 지역 수를 낮추면 한 지역이
  r = `ceil(17 / regions_per_run)`일에 한 번 찍히므로 허용을 `2r + 2`일(시차를 포함한 한 바퀴 + 폴백 한 바퀴 + 하드캡 1 + 여유 1)로
  올린다. 지금 리포 사본(17곳 모두 10-19 06:46)은 10-23 까지 통과하고 10-24 부터 빨개진다 —
  사본을 갱신하라는 신호다.
- 실행마다 후보 사본을 `batch/.out/runs/<dag>/<run_id>/` 에 둔다. 게시가 끝나면 지우고(POI 사본이 48.6MB 라 남기면 한 달에
  1.5GB), 검증에 실패한 실행의 후보는 원인을 보라고 남긴다.
- **검증 실패 = 게시 안 함.** validate 가 `AirflowFailException` 으로 끝나면 publish 는 돌지 않고, 지난 게시본이 그대로 남는다.
- 검증 규칙은 `checks.py` 하나 — Airflow 없이 단위 테스트한다. 시도 판정은 백엔드 `RegionResolver` 의 거울이다 — 첫 낱말이
  시도 **정식 이름**과 정확히 같아야 하고(양끝은 Kotlin `trim()` 과 같은 문자만 — Python `strip()` 과 달리 U+0085 는 남긴다 —, 가운데는 백엔드처럼 ASCII 공백으로만 자른다), 시도 목록은 백엔드 지역 시드
  (`R__seed_region_catalog.sql`)에서 읽는다. 약칭·잘린 이름을 펴는 것은 수집 병합 단계(ai `expand_sido_abbrev`)의 몫이다.

## 왜 — 실제로 있었던 사고 두 건

| 사고 | GitHub Actions(지금) | 이 파이프라인 |
|---|---|---|
| 2026-10-10 `cce8c508` — 배포가 8월에 커밋된 행사 사본을 구워, 그날 유효한 행사가 346건이 아니라 10건 | 수집은 매일 성공. 배포가 정본을 읽지 않아 아무도 몰랐다(사후에 배포 단계에 가드를 넣었다) | `event_collect.validate` 가 "그날 유효 건수 < 하한"으로 게시를 막는다. 유효 건수가 아직 하한 위여도 가장 오래된 운영 지역의 마지막 수집이 4일보다 오래됐으면 같은 validate 가 막는다 |
| 2026-10-20 #1427 — 수집 공유본 병합에 시도명이 잘린 주소 2건(`부산광역 …`·`제주특별자치 …`) | 봇 PR 은 CI 가 승인 대기로 멈춘 채 즉시 auto-merge 된다(#1427: 체크 0개, 6초) — 머지 뒤 backend-ci 가 깨져 열린 PR 전부가 막혔다. 데이터는 수집 병합 단계에서 고쳤다(#1431), 봇 PR 앞 게이트는 TRIP-1475 가 다룬다 | `poi_collect.validate` 가 "시도를 정할 수 없는 주소 2건 — 낙동강 생태탐방선(부산광역 …)…"으로 게시 전에 막는다(실측: #1427 데이터로 돌리면 정확히 그 2건을 짚고, #1431 이 고친 지금 리포 사본 60,521건은 통과한다). 검증이 게시 **앞에** 구조로 놓여 있다는 것이 차이다 |

## GitHub Actions 와 비교

| | GitHub Actions cron | Airflow |
|---|---|---|
| 재시도 | 잡 전체 재실행(수동) | 태스크 단위로 지정할 수 있다 — 검증 실패는 같은 문서면 같은 결과라 재시도 없이 실패로 끝낸다. 실패한 태스크부터 다시 돌리는 것은 된다. 단 **성공한** 실행은 게시가 후보를 지웠으므로 collect 부터 다시 돌린다(validate·publish 만 지우고 돌리면 "후보가 없다"로 실패한다) |
| 백필 | 날짜를 입력으로 받는 수동 디스패치 | 논리 날짜로 지난 날 실행 — 검증의 "그날"도 그 날짜다. 시험 실행은 `dags test <dag> <날짜>`, 정식 백필은 `airflow backfill create`(`catchup=False` 라 밀린 날을 자동으로 돌지는 않는다) |
| 의존 | 스텝 순서(한 잡 안), 실패 처리는 셸 조건문 | 태스크 의존 그래프 — 검증이 실패하면 게시가 구조적으로 안 돈다 |
| 관측 | 잡 요약·로그 | 태스크별 상태·로그·실행 이력 UI |
| 운영 비용 | 0(러너 무료 한도) | 상시 스케줄러·메타 DB 가 필요 — 지금 규모에서 운영에 올릴 이유는 없다 |

결론(2026-10-20): 운영은 GitHub Actions 를 유지한다. 이 파이프라인이 보여 주는 것은 "검증 게이트를 게시 앞에 두는 구조"이고,
그 구조는 GitHub Actions 에서도 스텝으로 옮길 수 있다.
갱신(2026-11-03, TRIP-1725): 옮길 이유가 하나 생겼다 — TourAPI 가 일부 러너 IP 를 블랙홀 처리해 ai-poi-collect 최근 100런
(8/19~) 중 정기 72 가운데 12, 재시도·수동 28 가운데 15 가 실패했다. 고정 IP 에서 도는 실 수집 DAG 를 그림자로 먼저 올린다(§실 수집 DAG).

## 실 수집 DAG — 운영 이전 1단계(TRIP-1725)

`poi_collect_live`·`event_collect_live` 는 위 두 DAG 와 달리 **실제로 수집한다** — Actions 워크플로와 같은 수집 스크립트를
같은 순서로 부르고(리포 조작은 `live.py`), 검증을 게시 앞 태스크로 둔다.

| DAG | 태스크 |
|---|---|
| `poi_collect_live` | collect(develop 복제·collect-state 복원·`collect_pois.py`·`merge_pois_docs.py --state`) → validate(축소 가드 + `check_pois`) → publish(롤링 PR·**머지 확인**) → persist_cursor(collect-state). 곁가지: collect → novelty(`collect_novelty.py --fail-if-stalled`, 비차단) |
| `event_collect_live` | collect(복원·`collect_events.py`·팝업·축제) → validate(`check_event_store` — 모양·그날 유효 건수) → publish(collect-state 영속) → freshness(`check_event_freshness`, 영속 뒤 경보) |

두 DAG 모두 마지막에 cleanup(**teardown** — 실행 성패에 세지 않는다)이 실행 폴더를 지운다. collect·validate·publish·영속이 실패한
실행은 남긴다(`KEEP`) — 원인을 보고, 실패한 태스크를 **하류(Downstream)와 함께** 지워(clear) 다시 돌리면 그 복제본에서 이어 간다.
남긴 실행은 다음 실행이 시작할 때 최근 3개(`pipeline.KEPT_RUNS`)만 두고 지운다(복제본 수백 MB × 매일 실패 → emptyDir 10Gi 축출
방지). 표시 없는 폴더는 하루 넘은 것만 지운다.
- **낡은 실행의 재시도는 더 새 게시를 덮지 않는다.** 복원 때 본 collect-state 의 blob, 복제 때 본 develop 공유본의 blob 을 실행
  폴더에 적어 두고, 영속·게시 직전에 지금 값과 다르면(그사이 다른 실행이 먼저 영속·게시했다) 실패한다 — collect 부터 다시 돈다.
  지금 값이 이미 이 실행의 내용이면(앞 시도가 영속하고 죽었다) 성공이다. 전환기에 Actions 와 함께 실 수집해도 같은 검사로 한쪽이 멈춘다.
- **운영 파드에서 `airflow dags test` 를 돌리지 말 것** — max_active_runs 를 따지지 않아 정기 실행과 같은 실행 폴더·collect-state 를
  동시에 만진다. 수동 실행은 UI 의 Trigger 로.

- **기본은 그림자다**(`BATCH_LIVE` 미설정): 실 API 를 부르지 않고, Actions 가 게시한 것(develop 공유본·collect-state 행사
  저장소)을 검증만 한다. 게시·영속은 건너뛴다. 생성 시 paused. 실 수집은 Actions 스케줄을 끈 뒤 `BATCH_LIVE=1` 로만 —
  둘이 함께 실 수집하면 일일 한도를 두 번 쓰고 collect-state 를 서로 덮는다.
- 커서는 게시가 머지를 **확인한 뒤에만** 저장한다(TRIP-1475). 앞 태스크가 실패하면 저장하지 않는다 — 다음 실행이 같은
  자리부터 다시 받는다.
- 머지 뒤 backend-ci 를 디스패치하지 않는다 — Actions 판은 GITHUB_TOKEN 이라 머지 push 가 런을 만들지 않아 디스패치가 필요하고,
  Airflow 판의 GH_TOKEN 은 PAT·App 토큰이라 머지 push 가 backend-ci push 필터(공유본 경로)로 저절로 돈다.
- Actions 판과 다른 점: 러너 IP 재시도 잡이 없고(고정 IP — EKS NAT 3.36.199.183 에서 TourAPI 도달 확인 2026-11-03),
  행사도 영속 앞에서 저장소 모양·유효 건수를 검증하고, 실 모드에 키가 없거나 collect-state 조회가 실패하면 초록불로 넘기지 않고 실패한다.
- 행사 신선도는 영속을 **막지 않는다**(영속 뒤 경보). 막으면 폴백이 이어지는 동안 포인터·coverage 도 영속되지 않아, 원인이
  풀려도 같은 낡은 저장소로 돌아가 신선도가 회복되지 않는다. 영속을 막는 것은 저장소가 깨졌을 때(모양·유효 건수)뿐이다.
- 신규율 정체 경보는 Actions 판처럼 병합을 막지 않는다 — 곁가지 태스크라 빨개져도 게시·커서 저장은 기다리지 않는다.
- 배포 초안은 `deploy/airflow/values.yaml`(적용 전 결정 목록이 그 머리에 있다).

## 한계

- 위 두 로컬 DAG 는 실제 수집을 하지 않는다 — 실 수집은 `*_live` 의 몫이다.
- CI 는 검증 로직·DAG 구조·합성 문서와 리포 행사 사본으로 도는 실행을 본다(`batch-ci.yml`, 실 API 호출 0건).

## 테스트

```bash
python3.12 -m unittest discover -s batch/tests -p "test_checks.py"    # Airflow 없이(검증 규칙·게시·실행 날짜) — Python 3.12+(CI 와 같은 버전)
# DAG 구조·실행(Airflow 3.3.2 필요)
AIRFLOW_HOME=$(mktemp -d) AIRFLOW__CORE__LOAD_EXAMPLES=False AIRFLOW__CORE__DAGS_FOLDER=$PWD/batch/dags \
  sh -c 'airflow db migrate && python -m unittest discover -s batch/tests'
```
