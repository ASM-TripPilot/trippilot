# POI 평판·성격 태그와 미술·술집 카테고리 적용

지도 앱 평판에서 뽑은 **파생 태그**(`인기1`~`인기5`·`평점높음`·성격 태그)와 정식 카테고리 **미술(ART)·술집(BAR)** 을 서버에 싣고 AI 가 쓰게 하는 절차다. 티켓: TRIP-1537(부모) · 1545(카테고리 승격). 장소 적재 일반 절차는 [poi-수집본-적재.md](poi-수집본-적재.md) 를 먼저 읽는다.

> **원자료는 이 레포에 두지 않는다.** 리뷰 수·별점·키워드 투표 같은 원본 값과 선별 기준은 레포 밖 운영 문서에 있고, 서버에는 아래 파생 태그와 영업시간만 올라간다. 이 문서도 파생 태그의 **의미와 쓰임**만 적는다.

## 1. 무엇이 바뀌었나

| 영역 | 변경 | 위치 |
|---|---|---|
| 데이터 | 서울·제주 장소에 파생 태그·정리된 영업시간·카테고리 승격을 반영한 공유본 | `ai/data/collected_pois.json` |
| DB | `poi.category` CHECK 에 `미술`·`술집` 추가(V2.79), `poi_public` 뷰에서 평판 태그 제외(V2.80) | `backend/app/src/main/resources/db/migration/` |
| BE | `PoiCategory` +미술·술집(경계 코드 `ART`·`BAR`), 평판 태그를 공개 응답에서 제외(`PublicTags`), "전시·문화" 컨셉에 미술 포함 | `backend/modules/place-data`, `itinerary-generation` |
| AI | `ART`·`BAR` 카테고리, 평판 보정·성격 태그 반영, `NIGHTLIFE_TAG` 가 `술집` 으로, 도우미 SQL 프롬프트 0.2.0 | `ai/src/trippilot`, `ai/prompts` |
| FE | API 타입 재생성, 장소 추가·탐색 칩에 미술·술집(·액티비티) | `frontend/src` |

## 2. 태그 어휘

| 태그 | 뜻 | AI 쓰임 | 사용자에게 |
|---|---|---|---|
| `인기1`~`인기5` | 리뷰 수 구간(경계는 `ai/src/trippilot/domain/poi.py` 주석). 100건 미만은 안 붙임 | 규칙 점수·풀 정렬(`reputation_bonus`) | **숨김** |
| `평점높음` | 별점이 높고 리뷰가 충분한 곳 | 위와 같음 | **숨김** |
| 성격 태그 13종 `혼밥` `혼술` `단체` `데이트` `뷰` `야외` `사진` `아이동반` `작업` `분위기` `가성비` `주차` `오래머물기` | 방문자 투표에서 그 곳이 평균보다 두드러지는 성격 | 도우미 탐색 순위·도우미 SQL, 재계획 규칙 폴백(말 → 태그 동의어 표 `domain/theme_tags.py`), 재계획 LLM 이 후보 줄에서 봄 | 그대로 보임 |
| `술집` | 술을 파는 밤 장소. 승격 뒤에도 태그를 **유지**한다 | 밤 시간대 규칙(`NIGHTLIFE_TAG`: 영업시간 추정·낮 추천 제외·늦은 시각 후보) | 보임 |
| `갤러리` | 미술 카테고리 승격의 기준 태그 | 데이터 승격 때만 | 보임 |

- 태그가 **없는** 곳은 "나쁘다"가 아니라 "모른다"다 — 평판 보정은 0(중립)이다.
- 한 곳에 붙는 성격 태그는 최대 3개다. 세분류 태그(`곱창,막창,양` 등)도 같은 `tags` 에 실린다.

## 3. 카테고리 10종

`명소 맛집 카페 야경 자연 쇼핑 문화 액티비티` + **미술**(문화에서 갤러리·미술관을 분리) + **술집**(맛집·액티비티에서 술집을 분리). 경계 코드는 `SIGHT FOOD CAFE NIGHT_VIEW NATURE SHOPPING CULTURE ACTIVITY ART BAR`.

