---
paths:
  - "src/features/home/**"
  - "src/app/(tabs)/index.tsx"
  - "src/pages/home/**"
  - "src/pages/magazine/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## home

- **홈 매거진·discovery 데이터는 픽스처다**(`homeFixtures.ts`·`magazineFixtures.ts`) — planning 얼굴만 실제 itinerary GET을 탄다. 서버가 매거진을 주게 되면 픽스처를 훅으로 바꾸는 자리다.
- **라이브 홈은 discovery·planning 두 얼굴뿐이고 postTrip은 프리뷰 전용이다** → `pages/home/ui/HomePage.tsx`는 지배(비-ENDED 중 가장 이른) 여행이 있으면 `planning`으로 착지하고, 그때만 조건부-자식 `PlanningHome`이 그 여행의 itinerary GET으로 카드 CTA 목적지를 정해 push한다(`resolveHomePhase.dominantTripId`). postTrip은 서버가 그 단계를 줄 계약이 없어(가정 E) 라이브에 안 나오고, `HomeScreen.test.tsx`의 버튼-집합 동치도 discovery·planning만 잰다. `HomePhase`에 얼굴을 새로 들이면 그 얼굴의 버튼(role="button"+onPress 미배선)이 무심판으로 남는지부터 확인한다.
- **`MagazineHero`를 같은 화면에 여러 번 렌더할 땐 testID 다중매치를 조심** → discovery 히어로 캐러셀이 여러 장을 렌더하는데, `MagazineHero`가 testID를 자체 하드코딩하면 `getByTestId('home-magazine-hero')`가 다중매치로 throw한다(프로즌 다수 동시 red). 계약: `MagazineHero`는 옵셔널 `testID`(기본값 `home-magazine-hero`)를 받고, 반복 렌더 시 **첫 인스턴스만 기본값, 나머지는 다른 값**을 명시로 넘긴다. 공유 컴포넌트를 다중 인스턴스로 재사용할 때 재발 가능한 패턴 — 새 반복 렌더를 만들 때 이 계약부터 확인.
- **캐러셀 페이지 수는 도트가 아니라 페이지 컨테이너로 잠근다** → 도트(`home-hero-dot-N`)는 정적 View 나열이라 페이지 수와 무관하게 존재 개수를 위조할 수 있다(예: 실제로는 1페이지인데 도트 5개만 정적으로 그림). 페이지 수의 진짜 앵커는 `heroes.map`이 실제로 낳는 `home-hero-page-N` 컨테이너 존재 여부다 — 새 캐러셀·페이저를 잠글 땐 도트가 아니라 컨테이너를 단언.
- **통합 히어로는 계획 중·여행 중이 부품을 공유하는 캐러셀이다 — page0만 트립, 나머지는 매거진** → `PlanningHeroCarousel`(`HomeScreen.tsx`)의 `home-hero-page-0`은 `IntegratedTripHero`(`heroes[0]?.imageUrl` 배경 재사용)를, `home-hero-page-1`~`-4`는 `MagazineHero`(`heroes.slice(0,4)`, 내부 testID `home-hero-slide-N`)를 감싼다. `kind: 'planning'` 하나가 계획 중·여행 중 둘 다를 가리키며, 본문 섹션 수(1 vs 2)는 `phase.showSpots?: boolean`이 가른다(`kind`가 아님) — 여행 중일 때만 `resolveHomePhase`가 이 필드를 채운다.
- **라이브 CTA 문구는 픽스처(6-b 프리뷰)와 다르다 — jest는 이 갭을 원리적으로 못 본다** → `ctaLabelForStatus`(`homePhase.ts`, 라이브 생산자)는 `'일정 이어서 짜기'`·`'확정 일정 보기'`·`'여행 일정 보기'`(꺾쇠 › 없음, status 기반 — 여행 중은 Figma "오늘 일정 보기"와 문구 자체가 다름)를 반환하는데, `homeFixtures.ts`의 `HOME_PLANNING_PROPS`·`HOME_TRAVELING_PROPS`는 꺾쇠 포함 문구를 하드코딩한다. `homePhase.test.ts`는 라이브 값을, `HomeScreen.test.tsx`는 픽스처 값을 정답으로 못 박아 둘 다 green인 채로 라이브 카드 문구가 Figma와 어긋난다. CTA 문구를 만질 땐 `homeFixtures.ts`와 `ctaLabelForStatus`를 함께 확인한다.
- **FAB 숨김 게이트(`sections.kind==='loading'`)는 `phase`를 안 본다 — "loading⟹phase없음"은 `HomePage`에만 있는 불변식** → `HomeScreen.tsx`가 로딩이면 `SavedMenuFab`·`CreateTripFab`을 무조건 미렌더하는데, 이 조건은 `phase` 축과 독립이다. phase 얼굴 + `sections={{kind:'loading'}}` 조합은 타입상 유효해 FAB만 사라진 어중간 화면을 만들 수 있다. 오늘은 page(`pages/home/ui/HomePage.tsx`)가 isPending일 때 phase 없이만 loading을 넘겨 실경로·프리뷰·테스트 어디서도 미발생. postTrip 얼굴이 라이브로 로딩 하위상태를 얻는 순간 재확인 대상.
