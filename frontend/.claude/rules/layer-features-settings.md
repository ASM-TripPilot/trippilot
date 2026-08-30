---
paths:
  - "src/features/settings/**"
---
# `src/features/settings/` — 마이·설정·위치동의 표면 (TRIP-603·604·608·609로 신설 → TRIP-605로 l04 추가 → TRIP-606으로 스타일 카드 추가 → TRIP-610으로 l05 취향 편집 추가 → TRIP-612로 l05 개인화 동의 추가 → TRIP-618로 U6 진입점 배선)

**이 파일은 TRIP-605([기록])에서 처음 만들어졌다** — `features/settings`는 TRIP-173에서 빈 배럴째 삭제된 뒤 TRIP-603/604/608/609(l03 마이페이지·설정·계정삭제·위치동의)로 재신설됐으나, 그 네 사이클 모두 이 층별 문서를 만들지 않았다(구조 지도 정비 항목이 `docs/structure.md`에서 `.claude/rules/layer-*.md`로 이관된 게 그 이후라 추정 — 사실 확인은 안 함). 그래서 아래는 **기존 파일 전수를 처음 문서화**(한 줄 식별)하고, **이번 사이클(TRIP-605) 신규·변경분만 상세**하게 적는다.

**경계(G-U5-14)**: 이 폴더는 **다른 `features/*`를 import할 수 없다** — `eslint.config.js`의 `FEATURES` 배열에 `settings`가 없어 기계 강제가 아니라 `src/__tests__/settingsBoundary.test.ts`의 소스 재귀 스캔이 유일한 그물이다(repo-traps 참고). 조합·조회·포맷은 전부 `pages/my-page`·`pages/my-stays` 같은 페이지 층이 진다.

## 기존 파일 (TRIP-603·604·608·609, 한 줄 식별만 — 상세는 후속 사이클이 그 파일을 만질 때 채운다)

| 파일 | 역할(한 줄) |
|---|---|
| `ui/MyPageScreen.tsx` | l03 마이페이지 화면(TRIP-603). **TRIP-606에서 additive prop `styleCard?: ReactNode` 추가** — `<ProfileCard/>`↔`<TripStatusSegment/>` 사이 렌더, 기존 testID·prop 무변경. |
| `ui/SettingsScreen.tsx` | 설정 화면(TRIP-604) |
| `ui/ProfileCard.tsx` / `ui/TripCard.tsx` / `ui/TripStatusSegment.tsx` | l03 프로필·여행 카드 구성 요소 |
| `ui/SettingsGroup.tsx` / `ui/SettingsRow.tsx`(`RowBody`·`PreparingRow`·**`NavRow`**, TRIP-618 신규 export) / `ui/ExportRow.tsx` / `ui/NicknameEditRow.tsx` | 설정 화면 행 구성 요소 |
| `ui/RevokeConfirmDialog.tsx` / `ui/DeleteAccountDialog.tsx` | 조건부 렌더 absolute 오버레이 다이얼로그 패턴 최초 선례(TRIP-608·609) — `BaseToggleDialog`(아래)가 이 형태를 그대로 따름 |
| `ui/LocationConsentScreen.tsx` | 위치 동의 철회 게이트 화면(TRIP-609) — 로컬 `useState` 다이얼로그 게이트 패턴의 최초 선례(`MyStaysScreen`의 출발점 전환 게이트가 이 형태를 그대로 따름) |
| `model/settingsSections.ts` / `model/tripBuckets.ts` / `model/exportSummary.ts` / `model/deletionScope.ts` | 설정 화면 순수 파생 모델(섹션 구성·여행 버킷·내보내기 요약·삭제 고지 목록 정본) |

## 이번 사이클(TRIP-605) 신규·변경

