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
| `ui/RevokeConfirmDialog.tsx` / `ui/DeleteAccountDialog.tsx` | 조건부 렌더 absolute 오버레이 다이얼로그 패턴 최초 선례(TRIP-608·609) — `BaseToggleDialog`(아래)가 이 형태를 그대로 따름. **TRIP-779(2026-09-24)**: 2단 게이트·문안·톤은 무변경, 라이브 Figma `1608:2440`/`4531:3018` 값만 재적용(불릿 `•` ink·간격6·목록 상한 `max-h-[248px]`·버튼 h52/라벨16·카드 그림자 `style`). 짝 테스트 `DeleteAccountDialog.l05parity.test.tsx`의 높이 상한 탐지기(`heightCapsAbove`)는 `[Npx]` 표기만 읽던 구멍을 **fail-closed**로 막았다(모르는 `max-h-*`/`h-*` 토큰 표기는 통과가 아니라 throw) — 이 파일의 `max-h-*`를 다시 만질 때 임의값 `[Npx]` 표기를 벗어나면 이 테스트가 즉시 걸린다는 뜻이다. **TRIP-772(2026-09-25)**: `DeleteAccountDialog`에 선택 prop `initialStep?: 'confirm1'|'confirm2'`(기본 `'confirm1'`) 추가 — `_dev/preview.tsx`의 `settings-delete-dialog-final` 키가 2단(최종 확인)을 직접 여는 용도. 프로덕션 호출부(`SettingsScreen.tsx:283`)는 이 prop을 전달하지 않아 무변경으로 1단부터 열린다. 이 우회 경로가 프로덕션에 새는지는 `src/__tests__/deleteAccountDialogGate.test.ts`(신규, 아래)가 소스 스캔으로 막는다. |
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
| `model/styleCardModel.ts` | **신규.** l03 스타일 요약 카드 순수 뷰모델 `buildStyleCardModel(envelope: StyleAnalysisEnvelope): StyleCardVM`. `StyleCardVM`은 판별 유니온(`kind:'official'|'insufficient'`) — official이면 `descriptors`·`gauges`(라벨 매핑 `easygoing→여유로움`·`foodAffinity→미식 취향`·`activeness→활동성`, 값 0~5 서버 그대로)·`sampleTripCount`·`updatedAt`(raw ISO), insufficient면 `current`만. `envelope.preview`는 **애초에 읽지 않는다**(INV-U5-09 — 구조적 차단, 런타임 분기 아님). `categoryBreakdown`·`avgPlacesPerDay`·`avgRadiusKm`·`avgDwellMinutes`는 VM에 안 담는다(BR-U5-08a 이 카드 한정 비노출, Q2). 값 재계산 0(BR-U6-24). **TRIP-637(2026-09-25)**: `kind` 분기는 이제 `.official`을 직접 안 읽고 `@/entities/style-analysis`의 `resolveStyleFace(envelope)`를 부른다(j05 화면 쪽 판정과 한 곳 공유, `styleCardModel.face.test.ts` 동치 property로 잠금). `\|\| analysis == null`은 TS 타입 좁히기용 행동상 죽은 중복(행동은 `resolveStyleFace`가 전담). **TRIP-956(2026-09-25)**: `insufficient` 분기의 `current`도 이제 `envelope.progress.current` 직접 읽기가 아니라 `resolveStyleProgress(envelope).current`(같은 entities 폴더, 위 layer-entities.md `lib/styleProgress.ts`) — `progress`가 결측·부분결측이어도 TypeError 없이 0으로 접는다. j05 쪽과 값이 같다는 것은 대칭 PBT(`styleCardModel.progress.test.ts`)가 잠근다. |
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
| `ui/PersonalizationScreen.tsx` | 무상태 프레젠테이션(props: `consentOn`·`reason`·`sharedItems`·`onToggle`·`onPressBack?`). `LocationConsentScreen.tsx` 구조 준용하되 **재확인 다이얼로그 없음**(개인화 철회는 데이터 파기가 아니라 추천 입력 제외뿐이라 BR상 게이트 불요, l06과의 유일한 차이). **TRIP-780로 공유 승격**: 인라인 Pressable(52×30) 13줄 → `shared/ui/Toggle`(46×28) 한 줄로 교체(구 서술 "선례 동형 Pressable"은 낡음). testID `settings-personalization-{root,back,toggle,item}`. |

