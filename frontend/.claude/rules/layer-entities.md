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
