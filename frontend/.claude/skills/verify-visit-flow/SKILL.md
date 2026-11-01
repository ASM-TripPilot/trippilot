---
name: verify-visit-flow
description: "여행 중 방문 체크(예정/진행 중/완료/건너뜀, [도착]·[방문 완료]·건너뛰기 노출과 낙관 갱신·연타 잠금)와 Plan-B 재계획(요청 → 초안 → 적용 → 남은 방문)을 TLA+ 모델 체크 + 실제 코드 적합성 검사로 검증한다. 허브(LiveHubView·LiveItineraryPage)·useVisitCheck·visitProgress/slotProgress·기록 화면 건너뛰기·재계획 요청/적용 코드를 바꿀 때, '방문 체크 꼬일 수 있어?', '건너뛴 곳에 도착 버튼', 'Plan-B 적용 뒤 일정', 'verify-visit-flow' 요청 시 사용하라."
---

# verify-visit-flow — 여행 중 방문·Plan-B 형식 검증

테스트는 누가 떠올린 순서만 본다. 이 스킬은 **하루 장소 3곳 안에서 사용자 누름·서버 응답·실패·재조회·재계획의 모든 순서**를 TLC 로 다 돌리고(48,132 상태), 그 모델이 실제 코드와 같은 판정을 하는지 fast-check 로 실제 코드에 대조한다.

## 지키는 약속

| 속성(모델 이름) | 사용자 말 | 피해 | 근거 |
|---|---|---|---|
| P1 `NoArriveOnSkipped` | 건너뛴 장소 카드에는 [도착]이 서지 않는다 | 누르면 서버가 409 로 거절해 「도착을 기록하지 못했어요」가 끝없이 반복된다 | BR-U5-02(같은 슬롯 두 번 체크 409) · BR-U10-56(남은 슬롯이 전부 건너뜀이면 [방문 완료] — 건너뜀은 도착 대상이 아니다) · j01 문구 「건너뛴 곳은 되돌리거나 완료로 바꿀 수 없어요」 |
| P2 `ReplanKeepsSkippedOut` | 재계획을 적용한 새 일정에 이미 건너뛴 장소가 다시 들어오지 않는다 | 새 일정에 갈 수 없는 칸이 생긴다(slotKey `날짜#poi` 가 같아 옛 건너뜀 기록과 부딪혀 [도착]이 영원히 409) | BR-U4-17(입력 = 남은·완료 슬롯) · BR-U5-02 · U5 유니크 `(trip_id, slot_key)` — **정본에 "건너뛴 곳은 재계획에서 뺀다"는 명문이 없다: 판단 필요** |
| P3 `OneOpenVisit` | 요청이 다 끝난 뒤 서버에 "도착했지만 안 끝난" 방문은 하루에 많아야 하나다 | 진행 중이 둘이면 하나는 허브에서 '예정'으로 보이고 그 [도착]은 409, 사슬 [도착]이 엉뚱한 곳을 완료시킨다 | BR-U10-54(진행 중 1곳을 먼저 완료) — U10 은 "진행 중 슬롯 전부"라는 복수 표현도 쓴다: **판단 필요** |
| P4 `ActiveCanFinish` | 진행 중 카드가 있으면 그 방문을 끝낼 버튼([방문 완료] 또는 뒤 카드의 [도착])이 하나는 선다 | 진행 중에서 빠져나올 길이 없다(갇힘) | BR-U10-56 갇힘 방지 |

## 결과 기준선 (sync 커밋에서 측정)

