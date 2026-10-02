---
paths:
  - "src/features/settings/**"
---
# `src/features/settings/` — 마이(l03)·등록 숙소(l04)·설정(l05)·위치/개인화 동의 표면

화면 뷰 6개(마이·설정·위치 동의·개인화·취향 수정)와 그 전용 부품·model(`deletionScope`·`personalizationCopy`·`usePreferences`)은 **TRIP-1154로 `pages/{my-page,settings,settings-location,settings-personalization,settings-preferences}` 이사** — 행은 `layer-pages.md`. 여기엔 page가 함께 쓰는 model·공용 부품(`InfoChip`·`cardShadow`·`SettingsGlyphs`)·`StyleSummaryCard`·l04 몫만 남았다.

**경계(G-U5-14)**: 다른 `features/*`를 import할 수 없다 — eslint 층 zone이 막는다. 조합·조회·포맷은 `pages/my-page`·`pages/my-stays`·`pages/settings` 같은 페이지 층이 진다. 다른 feature에 동명 글리프가 있어도 복제한다.

**다이얼로그 패턴**: 리포에 Modal 선례가 없다 — 확인/삭제류는 로컬 `useState`로 열고 조건부 `absolute inset-0` 오버레이로 그린다. 비즈니스 콜백은 다이얼로그 확정에서만 부른다. 딤·중앙정렬·터치 차단은 jest 원리적 사각(`repo-traps.md` 바텀시트·오버레이 절) — 자동 심판은 testID 트리 존재 + 확정 전 콜백 0회까지.