| 파일 | 내용 |
|---|---|
| `model/stayTripLink.ts` | **신규.** SavedStay↔trip 역참조 순수 함수 `buildStayTripLink(savedStays, trips, basesByTripId) → Map<savedStayId, {tripId, tripName, baseAssignmentId}>`. SavedStay엔 `tripId`가 없어 모든 여행의 거점 목록(`bases[].savedStayId`)을 뒤져 역으로 찾는다(N+1의 데이터 쪽 절반). savedStays를 바깥 루프로 돌아 **유령 base(거점에만 있고 savedStays엔 없는 id)를 자연 배제**하고, 한 숙소가 두 여행의 거점이면 `trips` 순서상 **첫 여행이 이긴다**(first-wins, 안쪽 루프 첫 매치 `break` — 발명값 아니라 Map 구조가 강제하는 계약). `tripName`은 `Trip.title`에서 온다(스키마에 `name` 없음). |
| `ui/MyStaysScreen.tsx` | **신규.** l04 등록 숙소·예약 기록 화면(순수 프레젠테이션). `MyStayRowVM[]`을 받아 행을 그리고, 출발점 전환 버튼(행당 정확히 1개, testID `my-stays-base-toggle-{savedStayId}`) press로 로컬 상태 `openRow`를 세워 `BaseToggleDialog`를 조건부 렌더한다 — **비즈니스 콜백 `onConfirmBaseToggle`은 다이얼로그 확정에서만 호출**(BR-U6-21 게이트, `LocationConsentScreen` 선례 동형). 좌표 미확정(`canAssignBase=false`, INV-U1-08)이면 토글에 real `disabled`가 걸려 게이트 진입 자체가 막힌다. 0건이면 `StateNotice`(testID `my-stays-empty`)+탐색 CTA(`my-stays-explore`). `location`이 빈 값이면 위치 줄을 안 그린다(F-1 대응, 그러나 프로덕션에서 항상 빈 값이라 이 화면 테스트의 위치 단언은 vacuous — 03b 경고-2, TRIP-622). |
| `ui/BaseToggleDialog.tsx` | **신규.** BR-U6-21 재확인 다이얼로그("출발점을 바꿀까요?" / "일정을 처음부터 다시 생성합니다..."). `RevokeConfirmDialog`의 오버레이 **형태**(조건부 absolute, 리포 Modal 선례 0)를 재사용하되 문안·버튼 계약이 달라 컴포넌트는 신규. **문안이 재생성을 약속하나 실제 확정 경로(`pages/my-stays`)는 DELETE(거점 해제)만 하고 재생성 POST가 없다**(03b 경고-3b, TRIP-621 — 다이얼로그를 다시 만질 때 이 불일치를 기억할 것). 실제 딤·중앙정렬은 조건부 렌더 오버레이라 jest 원리적 사각(repo-traps 바텀시트 함정과 동형 계열) — testID 트리존재+확정 전 mutate 0회까지만 자동 심판. |
| `ui/SettingsGlyphs.tsx` | **변경 — `BedGlyph` 신규 export 추가.** empty 상태 침대 아이콘. `features/trip/ui/TripGlyphs`에 동명 `BedGlyph`가 있으나 features 경계로 import 불가라 새로 그림(리포 관례 — `ChevronRightGlyph`가 이미 4벌, feature마다 새로 그리는 게 정상). |

## 이번 사이클(TRIP-606) 신규·변경

| 파일 | 내용 |
|---|---|
| `model/styleCardModel.ts` | **신규.** l03 스타일 요약 카드 순수 뷰모델 `buildStyleCardModel(envelope: StyleAnalysisEnvelope): StyleCardVM`. `StyleCardVM`은 판별 유니온(`kind:'official'|'insufficient'`) — official이면 `descriptors`·`gauges`(라벨 매핑 `easygoing→여유로움`·`foodAffinity→미식 취향`·`activeness→활동성`, 값 0~5 서버 그대로)·`sampleTripCount`·`updatedAt`(raw ISO), insufficient면 `current`만. `envelope.preview`는 **애초에 읽지 않는다**(INV-U5-09 — 구조적 차단, 런타임 분기 아님). `categoryBreakdown`·`avgPlacesPerDay`·`avgRadiusKm`·`avgDwellMinutes`는 VM에 안 담는다(BR-U5-08a 이 카드 한정 비노출, Q2). 값 재계산 0(BR-U6-24). |
| `ui/StyleSummaryCard.tsx` | **신규.** VM 주입 순수 프레젠테이션. testID `my-style-card`(루트)·`my-style-chip`(디스크립터 칩, official만)·`my-style-gauge`(축 행 1개당 1, 3개)·`my-style-dot-filled`/`my-style-dot-empty`(dot당 1 — **채운/빈을 서로 다른 exact testID를 단 View로 렌더**해 개수로 값을 잰다, SVG 한 장 fill 함정 회피)·`my-style-detail`(상세 분석, disabled Pressable — `records/style` 라우트 미착수라 INV-4 정직 degrade, onPress 미배선). 빈 dot 색은 토큰(`bg-hairline`) — raw hex 금지(`myStaysStructure.test.ts` G3 재귀가 이 폴더를 훑음). 메타줄 `여행 {n}개 · 갱신 {formatKoreanDate(updatedAt.slice(0,10))}`(Figma엔 없는 self 서식, `updatedAt`이 date-time이라 slice 필수 — 안 자르면 `Number()`가 NaN). 헤드라인 문장은 계약 필드 부재로 생략(Q1, TRIP-623 후속). |

## 이번 사이클(TRIP-610) 신규·변경 — l05 취향 전체 수정

