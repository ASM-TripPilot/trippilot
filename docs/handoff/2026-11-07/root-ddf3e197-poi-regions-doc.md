---
session: ddf3e197-8c82-4da8-b2f5-261457bcfa7b
area: root
cwd: frontend (작업 대상은 ai/·deploy/·backend/scripts, 데이터는 ~/trippilot-data)
branches_seen: [feature/region-covers-gw-gb-gn]
current_branch: feature/region-covers-gw-gb-gn (이 브랜치는 지역 커버 이미지용 — POI 작업은 새 브랜치에서)
span_kst: "11-04 → 11-07"
ended_by: 사용자 요청(세션 인수인계)
status: 진행중(코드 #2031 머지 · 데이터 #2032 · 닫기 TRIP-1811 PR, 배포는 사람 몫)
resume_local: "claude --resume ddf3e197-8c82-4da8-b2f5-261457bcfa7b"
related_prs: [1815, 2031, 2032]
tickets: [TRIP-1537, TRIP-392, TRIP-1810, TRIP-1811]
session_name: 장소 데이터 확장(부산·강원·경북·경남 정제) → 공유본 분할 반영
picked_up_by: Claude Code 2026-11-07 04:20 (레인 poi, TRIP-1810, 브랜치 chore/TRIP-1810-DATA-regions-doc)
---
# 정제본(149,743곳)을 공유본에 넣기 위한 "지역 문서 분리(A안)" — 코드→개발서버 확인→PR 순

⚠️ **로컬 세션 전용.** 데이터·스크립트가 `~/trippilot-data`(레포 밖)에 있어 `claude --cloud` 는 이어받을 수 없다. 클라우드는 2단계 코드만 가능하지만 입력 문서가 없어 검증이 안 된다.

## 목적
부산·강원·경북·경남의 네이버 평판 정제를 끝냈다(공유본 112,481 → 149,743곳, 107.2MB). 이 문서를 `ai/data/collected_pois.json` 한 파일에 넣으면 GitHub 단일 파일 한도(100MB)를 넘고, 레포가 PUBLIC 이라 네이버 파생값이 공개된다. 그래서 **한 파일로 합치지 않고 문서를 둘로 나눈다(A안)**.

## 결정 (사용자 확정 / 내가 제안해 채택)
- **A안 = "기존 파일 그대로 + 새 지역 파일 추가"** (사용자 확정 11-06). 기존 `ai/data/collected_pois.json`(90MB)은 그대로 두고 수집 병합도 이 파일만 계속 갱신한다. 이번 정제의 신규·보강 행은 `ai/data/collected_pois_regions.json`(가칭)으로 따로 둔다. 선례: `collected_localdata.json`·`collected_localcafe.json`·`ai/data/overture/` 가 이미 공유본과 따로 있다(`collect_overture.py` 머리 주석).
- **같은 `(source, content_id)` 가 두 파일에 있으면 지역 파일이 이긴다**(사용자 확정 11-07).
- 비공개 전환은 **박태현이 한다**(레포 admin). 운영 적재 뒤 가장 마지막이다. **사용자 결정(11-07)으로 지역 문서 한 파일은 레포 PUBLIC 인 채로 커밋한다**(노출 위험 고지·합의). 그 밖의 파생값 파일은 여전히 커밋하지 않는다.
- 경기는 수집이 끝난 뒤(약 4~5일, 11-06 기준) 같은 스크립트로 한 번 더 정제한다 — 이 작업과 분리.

## 검증된 사실 (이어받을 때 다시 확인할 필요 없음)
- 현재 레포 `visibility` = **PUBLIC** (11-07 확인). `ai/data/collected_pois.json` 은 git 추적 파일, 최신 갱신 커밋 `2005a8e9e`(#2009, 112,481건).
- `backend/scripts/ingest_pois.py` 는 **문서 경로를 여러 개 받는다**("준 순서대로 보낸다", `paths` nargs=\*). 순서대로 보내므로 뒤가 앞을 덮는다 → `[main, regions]` 순이면 "지역 파일이 이긴다"가 그대로 성립한다.
- `ai/Dockerfile` 은 `COPY data ./data` 라 새 파일은 이미지에 자동으로 들어간다.
- 배포 적재: `deploy/eks/runtime_pois.py` 의 `DOCUMENT = "/app/data/collected_pois.json"` 단일 값, `manifest()` 가 `base = [python, ingest_pois.py, --base-url, BACKEND, DOCUMENT]`. 여기를 두 경로로 넓히면 된다. `deploy/eks/tests/test_runtime.py` 가 이 모양을 단언한다.
- `collected_pois.json` 을 직접 읽는 곳(전부 단일 파일 가정): `.github/workflows/{ai-poi-collect,ai-fee-collect,ai-fee-sources-probe,ai-llm-smoke,ai-business-status-reminder,aws-deploy,backend-ci}.yml`, `ai/scripts/**` 다수(`merge_pois_docs.py`·`collect_novelty.py`·`build_region_profiles.py` 등), 백엔드 IT `PoiProposalRealDocumentIT`(+`PoiInternalApiIT`). **이번 A안에서는 수집 쪽을 안 건드리는 게 목표**라 대부분 손대지 않는다.
- 측정(정제본): 전체 107.2MB / 네이버 값(태그·영업시간)을 뺀 공유본 97.1MB / 보강 파일 19.9MB(gzip 2.2MB). → **B안(레포 밖 보강)만으로는 한도 해결이 안 된다**고 사용자에게 설명 완료, A안 선택.

## 정제 결과 (입력 데이터)
위치: `~/trippilot-data/processed/regions/` — 정본 절차는 `~/trippilot-data/RUNBOOK.md` §12 (스크립트 `scripts/refine_regions.py` → `judge_nonfood.py` → `build_regions.py`).

| 항목 | 값 |
|---|---|
| 업로드 문서 (공유본 + 이번 변경 합본) | `upload-regions.json`, 149,743곳, 107.2MB |
| 신규 행 | 41,414 (맛집 31,319·카페 6,007·술집 3,713·자연 240·그 외 135) |
| 보강(기존 행 태그·영업시간) | 3,590 (영업시간 새로 채움 2,889) |
| LOST 후보 (1차 필터 탈락한 서버 기존 행) | 4,152 → `lost-list.csv` |
| 이름 겹침으로 제외 | 2,676 → `dups-review.csv` (사람 검토 대기) |
| OSM 단독 보류 / 오분류 제거 / 비음식 탈락 | 3,482 / 884 / 377 |

규칙은 RUNBOOK §11(서울·제주)과 같다. 단 **테마 태그 평균은 지역·카테고리별**로 잡았다(서울 기준이면 시골 주차 태그가 32% 로 넘쳤다).

## 멈춘 지점 (2026-11-07, 레인 poi · TRIP-1810)
- **코드 PR #2031**(데이터 없음): 배포 적재가 이미지 안에 지역 문서가 있으면 `[공유본, 지역 문서]` 순으로 붓는다 · CI 경로 · 계약 IT(문서 없으면 건너뜀). 이 문서가 함께 커밋된다.
- **지역 문서**: `~/trippilot-data/processed/regions/collected_pois_regions.json` — 레포 밖, **커밋 안 함**. 수치·명령은 RUNBOOK §12.1.
- **로컬 리허설 통과**: 신규 39,193 · 보강 3,569 · 탈락 0(위 표의 41,414 / 3,590 과 다른 이유는 아래).
- **데이터 PR #2032**: `ai/data/collected_pois_regions.json` 한 파일.
- **TRIP-1811 PR**: LOST 를 공유본에서 빼고(제외 목록 `poi_excluded_filtered.json` + 재병합), `--close-missing` 이 여러 문서를 합쳐 대조한다.
- **결정(사용자 11-07)**: 겹치면 지역 문서가 이긴다 · 이름 겹침 2,676 은 뺀다 · LOST 4,152 는 TRIP-1811 로 분리 · 비공개 전환은 운영 적재 뒤 맨 마지막.

**위 표와 수가 다른 이유** — 정제(prep) 뒤에 공유본이 바뀌었다(#2009 112,481 → #2017 체인 794 제거 · #2019 85 추가 → 111,772).
- 신규 41,414 → 39,193: 체인·비여행 2,218(#2017 의 최신 게이트, 그대로 두면 지운 체인이 지역 문서로 되돌아온다) · prep 뒤 들어온 행과 이름 겹침 3.
- 보강 3,590 → 3,569: prep 뒤 공유본에서 빠진 행 21.

## 다음에 이어서 할 일
### 머지 — 오케
1. #2032(지역 문서) 먼저, 그다음 TRIP-1811 PR. 일일 병합이 공유본을 건드렸으면 1811 은 최신 develop 에서 재병합 뒤 머지(RUNBOOK §12.2).
2. 공유본이 지역 문서 생성 뒤 바뀌어도 머지는 막히지 않는다. 겹치는 행 값을 최신으로 맞추려면 `build_regions.py --regions-only` 재실행(RUNBOOK §12.1).

### 개발 서버 확인 — 사람(AWS/kubectl 필요)
- 접속 확인 → DB 스냅샷 → 배포 → 장소 수·카테고리·일정 생성·도우미 질의("서울 미술관"·"홍대 술집"·"부산 해변 카페" 등) 확인. **개발 서버 디스패치는 아직 한 번도 안 했다. 운영은 승인 안 됨.**
- LOST 닫기: `poi_close_missing_dry_run` 으로 닫을 수를 먼저 본다. **4,152 와 다를 수 있다** — 공유본에서 먼저 빠졌는데 아직 안 닫힌 행(#2017 체인 794 등)도 함께 닫힌다. 숫자를 보고 `poi_close_missing=true` 를 사람이 켠다. 이후 배포에서는 끈다.
- 이미지에 지역 문서가 없는 채로 닫으면 안 된다 — OVERTURE 가 41% 로 409 가 나서 막히지만, 순서는 #2032 먼저.
- ART·BAR(V2.79·V2.80)와 평판 태그를 쓰는 AI 코드는 develop 에 이미 있다 — 함께 배포할 브랜치 없음.

## 열린 문제
- **경기 정제**: 뒤에 지역 문서를 한 번 더 갱신한다(이 작업과 분리).
- **로컬 compose `poi-ingest`** 는 지역 문서를 붓지 않는다 — 데이터 PR 때 필요하면 한 줄(`collected_localdata.json` 선례).
- **적재 Job 시한 20분**: 두 문서 154,534건은 EKS 미측정(로컬은 갱신 26초). 첫 배포 로그에서 확인.

## 함정 / 주의
- **네이버 데이터는 내부용.** 레포가 PUBLIC 인 동안 `ai/data/` 에 정제본·태그가 든 어떤 파일도 커밋하지 마라. 데이터·스크립트는 `~/trippilot-data` 에만(RUNBOOK 도 레포 밖).
- **데이터 푸시·배포 금지**: 사용자가 승인하지 않았다. 개발·운영 서버 모두 해당. 로컬 DB 리허설은 허용. 코드 PR 은 데이터가 없어 지금 올린다.
- **`prep.pkl` 의 번호는 prep 때 공유본의 행 번호다** — 공유본이 바뀐 뒤 전체 모드를 그대로 돌리면 엉뚱한 행을 덮는다(전체 모드에 멈춤 가드, 지역 문서 모드는 키로 얹는다).
- 수집기는 `scripts/stop_enrich.sh` 로만 멈춘다(경기 수집이 도는 중). 충전기 연결·덮개 열림 유지. 막히면(429·captcha) 우회하지 마라.
- **#1815**(Airflow 실 수집 DAG, 열림·미머지)도 `collected_pois.json` 공유본을 PR 로 갱신한다. 이 작업은 그 파일을 건드리지 않으므로(LOST 열린 문제 1의 (a)만 예외) 충돌은 적지만, (a)를 택하면 같은 파일을 두 PR 이 만진다 — 푸시 직전 재기준 필수.
- 레포 PUBLIC 인 동안 `ai/data/README.md` 등 문서에 정제 통계(곳수)는 써도 되지만 **개별 장소의 평점·리뷰 수는 쓰지 마라.**
- 현재 체크아웃(`trippilot`)의 브랜치 `feature/region-covers-gw-gb-gn` 에는 지역 커버 이미지 미커밋 변경(64장)이 있다 — 그 작업과 섞지 마라.
- `docs/handoff` 이 문서는 새 커밋이 필요하다. 지금은 위 브랜치 워킹트리에 **미커밋 상태**로 있다.
