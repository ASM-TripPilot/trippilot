# batch — 수집 파이프라인(로컬, Airflow)

수집 → **검증** → 게시를 DAG 로 묶어, 깨진 수집 결과가 정본을 덮지 못하게 구조로 막는다(TRIP-1468).
운영 배치는 지금처럼 GitHub Actions(`ai-poi-collect.yml`·`ai-event-collect.yml`)가 돈다 — 이 폴더는 로컬 전용이다.

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
| `event_collect` | 04:40 | collect → validate(**그날 유효한 행사 수** 하한·**마지막 수집 7일 이내**) → publish |

- 실제 수집은 운영 워크플로의 몫이다 — 이 DAG 는 그 결과물(리포 사본)을 검증 게이트에 통과시키는 구조만 돌린다.
  신선도는 따로 DAG 를 두지 않고 `event_collect.validate` 안에서 본다 — 저장소의 `coverage`(지역별 마지막 수집 시각) 중
  가장 늦은 것이 실행 날짜보다 `max_age_days`(기본 7일)를 넘게 앞서면 막는다. 그날 유효 건수만으로는 늦다: 사본에 미래
  행사가 남아 있으면 수집이 멈춰도 몇 주 동안 하한 위에 머문다(2026-10-19 사본은 12-07 에야 하한 아래로 떨어진다).
  7일인 이유: 운영 수집은 하루 3개 지역씩 돌아 17개 지역이 6일에 한 바퀴다 — 가장 늦은 시각이 한 바퀴보다 오래됐으면 어느
  지역도 수집되지 않은 것이고, 하루 여유를 더했다. 지금 리포 사본(마지막 수집 10-19)은 10-26 까지 통과하고 10-27 부터
  빨개진다 — 사본을 갱신하라는 신호다.
- 실행마다 후보 사본을 `batch/.out/runs/<dag>/<run_id>/` 에 둔다. 게시가 끝나면 지우고(POI 사본이 48.6MB 라 남기면 한 달에
  1.5GB), 검증에 실패한 실행의 후보는 원인을 보라고 남긴다.
- **검증 실패 = 게시 안 함.** validate 가 `AirflowFailException` 으로 끝나면 publish 는 돌지 않고, 지난 게시본이 그대로 남는다.
- 검증 규칙은 `checks.py` 하나 — Airflow 없이 단위 테스트한다. 시도 판정은 백엔드 `RegionResolver` 의 거울이다 — 첫 낱말이
  시도 **정식 이름**과 정확히 같아야 하고(양끝은 Kotlin `trim()` 과 같은 문자만 — Python `strip()` 과 달리 U+0085 는 남긴다 —, 가운데는 백엔드처럼 ASCII 공백으로만 자른다), 시도 목록은 백엔드 지역 시드
  (`R__seed_region_catalog.sql`)에서 읽는다. 약칭·잘린 이름을 펴는 것은 수집 병합 단계(ai `expand_sido_abbrev`)의 몫이다.

## 왜 — 실제로 있었던 사고 두 건

| 사고 | GitHub Actions(지금) | 이 파이프라인 |
|---|---|---|
| 2026-10-10 `cce8c508` — 배포가 8월에 커밋된 행사 사본을 구워, 그날 유효한 행사가 346건이 아니라 10건 | 수집은 매일 성공. 배포가 정본을 읽지 않아 아무도 몰랐다(사후에 배포 단계에 가드를 넣었다) | `event_collect.validate` 가 "그날 유효 건수 < 하한"으로 게시를 막는다. 유효 건수가 아직 하한 위여도 마지막 수집이 7일보다 오래됐으면 같은 validate 가 막는다 |
| 2026-10-20 #1427 — 수집 공유본 병합에 시도명이 잘린 주소 2건(`부산광역 …`·`제주특별자치 …`) | 봇 PR 은 CI 가 승인 대기로 멈춘 채 즉시 auto-merge 된다(#1427: 체크 0개, 6초) — 머지 뒤 backend-ci 가 깨져 열린 PR 전부가 막혔다. 데이터는 수집 병합 단계에서 고쳤다(#1431), 봇 PR 앞 게이트는 TRIP-1475 가 다룬다 | `poi_collect.validate` 가 "시도를 정할 수 없는 주소 2건 — 낙동강 생태탐방선(부산광역 …)…"으로 게시 전에 막는다(실측: #1427 데이터로 돌리면 정확히 그 2건을 짚고, #1431 이 고친 지금 리포 사본 60,521건은 통과한다). 검증이 게시 **앞에** 구조로 놓여 있다는 것이 차이다 |

## GitHub Actions 와 비교

| | GitHub Actions cron | Airflow |
|---|---|---|
| 재시도 | 잡 전체 재실행(수동) | 태스크 단위로 지정할 수 있다 — 검증 실패는 같은 문서면 같은 결과라 재시도 없이 실패로 끝낸다. 실패한 태스크부터 다시 돌리는 것은 된다 |
| 백필 | 날짜를 입력으로 받는 수동 디스패치 | 논리 날짜로 지난 날 실행 — 검증의 "그날"도 그 날짜다. 시험 실행은 `dags test <dag> <날짜>`, 정식 백필은 `airflow backfill create`(`catchup=False` 라 밀린 날을 자동으로 돌지는 않는다) |
| 의존 | 스텝 순서(한 잡 안), 실패 처리는 셸 조건문 | 태스크 의존 그래프 — 검증이 실패하면 게시가 구조적으로 안 돈다 |
| 관측 | 잡 요약·로그 | 태스크별 상태·로그·실행 이력 UI |
| 운영 비용 | 0(러너 무료 한도) | 상시 스케줄러·메타 DB 가 필요 — 지금 규모에서 운영에 올릴 이유는 없다 |

결론: 운영은 GitHub Actions 를 유지한다. 이 파이프라인이 보여 주는 것은 "검증 게이트를 게시 앞에 두는 구조"이고,
그 구조는 GitHub Actions 에서도 스텝으로 옮길 수 있다.

## 한계

- 실제 수집(API 호출·수집 커서·병합)은 하지 않는다. 운영 수집기를 DAG 로 옮기려면 병합 뒤 검증·커서 저장 순서까지
  옮겨야 하고(TRIP-1475 가 운영 쪽에서 다룬다), 지금 규모에서 그만한 이득이 없다.
- CI 는 검증 로직·DAG 구조·합성 문서와 리포 행사 사본으로 도는 실행을 본다(`batch-ci.yml`, 실 API 호출 0건).

## 테스트

```bash
python3 -m unittest discover -s batch/tests -p "test_checks.py"       # Airflow 없이(검증 규칙·게시·실행 날짜)
# DAG 구조·실행(Airflow 3.3.2 필요)
AIRFLOW_HOME=$(mktemp -d) AIRFLOW__CORE__LOAD_EXAMPLES=False AIRFLOW__CORE__DAGS_FOLDER=$PWD/batch/dags \
  sh -c 'airflow db migrate && python -m unittest discover -s batch/tests'
```