| 파일 | 내용 |
|---|---|
| `model/preferenceDraft.ts` | **신규.** `PreferenceView`(축 래퍼 `{value,isNeutralDefault}`) ↔ `PreferenceInput`(평면) 역변환 순수 함수 2개 — `initialSelection(view)`(미설정 축은 null/false로 시드) · `buildPreferenceInput(view, selection)`(안 만진 축은 키 자체 omit, `arrayEq` 순서 민감 비교). openapi "생략=미변경, null=미설정 초기화" 계약과 정합(AC-2). 개념 [[역변환 함수 (View→Input)]]. |
| `model/usePreferences.ts` | **신규.** `useGetMePreferences` 초기값 + `usePutMePreferences` 저장(`{data}`) + 400 `saveError` 노출. 자족 컨테이너 전용 훅, 격리 단위 테스트 없음(통합이 화면 관통으로 검증 — 02 §의도적 결합-회피). |
| `ui/PreferencesEditScreen.tsx` | **신규(컨테이너).** GET/PUT 배선 + **저장 diff 기준선 baseline freeze**(`baseView` state, 시드와 같은 렌더에서 함께 굳힘 — 5-b 경고-1 lost update 봉합, 개념 [[lost update — 저장 diff 기준선은 시드 스냅숏이어야 한다]]). `usePreferences`·`@/shared/api` 체인이 **이 파일에만** 남아있다 — 순수 뷰는 별 파일로 분리됨(아래). |
| `ui/PreferencesEditView.tsx` | **신규(순수 뷰, 03d 분리).** `PreferencesEditScreen`에서 뷰만 도려낸 파일 — `usePreferences`·`@/shared/api` import 0(프리뷰가 안전하게 태울 수 있는 이유). `EditableAxis`·`isMultiAxis`·`MULTI_AXES`/`SINGLE_AXES`도 이 파일 소유. testID `settings-pref-*`(축 세그먼트 네임스페이스, `자연`·`쇼핑`처럼 두 축이 공유하는 라벨 충돌 방지). 개념 [[모듈 로드 크래시 연쇄]] §TRIP-610. |

### 온보딩 쪽 변경 (shared 승격 재배선, 회귀 0)

`model/preferenceSelection.ts`(재수출 — 실체는 `shared/pref/preferenceSelection.ts`) · `ui/PrefStep1Screen.tsx`/`PrefStep2Screen.tsx`(shared `PrefTile`/`PrefChip` 소비로 재배선, −170줄, testID·props 불변) — 상세는 `.claude/rules/layer-shared.md`. 개념 [[shared 승격 — 두 화면이 한 형식 공유]] §TRIP-610.

### 범위 밖 (인수인계)

l05 설정 목록의 취향 7행은 여전히 `ready:false`(`settingsSections.ts`, TRIP-608 테스트가 잠금) — 진입 활성화는 **TRIP-624**(신규 발행)로 분리. 화면 자체는 `/settings/preferences` 라우트 + 프리뷰로만 도달 가능.

## 이번 사이클(TRIP-618) 신규·변경 — U6 진입점 배선(마이→설정→위치동의·알림)

순수 라우팅 배선(신규 비주얼 0). l03 마이 하단 '설정' 행·l05 '위치정보 수집 동의'·'알림 설정' 두 행 — 지금까지 목적지 라우트가 없어 "준비 중"이던 세 스텁 행에 실제 라우트를 연결.

| 파일 | 내용 |
|---|---|
| `model/settingsSections.ts` | `location-consent`·`notifications` 두 행 `ready:false→true` 플립. 취향 7행(TRIP-624 분리)·제휴(라우트 없음)는 `ready:false` 유지 — 근거가 다름을 주석에 분리 명시. |
| `ui/SettingsRow.tsx` | **신규 export `NavRow`**(`RowBody`+`ChevronRightGlyph`+`onPress`, testID `settings-nav-{rowKey}`) — 리포에 press+chevron 활성 설정 행이 이전엔 0건(재사용 탐색 후 신규 소명, 03 §NavRow). `disabled`/`accessibilityState` 미부착이 `PreparingRow`(둘 다 부착)와의 구분선. |
| `ui/SettingsScreen.tsx` | `renderRow` switch에 `case 'location-consent'`·`case 'notifications'` 추가(→`NavRow` 렌더) + `onPressLocation?`/`onPressNotifications?` optional prop. **급소**: 이 switch는 `row.key` 리터럴만 보고 `row.ready`를 읽지 않는다 — `settingsSections.ts`의 `ready` 플립과 이 switch 케이스는 **별도로 정합을 유지해야 하는 구조적 결합**(자동 교차심판 없음, 04 n=2 판단성 관찰). 개념 [[가드의 사정거리]] TRIP-618 실측. |
| `ui/MyPageScreen.tsx` | 하단 '설정' 행에 `onPress?`/`testID?`(inner `SettingsRow`에 전달) + `onPressSettings?` prop — press면 Pressable. |