| 항목 | 미술 | 술집 |
|---|---|---|
| 규칙 점수 가중 | 0.8(문화와 같음) | 0.6(카페와 같은 단) |
| 기본 체류 | 75분 | 90분 |
| 날씨 | 실내 | 실내 |
| 같은 단지 묶기 | 일반 | 식당처럼 제외 |
| 문화 취향·탐색 | 문화를 고르면 미술도 | — |

도우미 **분류** 선택지(LLM 이 고르는 카테고리)는 8개 그대로다 — 분류 스키마 바이트가 바뀌면 재생 기록·판본 실측이 무효가 된다(`tests/domain/test_plan_tools.py` 골든).

## 4. 공개 면에서 숨기는 것

`인기N`·`평점높음` 은 앱 화면(장소 상세 칩·장소 추가 서브타이틀)과 도우미 SQL(`poi_public.tags`)에 그대로 나가면 리뷰 규모가 드러나고 `#인기5` 같은 문구가 뜬다. 그래서:

- 앱 API: `PlaceResponse`(`PoiDtos.kt`) 와 일정 표면(`PoiSurfaceService`)이 `PublicTags.of()` 로 걸러서 내보낸다.
- 도우미: `V2.80` 이 `poi_public` 뷰의 `tags` 에서 같은 태그를 뺀다.
- AI 내부 읽기(`/internal/pois`)는 원본 태그를 준다 — AI 가 점수에 쓴다.
- **두 규칙(`PublicTags` 와 V2.80 뷰)은 함께 고친다.** 한쪽만 바꾸면 화면과 도우미가 어긋난다.
- 막지 못하는 것: AI 가 만든 이유 문장이 "인기 있는" 같은 말을 쓰는 것(프롬프트 몫).

## 5. 왜 공유본을 교체하나

`aws-deploy.yml` 은 **배포마다** AI 이미지의 `ai/data/collected_pois.json` 을 백엔드에 upsert 한다(`deploy/eks/runtime_pois.py`). 수신은 `Poi.refreshed` 로 이름·좌표·카테고리·영업시간·태그를 덮어쓰고 LOST 를 ACTIVE 로 되살린다. 그래서 DB 만 고치면 **다음 배포가 되돌린다**(태그·영업시간·카테고리 복귀, 닫은 곳 부활). 공유본이 DB 정본이므로:

- 새 값·카테고리 승격(`poi.category` 가 `ART`/`BAR`)을 **공유본에 넣는다.**
- 서버에서 내릴 곳은 공유본에서 빼고 `--close-missing` 으로 LOST 처리한다(삭제 아님 — 담기·확정 일정이 행을 가리킨다).
- 일일 수집이 같은 파일을 갱신하므로(나중 수집분이 이김) 교체 전에 열린 `chore/poi-data-sync` PR 을 먼저 정리하고, 교체 직전에 최신 공유본 위로 다시 얹는다.
- GitHub 단일 파일 한도 100MB. 한 행에 한 줄 직렬화(`merge_pois_docs.dumps_doc`)를 지킨다 — 지금 ≈ 75MB.

## 6. 적용 순서

### 6.0 사전
1. 레포를 **비공개**로 전환하고 `gh repo view ASM-TripPilot/trippilot --json visibility` 로 확인한다(공유본을 올리기 전).
2. 서버 접속 환경 확인: `aws sts get-caller-identity` · `kubectl get ns` · `SERVICE_AUTH_TOKEN`(k8s secret `trippilot-shared`). 절차는 [poi-수집본-적재.md](poi-수집본-적재.md) §사전 준비.
3. `gh pr list --head chore/poi-data-sync --state open` — 열린 공유본 갱신 PR 이 있으면 먼저 머지·정리한다.

### 6.1 PR 머지 순서 (배포는 아직 아님 — 배포는 수동 `workflow_dispatch` 뿐이다)
1. **AI 평판·술집 PR**(`feature/TRIP-1537-AI-poi-signal-tags`): 작고 서로 의존이 없다.
2. **카테고리 PR**(`feature/TRIP-1545-ART-BAR-category`): 1 의 `domain/poi.py`·`scorer.py` 와 충돌하면 1 위로 리베이스하고, `ai/docs/openapi.json` 은 `cd ai && uv run python scripts/export_openapi.py` 로 다시 만든다(ai-ci 가 일치를 강제). 마이그레이션 번호(V2.79·V2.80)가 다른 PR 과 겹치면 올린다.
3. **데이터 PR**(`chore/TRIP-1537-DATA-shared-poi-doc`): 머지 직전에 최신 공유본 위로 다시 얹고(레포 밖 도구) 전체 AI 테스트를 돌린다. **1·2 가 머지된 뒤**에 머지한다 — 문서가 `ART`/`BAR` 를 쓰므로 그 코드를 먼저 가져야 CI 와 리뷰가 의미 있다.

