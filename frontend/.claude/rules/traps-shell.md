---
paths:
  - "src/app/**"
  - "src/shared/ui/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 라우팅 · 셸

- **미인증 딥링크 노출** → `stays/`·`stays/register`·`trips/new/**`는 전부 `(tabs)` 밖의 파일시스템 라우트라 `SplashGate`의 `Stack.Protected` guard 어디에도 안 걸린다 — 미인증에서도 딥링크로 열린다(API가 401을 주므로 데이터 노출은 없다). 새 라우트를 이 그룹들 밖에 추가할 때 guard 안에 넣을지는 아무도 안 물어본다 — 고치려면 라우트 위치 자체를 바꾸는 결정이 선행돼야 한다.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.
- **탭 셸 자리표시자(`shell-tab-placeholder-*`) 교체는 test-designer가 `tabsShell.test.tsx`의 해당 describe를 직접 갈아야 한다 — 기계가 자동 갱신해 주지 않는다** → `my`(TRIP-604)·`records`(TRIP-575) 두 탭이 이미 이 경로를 거쳤다(explore·itinerary는 더 앞서 승격 — `records`가 마지막으로 남았던 껍데기라 이제 5탭 전부 실화면, `shell-tab-placeholder-*` 잔존 참조는 `tabsMyRoute.test.tsx`·`tabsRecordsRoute.test.tsx`의 사후 부재 확인용뿐). 새 탭이 준비 중 셸을 실화면으로 승격할 때 이 describe를 안 바꾸면 placeholder testID 부재로 계속 red다 — 뮤테이션 실측(§5, "지금 상태(placeholder 유지)에서 새 단언이 red인가")으로 새 계약이 실제로 무는지 증명하는 것이 정본 절차. **QueryClient 부재 크래시**: 셸 교체로 새 조회 훅(`useGetTrips` 등)을 물게 되면 `render(<XxxRoute/>)`가 QueryClient 없이 크래시할 수 있다 — `my`·`home`·`records` 전부 **기존 전역 목**(TRIP-371의 `useGetTrips` 빈 목록 스텁)이 이미 있어 신규 목 없이 빈 얼굴로 안전 렌더됐다(재사용 우선, 새 훅이면 새 목 필요).
