---
paths:
  - "src/features/planb/**"
---
# `src/features/planb/` — 재계획(Plan-B) 도메인: 요청·진행·반영·트리거 표면

바텀시트 목이 열림/닫힘·딤을 원리적으로 못 보므로(`repo-traps.md` 바텀시트 절), 이 도메인은 **관측 가능한 계약**(제출 시 이 body로 POST가 나간다 / 이 라우트로 push한다)으로 심판을 세운다 — 순수 조립·폼 상태·순수 시트를 배선(pages 층)과 엄격히 분리한다. `MapSheetShell`이 widgets 층이라 지도+시트 화면(i05 진행·i06 재계획안)은 features가 아니라 `pages/live/planb-draft`의 뷰에 있다. TRIP-1155로 파일 21개가 `features/{request-replan,apply-replan}`·`pages/{live-itinerary,planb-draft,planb-request,planb-diff,itinerary-edit}`로 이사했다(행은 각 층 문서).

| 파일 | 역할 |
|---|---|
| `src/features/planb/ui/PlanbGlyphs.tsx` | 로컬 복제 글리프(`AppliedAlertGlyph`·`RiskWarningGlyph`·`ChevronRightGlyph`·`LockGlyph`) — 다른 feature 동명 글리프는 import 금지라 복제한다 |
| `src/features/planb/model/appliedSummary.ts` | `appliedSummaryBadges(...)` — 거리 부호는 U+2212/`+`, `\|Δ\|<10`이면 `이동 0m`, `distanceDeltaM===null`이면 배지를 뺀다. 타입에 `duration`이 없어 INV-3 원리적 보장. **프로덕션 소비처 0**(`app/_dev/preview.tsx`만 부른다) |
| `src/features/planb/model/triggerLabel.ts` | `TRIGGER_LABELS`·`triggerLabel(kind, variant?)` — `TriggerKind` 4종 → `{label, iconKey}` 정적 요지(상세 사유는 서버 `reason`, 섞지 않는다). 상황 감지 FE-B: `VARIANT_LABELS: Record<NonNullable<TriggerVariant>, string>`(변형 12종 — 서버 enum 이 늘면 tsc 가 잡는다)·`isKnownVariant` — 아는 변형이면 그 라벨 + **kind 의 iconKey**, 모르는 값·null 이면 kind 라벨(`TRIGGER_LABELS` 무변경). 조회는 `hasOwnProperty`(`'toString'` 같은 프로토타입 키가 라벨로 새지 않게). node-safe. 표 도출 강제 소스 스캔(`RiskDetailSheet.labelSource.test.ts`)은 TRIP-1354 에서 지웠다(판정 3 — 리터럴만 잡아 import 우회는 못 봤다). PBT-SA-22 는 `triggerLabel.property.test.ts`(라벨·알약·날짜어 묶음 1파일) |
| `src/features/planb/model/triggerPillCopy.ts` | i02 지도 위 알약 카피 `{dayLabel }{라벨}{ · 장소}{ 시}` — WEATHER `{슬롯명} {H}시`·DELAY `{슬롯명} 방면`·CLOSURE `{슬롯명} 주변 시설`, 매칭 슬롯이 없으면 라벨만. 상황 감지 FE-B: 3번째 인자 `{variant, dayLabel}` — 아는 변형이면 변형 라벨, CLOSURE 는 변형이 있을 때만 `주변 시설` 꼬리를 뗀다(그 장소 자체의 영업). 옵션이 없거나 null 이면 **옛 출력과 바이트까지 같다**(PBT-SA-22 ④의 오라클이 옛 구현 사본). `startAt` 옆 산술 없음(BR-U4-34) |
| `src/features/planb/model/triggerDayLabel.ts` | 상황 감지 FE-B — `triggerDayLabel(affectedDate, today)`: 같은 날 null · 다음 날 `내일` · 그 밖 `M월 D일`(앞자리 0 없음, '모레' 없음). 상대 날짜어는 **표시 시점에만** 만든다(서버 문구엔 없다, BR-SA-12 ②). 다음 날은 `Date.UTC` 달력 산술(월말·연말·윤일), 날짜 꼴이 아니면 null. 시계를 읽지 않는다 — `today` 는 호출부가 준다 |
| `src/features/planb/model/useActiveTriggers.ts` | codegen triggers GET 래퍼(로직 0) — `enabled`로 active 얼굴에서만 조회. 서버가 발화 중인 것만 반환(INV-U4-01), MANUAL 제외는 페이지 몫. 서버 억제(BR-U4-15)를 만드는 경로는 앱에 없다(× 끄기는 로컬 숨김) |
| `src/features/planb/config/watchLabels.ts` | `WATCH_CATEGORY_LABEL`(날씨·이동·영업)·`WATCH_STATUS_LABEL`(`active` 활성·`normal` 정상·`unknown` 확인 불가 — 상황 감지 FE-B)·`WatchKind`·`WatchStatus`. kind 3리터럴을 model 타입과 두 벌로 가진다(순환 회피) — 어긋나면 tsc가 `Record` 키로 잡는다 |

⚠️ `features/planb/ui/**`의 소요시간 표기 0건(INV-3)·`<MapView>` 호출부 명부는 기계 강제 없음 — TRIP-1145에서 스캔 삭제, 회귀는 QA.