### 6.2 개발 서버 배포 (한 번에)
1. 배포 입력: `environment=dev`, `target=dev`, `mode=apply`, `deploy_application=true`, `poi_close_missing_dry_run=true`, `poi_close_missing=false`.
   - 순서가 맞아야 한다: 백엔드 기동(Flyway V2.79·V2.80) → AI → "Load the POI shared document" 단계. BE·AI 가 `ART`/`BAR` 를 알기 전에 문서가 먼저 들어가면 그 행이 `DROP_UNKNOWN_CATEGORY` 로 탈락한다.
2. 배포 요약의 "POI load" 줄에서 **닫힐 수**를 본다(예상: `LOCALDATA` 6,933, 나머지 출처 0). 크게 다르면 멈춘다. 비율 가드(409)가 걸리면 이유를 먼저 확인한다.
3. 같은 입력에서 `poi_close_missing=true`(dry_run 끔)로 한 번 더 배포한다. 적재 Job 제한은 20분이다(10만 곳이 들어오는지 첫 배포에서 확인).
4. **이후 일반 배포에서는 `poi_close_missing` 을 켜지 않는다**(공유본에 없는 곳이 LOST 가 된다).

### 6.3 개발 서버 확인
- 장소 수·카테고리별 수(미술·술집이 새로 보이는지), `술집` 태그, 영업시간 보유 수.
- 앱 API 응답에 `인기N`·`평점높음` 이 **없는지**(장소 상세·일정), 도우미 SQL 이 그 태그를 못 거르는지.
- 일정 생성(서울·제주, 취향 문화/액티비티 포함)과 재계획이 정상인지, 후보에 술집이 낮 일정에 섞이지 않는지.
- 도우미 질의(LLM 품질은 오프라인으로 못 쟀으니 직접): "서울 미술관", "홍대 술집", "혼자 가기 좋은 카페", "아이랑 갈 만한 곳". 도우미가 만든 SQL 이 `category IN ('문화','미술')`·`'술집'`·성격 태그를 쓰는지 로그로 본다.
- 이전 앱 빌드로 장소 상세·목록이 깨지지 않는지(새 카테고리 값을 모르는 클라이언트).

### 6.4 운영 서버
6.2·6.3 과 같은 순서(`environment=prd`, `target=prod`). 앞서 DB 스냅샷을 받는다. FE 칩 변경은 앱 빌드 배포에 실린다 — 서버와 독립이다.

## 7. 되돌리기
- 닫기: 적재 스크립트가 남긴 `close-missing-undo-<출처>-<시각>.sql` 을 `psql` 로 먹이거나, 닫힌 곳을 다시 담은 공유본을 배포하면 LOST 가 ACTIVE 로 돌아온다.
- 카테고리: 승격한 곳을 되돌리려면 공유본의 `poi.category` 를 원래 값으로 돌려 다시 배포한다(DB CHECK 는 값을 더하기만 했으므로 두어도 된다).
- 전체: 배포 전 스냅샷 복원.

## 8. 한계·후속
- LLM 선호 점수와 재계획 구성 LLM 은 평판을 모른다(후보 줄에 태그가 없다). 평판이 닿는 곳은 풀 정렬·규칙 점수(LLM 전 선별·폴백)·도우미 탐색·재계획 규칙 폴백이다.
- 재계획(PlanB) 프롬프트에는 태그 의미 설명이 없다 — 품질을 재 보고 정한다.
- 일일 수집이 TourAPI 행을 갱신하면 그 행의 파생 태그가 사라질 수 있다 — 공유본 교체 뒤 주기 점검이 필요하다.
- `poi_public.tags` 가 식이라 `tags` 인덱스를 못 탄다(규모가 작아 영향은 작다고 보지만 측정 전).
