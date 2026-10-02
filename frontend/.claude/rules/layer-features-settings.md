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
| `ui/BaseToggleDialog.tsx` | 출발점 해제 확인 다이얼로그 — "출발점을 해제할까요? / 일정은 그대로예요." + "해제". **제품 소비처 0**(TRIP-1076으로 l04가 다이얼로그 없이 거점 화면 push로 바뀜 — 프리뷰 `my-stays-dialog` 키만 문다, 고아). l04 뷰 `MyStaysScreen`은 TRIP-1148로 `pages/my-stays/ui`로 이사. `DIALOG_SHADOW`는 `RevokeConfirmDialog`와 값이 다르다 — 다이얼로그 틀을 `shared/ui`로 승격할 때 먼저 맞출 것 |
| `ui/SettingsGlyphs.tsx` | 설정·마이 글리프 + `MUTED`·`MUTED_SOFT` hex export(비-글리프 파일이 raw hex 없이 색을 넘기기 위함 — 기계 강제 없음, raw hex 소스 스캔은 TRIP-1145·1154에서 삭제). `BookmarkGlyph`·`PencilGlyph`는 프로덕션 소비처 0이지만 parity 테스트의 부재 단언이 import하므로 남긴다. **TRIP-1051**: 옛 취향 7행 아이콘 6개(`WonGlyph`·`PeopleGlyph`·`StarGlyph`·`ArrowsSwapGlyph`·`ForkKnifeGlyph`·`GaugeGlyph`) 삭제 — 취향 행이 하나로 합쳐지며 고아가 됐다. 취향 행 아이콘은 기존 `ContrastGlyph`(반원) 재사용, 새 글리프 추가 없음 |
| `ui/cardShadow.ts` | `CARD_SHADOW`(카드 껍데기 공용). `LocationConsentScreen`에 같은 값의 지역 상수가 있다 |

**관측된 함정**: `enabled:false`로 꺼진 쿼리도 TanStack Query는 캐시에 남은 `data`를 돌려준다 — `SettingsPage`(제휴 토글)·`StayDetailPage`(고지 시트)가 같은 `getGetMeSettingsQueryKey()`를 공유하므로 게스트 판정에 `isAuthed &&`를 명시하지 않으면 이전 계정의 `dismissed:true`가 새어 법정 제휴 고지를 우회한다.
