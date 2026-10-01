---
paths:
  - "src/features/planb/**"
---
# `src/features/planb/` — 재계획(Plan-B) 도메인: 요청·진행·반영·트리거 표면

바텀시트 목이 열림/닫힘·딤을 원리적으로 못 보므로(`repo-traps.md` 바텀시트 절), 이 도메인은 **관측 가능한 계약**(제출 시 이 body로 POST가 나간다 / 이 라우트로 push한다)으로 심판을 세운다 — 순수 조립·폼 상태·순수 시트를 배선(pages 층)과 엄격히 분리한다. `MapSheetShell`이 widgets 층이라 지도+시트 화면(i05 진행·i06 재계획안)은 features가 아니라 `pages/planb-draft`의 뷰에 있다.

| 파일 | 역할 |
|---|---|
| `src/features/planb/model/replanScope.ts` | 범위 카탈로그 — `REPLAN_SCOPES`(`PARTIAL_SLOTS`·`FULL_DAY`)·`DEFAULT_REPLAN_SCOPE`. 와이어값은 ASCII key, 한글은 라벨. |
| `src/features/planb/config/replanChoices.ts` | 사유·방향 카탈로그(node-safe) — `REPLAN_REASONS`·`REPLAN_DIRECTIVES`·`ReplanChoice`·`TRIGGER_REASON_KEY: Record<WatchKind, string>`(kind가 늘면 tsc가 누락을 잡는다). ⚠️ `AVOID_OUTDOOR`는 ai 지시 사전에 없어 `unknown_directives`로 조용히 무시되고, 일부 방향은 ai 사전엔 있으나 solver 미배선이라 무효과 |
| `src/features/planb/model/replanMapCenter.ts` | `deriveReplanMapAnchor({sessionOrigin?, days?, preferredDate?})` — 사다리 `세션 origin(lat·lng 둘 다) ?? 기준 날짜 첫 좌표 슬롯 ?? 일정 첫 좌표 슬롯 ?? REPLAN_MAP_FALLBACK_CENTER`. 슬롯에서 골랐으면 `placeName`도 돌려준다("{장소} 인근(추정)" 라벨 재료). `PlanbSolvingPage`·`PlanbDraftPage`·`LiveLocationPage` 공용(G3 소스 가드가 호출을 강제) |
| `src/features/planb/model/replanRequest.ts` | `buildStartReplanRequest(values, origin?)` — 폼 값을 `StartReplanRequest` 7키로. 위치 미입력이어도 **`originKind: null`을 반드시 명시**(codegen required·nullable). `origin`이 없으면 `originLat/originLng` **키 자체가 없다**(값 null과 다름), 있으면 9키([[후방호환 옵셔널 파라미터 (additive prop)]]) |
| `src/features/planb/model/replanOrigin.ts` | `buildManualOrigin`·`buildGpsOrigin`(`{originKind, originLat, originLng}` 정확히 3키)·`isEstimatedOrigin(originKind)`(`!== 'GPS'` — GPS만 실측, 나머지는 전부 "추정"). 파일 헤더의 "test-designer 스텁 — red 유도용" 주석은 낡았다 |
| `src/features/planb/model/useReplanGpsOrigin.ts` | 앱 위치 동의(`useGetMeLocationConsent().legalConsent===true`)일 때만 `readDevicePosition()` → `buildGpsOrigin`. 동의 OFF·오류는 `undefined`(위치 API 0회). `shared/location/useLocationConsent`는 마운트 부수효과(권한 조회+PATCH 미러) 때문에 의도적으로 안 쓴다. 렌더마다 새 함수를 돌려줘 낡은 클로저가 없다 |
| `src/features/planb/model/replanFormStore.ts` | Zustand 폼 스토어 `useReplanFormStore` — `scope`·`reasons`(Set)·`directives`(Set)·`freeText`·`sheetOpen`. 시트↔페이지 상태 공유 때문에 페이지 로컬 `useState`가 아니다 |
| `src/features/planb/model/useStartReplan.ts` | codegen 세션 생성 훅의 얇은 래퍼 — 통합 테스트가 이 심볼을 목 seam으로 잠그므로 페이지가 codegen 훅을 직접 부르지 않는다 |
| `src/features/planb/model/useReplanDiff.ts` | codegen diff GET 훅의 얇은 래퍼(`enabled: options?.enabled ?? true`). ⚠️ 페이지 테스트는 seam을 통째로 목으로 바꾸므로 이 매핑이 깨져도 못 잡는다 — 잠그려면 `useReplanDiff.integration.test.tsx`에 `enabled:false`→GET 0회 케이스가 필요하다 |
| `src/features/planb/ui/ReplanRequestSheet.tsx` | i04 재계획 요청 순수 시트 — 섹션 순서(왜 바꾸나요→범위→방법→직접 말하기→[AI가 다시 짜기]). 감지 트리거가 있으면 `ReplanDetectedChip`을 선두에 얹고 매핑되는 정적 칩은 숨긴다(숨긴 선택값은 스토어에 남는다 — 제출 필터는 배선판 몫). 자유텍스트는 `BottomSheetTextInput`. `errorText?`는 CTA 바로 위 한 줄(여행 기간 밖 409 안내) |
| `src/features/planb/model/replanState.ts` | `resolveReplanState` — `ReplanSessionStatus` 7값을 화면 5종(`solving`·`draft`·`noSolution`·`failed`·`closed`)으로 exhaustive switch 폴드(default 없음 — tsc가 누락 case를 강제). [[상태를 좁혀 접는 판정 — resolveReplanState의 폴드]] |
| `src/features/planb/model/slackTime.ts` | `slackTime` — 두 확정 시각(`HH:mm[:ss]`)의 차를 `여유 N시간 M분`/`여유 없음`으로(wall-clock 미사용, `split(':')`). **model이라 INV-3 소스 가드 밖** — PBT-U4-F2(되파싱 오라클)가 유일 심판. [[두 확정 시각의 차 — 여유(slack) 계산]] |
| `src/features/planb/model/replanFromInstant.ts` | `readFromInstant(fromInstant)` — 서버 ISO 순간에 고정 +9h를 더한 뒤 **UTC 필드**로 읽어 `{date, hour}`(여행지 KST). 기기 로컬 getter를 쓰면 KST 기계에선 green, UTC CI에서만 red다. 잘못된 문자열은 `RangeError`(침묵 실패 아님). [[순간(instant)을 여행지 시각으로 — readFromInstant의 UTC 트릭]] |
| `src/features/planb/model/useReplanSession.ts` | codegen 세션 GET 래퍼 — `COLLECTING`·`SOLVING`일 때만 2000ms `refetchInterval`(도착 후 자동 정지) |
| `src/features/planb/model/useSlotCandidates.ts` | codegen 슬롯 후보 POST passthrough. ⚠️ 프로덕션 소비처 0 |
| `src/features/planb/ui/PlanbGlyphs.tsx` | 로컬 복제 글리프(`AppliedAlertGlyph`·`RiskWarningGlyph`·`ChevronRightGlyph`·`LockGlyph`) — 다른 feature 동명 글리프는 import 금지라 복제한다 |
| `src/features/planb/ui/SlotCandidateSheet.tsx` | i14 순수 인라인 패널(바텀시트 라이브러리 import 0 — 통과형 목 사각 회피). 후보 카드마다 rationale·distanceRange·`{slackLabel}`(model 값을 변수로만). `degraded===true`만 강등 고지, `[]`면 empty. ⚠️ 프로덕션 소비처 0(프리뷰만) — `features/itinerary`의 동명 파일과 별개 |
| `src/features/planb/model/useApplyReplan.ts` | codegen apply를 감싸는 유일 seam(`PlanbDiffPage` 1곳 — 구조가드로 봉인). 성공 시 itinerary 캐시 무효화(확정이 원 일정을 바꾸는 유일 지점, INV-U4-05). 무효화 정확성은 jest 사각(문자열 실재만 확인) |
| `src/features/planb/model/useCancelReplan.ts` | codegen cancel passthrough(무효화 없음 — 원 일정 불변). ⚠️ apply와 달리 codegen 직접 호출 봉인 가드가 없다 — `PlanbSolvingPage`가 codegen 훅을 직접 부른다 |
| `src/features/planb/ui/ReplanAppliedSheet.tsx` | i08 변경 반영 시트 — 허브 위 조건부 마운트(`?applied` 쿼리). 스크림은 `backdropComponent`(본문 밖), 끌어 닫기 = 확인. 요약 배지·내역 행은 빈 값이면 컨테이너째 안 그린다. `[되돌리기]`는 서버 호출 없이 안내만(되돌리기 API 없음, [[계약이 못 받치면 안 그린다]]) |
| `src/features/planb/model/appliedSummary.ts` | `appliedSummaryBadges(...)` — 거리 부호는 U+2212/`+`, `\|Δ\|<10`이면 `이동 0m`, `distanceDeltaM===null`이면 배지를 뺀다. 타입에 `duration`이 없어 INV-3 원리적 보장 |
| `src/features/planb/model/reorderKeepingLocked.ts` | `reorderKeepingLocked(original, reordered, lockedPoiIds)` — 잠긴 칸(`isFixed \|\| lockedPoiIds`)은 원래 index에 두고 빈 칸을 나머지 순서로 채운다(입력 불변). `itineraryEditStore`의 `reorderKeepingFixed`와 같은 알고리즘의 사촌(형제 feature import 금지). 소비처는 `ItineraryEditPage.onReorder` |
| `src/features/planb/model/triggerLabel.ts` | `TRIGGER_LABELS`·`triggerLabel(kind)` — `TriggerKind` 4종 → `{label, iconKey}` 정적 요지(상세 사유는 서버 `reason`, 섞지 않는다). node-safe. `RiskDetailSheet.labelSource.test.ts`가 표 도출을 강제(리터럴만 잡아 import 우회는 못 본다) |
| `src/features/planb/model/triggerPillCopy.ts` | i02 지도 위 알약 카피 — WEATHER `{슬롯명} {H}시`·DELAY `{슬롯명} 방면`·CLOSURE `{슬롯명} 주변 시설`, 매칭 슬롯이 없으면 `triggerLabel(kind).label`. `startAt` 옆 산술 없음(BR-U4-34) |
| `src/features/planb/model/useActiveTriggers.ts` | codegen triggers GET 래퍼(로직 0) — `enabled`로 active 얼굴에서만 조회. 서버가 발화 중인 것만 반환(INV-U4-01), MANUAL 제외는 페이지 몫. 서버 억제(BR-U4-15)를 만드는 경로는 앱에 없다(× 끄기는 로컬 숨김) |
| `src/features/planb/model/triggerWatchlist.ts` | `triggerWatchlist(triggers)` — 같은 발화 목록을 i03 시트 배지 3행(`{activeBanner, rows[3]}`)으로 **다르게 접는다**([[사영 (projection) — 같은 데이터 다른 접기]]). MANUAL 제외 후 `[0]`이 배너, 행은 `WEATHER·DELAY·CLOSURE` 고정 순서. 행 이름은 `config/watchLabels.ts`의 카테고리명(활성 트리거 제목과 다른 표면) |
| `src/features/planb/config/watchLabels.ts` | `WATCH_CATEGORY_LABEL`(날씨·이동·영업)·`WATCH_STATUS_LABEL`·`WatchKind`. kind 3리터럴을 model 타입과 두 벌로 가진다(순환 회피) — 어긋나면 tsc가 `Record` 키로 잡는다 |
| `src/features/planb/model/riskAffectedRow.ts` | `riskAffectedRow(days, slotKey)` — `parseSlotKey`(entities)로 쪼개 **트리거 자신의 날짜**에서 슬롯을 찾고 `{time, name, meta}`만(INV-3). 못 찾으면 전부 `null`(상자 생략) |
| `src/features/planb/model/foldScope.ts` | `foldScope(scope)` — `FULL_DAY`만 통과, 나머지(null 포함)는 `PARTIAL_SLOTS` |
| `src/features/planb/ui/RiskDetailSheet.tsx` | i03 위험 상세 순수 시트 — eyebrow + 빨강 경고 + 서버 `reason` 제목 + 영향 상자(있을 때만) + 배지 3개 + `[대안 보기]`. 조건부 마운트로 열고([[조건부 마운트로 시트 열기]]) 페이지가 허브의 **형제**로 그려 딤이 허브 전체를 덮는다([[z-order = 렌더 순서 (RN absolute 형제는 나중 렌더가 위)]]). `backgroundComponent={null}`이라 위로 끌면 여분 패딩이 투명해지는 gap이 생길 수 있다(6-b 확인 대기, [[gorhom 배경 끄기와 over-drag 여분 패딩]]) |

⚠️ `features/planb/ui/**`의 소요시간 표기 0건(INV-3)·`<MapView>` 호출부 명부는 기계 강제 없음 — TRIP-1145에서 스캔 삭제, 회귀는 QA.
