---
paths:
  - "src/features/trip/**"
  - "src/pages/trip/trip-new-*/**"
  - "src/pages/trip/trip-settings/**"
  - "src/widgets/trip-edit-sheets/**"
  - "app/trips/**"
  - "src/features/create-trip/**"
  - "src/features/assign-trip-base/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 여행 만들기 위저드 (g01)

- **기간 포맷터 6벌의 정본은 `entities/trip/lib/formatTripPeriod.ts`다(`tripSummary.ts`·`tripWizardStep1.ts`는 내부 사용 `import`만 남았다)** → 6벌(`formatDateRange`·`formatSectionRange`·`formatTripRange`·`formatConfirmedDateRange`·`formatTripDateRange`·`formatDateRangeWithDow`)은 en dash(U+2013)·미들닷(U+00B7)·공백 유무가 서로 달라 하나로 통합하면 회귀한다.

## 거점 숙소 단일 카드 (g02)


## 숙소 선택 시트 후보 카드 (g02)

- **`CheckGlyph` 는 공용(`shared/ui/glyphs`)만 갖는다** — 슬라이스 것은 `TripCheckGlyph`·`SlotCheckGlyph` 처럼 접두가 붙어 grep 이 정의 파일을 바로 가리킨다(TRIP-1773 전엔 여러 `*Glyphs.tsx` 에 동명이심볼이 있었다). 소비처 수는 그래도 `from` 절로 확인한다(`TripCheckGlyph` 는 `StaySelectSheet.tsx` 하나가 쓴다).
- **거점 편집의 "바뀌었나" 기준(스냅샷)은 마운트 후 첫 서버 응답이라, l04가 선채움한 캐시로 카드가 즉시 뜬 뒤 첫 조회가 끝나기 전에 [지정]하면 지정 뒤 값이 기준이 되어 [완료]가 묻지 않고 나간다** → 결과는 암묵적 [그대로 두기](자동 재생성 없음). 첫 조회가 끝내 실패하면 옛 캐시가 기준이 되어 가짜 "바뀌었어요"도 가능(미재현). 어느 테스트도 "스냅샷 전 조작" 창을 안 밟는다 — `TripBasesPage.integration.test.tsx` 「편집 모드 (TRIP-1082)」 describe는 모두 첫 응답 뒤에 조작한다.

## 예산 등급 (g01)


## 여행 설정 (g03, TRIP-1787)

- **저장·삭제 성공의 캐시 갱신(목록 무효화·단건 쓰기)은 훅 옵션 `onSuccess`(`context.client`)에 있다 — `mutate(vars, { onSuccess })` 호출별 콜백에 두면 응답 전 뒤로 간 화면에서 건너뛰어 목록이 낡는다** → 5-b 가 이 페이지에서 또 잡았다(`traps-itinerary` GeneratingPage 와 같은 함정인데 그 파일은 이 경로에서 안 로드된다). 화면 이동·토스트만 호출별 콜백에 둔다. 지키는 것은 TripSettingsPage unmount 테스트 2건뿐이다.
- **일과 시간을 바꿔도 이미 만든 일정은 다시 계산되지 않고 그 사실을 알리는 안내도 없다** → 서버에 "매일 끝" 필드가 없어 행은 「하루 시작 ~ 21:00」 고정 표기다. Figma 에 안내 프레임이 없어 의도적 공백이다.
- **끝난 여행 잠금은 `trip.status==='ENDED'` 다 — `classifyTripPhase` 로 바꾸지 마라**(날짜 지난 작성 중은 draft 라 저장이 열린 채 서버 409 를 맞는다).

## 여행 설정 — 기간·커버 (g03, TRIP-1788)

- **PATCH 를 저장·일수 확정 두 길에서 겹쳐 부르면 앞 호출의 개별 콜백이 버려져 잠금 ref 가 영영 안 풀린다** → 같은 `usePatchTripsTripId` 의 `mutate` 를 두 번 부르면 TanStack Query 는 마지막 호출의 `onSuccess`·`onError`·`onSettled` 만 실행한다. 저장 응답을 기다리는 중 기간 행 → 「다시 만들기」가 겹치면 저장 버튼이 켜진 채 눌러도 PATCH 0건이 된다(03b 경고-1, 임시 통합 테스트로 재현). 잠금은 `patchingRef` 하나로 두 길이 같이 쓴다 — **둘로 쪼개지 마라.** 지키는 것은 통합 M1 뿐이다.
- **위저드로 만든 여행은 박수 합 = 기간이라 기간만 줄이는 PATCH 는 서버 INV-U1-14(Σ박수 ≤ 기간)로 400 이다** → 일수 확정 본문은 `fitDestinationNights` 를 거쳐 박수를 새 기간에 맞춘다(마지막 여행지부터 줄임). 여러 도시를 줄이면 마지막 도시가 0박으로 남을 수 있다(서버 허용, 0박 도시의 실제 화면은 못 봤다).
- **기간 잠금은 서버보다 보수적이다** → 오늘 시작 여행은 앱이 잠그고 서버는 받는다, 일정 없는 여행은 서버가 시작 뒤에도 일수 변경을 받는데 앱은 잠근다(사용자 결정 "여행 중 잠금"). 반대로 달력은 오늘을 새 시작일로 고르게 해, 저장하면 그 여행이 바로 잠긴다. 서버 결함이 아니니 "고치지" 마라.
- **일수 변경 확정의 서버 쪽 약속은 TRIP-1789 가 먼저 나가야 성립한다** → 옛 서버는 `discardItinerary` 를 모르는 채 날짜만 옮겨(일정은 옛 날짜에 남는다) 일정이 어긋난다. 출시는 서버 main 승격 → 앱 순서(머지는 1789 → 1788). 기계 강제는 없다.
- **커버 그림 비교 테스트의 기대값은 `coverSourceForKey` 로 만든다** → jest 의 번들 이미지는 `{testUri: <require 한 파일 기준 상대경로>}` 라 테스트 파일에서 직접 `require` 하면 같은 그림도 불일치한다. 소비처 `Image` 는 `source` 를 `[{testUri}]` 배열로 바꿔 호스트에 단다. 함수 경계 계약은 `layer-entities.md` `lib/regionCover.ts`.
