---
paths:
  - "src/entities/**"
---
# `src/entities/` — FSD entities 층 (TRIP-804 규칙 신설 · TRIP-806 첫 입주·형제 격리)

둘 이상 feature가 쓰는 **도메인 단위**(place·stay·trip·itinerary-slot 같은 카드·타입·업무 규칙)를 두는 층. **첫 입주 = `place`(TRIP-806).** 슬라이스별 파일 목록의 정본은 `src/entities` 디렉토리와 `docs/structure.generated.md`.

## import 방향
- entities → shared 만 참조한다. features · widgets · pages · app · app-shell 은 참조하지 못한다(하위 층은 상위 층을 모른다).
- **형제 슬라이스는 서로 모른다**: `entities/place`는 `entities/stay`를 직접 import 하지 못한다(features 슬라이스 격리와 동형 — 슬라이스마다 zone이 자동 생성). 공용이 생기면 형제에서 꺼내지 말고 `shared`로 내린다.
- **교차는 `@x` 창구로만**: 도메인끼리 꼭 참조해야 하면 **제공자가 소비자에게만** 내주는 `entities/<제공자>/@x/<소비자>/**` 폴더를 통한다. 예: place가 itinerary-slot에게 `entities/place/@x/itinerary-slot/`로 공개 API를 내주면, `entities/itinerary-slot/**`만 그 경로를 import할 수 있다(다른 슬라이스는 여전히 차단). `@x`는 **미래 대비 규약**이라 실제 폴더는 필요할 때 만든다(TRIP-806 시점엔 없음).
- `eslint.config.js`의 층 zone(`import/no-restricted-paths`)이 강제하고 — 형제 격리 except는 자기 슬라이스 + `entities/*/@x/<자기>/**`를 **전부 절대 glob**으로 둔다(상대 glob은 정당한 자기 import까지 오탐, 문제로그 2026-09-12) — `src/__tests__/importBoundaryLayers.test.ts`가 형제 차단·`@x` 통과를 실측한다.

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷 + **entities 한정 `@x`**(교차 창구, 위 참고). 옛 칸 `screens·containers·hooks·store` 부활 금지. `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층. `fsdLayerStructure.test.ts`가 이 세그먼트 목록(entities만 `@x` 추가)을 잠근다.

## `src/entities/place/` (TRIP-806)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `Place`·`PoiCategory`·`SavedPlace`를 `@/shared/api/generated/schemas`에서 **얇게 재수출**(새 shape 아님 — 원본이 바뀌면 자동 추종) + 화면 전용 뷰모델 `PlaceCardVM`(서버 계약 아님, `ExploreLandingScreen`에서 이관). generated 직참조는 이 파일만 허용(G2 스캔 예외) — `ui/`·`lib/`가 `@/shared/api/generated`를 직접 물면 경계 위반. |
| `lib/formatDistance.ts` | 미터→`"820m"`/`"3.2km"` 문자열 반올림 코어. `legDistance`(itinerary)·`radiusUsedLabel`(itinerary)이 각자 복붙하던 반올림 로직을 위임하도록 바뀜(계약·출력 불변, 재발명 0). |
| `ui/PlaceRailCard.tsx` | d05 목적지 상세 레인 카드. 폭 `160px`(Seed 정본값) — 옛 d05 로컬 카드의 `150px`에서 10px 넓어짐(testID·텍스트는 보존, 폭만 6-b 실기 확인 대상). |
| `ui/PlaceGridCard.tsx` | d04 탐색 그리드 카드. 하트 저장 testID·"담음" 배지·pending(연타 방지) 가드. |
| `ui/PlaceRowCard.tsx` | 범용 행 카드(save?/trailing?/subtitle 옵셔널 슬롯). **이번 사이클 소비처 0**(d02는 로컬 `SavedPlaceRow` 유지, h13은 로컬 구조 유지 — 둘 다 entities에서는 글리프·부제만 가져간다). AC·승인 테스트가 요구해 존재하지만 존치 여부는 d02(TRIP-706)·h13(TRIP-798) 정합 시 재판단(문제로그 아님 — 개발로그 인수인계 참고). |
| `ui/SlotCandidateCard.tsx` | itinerary(h13)·planb 후보 시트 공용, 옵셔널 슬롯 7개(showImage·showNameTestId·badge·selected·slack·trailing·distanceLabel)+`testIDPrefix`로 두 소비처 구조 발산을 흡수. **실값 옵셔널 prop(이름·이미지·태그) 미구현**(현재 "이름 준비 중" 고정 문구) — BE 계약 보강 TRIP-851 완료 후 연계. planb 루트 정규식이 `image-`·`name-`를 감산 안 함 주의(테스트에서 `queryByTestId`로 null 확인 필수). |
| `ui/PlaceSubtitle.tsx` | 부제 조각(`parts.join(' · ')`만, 표시 로직 무변경 — 3-a 결정: 조각을 인자화했을 뿐 기존 3공식 중 어느 것도 통일하지 않음). |
| `ui/PlaceGlyphs.tsx` | **하트 글리프(Outline·Filled) 정본, 2026-09-13부터.** `features/explore/ui/ExploreGlyphs.tsx`의 동명 함수는 5-c에서 삭제됨 — 새 하트 소비처는 반드시 이 파일에서 가져온다(raw-hex·fill 스캔 제외 관례라 두 벌이 나면 기계가 못 잡는다, repo-traps 참고). |