l05 설정 목록에 개인화 진입행 없음(Figma 캐논에 개인화 그룹 자체가 없음 + `settingsSections.test.ts` 완전일치 가드 충돌, TRIP-610 `preferences` 선례와 동형 판단) — 도달 경로는 딥링크 `/settings/personalization`과 `_dev/preview.tsx` 3키(reason 3얼굴)뿐. 진입행 배선은 후속 티켓([FE] l05 설정 개인화 진입행, Figma 디자인 선행).

## 이번 사이클(TRIP-573) 변경 — StyleSummaryCard 상세진입 활성화

j05(여행 스타일 분석, `features/reflection`)가 `records/style` 라우트를 신설하면서, TRIP-606에서 disabled로 남아있던 상세진입 Pressable을 이 사이클이 활성화했다.

| 파일 | 내용 |
|---|---|
| `ui/StyleSummaryCard.tsx` | **변경(additive) — `my-style-detail` prop-gated 활성화.** `onPressDetail?: () => void` prop 추가, `disabled={onPressDetail == null}`·`onPress={onPressDetail}`. prop 미주입 시 여전히 `disabled`(기존 `StyleSummaryCard.test.tsx` AC-S6의 `toBeDisabled()` 무회귀 — 이게 backward-compat 증거). 실제 배선은 `pages/my-page/ui/MyPage.tsx`가 `onPressDetail={() => router.push('/records/style')}`를 주입(`layer-pages.md` `my-page` 행 참고). |

## 이번 사이클(TRIP-775) 신규·변경 — l03 마이페이지 default Figma 정합

