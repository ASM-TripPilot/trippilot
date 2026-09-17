---
paths:
  - "src/features/home/**"
  - "src/app/(tabs)/index.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## home

- **홈 실 데이터** → 서버 API가 **아직 없다**(TRIP-170 범위 밖). `homeFixtures.ts`를 API 훅으로 교체하는 자리.
- **라이브 홈=discovery/planning만, collecting·upcoming·postTrip은 여전히 phase 무심판** → (TRIP-401로 갱신) `(tabs)/index.tsx`는 더 이상 phase를 안 넘기지 않는다 — 지배(비-ENDED 중 가장 이른) 여행이 있으면 실제로 `planning` 얼굴로 착지하고, 그때만 조건부-자식 `PlanningHome`이 그 여행의 itinerary GET으로 카드 CTA 목적지를 정해 push한다(`resolveHomePhase.dominantTripId`). `HomeScreen.test.tsx`의 버튼-집합 동치(370-AC-4)도 TRIP-401부터 discovery+**planning** 2얼굴을 잰다(T3 AC-6/AC-7) — planning의 hero CTA·브릿지 CTA 죽은 버튼은 닫혔다. **여전히 열려 있는 것**: collecting/upcoming/postTrip 단계는 서버가 그 단계를 줄 계약이 없어(가정 E) 라이브에 결코 안 나오고, 그 얼굴들의 CTA(`home-spots-more`(collecting) 등)는 픽스처 전용 프리뷰에서만 존재 — `SpotsSection`이 `asButton`을 구조적으로 항상 넘겨 collecting에서도 role="button"+onPress=undefined(무동작 버튼)인 채 무심판. phase CTA를 collecting/upcoming/postTrip으로 확장할 때(U6/U7) 이 잔여 사각을 잠가야 한다(TRIP-370 03b 참고-1 잔여).
- **`MagazineHero`를 같은 화면에 여러 번 렌더할 땐 testID 다중매치를 조심** → discovery 히어로 캐러셀(TRIP-694)이 5장을 렌더하는데, `MagazineHero`가 testID를 자체 하드코딩하면 `getByTestId('home-magazine-hero')`가 다중매치로 throw한다(프로즌 다수 동시 red). 계약: `MagazineHero`는 옵셔널 `testID`(기본값 `home-magazine-hero`)를 받고, 반복 렌더 시 **첫 인스턴스만 기본값, 나머지는 다른 값**을 명시로 넘긴다. 공유 컴포넌트를 다중 인스턴스로 재사용할 때 재발 가능한 패턴 — 새 반복 렌더를 만들 때 이 계약부터 확인.
- **캐러셀 페이지 수는 도트가 아니라 페이지 컨테이너로 잠근다** → 도트(`home-hero-dot-N`)는 정적 View 나열이라 페이지 수와 무관하게 존재 개수를 위조할 수 있다(예: 실제로는 1페이지인데 도트 5개만 정적으로 그림). 페이지 수의 진짜 앵커는 `heroes.map`이 실제로 낳는 `home-hero-page-N` 컨테이너 존재 여부다 — 새 캐러셀·페이저를 잠글 땐 도트가 아니라 컨테이너를 단언.
- **`hero` prop이 빈 배열이면 크래시한다(방어 없음)** → `HomeScreenProps.hero`가 TRIP-694로 `readonly HomeMagazineHero[]`(5장 배열)가 됐는데, `hero[0]`(collecting/planning이 첫 장만 쓰는 2곳, `HomeScreen.tsx`)는 빈 배열이면 `undefined`가 되어 `MagazineHero`가 `hero.eyebrow` 등 접근에서 크래시한다. 현 호출자(`(tabs)/index.tsx`·`_dev/preview.tsx`)는 항상 5장 픽스처라 오늘은 미도달이지만, 홈은 "픽스처→서버 API 훅 교체 자리"(위 항목)라 서버가 빈 리스트를 주는 순간 이 경로가 실화된다(INV-4 침묵 실패 계열, 방어 미조치).
- **FAB 숨김 게이트(`sections.kind==='loading'`)는 `phase`를 안 본다 — "loading⟹phase없음"은 라우트에만 있는 불변식** → `HomeScreen.tsx`가 로딩이면 `SavedMenuFab`·`CreateTripFab`을 무조건 미렌더하는데, 이 조건은 `phase`(discovery/collecting/planning/…) 축과 독립이다. `<HomeScreen phase={UPCOMING_PHASE} sections={{kind:'loading'}}/>`처럼 phase 얼굴 + loading kind 조합은 타입상 유효해 FAB만 사라진 어중간 화면을 만들 수 있다. 오늘은 라우트(`app/(tabs)/index.tsx:108`)가 isPending일 때 phase 없이만 loading을 넘겨 실경로·프리뷰·테스트 어디서도 미발생(TRIP-699 code-critic 03b 참고-1, 미룸 판정). collecting/upcoming/postTrip 얼굴이 라이브로 로딩 하위상태를 얻는 순간(가정 E 해제) 재확인 대상.
