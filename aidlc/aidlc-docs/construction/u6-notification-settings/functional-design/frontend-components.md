# U6 Notification & Settings — Frontend Components

> **정본 = 리포 실제 층 배치**(2026-08-24 실측). `src/app` · `src/pages/<slice>/{index.ts,ui}` · `src/features/<domain>/{model,ui}` · `src/shared/*` · `src/__tests__/*Structure.test.ts`.
> **현재**: `(tabs)/my.tsx` = **26줄 "마이 준비 중" 셸**(TRIP-290 · `StateNotice`). 밴드 `l` 라우트 **0** → 프런트가 본체.
> **시각 확인**: `l01 default` · `l02 default` · `l02 permission-denied` · `l03 default` · `l05 default` · `l06 default` **6프레임**. 나머지 10은 이름 수준(§9).

---

## 1. 라우트

| 라우트 | 화면 | 비고 |
|---|---|---|
| `(tabs)/my.tsx` | **`l03` 마이페이지** | **셸 교체.** 마이 탭 루트 — 밴드 `l`에서 **BottomTab이 있는 유일한 화면** |
| `my/stays.tsx` | `l04` 등록 숙소·예약 기록 | 3상태(default·empty·dialog) |
| `settings/index.tsx` | `l05` 설정 | 6그룹 · 2상태(default·dialog) |
| `settings/notifications.tsx` | `l02` 알림 설정 | 2상태(default·**permission-denied**) |
| `settings/location.tsx` | `l06` 위치정보 동의 | 3상태(default·dialog·permission-denied) |
| `notifications.tsx` | `l01` 알림함 | 2상태(default·empty). 어디서든 종 아이콘으로 진입 |

> `l07`은 **라우트가 아니다** — U1 `OtaChoiceSheet`(숙소 상세 위 시트)이고 U6는 안 만든다(DEC-U6-7).
> `(tabs)/my.tsx`(→`/my`)와 `app/my/stays.tsx`(→`/my/stays`) 공존은 **리포 선례**대로 문제없다(`(tabs)/explore.tsx` + `app/explore/places.tsx`).

---

## 2. `src/pages/` 슬라이스 (6)

`my-page/` · `my-stays/` · `settings/` · `settings-notifications/` · `settings-location/` · `notification-inbox/`

---

## 3. `src/features/notification/`

### `model/`

| 파일 | 책임 | 규칙 |
|---|---|---|
| `useNotificationInbox.ts` | `since` 커서 조회 + 페이지네이션 | DEC-U6-4 |
| `groupByDay.ts` | **`오늘` / `이전`** 2구간 분할(실물 `l01`) | 순수 함수 · PBT-U6-F1 |
| `notificationKind.ts` | 8종 ↔ 아이콘·라벨 매핑(`숙소`·`Plan-B`·`일정`·`회고`·`시스템`) | DEC-U6-8 |
| `notificationAction.ts` | `action_type` → 라우트(`대안 일정 보기` → U4 재계획) | BR-U6-08 |
| `useToggles.ts` | 7행 × 2채널 조회·변경(낙관적 갱신) | BR-U6-14 |
| `channelAvailability.ts` | OS 권한 × 토글 → **푸시 열 비활성/`권한 필요` 칩** | BR-U6-16 · **PBT-U6-F2** |
| `usePushRegistration.ts` | `expo-notifications` 토큰 획득 → 서버 등록 | DEC-U6-3 |
| `unreadCount.ts` | 미읽음 수(탭 뱃지) | |

### `ui/`

`NotificationInboxScreen` · `NotificationRow`(아이콘 · 제목 · `종류 · 상대시각` 메타 · **미읽음 dot** · 액션 링크) · `DayGroupHeader` · `MarkAllReadButton` · `NotificationSettingsScreen` · `ToggleRow`(푸시·인앱 2열) · `PermissionBanner`(`설정 이동`) · `NotificationGlyphs`

---

## 4. `src/features/settings/`

### `model/`

| 파일 | 책임 | 규칙 |
|---|---|---|
| `settingsSections.ts` | `l05` 6그룹 정의 + 각 행의 **현재값 요약**(`여행자123`·`바다·휴양`·`미설정`·`동의`) | §3.3 배선표 |
| `useLocationConsent.ts` | `GET/PUT /me/location-consent` — **토글 1개 → L2·L3 동시** | DEC-U6-11 · BR-U6-29 |
| `revokeImpact.ts` | 철회 직전 고지 문구(중단되는 것 3 / 계속되는 것 2) | BR-U6-30 |
| `deletionScope.ts` | **삭제 시 함께 지워지는 목록** — U6 소유, 유닛 추가 시 갱신 | BR-U6-25 |
| `useAffiliateNotice.ts` | "다시 보기" 토글 | BR-U6-33 |
| `usePreferences.ts` | 취향 7행 조회·수정 | BR-U6-28 |

### `ui/`