**헤더 sun 아이콘(`my-header-settings`)은 이번에 무배선** — Figma l03 헤더는 sun/애스터리스크 글리프 1개(bell 아님)이고 목적지가 Figma·construction 어디에도 없다. 티켓의 "헤더 알림함→l01"은 Figma 근거 없는 드리프트(01b Q1 자율 판정). 후속 티켓([FE] l01 알림함 진입점 배선)으로 분리 — 제품/디자인이 목적지(l03 헤더인가 다른 자리인가, sun→bell 교체 여부)를 먼저 정해야 한다.

l05 '등록 숙소·예약 기록'(bases) 행은 이 티켓 스코프 밖(스코프 크리프 금지, 01b Q3) — 여전히 무배선.

## 이번 사이클(TRIP-612) 신규 — l05 개인화 동의

| 파일 | 내용 |
|---|---|
| `model/personalizationCopy.ts` | **신규.** 순수 함수 `personalizationCopy(reason): string \| null` — `PersonalizationInfoReason` enum 3값 전수 매핑(`APPLIED`→`null`, `CONSENT_MISSING`→'동의하면 지난 기록을 반영해요', `NOT_ENOUGH_RECORDS`→'기록이 더 쌓이면 반영돼요'). **급소**: `NOT_ENOUGH_RECORDS`는 이미 동의한 사용자라 "동의하면" 문구가 나오면 BR-U5-44 위반 — 반환 문자열에 그 부분문자열이 없음을 테스트가 순수 층에서도 잠근다. |
| `model/usePersonalization.ts` | **신규.** `useGetMePersonalization()` 조회 + `consentOn = reason !== CONSENT_MISSING`(**`applied` 필드가 아니라 `reason`에서 도출** — 두 필드가 다른 축, 섞으면 NOT_ENOUGH_RECORDS 얼굴에서 토글이 잘못 그려진다) + 토글 press → `fetchTerms()`에서 PERSONALIZATION `termsVersion` 필터 → `patchConsent('PERSONALIZATION', version, consentOn?'REVOKE':'GRANT')` → `invalidateQueries`. GET 미도착 시 `reason ?? CONSENT_MISSING`으로 degrade(개념 [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] 참고 — 이번은 미배선이 아니라 미도착 변형). **적대적 리뷰 차단-1(2026-08-31 봉합)**: 이 도출을 검증하는 유일한 심판(T3 페이지 통합)이 원래 reason 3값 중 NOT_ENOUGH_RECORDS를 프라임하지 않아, `applied` 기반 오답 도출로 뮤테이션해도 전 스위트 green이었다 — 개념 [[가드의 사정거리]] TRIP-612 실측. 급소 케이스 추가 + 뮤테이션 실측으로 봉합(implementer 재호출 없이 테스트만 강화). |
| `ui/PersonalizationScreen.tsx` | **신규.** 무상태 프레젠테이션(props: `consentOn`·`reason`·`sharedItems`·`onToggle`·`onPressBack?`). `LocationConsentScreen.tsx` 구조 준용하되 **재확인 다이얼로그 없음**(개인화 철회는 데이터 파기가 아니라 추천 입력 제외뿐이라 BR상 게이트 불요, l06과의 유일한 차이). 토글은 `LocationConsentScreen` 선례 동형 Pressable+`accessibilityState.checked`(RN `Switch` 아님). testID `settings-personalization-{root,back,toggle,item}`. |

l05 설정 목록에 개인화 진입행 없음(Figma 캐논에 개인화 그룹 자체가 없음 + `settingsSections.test.ts` 완전일치 가드 충돌, TRIP-610 `preferences` 선례와 동형 판단) — 도달 경로는 딥링크 `/settings/personalization`과 `_dev/preview.tsx` 3키(reason 3얼굴)뿐. 진입행 배선은 후속 티켓([FE] l05 설정 개인화 진입행, Figma 디자인 선행).

## 관련

- 경계 가드: `src/__tests__/settingsBoundary.test.ts`(소스 재귀 스캔, eslint 무강제 — repo-traps 참고). TRIP-610도 이 가드가 `features/onboarding` 재사용을 막아 shared 승격을 강제한 세 번째 실측.
- 다이얼로그 게이트·오버레이 jest 사각의 리포 전역 함정 서술: `frontend/.claude/rules/repo-traps.md`.
