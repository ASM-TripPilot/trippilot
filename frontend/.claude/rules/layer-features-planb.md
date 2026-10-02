---
paths:
  - "src/features/planb/**"
---
# `src/features/planb/` — 재계획(Plan-B) 도메인: 요청·진행·반영·트리거 표면

바텀시트 목이 열림/닫힘·딤을 원리적으로 못 보므로(`repo-traps.md` 바텀시트 절), 이 도메인은 **관측 가능한 계약**(제출 시 이 body로 POST가 나간다 / 이 라우트로 push한다)으로 심판을 세운다 — 순수 조립·폼 상태·순수 시트를 배선(pages 층)과 엄격히 분리한다. `MapSheetShell`이 widgets 층이라 지도+시트 화면(i05 진행·i06 재계획안)은 features가 아니라 `pages/live/planb-draft`의 뷰에 있다. TRIP-1155로 파일 21개가 `features/{request-replan,apply-replan}`·`pages/{live-itinerary,planb-draft,planb-request,planb-diff,itinerary-edit}`로 이사했다(행은 각 층 문서).

| 파일 | 역할 |
|---|---|
| `src/features/planb/model/slackTime.ts` | `slackTime` — 두 확정 시각(`HH:mm[:ss]`)의 차를 `여유 N시간 M분`/`여유 없음`으로(wall-clock 미사용, `split(':')`). **프로덕션 소비처 0**(`SlotCandidateSheet`는 주석뿐, 문자열은 props로 받음 — 프리뷰 픽스처만 산출 형태를 흉내) — PBT-U4-F2(되파싱 오라클)가 유일 심판(INV-3 소스 스캔은 TRIP-1145에서 삭제). [[두 확정 시각의 차 — 여유(slack) 계산]] |
| `src/features/planb/model/useSlotCandidates.ts` | codegen 슬롯 후보 POST passthrough. ⚠️ 프로덕션 소비처 0 |
| `src/features/planb/ui/PlanbGlyphs.tsx` | 로컬 복제 글리프(`AppliedAlertGlyph`·`RiskWarningGlyph`·`ChevronRightGlyph`·`LockGlyph`) — 다른 feature 동명 글리프는 import 금지라 복제한다 |
| `src/features/planb/ui/SlotCandidateSheet.tsx` | i14 순수 인라인 패널(바텀시트 라이브러리 import 0 — 통과형 목 사각 회피). 후보 카드마다 rationale·distanceRange·`{slackLabel}`(model 값을 변수로만). `degraded===true`만 강등 고지, `[]`면 empty. ⚠️ 프로덕션 소비처 0(프리뷰만) — `pages/itinerary/itinerary-draft`의 동명 파일과 별개 |
| `src/features/planb/model/appliedSummary.ts` | `appliedSummaryBadges(...)` — 거리 부호는 U+2212/`+`, `\|Δ\|<10`이면 `이동 0m`, `distanceDeltaM===null`이면 배지를 뺀다. 타입에 `duration`이 없어 INV-3 원리적 보장. **프로덕션 소비처 0**(`src/app/_dev/preview.tsx`만 부른다) |
| `src/features/planb/model/triggerLabel.ts` | `TRIGGER_LABELS`·`triggerLabel(kind)` — `TriggerKind` 4종 → `{label, iconKey}` 정적 요지(상세 사유는 서버 `reason`, 섞지 않는다). node-safe. `RiskDetailSheet.labelSource.test.ts`가 표 도출을 강제(리터럴만 잡아 import 우회는 못 본다) |
| `src/features/planb/model/triggerPillCopy.ts` | i02 지도 위 알약 카피 — WEATHER `{슬롯명} {H}시`·DELAY `{슬롯명} 방면`·CLOSURE `{슬롯명} 주변 시설`, 매칭 슬롯이 없으면 `triggerLabel(kind).label`. `startAt` 옆 산술 없음(BR-U4-34) |
| `src/features/planb/model/useActiveTriggers.ts` | codegen triggers GET 래퍼(로직 0) — `enabled`로 active 얼굴에서만 조회. 서버가 발화 중인 것만 반환(INV-U4-01), MANUAL 제외는 페이지 몫. 서버 억제(BR-U4-15)를 만드는 경로는 앱에 없다(× 끄기는 로컬 숨김) |
| `src/features/planb/config/watchLabels.ts` | `WATCH_CATEGORY_LABEL`(날씨·이동·영업)·`WATCH_STATUS_LABEL`·`WatchKind`. kind 3리터럴을 model 타입과 두 벌로 가진다(순환 회피) — 어긋나면 tsc가 `Record` 키로 잡는다 |

⚠️ `features/planb/ui/**`의 소요시간 표기 0건(INV-3)·`<MapView>` 호출부 명부는 기계 강제 없음 — TRIP-1145에서 스캔 삭제, 회귀는 QA.
