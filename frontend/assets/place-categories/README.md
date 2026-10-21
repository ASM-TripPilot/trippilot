# 장소 카테고리 이미지

장소(POI) 카드·상세의 이미지를 **서버 사진 유무와 관계없이 카테고리별 생성 이미지로 통일**하려고 만든 수묵담채(K6) 일러스트. 지역 커버(`../region-covers/`)와 같은 스타일이다.

> **아직 앱에 연결돼 있지 않다.** 이 폴더는 에셋과 생성 기록만 담는다. 카테고리 → 이미지 조회 모듈과 카드 교체는 후속 작업이다.

## 구성 (30파일 · 약 2.1MB)

카테고리 10종 × 가로 3:2 변형 3장, 738×492 WebP q75. 파일명 `<slug>-<n>.webp`(n = 1~3).

| 카테고리 | slug | | 카테고리 | slug |
|---|---|---|---|---|
| 명소 | `sight` | | 쇼핑 | `shopping` |
| 맛집 | `food` | | 문화 | `culture` |
| 카페 | `cafe` | | 액티비티 | `activity` |
| 야경 | `night_view` | | 미술 (신설) | `art` |
| 자연 | `nature` | | 술집 (신설) | `bar` |

slug 는 AI 경계 코드(`SIGHT`·`NIGHT_VIEW`…)를 소문자로 쓴 것이다. **미술·술집은 아직 백엔드 `PoiCategory` enum·DB CHECK·OpenAPI·생성 타입에 없다** — 이미지만 먼저 만들었다. 모르는 카테고리·null 은 `../region-covers/placeholder/place.webp`(중립 폴백).

## 장면

- 맛집은 **특정 요리·문화권으로 읽히지 않게** 했다(한옥·노렌·등·간판 없음): 식당 홀 / 가게 외관 / 테이블 위 요리.
- 야경·술집은 밤·황혼 장면이라 다른 카테고리보다 어둡다. 문화(전시장)는 옅어서 작은 칸에서 가장 흐릿하다.
- 특정 지역·실존 랜드마크는 그리지 않았다 — 어느 지역 장소에나 붙는다.

## 쓸 때 (설계 제안)

- **변형 고르기**: 랜덤이 아니라 `해시(poiId) % 3`. 같은 장소는 어느 화면에서든 같은 그림이고(목록→상세 일관), 목록 재활용 중 깜빡이지 않으며, 테스트가 결정적이다. 이웃 항목이 같은 변형일 확률은 약 1/3.
- **모양**: 세로 칸(홈 컬렉션 카드 230×300, 상세 hero 402×430)도 가로 변형을 `cover` 로 잘라 쓴다 — 소재를 가운데 두고 그려서 알아볼 수 있다. 세로 전용 이미지는 만들었으나 변형이 1장뿐이라 목록과 상세에서 다른 그림이 나오므로 넣지 않았다.
- **위치**: 카드·일정 슬롯(형제 슬라이스)이 모두 쓰므로 `shared/` — 코드→파일 정적 `require` 맵(`entities/trip/config/regionCovers.ts` 와 같은 모양).

## 다시 만들 때 (`_tools/gen_categories.py`)

```bash
python3 -I frontend/assets/place-categories/_tools/gen_categories.py gen food,bar   # 없는 PNG 만 생성
python3 -I frontend/assets/place-categories/_tools/gen_categories.py export          # PNG → 738px WebP q75
```

스타일 문구·API 사정은 `../region-covers/README.md` 와 같다(레포 루트 `.env` Azure 키, 한 장 ~45초, 동시 3개). 원본 PNG 는 `../region-covers/_tools/out/`(커밋 안 함)에 쌓인다.

⚠️ `sight`·`cafe`·`night_view`·`nature`·`shopping`·`culture`·`activity` 의 **변형 1번은 원본 PNG 가 사라지고 WebP 만 남았다** — `export` 는 원본 PNG 가 있어야 돌아가므로, 이 일곱 장을 다시 뽑으면 같은 소재의 새 그림이 나온다(프롬프트는 `SUBJECTS` 에 그대로 있다).