| 검사 | 기준선 | 뜻 |
|---|---|---|
| 적합성(코드==모델) | 같음 | 모델의 CODE MIRROR 식이 실제 코드와 생성 입력 150건에서 같다 |
| 반례 재현 R1~R3 | 재현됨 | 아래 결함 3건이 실제 `LiveItineraryPage` 위에서 그대로 일어난다 |
| `TypeOK`·`ActiveCanFinish`·교착 없음 | 성립 | |
| `NoArriveOnSkipped` | 깨짐 | 결함 FM-L4-01 — 진행 중이 없으면 `canArriveAt` 이 건너뜀을 안 본다 (`activeIndex < 0` 갈래). 기존 테스트 `LiveHubView.test.tsx` HV10f 가 이 동작을 잠그고 있다 |
| `ReplanKeepsSkippedOut` | 깨짐 | 결함 FM-L4-05 — 수동 재계획은 `excludedPoiIds: []` 를 싣고, 서버도 건너뛴 곳을 잠그지도 빼지도 않는다(가정 S4) |
| `OneOpenVisit` | 깨짐 | 새 결함 — 단독 [방문 완료] 대기 중 다른 [도착]이 열린다(`completeBusy` ≠ `arriveBusy`), 완료가 네트워크로 실패하면 진행 중 2곳 |

깨짐 3건은 **보고된 결함**이다. 모델이나 속성을 약하게 고쳐 통과시키지 마라. 제품 코드는 사용자가 요청할 때만 고친다.

## 실행 — 명령 하나

```sh
frontend/.claude/skills/verify-visit-flow/scripts/run.sh [--frontend <node_modules 있는 frontend>] [--model <모델 폴더 사본>] [--skip-jest|--skip-tlc]
```

- 기본 `--frontend` 는 이 스킬이 든 frontend. `pnpm install` 안 된 워크트리면 된 워크트리를 넘긴다.
- 약 30초. 처음엔 mise 로 Temurin 25 · TLC 1.7.4 를 받는다(네트워크, `brew install mise`). `TLA2TOOLS`·`JAVA` 로 바꿔 쓸 수 있다.
- 기준선과 모두 같으면 exit 0. 끝 표의 「결과」와 「기준선」 칸을 본다.
- 검사 파일은 `checks/*.check.tsx` 다 — 리포 jest 가 `.claude/` 도 훑으므로 `.test` 이름을 쓰지 않는다. 스크립트가 리포 밖 임시 폴더에 `.test.tsx` 로 복사해 `--roots` 로 돌리고 지운다(`VISIT_FLOW_KEEP=1` 이면 남긴다).
- 반례 경로와 상태도는 **`/statechart` 스킬**로 `model/MCVisitFlow.tla`(view = `model/view.mjs`)를 돌려 읽는다. 깨진 규칙마다 가장 짧은 경로가 한국어 단계로 나온다.

## 이 변경이 덮는 코드에 닿는가

아래 파일을 바꿨으면 이 스킬을 돌린다. 스크립트가 sync 커밋 대비 바뀐 파일을 `!! 동기화` 로 먼저 알린다.

| 파일 (frontend/ 기준) | 함수·식 | 모델 대응 |
|---|---|---|
| `src/pages/live/live-itinerary/ui/LiveHubView.tsx` | `canArriveAt` · `arriveAfterActive` · `showComplete` | `CanArriveAt` · `ArriveAfterActive` · `ShowComplete` (CODE MIRROR, 적합성이 대조) |
| `src/entities/itinerary-slot/lib/visitProgress.ts` | `deriveVisitProgress` · `deriveSkippedPoiIds` | `Completed` · `Candidate` · `ActiveIdx` · `SkippedC` (적합성) |
| `src/entities/itinerary-slot/lib/slotProgress.ts` | `projectSlotProgress` | `SlotState` (적합성) |
| `src/pages/live/live-itinerary/ui/LiveItineraryPage.tsx` | `pressArrive`(`arriveBusy`) · `pressComplete`(`completeBusy`) · 파생 배선 · `onPressArrive` 게이트 | `PressArrive` · `PressComplete` · `HubIdle`/`cmp` 두 잠금 (반례 재현 R1·R3) |
| `src/features/check-visit/model/useVisitCheck.ts` | `arrive` · `complete` · `skip` · `completeThenArrive` (낙관 갱신·레코드 단위 롤백·409 재조회) | `*Ok` · `*NetFail` · `*Rejected` · `ChainComplete*` (적합성 사슬 2건 + 재현) |
| `src/features/check-visit/model/visitStatus.ts` | `OPTIMISTIC_VISIT_ID_PREFIX` | `opt` |
| `src/pages/record/trip-records/ui/VisitRecordCard.tsx` · `TripRecordsPage.tsx` | `canSkip` · `handleConfirmSkip` | `J01Skip` · `SkipOk` · `SkipFail` (읽어서 대조) |
| `src/pages/live/planb-request/ui/PlanbRequestPage.tsx` · `src/features/request-replan/model/replanRequest.ts` | `excludedPoiIds: entrySeed?.excludedPoiIds` → `?? []` | `ExcludedSent == {}` (빌더는 적합성, 페이지 인자는 읽어서 대조) |
| `src/features/apply-replan/model/useApplyReplan.ts` | 적용 성공 → 일정 무효화(방문 기록 캐시는 그대로) | `Apply` (재현 R2) |
| `backend/modules/archive/.../VisitCheckService.kt` · `domain/VisitCheck.kt` · `api/ArchiveFacade.kt` · `backend/modules/itinerary-recalculation/.../ReplanSolver.kt` | 서버 규칙 — 가정 S1~S4 | 가정. 바뀌면 `VisitFlow.tla` ASSUMPTION 주석과 재현 테스트의 가짜 서버를 함께 고친다 |

