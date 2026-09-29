---
paths:
  - "src/features/settings/**"
---
# `src/features/settings/` — 마이(l03)·등록 숙소(l04)·설정(l05)·위치/개인화 동의 표면

**경계(G-U5-14)**: 다른 `features/*`를 import할 수 없다 — eslint 층 zone과 `src/__tests__/settingsBoundary.test.ts`(소스 재귀 스캔)가 이중으로 막는다. 조합·조회·포맷은 `pages/my-page`·`pages/my-stays`·`pages/settings` 같은 페이지 층이 진다. 다른 feature에 동명 글리프가 있어도 복제한다.

**다이얼로그 패턴**: 리포에 Modal 선례가 없다 — 확인/삭제류는 로컬 `useState`로 열고 조건부 `absolute inset-0` 오버레이로 그린다. 비즈니스 콜백은 다이얼로그 확정에서만 부른다. 딤·중앙정렬·터치 차단은 jest 원리적 사각(`repo-traps.md` 바텀시트·오버레이 절) — 자동 심판은 testID 트리 존재 + 확정 전 콜백 0회까지.

| 파일 | 역할 |
|---|---|
| `ui/MyPageScreen.tsx` | l03 마이페이지 화면 — 판정은 페이지가 하고 값만 소비(`showPast`·`styleCard?` 슬롯·`menuHandlers: Partial<Record<MenuRowKey, () => void>>`). 헤더는 `ScrollView` 밖(고정), 톱니·"캘린더 ›"는 콜백이 있을 때만 렌더(누를 곳 없는 링크를 만들지 않는다). 메뉴 카드는 `overflow-hidden`을 의도적으로 안 붙인다(iOS 그림자 클리핑) |
| `ui/MyPageScreen.l03empty.test.tsx` | 세그·카드·빈 문구·CTA 부재(TRIP-1123)·`onPressCount` 배선·캘린더 링크 분기 |
| `ui/SettingsScreen.tsx` | l05 설정 화면 — `renderRow` switch가 행 종류별로 그린다. **급소**: 이 switch는 `row.key` 리터럴만 보고 `row.ready`를 읽지 않는다 — `settingsSections.ts`의 `ready`와 switch 케이스는 따로 정합을 유지해야 한다(자동 교차심판 없음, [[가드의 사정거리]]). 제휴 토글은 `Toggle checked===true` + 실패 안내 |
| `ui/ProfileCard.tsx` | l03 프로필 카드 — `tags?` 슬롯(정식 스타일 분석일 때만 페이지가 주입), 카운트 3칸 사이 hairline 막대. 숫자 칸(`my-profile-count-{bucket}`)은 `counts===null`이면 세 칸 모두 `–`(0을 그리지 않는다, INV-4), `onPressCount`가 있을 때만 누를 수 있고 라벨 뒤 별도 `›` Text가 붙는다(한 Text에 합치면 `ProfileCard.l03parity` AC-3이 red) |
| `ui/SettingsGroup.tsx` | 설정 그룹 카드 — `label: string \| null`(TRIP-1051). `null`이면 머리글 `Text` 자체를 안 그린다(`{조건 ? <Text/> : null}` — `<Text>{null}</Text>`이 아니다. 후자는 빈 글자칸이 남아 카드가 밀린다) |
| `ui/SettingsRow.tsx` | 설정 행 부품 — `RowBody`·`PreparingRow`(`disabled`+`accessibilityState`)·`NavRow`(press+chevron, `value`·`chip` 슬롯, testID `settings-nav-{rowKey}`)·내부 `RowChip` |
| `ui/ExportRow.tsx` | 내보내기 행 |
| `ui/NicknameEditRow.tsx` | 닉네임 편집 행 |
| `ui/RevokeConfirmDialog.tsx` | 위치 동의 철회 확인 다이얼로그(조건부 오버레이 패턴) |
| `ui/DeleteAccountDialog.tsx` | 계정 삭제 2단 게이트 다이얼로그. `initialStep?`은 프리뷰 전용 — 프로덕션 호출부가 넘기지 않는지는 `src/__tests__/deleteAccountDialogGate.test.ts`가 소스 스캔으로 막는다. 목록 높이 상한은 임의값 `max-h-[Npx]` 표기여야 한다 — `DeleteAccountDialog.l05parity.test.tsx`의 탐지기가 모르는 토큰 표기에 throw한다(fail-closed) |
| `ui/LocationConsentScreen.tsx` | 위치 동의 철회 게이트 화면 — 로컬 `useState` 다이얼로그 게이트의 원형 |
| `model/settingsSections.ts` | 설정 섹션 구성 순수 파생 — 취향은 머리글 없는 카드 한 행(`preferenceRow`, TRIP-1051): `view` 없으면 값 없이 줄만(D4, 미설정 칩 없음), 있으면 `summarizePreferences`의 `kind==='value'` 축 수 / `axes.length`로 `N/7 설정됨`. 분모는 `axes.length`에서 뽑지만 축이 실제로 7개인 동안은 리터럴 `7`로 바꿔도 테스트가 못 잡는다(심판 사각, [[뮤테이션 테스팅]])·동의 칩(`consentChip`, undefined면 칩 없음)·개인화·제휴 행. `SettingsGroupVM.label`은 `string \| null` — 취향 그룹만 `null`(머리글 미렌더). `location-consent` 행 라벨은 'GPS 이동경로 기록'이고 칩은 L3(`gpsRecordingOptIn`)인데, 그 행이 여는 l06 화면 토글은 L2(`legalConsent`)를 읽어 값이 갈릴 수 있다 |
| `model/tripBuckets.ts` | l03 숫자 집계 — `phaseBucket`(단계→칸, `draft`→null)·`bucketTrips`(모름이 하나라도 있으면 null). 서버 `Trip.status`는 쓰지 않는다(날짜 파생이라 초안도 ACTIVE) |
| `model/exportSummary.ts` | 내보내기 요약 파생 |
| `model/deletionScope.ts` | 계정 삭제 고지 목록 정본 |
| `model/stayTripLink.ts` | `buildStayTripLink(savedStays, trips, basesByTripId) → Map<savedStayId, {tripId, tripName, baseAssignmentId}>` — `SavedStay`에 `tripId`가 없어 모든 여행의 거점을 역으로 뒤진다. savedStays를 바깥 루프로 돌아 유령 base를 자연 배제하고, 두 여행의 거점이면 **첫 여행이 이긴다**. `tripName`은 `Trip.title` |
| `ui/MyStaysScreen.tsx` | l04 등록 숙소 순수 프레젠테이션 — 행당 출발점 버튼 1개(`my-stays-base-toggle-{savedStayId}`)가 로컬 `openRow`로 `BaseToggleDialog`를 열고, `onConfirmBaseToggle`은 확정에서만 부른다(BR-U6-21). 좌표 미확정(`canAssignBase=false`, INV-U1-08)이면 토글이 `disabled`. 등록 행 버튼은 "출발점 해제"(실제 동작이 해제뿐). `location`이 비면 위치 줄을 안 그린다 — 프로덕션에선 항상 비어 이 단언은 vacuous. ⚠️ 미등록 행("출발점 지정") press 경로를 지키는 테스트가 없다 |
| `ui/MyStaysScreen.l04parity.test.tsx` | 배지·칩 토큰·"출발점" 문구+chevron·주소 줄 유무 짝·empty 로컬 마크업·dialog 치수·구분선 막대 |
| `ui/BaseToggleDialog.tsx` | 출발점 해제 확인 다이얼로그 — "출발점을 해제할까요? / 일정은 그대로예요." + "해제". `DIALOG_SHADOW`는 `RevokeConfirmDialog`와 값이 다르다 — 다이얼로그 틀을 `shared/ui`로 승격할 때 먼저 맞출 것 |
| `ui/SettingsGlyphs.tsx` | 설정·마이 글리프 + `MUTED`·`MUTED_SOFT` hex export(비-글리프 파일이 raw hex 없이 색을 넘기기 위함 — raw-hex 가드는 화면 소스의 hex 문자열만 스캔한다). `BookmarkGlyph`·`PencilGlyph`는 프로덕션 소비처 0이지만 parity 테스트의 부재 단언이 import하므로 남긴다. **TRIP-1051**: 옛 취향 7행 아이콘 6개(`WonGlyph`·`PeopleGlyph`·`StarGlyph`·`ArrowsSwapGlyph`·`ForkKnifeGlyph`·`GaugeGlyph`) 삭제 — 취향 행이 하나로 합쳐지며 고아가 됐다. 취향 행 아이콘은 기존 `ContrastGlyph`(반원) 재사용, 새 글리프 추가 없음 |
| `model/styleCardModel.ts` | `buildStyleCardModel(envelope) → StyleCardVM`(`official`\|`insufficient`) — 분기는 `@/entities/style-analysis`의 `resolveStyleFace`, `current`는 `resolveStyleProgress`(j05와 판정 공유 — 대칭 PBT가 잠금). `envelope.preview`는 **애초에 읽지 않는다**(INV-U5-09). 카테고리·평균 지표는 VM에 안 담는다(BR-U5-08a 이 카드 한정 비노출), 값 재계산 0(BR-U6-24) |
| `ui/StyleSummaryCard.tsx` | l03 스타일 요약 카드 — dot 게이지는 **채운/빈 dot을 서로 다른 exact testID의 View로** 렌더해 개수로 값을 잰다(SVG fill 함정 회피). 빈 dot 색은 토큰(`bg-hairline`). `my-style-detail`은 `onPressDetail`이 없으면 `disabled`. `headline?`은 계약 공백 슬롯 |
| `model/preferenceDraft.ts` | `initialSelection(view)`·`buildPreferenceInput(view, selection)` — `PreferenceView` ↔ `PreferenceInput` 역변환. 안 만진 축은 **키 자체를 omit**(openapi "생략=미변경, null=초기화"). [[역변환 함수 (View→Input)]] |
| `model/usePreferences.ts` | `useGetMePreferences` 초기값 + `usePutMePreferences` 저장 + 400 `saveError` |
| `ui/PreferencesEditScreen.tsx` | 취향 편집 컨테이너 — GET/PUT 배선 + **저장 diff 기준선을 시드와 같은 렌더에서 굳힌다**(lost update 방지, [[lost update — 저장 diff 기준선은 시드 스냅숏이어야 한다]]). `@/shared/api` 체인은 이 파일에만 있다 |
| `ui/PreferencesEditView.tsx` | 순수 뷰 — `usePreferences`·`@/shared/api` import 0(프리뷰가 안전하게 로드). testID `settings-pref-*`는 축 네임스페이스(두 축이 공유하는 라벨 충돌 방지). [[모듈 로드 크래시 연쇄]] |
| `model/personalizationCopy.ts` | `personalizationCopy(reason)` — `APPLIED`→null, `CONSENT_MISSING`→'동의하면…', `NOT_ENOUGH_RECORDS`→'기록이 더 쌓이면…'. 후자는 이미 동의한 사용자라 "동의하면" 문구가 나오면 BR-U5-44 위반(순수 층에서 잠금) |
| `model/usePersonalization.ts` | 조회 + `consentOn = reason !== CONSENT_MISSING` — **`applied`가 아니라 `reason`에서 도출한다**(다른 축, 섞으면 NOT_ENOUGH_RECORDS 얼굴에서 토글이 틀린다 — 통합 테스트가 그 reason을 프라임해야 이 도출을 잡는다). 토글 → 약관 버전 조회 → GRANT/REVOKE → 무효화. 미도착은 `CONSENT_MISSING`으로 degrade |
| `ui/PersonalizationScreen.tsx` | 무상태(`consentOn`·`reason`·`sharedItems`·`onToggle`) — l06과 달리 재확인 다이얼로그가 없다(철회가 데이터 파기가 아니라 추천 입력 제외뿐). 토글은 `shared/ui/Toggle` |
| `ui/InfoChip.tsx` | 누르지 않는 회색 칩 — 프로필 태그·스타일 칩·여행 카드 칩 공용(소비처가 settings 안뿐이라 shared 미승격) |
| `ui/cardShadow.ts` | `CARD_SHADOW`(카드 껍데기 공용). `LocationConsentScreen`에 같은 값의 지역 상수가 있다 |
| `model/preferenceSummary.ts` | `summarize`·`summarizePreferences` — 취향 7축을 `설정 안 함`/값 요약으로(`initialSelection` 재사용, 동행 끝에 반려동물). `settingsSections.ts`는 이제 `kind`만 읽는다 — `PreferenceSummary.text`(가운뎃점 요약 문자열)는 TRIP-1051 이후 운영 소비처 0(`preferenceSummary.test.ts`만 읽음), `PreferenceRowKey` export도 외부 소비자 0(03b 참고-2, 새 티켓 후보) |
| `ui/SettingsScreen.l05parity.test.tsx` | 취향 값/칩 짝·동의 칩·개인화·chevron 색·칩 r8·바탕 |

**관측된 함정**: `enabled:false`로 꺼진 쿼리도 TanStack Query는 캐시에 남은 `data`를 돌려준다 — `SettingsPage`(제휴 토글)·`StayDetailPage`(고지 시트)가 같은 `getGetMeSettingsQueryKey()`를 공유하므로 게스트 판정에 `isAuthed &&`를 명시하지 않으면 이전 계정의 `dismissed:true`가 새어 법정 제휴 고지를 우회한다.
