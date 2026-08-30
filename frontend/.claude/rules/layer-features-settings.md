---
paths:
  - "src/features/settings/**"
---
# `src/features/settings/` — 마이·설정·위치동의 표면 (TRIP-603·604·608·609로 신설 → TRIP-605로 l04 추가)

**이 파일은 TRIP-605([기록])에서 처음 만들어졌다** — `features/settings`는 TRIP-173에서 빈 배럴째 삭제된 뒤 TRIP-603/604/608/609(l03 마이페이지·설정·계정삭제·위치동의)로 재신설됐으나, 그 네 사이클 모두 이 층별 문서를 만들지 않았다(구조 지도 정비 항목이 `docs/structure.md`에서 `.claude/rules/layer-*.md`로 이관된 게 그 이후라 추정 — 사실 확인은 안 함). 그래서 아래는 **기존 파일 전수를 처음 문서화**(한 줄 식별)하고, **이번 사이클(TRIP-605) 신규·변경분만 상세**하게 적는다.

**경계(G-U5-14)**: 이 폴더는 **다른 `features/*`를 import할 수 없다** — `eslint.config.js`의 `FEATURES` 배열에 `settings`가 없어 기계 강제가 아니라 `src/__tests__/settingsBoundary.test.ts`의 소스 재귀 스캔이 유일한 그물이다(repo-traps 참고). 조합·조회·포맷은 전부 `pages/my-page`·`pages/my-stays` 같은 페이지 층이 진다.

## 기존 파일 (TRIP-603·604·608·609, 한 줄 식별만 — 상세는 후속 사이클이 그 파일을 만질 때 채운다)

| 파일 | 역할(한 줄) |
|---|---|
| `ui/MyPageScreen.tsx` | l03 마이페이지 화면(TRIP-603) |
| `ui/SettingsScreen.tsx` | 설정 화면(TRIP-604) |
| `ui/ProfileCard.tsx` / `ui/TripCard.tsx` / `ui/TripStatusSegment.tsx` | l03 프로필·여행 카드 구성 요소 |
| `ui/SettingsGroup.tsx` / `ui/SettingsRow.tsx` / `ui/ExportRow.tsx` / `ui/NicknameEditRow.tsx` | 설정 화면 행 구성 요소 |
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

## 관련

- 경계 가드: `src/__tests__/settingsBoundary.test.ts`(소스 재귀 스캔, eslint 무강제 — repo-traps 참고).
- 다이얼로그 게이트·오버레이 jest 사각의 리포 전역 함정 서술: `frontend/.claude/rules/repo-traps.md`.