## 동기화

- **sync 커밋: `22a5ee3dba9ccea78320485af0534b8b7c32a949`** (develop, 2026-11-01). 이 커밋에서 위 표의 코드와 모델이 같다는 것을 적합성·재현·읽기로 확인했다.
- sync 커밋은 **위 표의 코드를 새 커밋에서 다시 읽어 모델이 그 코드를 그대로 기술한다고 확인한 뒤에만** 앞으로 옮긴다(이 파일과 `scripts/run.sh` 의 `SYNC=` 두 곳). 스크립트가 exit 0 이라는 것만으로 옮기지 마라 — 적합성은 CODE MIRROR 구역만 기계로 보고, 요청·롤백·잠금 단계는 읽어서 맞춰야 한다.

## 결과 읽기 — 실제 버그인가, 모델 오류인가

1. **적합성 「다름」** → 앱 결함이 아니다. 코드가 모델과 달라졌다. 로그의 `Counterexample`(장소 순서·캐시 상태)과 Expected/Received 가 어느 식이 갈렸는지 알려 준다.
   - 의도한 변경이면 아래 「의도한 변경일 때」로 모델을 고친다.
   - 의도하지 않았으면 그 diff 가 회귀다.
2. **TLC 결과가 기준선과 다름**(새로 깨짐) → `/statechart` 로 반례 경로를 읽고, **그 경로를 실제 코드에서 한 단계씩 재현한다** — `checks/repro.integration.check.tsx` 에 R 하나를 더해 `run.sh` 로 돌린다(가짜 서버·`J01Probe` 패턴을 그대로 쓴다). 재현되면 결함으로 보고하고, 안 되면 모델 오류를 먼저 의심한다(모델이 한 덩어리로 본 단계가 코드에선 둘인가, 가정이 서버와 다른가).
3. **기준선 「깨짐」이 「성립」으로** 바뀜 → 결함이 고쳐졌을 수 있다. 반례 재현 R 도 「안됨」이어야 정합이다. 둘 다 확인되면 기준선(이 파일 표 + `run.sh` `BASELINE`)을 바꾸고, 그 재현 R 은 "고쳐진 동작"을 단언하도록 뒤집는다.
4. **반례 재현 「안됨」, 적합성 「같음」** → 화면 문구·testID·요청 순서가 바뀌었거나 결함이 고쳐졌다. 재현 로그의 ✕ 를 보고 가른다.

## 의도한 변경일 때 모델 고치기