`SettingsScreen` · `SettingsGroup` · `SettingsRow`(값 요약·뱃지·chevron) · `LocationConsentScreen`(토글 + `이렇게 사용해요` 3 + `동의를 꺼도 계속 동작해요` 배너) · `RevokeConfirmDialog` · `DeleteAccountDialog`(**위험** 스타일) · `MyPageScreen` · `ProfileCard` · `StyleSummaryCard`(디스크립터 + 칩 + **dot 게이지 3축**) · `TripStatusSegment` · `TripCard` · `MyStaysScreen`

---

## 5. `src/shared/` 변경

| 대상 | 변경 |
|---|---|
| `shared/push/` | **신설** — `expo-notifications` 배선(권한 요청·토큰·수신 핸들러·포그라운드 표시 정책). ⚠ **이미 설치·플러그인 등록됨**(`app.config.ts:38`)이라 **신규 의존성 0, EAS 재빌드 불필요할 가능성** — U4 `expo-task-manager`와 다른 점(착수 전 확인) |
| `shared/ui/StateNotice` | 재사용(빈 알림함·빈 숙소·빈 여행) |
| `shared/api/generated` | orval 태그 추가 — `notification`(신규) · `account`·`location`(기존) |

---

## 6. 구조 가드 (`src/__tests__/`)

| 가드 | 잠그는 것 |
|---|---|
| `notificationStructure.test.ts` | 라우트 6 · pages 6 · feature 2분할 |
| `notificationDurationStructure.test.ts` | **알림 본문에 소요시간 심볼 금지**(BR-U6-05 · PBT-U6-5). 기존 `liveTimeStructure`·`recordsDurationStructure` 선례 |
| `notificationKindGuard.test.ts` | `SYSTEM`이 토글 목록에 들어가지 않는다 · `COMMUNITY` 행이 렌더 트리에 없다(U7 개통 전) |
| `settingsBoundary.test.ts` | `features/settings`가 **다른 feature를 import하지 않는다**(U5 G-U5-14 재발 방지 — `import/no-restricted-paths`) |
| `deletionScopeStructure.test.ts` | 삭제 고지 목록이 `deletionScope.ts` 한 곳에서만 나온다(화면이 자체 목록을 만들지 못하게) |

> ⚠️ **U5에서 배운 것**: `features/*`는 서로 import할 수 없다. 마이페이지가 U5 스타일 카드를 그릴 때 **`features/reflection`의 컴포넌트를 가져다 쓸 수 없다** — 공유가 필요하면 `shared/`로 승격해야 한다.

---

## 7. 폼 검증 (UX 사본 — 권위는 서버)

| 입력 | 클라 | 서버 |
|---|---|---|
| 닉네임 | 길이·문자 | `/me/profile/nickname` + `moderation`(U0) |
| 토글 | 없음(즉시 저장) | `notification_toggle` |
| 위치 동의 | OS 권한 선결 확인 | `PUT /me/location-consent`(철회 시 파기 트리거) |
| 계정 삭제 | 재확인 2단 | `POST /me/deletion` |

---

## 8. testID (`{feature}-{screen}-{role}`)

`notification-inbox-row` · `notification-inbox-unread-dot` · `notification-inbox-action` · `notification-inbox-mark-all` · `notification-settings-toggle-push` · `notification-settings-toggle-inapp` · `notification-settings-permission-banner` · `settings-group` · `settings-row` · `settings-location-toggle` · `settings-location-revoke-confirm` · `settings-affiliate-toggle` · `settings-delete-account` · `my-profile-card` · `my-style-gauge` · `my-trip-segment` · `my-trip-card` · `my-stays-row`

---

## 9. PBT (`model/` · fast-check)

| ID | 성질 |
|---|---|
| **PBT-U6-F1** | 임의의 알림 열에 대해 `groupByDay`는 **모든 항목을 정확히 한 번** 배치한다(오늘/이전 어느 쪽이든 유실·중복 없음) |
| **PBT-U6-F2** | OS 권한이 `DENIED`면 어떤 토글 조합에서도 **푸시 열이 활성으로 그려지지 않는다** |
| **PBT-U6-F3** | 위치 토글을 끄면 어떤 경로로도 **L2·L3가 분리된 상태**(하나만 true)로 서버에 전송되지 않는다 |

---

## 10. 시각 확인 상태

**6프레임 확인**(로컬 export `~/Documents/trippilot 짬통/…`) — `l01 default`·`l02 default`·`l02 permission-denied`·`l03 default`·`l05 default`·`l06 default`.
**미확인 10**: `l01 empty` · `l03 empty` · `l04`×3 · `l05 dialog` · `l06 dialog`·`permission-denied` · `l07`×2.
`l05 dialog`·`l06 dialog`는 **삭제 재확인·철회 재확인 다이얼로그**로 추정되며 **BR-U6-25·30의 문안 정본**이라, 구현 착수 전 반드시 확인해야 한다. export가 로컬에 있으므로 Figma 호출 상한과 무관하게 언제든 가능하다.
