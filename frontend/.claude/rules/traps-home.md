---
paths:
  - "src/features/home/**"
  - "src/app/(tabs)/index.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## home

- **홈 실 데이터** → 서버 API가 **아직 없다**(TRIP-170 범위 밖). `homeFixtures.ts`를 API 훅으로 교체하는 자리.
- **라이브 홈=discovery/planning만, collecting·upcoming·postTrip은 여전히 phase 무심판** → (TRIP-401로 갱신) `(tabs)/index.tsx`는 더 이상 phase를 안 넘기지 않는다 — 지배(비-ENDED 중 가장 이른) 여행이 있으면 실제로 `planning` 얼굴로 착지하고, 그때만 조건부-자식 `PlanningHome`이 그 여행의 itinerary GET으로 카드 CTA 목적지를 정해 push한다(`resolveHomePhase.dominantTripId`). `HomeScreen.test.tsx`의 버튼-집합 동치(370-AC-4)도 TRIP-401부터 discovery+**planning** 2얼굴을 잰다(T3 AC-6/AC-7) — planning의 hero CTA·브릿지 CTA 죽은 버튼은 닫혔다. **여전히 열려 있는 것**: collecting/upcoming/postTrip 단계는 서버가 그 단계를 줄 계약이 없어(가정 E) 라이브에 결코 안 나오고, 그 얼굴들의 CTA(`home-spots-more`(collecting) 등)는 픽스처 전용 프리뷰에서만 존재 — `SpotsSection`이 `asButton`을 구조적으로 항상 넘겨 collecting에서도 role="button"+onPress=undefined(무동작 버튼)인 채 무심판. phase CTA를 collecting/upcoming/postTrip으로 확장할 때(U6/U7) 이 잔여 사각을 잠가야 한다(TRIP-370 03b 참고-1 잔여).