| 파일 | 역할 |
|---|---|
| `model/settingsSections.ts` | 설정 섹션 구성 순수 파생 — 취향은 머리글 없는 카드 한 행(`preferenceRow`, TRIP-1051): `view` 없으면 값 없이 줄만(D4, 미설정 칩 없음), 있으면 `summarizePreferences`의 `kind==='value'` 축 수 / `axes.length`로 `N/7 설정됨`. 분모는 `axes.length`에서 뽑지만 축이 실제로 7개인 동안은 리터럴 `7`로 바꿔도 테스트가 못 잡는다(심판 사각, [[뮤테이션 테스팅]])·동의 칩(`consentChip`, undefined면 칩 없음)·개인화·제휴 행. `SettingsGroupVM.label`은 `string \| null` — 취향 그룹만 `null`(머리글 미렌더). `location-consent` 행 라벨은 'GPS 이동경로 기록'이고 칩은 L3(`gpsRecordingOptIn`)인데, 그 행이 여는 l06 화면 토글은 L2(`legalConsent`)를 읽어 값이 갈릴 수 있다 |
| `model/tripBuckets.ts` | l03 숫자 집계 — `phaseBucket`(단계→칸, `draft`→null)·`bucketTrips`(모름이 하나라도 있으면 null). 서버 `Trip.status`는 쓰지 않는다(날짜 파생이라 초안도 ACTIVE) |
| `model/exportSummary.ts` | 내보내기 요약 파생 |
| `model/stayTripLink.ts` | `buildStayTripLink(savedStays, trips, basesByTripId) → Map<savedStayId, {tripId, tripName, baseAssignmentId}>` — `SavedStay`에 `tripId`가 없어 모든 여행의 거점을 역으로 뒤진다. savedStays를 바깥 루프로 돌아 유령 base를 자연 배제하고, 두 여행의 거점이면 **첫 여행이 이긴다**. `tripName`은 `Trip.title` |
| `ui/BaseToggleDialog.tsx` | 출발점 해제 확인 다이얼로그 — "출발점을 해제할까요? / 일정은 그대로예요." + "해제". **제품 소비처 0**(TRIP-1076으로 l04가 다이얼로그 없이 거점 화면 push로 바뀜 — 프리뷰 `my-stays-dialog` 키만 문다, 고아). l04 뷰 `MyStaysScreen`은 TRIP-1148로 `pages/my-stays/ui`로 이사. `DIALOG_SHADOW`는 `RevokeConfirmDialog`와 값이 다르다 — 다이얼로그 틀을 `shared/ui`로 승격할 때 먼저 맞출 것 |
| `ui/SettingsGlyphs.tsx` | 설정·마이 글리프 + `MUTED`·`MUTED_SOFT` hex export(비-글리프 파일이 raw hex 없이 색을 넘기기 위함 — 기계 강제 없음, raw hex 소스 스캔은 TRIP-1145·1154에서 삭제). `BookmarkGlyph`·`PencilGlyph`는 프로덕션 소비처 0이지만 parity 테스트의 부재 단언이 import하므로 남긴다. **TRIP-1051**: 옛 취향 7행 아이콘 6개(`WonGlyph`·`PeopleGlyph`·`StarGlyph`·`ArrowsSwapGlyph`·`ForkKnifeGlyph`·`GaugeGlyph`) 삭제 — 취향 행이 하나로 합쳐지며 고아가 됐다. 취향 행 아이콘은 기존 `ContrastGlyph`(반원) 재사용, 새 글리프 추가 없음 |
| `model/styleCardModel.ts` | `buildStyleCardModel(envelope) → StyleCardVM`(`official`\|`insufficient`) — 분기는 `@/entities/style-analysis`의 `resolveStyleFace`, `current`는 `resolveStyleProgress`(j05와 판정 공유 — 대칭 PBT가 잠금). `envelope.preview`는 **애초에 읽지 않는다**(INV-U5-09). 카테고리·평균 지표는 VM에 안 담는다(BR-U5-08a 이 카드 한정 비노출), 값 재계산 0(BR-U6-24) |
| `ui/StyleSummaryCard.tsx` | l03 스타일 요약 카드 — dot 게이지는 **채운/빈 dot을 서로 다른 exact testID의 View로** 렌더해 개수로 값을 잰다(SVG fill 함정 회피). 빈 dot 색은 토큰(`bg-hairline`). `my-style-detail`은 `onPressDetail`이 없으면 `disabled`. `headline?`은 계약 공백 슬롯 |
| `model/preferenceDraft.ts` | `initialSelection(view)`·`buildPreferenceInput(view, selection)` — `PreferenceView` ↔ `PreferenceInput` 역변환. 안 만진 축은 **키 자체를 omit**(openapi "생략=미변경, null=초기화"). [[역변환 함수 (View→Input)]] |
| `model/usePersonalization.ts` | 조회 + `consentOn = reason !== CONSENT_MISSING` — **`applied`가 아니라 `reason`에서 도출한다**(다른 축, 섞으면 NOT_ENOUGH_RECORDS 얼굴에서 토글이 틀린다 — 통합 테스트가 그 reason을 프라임해야 이 도출을 잡는다). 토글 → 약관 버전 조회 → GRANT/REVOKE → 무효화. 미도착은 `CONSENT_MISSING`으로 degrade |
| `ui/InfoChip.tsx` | 누르지 않는 회색 칩 — 프로필 태그·스타일 칩·여행 카드 칩 공용(소비처가 settings 안뿐이라 shared 미승격) |
| `ui/cardShadow.ts` | `CARD_SHADOW`(카드 껍데기 공용). `LocationConsentScreen`에 같은 값의 지역 상수가 있다 |
| `model/preferenceSummary.ts` | `summarize`·`summarizePreferences` — 취향 7축을 `설정 안 함`/값 요약으로(`initialSelection` 재사용, 동행 끝에 반려동물). `settingsSections.ts`는 이제 `kind`만 읽는다 — `PreferenceSummary.text`(가운뎃점 요약 문자열)는 TRIP-1051 이후 운영 소비처 0(`preferenceSummary.test.ts`만 읽음), `PreferenceRowKey` export도 외부 소비자 0(03b 참고-2, 새 티켓 후보) |

**관측된 함정**: `enabled:false`로 꺼진 쿼리도 TanStack Query는 캐시에 남은 `data`를 돌려준다 — `SettingsPage`(제휴 토글)·`StayDetailPage`(고지 시트)가 같은 `getGetMeSettingsQueryKey()`를 공유하므로 게스트 판정에 `isAuthed &&`를 명시하지 않으면 이전 계정의 `dismissed:true`가 새어 법정 제휴 고지를 우회한다.
