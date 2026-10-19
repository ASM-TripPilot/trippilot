# batch — 수집 파이프라인(로컬, Airflow)

수집 → **검증** → 게시 → 신선도 감시를 DAG 로 묶어, 깨진 수집 결과가 정본을 덮지 못하게 구조로 막는다(TRIP-1468).
운영 배치는 지금처럼 GitHub Actions(`ai-poi-collect.yml`·`ai-event-collect.yml`)가 돈다 — 이 폴더는 로컬 전용이다.

## 실행

```bash
docker compose --profile batch up -d airflow     # http://localhost:8090 — 계정·비밀번호는 `docker logs trippilot-airflow`
docker exec trippilot-airflow airflow dags test poi_collect 2026-10-20
docker exec trippilot-airflow airflow dags test event_collect 2026-10-20
docker compose --profile batch down
```

게시본은 `batch/.out/`(git 제외)에 쌓인다 — 실제 수집은 `published/`, 드라이런은 `dry-run/`. 드라이런은 실제 게시본과
수집 커서를 건드리지 않는다(같은 곳에 두면 스케줄 드라이런이 실제 수집분을 리포 사본으로 되돌린다). git·`collect-state`
브랜치는 건드리지 않는다. Linux 에서는 `AIRFLOW_UID=$(id -u)` 를 주고 띄운다(이미지가 uid 50000 으로 돈다).

| DAG | 주기(KST) | 태스크 |
|---|---|---|
| `poi_collect` | 04:00 | collect → validate(건수 하한·이름·**백엔드가 시도를 읽는가**) → publish |
| `event_collect` | 04:40 | collect → validate(**그날 유효한 행사 수** 하한) → publish |
| `event_freshness` | 매시 | **실제 수집** 게시본의 마지막 수집(지역별 `coverage` 최댓값)이 36시간을 넘으면 실패. 실제 게시본이 없으면 건너뛴다 |

- **드라이런이 기본**(`dry_run=True`) — 실제 API 를 부르지 않고 리포의 수집본(`ai/data/collected_*.json`)을 수집 결과로 쓴다
  (게시본이 있어도 매번 리포 사본 — 리포가 갱신되면 드라이런도 따라간다).
- `dry_run=False` 는 운영 워크플로와 같은 스크립트·인자를 부른다. POI 는 한 번 분량(변경분)을 게시본에
  `merge_pois_docs.py --allow-mixed` 로 **병합한** 문서를 검증하고(그대로 게시하면 공유본이 수백 건으로 줄어든다), 운영과 같은
  **축소 가드**(병합본 + 의도 제거 몫 ≥ 기준)를 건다. 수집 커서는 게시가 끝난 뒤에만 옮긴다(먼저 옮기면 검증에서 막힌 제안이
  "기제안"으로 남아 다시 수집되지 않는다). 행사는 운영처럼 검색·LLM 추출과 팝업 큐레이션이 실패하면 실패, TourAPI 축제만
  실패해도 앞 수집분을 살린다. 수집 태스크는 재시도하지 않는다(재시도 = 호출 한도를 더 씀).
  키(TourAPI·네이버·카카오·Azure OpenAI)가 환경에 있어야 하고, 컨테이너 이미지에는 ai 의존성·uv 가 없어 호스트에서만 된다.
- **검증 실패 = 게시 안 함.** validate 가 `AirflowFailException` 으로 끝나면 publish 는 돌지 않고, 지난 게시본이 그대로 남는다.
- 검증 규칙은 `checks.py` 하나 — Airflow 없이 단위 테스트한다. 시도 판정은 백엔드 `RegionResolver` 의 거울이다 — 첫 낱말이
  시도 **정식 이름**과 정확히 같아야 하고(공백도 백엔드처럼 ASCII 공백으로만 자른다), 시도 목록은 백엔드 지역 시드
  (`R__seed_region_catalog.sql`)에서 읽는다. 약칭·잘린 이름을 펴는 것은 수집 병합 단계(ai `expand_sido_abbrev`)의 몫이다.

## 왜 — 실제로 있었던 사고 두 건