| 파일 | 내용 |
|---|---|
| `ui/ProfileCard.tsx` | **변경.** `tags?: string[]` 슬롯 신설(정식 스타일 분석일 때만 주입 — 계약 공백 아님, 페이지가 판정). [편집] 아이콘(`PencilGlyph`) 제거 + r8 아웃라인, 카운트 3칸 사이 세로 hairline 막대 2개(`my-profile-count-divider`) 신설(기존 `border-t`만 있던 것에 추가). |
| `ui/StyleSummaryCard.tsx` | **변경.** 게이지 dot을 `justify-between`(우측 정렬)에서 라벨 칸 고정폭(`w-[64px]`) + 좌측 정렬로. 메타줄("여행 N개 · 갱신 …", TRIP-606 self 서식) 제거 — `formatKoreanDate` import도 함께 삭제. `sampleTripCount`·`updatedAt` VM 필드는 `styleCardModel.test` AC-M1이 잠가 **필드 자체는 유지**. `headline?: string` 계약 공백 슬롯 신설(서버에 필드 없음, TRIP-623 후속). |
| `ui/TripCard.tsx` | **변경.** 머리줄을 `flex-row`([배지][제목 flex-1][회고 chevron])로 — 기존엔 배지 줄과 제목 줄이 분리돼 있었다. 지역 `Chip`(pill·text-body) 삭제 → `InfoChip`으로 대체. |
| `ui/TripStatusSegment.tsx` | **변경(값만).** 세그먼트 바탕 `bg-hairline`(#EDEDED)·안쪽 여백 4·탭 높이 34·글자 13.5(Figma D8 실측 드리프트, 구조 변경 없음). |
| `ui/InfoChip.tsx` | **신규.** 회색 r8 칩 1종(`surface-strong`·11/6 패딩·12 muted) — 프로필 태그·스타일 칩·여행 카드 칩 3곳 공용. 누르지 않는 회색 칩 export가 `shared/ui`에 없어 신설(`PrefChip`은 누르는 선택 칩이라 용도가 다름). 소비처 3곳이 모두 settings 안이라 shared 미승격(README 승격 규칙 "feature 2곳 이상" 불충족). |
| `ui/cardShadow.ts` | **신규.** `CARD_SHADOW`(RN `style` 객체, `0/2/10·6%·elevation2`) — 카드 껍데기 4종(프로필·스타일·여행·메뉴) 공용. `LocationConsentScreen.tsx`의 동명 지역 상수와 **값이 중복**되지만 features 경계 때문에 import 불가라 별도 export로 신설(drive-by 통합 금지, 5-c 후보로 보고만 함). |
| `ui/SettingsGlyphs.tsx` | **변경.** `GearGlyph`·`BarChartGlyph`를 Figma 실측 path(22 격자·#3F3F3F·stroke2)로 재작도. `MenuBedGlyph` 신설(메뉴 첫 행, 기존 `BedGlyph`는 l04 empty용이라 모양이 다름). `ChevronRightGlyph`에 `color?` prop 추가(기본값 기존 연회색). `MUTED_SOFT` hex export 추가(비-글리프 파일이 raw hex 없이 chevron 색을 넘기기 위함). **`BookmarkGlyph`·`PencilGlyph`는 이 변경으로 프로덕션 소비처가 0이 됐다** — `MyPage.l03parity`·`ProfileCard.l03parity`의 부재 단언(짝 앵커)이 여전히 import하므로 남겨둠. **TRIP-776 추가**: `PlusGlyph` 신설(20×20, 흰 두 선, stroke 2.6, Figma) — `home`·`stay`·`record`·`itinerary`·`widgets/map-sheet-shell`에 동명 글리프가 있으나 features 경계로 import 불가라 복제(리포 관례). |
| `ui/MyPageScreen.tsx` | **변경.** `showPast?: boolean` prop 추가(판정은 페이지, 화면은 값만 소비). 하트 FAB 제거(Figma 근거 없음, "장식·미배선"). 메뉴 카드 재구성 — `px-lg` 내부 여백 제거하고 행마다 `p-lg` + 행 사이 카드 폭 전체 구분선 막대(옛 코드는 들여진 `border-b`). `overflow-hidden` 의도적 미부착(iOS 그림자 클리핑 회피). 헤더를 `ScrollView` 밖으로 이동(스크롤해도 고정) + 톱니 아이콘 조건부 렌더(`onPressSettings` 있을 때만). 메뉴 행 → 콜백은 `menuHandlers: Partial<Record<MenuRowKey, () => void>>`. **TRIP-776 추가**: 빈 문구 왼쪽 정렬로 변경(`items-center` 제거) — 블록이 세 탭(예정·진행중·종료) 공용이라 진행중·종료 빈 문구도 함께 왼쪽으로 감(03b 참고-3, Figma에 그 두 탭 프레임이 없어 판단성 미해결). CTA 라벨 `'새 여행 만들기'` + 신규 `PlusGlyph`(`my-create-trip-plus`). `onPressCalendar?` prop 추가 — 있을 때만 "캘린더 ›" 링크 렌더(TRIP-939 원칙 승계: 누를 곳 없는 링크 안 만듦). |
| `ui/MyPageScreen.l03empty.test.tsx` | **신규(TRIP-776)** — 빈 문구·CTA·캘린더 링크 3방향 분기(콜백+섹션/섹션 없음/콜백 없음) 단위. |

## 이번 사이클(TRIP-777) 변경 — l04 등록 숙소 default·empty·dialog Figma 정합

| 파일 | 내용 |
|---|---|
| `ui/MyStaysScreen.tsx` | **변경(값·구조 일부).** "출발점" 배지·"출발점 지정"·칩 3종을 `rounded-[8px]`로, 카드를 `rounded-[12px]`로 재작도. "출발점 변경 ›"에서 "›" 문자를 지우고 `ChevronRightGlyph`(muted, `SettingsGlyphs.MUTED` 신규 export)로 대체. empty를 `shared/ui/StateNotice` 우회 — 로컬 마크업으로 제목 생략·CTA 폭 조정(testID `my-stays-empty`·`my-stays-explore` 보존). **경고: 배지·칩·"출발점 지정" 상자를 `h-[..]`(고정 높이, `:60`·`:97`·`:108`)로 바꿔 큰 글씨 배율(iOS 약 1.5~1.8배)에서 글자가 상자를 넘칠 수 있다**(03b 경고-2, `min-h-[..]`로 바꾸면 완화 — 5-c 판단은 이번엔 보류, 다음에 이 파일을 만질 때 처리). **미등록 행("출발점 지정")을 누르는 경로를 지키는 테스트가 없다**(03b 경고-1, TRIP-605부터 있던 구멍 — 이번 사이클은 손대지 않음, 다음에 이 Pressable을 만질 때 `my-stays-base-toggle-s2`류 케이스를 추가할 것). |
| `ui/BaseToggleDialog.tsx` | **변경(값만).** 카드 `w-[330px]`·제목 `text-[19px]`·본문 `text-body`(muted 아님)·버튼 h44·딤 `bg-scrim/55`로 Figma 1606 재작도. `DIALOG_SHADOW`는 `DeleteAccountDialog`와 값이 같다는 주석이 있었는데 실제로는 `RevokeConfirmDialog`(0.2/14)와 다르다 — 다이얼로그 틀을 `shared/ui`로 승격할 때 이 차이를 먼저 확인할 것(03b 지적-3). |
| `ui/SettingsGlyphs.tsx` | **변경.** `BedGlyph`를 Figma path·`muted-soft`로 재작도(소비처는 `MyStaysScreen` 1곳뿐이라 회귀 없음). `MUTED` hex export 신규(chevron 색 전달용 — `myStaysStructure` G3 raw hex 가드는 화면 소스의 hex 문자열만 스캔하므로 이름으로 넘기면 안 걸린다, 참고-1). |
| `src/__tests__/devPreviewMyStays.test.tsx` | **신규.** `my-stays-default`(2행 프리뷰)·`my-stays-dialog`(형제 합성 — `MyStaysScreen` 뒤에 `BaseToggleDialog`를 형제로 얹어 트리 순서로 열림을 확인, `@/shared/api` 네트워크 지뢰 미로드) 두 프리뷰 키 가드. `devPreviewBandNav`/`devPreviewBandSort` 카운트·정렬 가드도 이 사이클에서 +1(164→165, `my-stays-empty` 뒤 삽입). |
| `ui/MyStaysScreen.l04parity.test.tsx` | **신규.** AC-1~7 — 배지·칩 토큰(`rounded-[8px]`/`[12px]`)·"출발점 변경" 완전일치+chevron 글리프·주소 줄 유무 짝·empty 로컬 마크업·dialog 치수(공통 host 조상으로 탐색, 명시 testID 없음)·`border-hairline` 구분선 막대. |

**새 티켓 후보(범위 밖, 착수 안 함)**: l04 실주소(계약에 `SavedStay.address` 없음, 역지오코딩 우회 수단만 있음 — BR-U6-20 미충족 상태로 미룸) · `SavedStay` codegen 재생성(`linkedTripIds` 누락, N+1 제거 가능) · 좌표 미확정 행 비활성 표시+BR-U1-22 안내(Figma 프레임 선행 필요) · 다이얼로그 틀(딤·카드·그림자·버튼) `shared/ui` 승격.

## 이번 사이클(TRIP-778) 변경 — l05 설정 default Figma 정합 + 제휴 "다시 보지 않기" 서버 전환

| 파일 | 내용 |
|---|---|
| `model/preferenceSummary.ts` | **신규.** `summarize`(빈 값 거르고 `·`로 이어붙임, 없으면 unset) · `summarizePreferences`(기존 `initialSelection` 재사용, 동행 끝에 반려동물 붙임). 취향 7행을 `설정 안 함`/실제 값 요약으로 갈라 `SettingsScreen`에 넘긴다. 대체할 기존 함수 없음(재사용 탐색 결과 — `usePreferences`류 소비처 3곳 중 요약 함수는 없었다). |
| `model/settingsSections.ts` | **변경.** 입력 3필드 추가(취향 요약·위치 동의·개인화). `SettingsRowChip` 타입, `PREFERENCE_ROWS`·`UNSET_CHIP` 상수, `preferenceRows`(값 모르면 값·칩 둘 다 없음), `consentChip`(undefined면 칩 없음), 개인화 행 신설. 취향 7행·개인화·제휴 전 행 `ready:true`로 개통(TRIP-624 분리로 미뤄 뒀던 `ready:false`가 풀림 — 새 티켓 후보 "운영 빌드 새 노출 행", 백엔드 `/me/settings` 배포 확인 필요). |
| `ui/SettingsRow.tsx` | **변경.** `NavRow`에 `value`·`chip`·`chevron` 색(`MUTED_SOFT`)+testID 슬롯 추가, 내부 `RowChip`(tone 2종, r8) 신설. |
| `ui/SettingsScreen.tsx` | **변경.** `PREFERENCE_ROW_KEYS` 도입, `renderRow`에 취향·개인화·제휴 분기(제휴는 `Toggle checked===true`·`disabled==null`+실패 안내 Text) 추가. 위험 칩 r8, 바탕 `bg-canvas`. |
| `ui/SettingsGlyphs.tsx` / `ui/ExportRow.tsx` / `ui/NicknameEditRow.tsx` | **변경.** `SparkleGlyph` 신규(개인화 행 아이콘 — `HomeGlyphs`·`TripGlyphs`에 동명이 있으나 features 경계로 복제). `ExportRow`·`NicknameEditRow`는 chevron 색을 `MUTED_SOFT`로 한 줄씩(캡처 대조에서 발견, l05 화면 자신의 행이라 다른 화면으로 안 번짐). |
| `ui/SettingsScreen.l05parity.test.tsx` | **신규.** 취향 7행 값/칩 짝·위치 동의 칩·개인화 `사용 중`·chevron 색·칩 r8·바탕 완전일치. |
| `shared/storage/flag.ts`·`flag.test.ts` | **삭제(`git rm`).** "다시 보지 않기" 저장처가 기기 SecureStore에서 서버 `/me/settings`로 전환(아래 pages 절·`shared/api` 참고). |

**저장처 전환 요지(pages 배선은 `layer-pages.md`의 `stay-detail`·`settings` 행 참고)**: `SettingsPage`(제휴 토글)와 `StayDetailPage`(고지 시트)가 같은 쿼리 키(`getGetMeSettingsQueryKey()`)를 읽고 써 "한 진실"을 이룬다. **실측 결함(03b 경고-1, 수정 완료)**: `enabled:false`로 꺼진 쿼리도 TanStack Query는 캐시에 남은 `data`를 그대로 돌려준다 — 게스트 판정에 `isAuthed &&`를 명시로 걸지 않으면 이전 계정의 `dismissed:true`가 게스트에게 새어 법정 제휴 고지를 우회한다. `enabled:false` ≠ "캐시 무시"라는 이 패턴은 다른 화면에서도 재발할 수 있는 일반 함정이다(문제로그 참고).

**새 티켓 후보(범위 밖, 착수 안 함)**: 설정 토글 연타 시 PATCH 응답 순서 역전으로 캐시가 서버와 갈라질 가능성(참고-3, 확인 필요) · 세션 만료 후 다른 계정 로그인 시 이전 계정 캐시가 첫 GET 전까지 노출(재리뷰 참고-R1) · `useLocationConsent` 리터럴 키가 생성 키와 손으로만 맞물림(참고-2) · 전체 `pnpm codegen` 동기화(약 208파일, notification 스키마 드리프트 포함) · Figma 취향 값 문구(`바다·휴양` 등)가 서버 enum 밖(D5) · 운영 빌드에서 새로 열리는 행(취향·개인화·제휴) 백엔드 배포 확인.

## 이번 사이클(TRIP-977) 변경 — l03 세그먼트 탭 크래시 수정(selected 그림자 className→style)

| 파일 | 내용 |
|---|---|
| `ui/TripStatusSegment.tsx` | **변경(값 무회귀, 메커니즘 변경).** 선택 탭에만 붙던 className `shadow-sm` 제거 → `style={selected ? SEGMENT_SHADOW : undefined}`(`cardShadow.ts`). **원인**: `shadow-sm`은 NativeWind 네이티브 컴파일에서 CSS 변수(`--tw-shadow-color`)를 선언하고, 탭 전환으로 그 변수가 새로 생기면 `react-native-css-interop`이 해당 Pressable을 `VariableContext.Provider`로 재마운트하며 dev 경고에서 props 전체를 직렬화한다 — 그 직렬화가 크래시를 낸다(QA #026). `bg-canvas`는 고정 hex라 변수를 안 선언해 className 유지 가능. |
| `ui/cardShadow.ts` | **변경 — `SEGMENT_SHADOW` 신규 export.** 값은 **NativeWind 네이티브 프리셋 `shadow-sm`**(`0px 1px 1px rgba(0,0,0,0.35)`, iOS 실효 불투명도 35% — 웹 Tailwind `shadow-sm`의 0/1/2·5%와 다르다, 03b 경고-2 정정 반영)와 동일 값으로 맞춤. 기존 `CARD_SHADOW`(0/2/10·6%)는 값이 달라 재사용 불가(더 게으른 대안으로 검토했으나 시각이 달라져 기각). |
| `ui/TripStatusSegment.test.tsx` | **신규.** 소스 가드 — 변수 선언·애니메이션 계열 정규식 `\b(shadow\|ring\|scale\|translate\|rotate\|skew\|transition\|animate)(-…)?\b(?![A-Z])`로 셀렉터별 이름이 아니라 **계열**을 막는다(이름 목록으로 시작했다가 5-c에서 확장 — `bg-canvas shadow`·`ring-1`·`shadow-black/10`·`scale-105` 등 형제 유틸의 재도입도 잡음, `tabular-nums`·`from-*`는 `from` import 오탐이라 사정거리 밖으로 명시 제외). 선택 탭만 `toHaveStyle({shadowOpacity: expect.any(Number)})`. |

**같은 패턴이 다른 곳에도 있는가 — 03b 실측 0건(2026-09-26 기준).** `shared/ui/SegmentedControl.tsx`는 애초부터 이 파일과 동일한 처방(style 그림자 + `bg-canvas`)을 쓰고 있었다 — TripStatusSegment는 TRIP-604 때 role·치수가 달라 별도로 만들어졌을 뿐 처방 자체는 선행 사례가 있었다. **재발 방지용 리포 전역 가드(lint/전역 스캔)는 아직 없다** — 새 티켓 후보(낮음), 지금 있는 결함이 아니라 예방 장치라 우선순위가 낮게 매겨졌다.

## 관련

- 경계 가드: `src/__tests__/settingsBoundary.test.ts`(소스 재귀 스캔, eslint 무강제 — repo-traps 참고). TRIP-610도 이 가드가 `features/onboarding` 재사용을 막아 shared 승격을 강제한 세 번째 실측.
- 다이얼로그 게이트·오버레이 jest 사각의 리포 전역 함정 서술: `frontend/.claude/rules/repo-traps.md`.