1. `model/VisitFlow.tla` 의 CODE MIRROR 구역 식을 새 코드에 글자 그대로 맞춘다(옆 주석의 파일·식 이름 유지). 같은 식을 `checks/conformance.check.tsx` 의 `modelArriveTargets`·`modelShowComplete`·`modelExcludedSent` 에도 옮긴다.
2. 요청·잠금·롤백이 바뀌었으면 해당 액션(`PressArrive`·`Chain*`·`Arrive*`·`Complete*`·`J01Skip`·`Apply` 등)을 고친다. **코드에서 한 덩어리가 아닌 것을 한 액션으로 합치지 마라** — 기준: `await` 사이에 사용자가 다른 버튼을 누를 수 있으면 두 액션이다.
3. 먼저 모델 사본에서 시험하려면 `cp -R model <사본>` 뒤 `run.sh --model <사본>`.
4. `run.sh` 가 기준선과 같거나, 다르면 위 「결과 읽기」로 판정한다. 속성(INVARIANT)을 약하게 바꿔 맞추지 마라.
5. 코드를 다시 읽어 대조한 뒤 sync 커밋을 옮긴다.

## 범위·가정 (통과가 뜻하는 것)

- **경계**: 오늘 하루, 장소 3곳(일정 `A·B·C`), 재계획이 새로 놓는 장소 ≤ 2, 수동 허브(`Armed = FALSE`). 상태 48,132개 전수.
- **가정(서버, 백엔드 코드에서 읽음)**: S1 기록 있는 슬롯 도착 409 · S2 `open` 만 완료 · S3 `open` 만 건너뜀 · S4 재계획은 완료 슬롯을 잠그고 진행 중 방문은 남기며, 건너뛴 곳은 잠그지도 빼지도 않고, `excludedPoiIds` 밖 아무 장소나 새로 놓을 수 있다(AI 선택 = 비결정). 네트워크 실패는 어느 요청에나.
- **가정(클라이언트)**: 허브는 오늘 일차를 보고 방문 기록을 받은 상태(`onPressArrive` 게이트 참). j01 건너뛰기는 허브 요청이 다 끝난 뒤에 한다. 재조회는 요청이 없을 때만 일어난다. 낙관 도착 레코드에 [방문 완료]를 누르는 경로(서버 404 → 무변화)는 뺐다. 다른 기기·자동 기록(지오펜스)·즉석 방문은 없다.
- **덮지 않는 것**: 시각 수정·사진·메모, 자동 기록(ARMED), 다른 일차·여행 전후, 실패 안내 줄이 언제 지워지는가(FM-L4-01 의 "적용 뒤에도 안내가 남음"), 재계획 초안 화면의 표시(FM-L4-03), 진행 화면 폴링·8분 상한·취소, 오프라인 큐, 서버 쪽 규칙 자체(백엔드 Kotest 몫).

## 모델 파일

- `model/VisitFlow.tla` — 명세(변수·CODE MIRROR·ASSUMPTION·액션·속성). `model/MCVisitFlow.tla`·`.cfg` — 상수(시퀀스는 cfg 에 못 적어 MC 모듈에 둔다). `model/view.mjs` — `/statechart` 용 한국어 라벨.
- `checks/conformance.check.tsx` — 적합성(jest node 버킷). `checks/repro.integration.check.tsx` — 반례 재현 R1~R3(jest integration 버킷, MSW 가짜 서버). 재현에서 j01 훅은 `renderHook` 이 아니라 같은 트리의 `J01Probe` 로 둔다 — `renderHook` 을 따로 띄우면 페이지 트리의 누름이 요청을 안 보내고 `screen` 도 훅 트리를 가리킨다(실측).

## 증명 기록

sync 커밋에서 `LiveHubView.tsx` 의 `showComplete` 를 `automationArmed` 로 깨자 → `!! 동기화` 경고 + 적합성 「다름」(반례: 일정 `[b]`, b 진행 중 → 기대 complete true / 실제 false) + R3 「안됨」. 모델 사본 `ShowComplete == Armed` 로 맞추자 `ActiveCanFinish` 「깨짐」(1단계: C [도착] → 진행 중 카드에 끝낼 버튼 없음). `cp` 사본으로 원복 → 기준선 그대로.

*유지 판정: maintain-formal-verification-skill 결과로 판정한다 — 3회 연속 `in sync` 이고 그 사이 이 영역 결함 0 이면 실행 주기를 늘린다. 6개월 동안 결함을 1건도 못 내면 이 스킬을 뗀다(첫 실행에서 결함 3건 — FM-L4-01·FM-L4-05 확인, 이중 진행 중 신규).*