| 사고 | GitHub Actions(지금) | 이 파이프라인 |
|---|---|---|
| 2026-10-10 `cce8c508` — 배포가 8월에 커밋된 행사 사본을 구워, 그날 유효한 행사가 346건이 아니라 10건 | 수집은 매일 성공. 배포가 정본을 읽지 않아 아무도 몰랐다(사후에 배포 단계에 가드를 넣었다) | `event_collect.validate` 가 "그날 유효 건수 < 하한"으로 게시를 막고, `event_freshness` 가 수집 정지를 알린다 |
| 2026-10-20 #1427 — 수집 공유본 병합에 시도명이 잘린 주소 2건(`부산광역 …`·`제주특별자치 …`) | 봇 PR 은 CI 가 승인 대기로 멈춘 채 즉시 auto-merge 된다(#1427: 체크 0개, 6초) — 머지 뒤 backend-ci 가 깨져 열린 PR 전부가 막혔다. 지금은 병합 직후 "백엔드가 읽는가" 검사로 PR 전에 막는다(TRIP-1471) | `poi_collect.validate` 가 "시도를 정할 수 없는 주소 2건 — 낙동강 생태탐방선(부산광역 …)…"으로 게시 전에 막는다(실측: #1427 데이터로 드라이런이 정확히 그 2건을 짚었다). 검증이 게시 **앞에** 구조로 놓여 있다는 것이 차이다 |

## GitHub Actions 와 비교

| | GitHub Actions cron | Airflow |
|---|---|---|
| 재시도 | 잡 전체 재실행(수동) | 태스크 단위로 지정할 수 있다 — 여기서는 일부러 끈다(수집 재시도 = 호출 한도를 더 씀, 검증 실패는 같은 문서면 같은 결과). 실패한 태스크부터 다시 돌리는 것은 된다(앞 태스크 결과 재사용) |
| 백필 | 날짜를 입력으로 받는 수동 디스패치 | 논리 날짜로 지난 날 재실행(`dags test <dag> <날짜>`) — 검증의 "그날"도 그 날짜다. 단 드라이런에서만 맞다: 실제 수집기는 벽시계 기준으로 지난 행사를 지우므로 과거 날짜 실제 백필은 검증에 막힐 수 있다 |
| 의존 | 스텝 순서(한 잡 안), 실패 처리는 셸 조건문 | 태스크 의존 그래프 — 검증이 실패하면 게시가 구조적으로 안 돈다 |
| 관측 | 잡 요약·로그 | 태스크별 상태·로그·실행 이력 UI, 신선도 DAG |
| 운영 비용 | 0(러너 무료 한도) | 상시 스케줄러·메타 DB 가 필요 — 지금 규모에서 운영에 올릴 이유는 없다 |

결론: 운영은 GitHub Actions 를 유지한다. 이 파이프라인이 보여 주는 것은 "검증 게이트를 게시 앞에 두는 구조"이고,
그 구조는 GitHub Actions 에서도 스텝으로 옮길 수 있다.

## 한계

- 컨테이너(`apache/airflow` 이미지)에는 ai 패키지 의존성과 uv 가 없어 `dry_run=False` 는 호스트에서 Airflow 를 돌릴 때만 된다.
- `dry_run=False` 경로는 실제 키가 필요해 테스트하지 않았다 — 운영 워크플로와 같은 스크립트·인자를 부르는 것까지만 맞췄다.
- 실제 키로 돌리는 수집은 CI 에서 하지 않는다(실 API 호출 0건 규칙). CI 는 검증 로직·DAG 구조·드라이런만 본다(`batch-ci.yml`).

## 테스트

```bash
python3 -m unittest discover -s batch/tests -p "test_checks.py"       # Airflow 없이
# DAG 구조·드라이런(Airflow 3.3.2 필요)
AIRFLOW_HOME=$(mktemp -d) AIRFLOW__CORE__LOAD_EXAMPLES=False AIRFLOW__CORE__DAGS_FOLDER=$PWD/batch/dags \
  sh -c 'airflow db migrate && python -m unittest discover -s batch/tests'
```
