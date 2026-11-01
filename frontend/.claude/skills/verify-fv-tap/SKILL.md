---
name: verify-fv-tap
description: "버튼 연타 잠금(shared/lib/pressGuard.ts guardPress 의 모듈 전역 400ms 창 · openPressGuardWindow · 페이지 잠금 ref assignLockRef·lockedRef·inFlightRef)을 TLA+ 모델 체크 + 실제 코드 적합성 검사 + 반례 재현으로 검증한다. pressGuard.ts 나 아래 표의 대표 경로(일정 확정·숙소 지정·위치카드 허용·위저드 삭제·홈 이동)를 바꿀 때, 새 버튼에 guardPress/잠금 ref 를 붙일 때, '연타하면 두 번 나가?', '더블탭 관통', '확정 두 번', 'verify-fv-tap' 요청 시 사용하라."
---

# verify-fv-tap — 연타 잠금 형식 검증

테스트는 "창 안에서 두 번 누르면 한 번"처럼 누가 떠올린 순서만 본다. 이 스킬은 **누름·시간 흐름(100ms 틱, 1초까지)·서버 응답(성공·409·네트워크 실패, 지연은 아무 값)·바뀐 화면의 탭이 섞이는 모든 순서**를 경로마다 TLC 로 다 돌리고, 그 모델의 창 판정이 실제 `guardPress` 와 같은지 fast-check 로 대조하고, 반례를 실제 페이지에서 다시 밟는다.

## 지키는 약속

| 속성(모델 이름) | 사용자 말 | 피해 |
|---|---|---|
| P1 `OnceOnly` | 버튼을 빠르게 여러 번 눌러도 화면 이동·요청은 한 번만 나간다(실패 안내를 본 뒤 다시 누르는 재시도는 예외) | 같은 요청이 두 번 서버에 간다 — 서버가 409 로 막아도 클라이언트가 그 409 를 사용자에게 실패로 보여 준다(P2) |
| P2 `NoFalseFailure` | 요청이 다 끝났고 서버가 받아들였으면 화면에 실패 안내가 보이지 않는다 | 성공했는데 「확정하지 못했어요」가 떠 사용자가 같은 일을 또 한다 |
| P3 `NoPassThrough` | 화면이 바뀐 지 400ms 안의 탭(연타의 남은 탭)은 바뀐 화면의 버튼을 누르지 않는다 | 확정 직후 편집 화면으로 빨려 들어가는 등 사용자가 안 누른 버튼이 눌린다(TRIP-1013 #057 류) |

근거: TRIP-1013(공용 가드 도입)·1194·1222·1273·1282·1290 연타 관통 수정 · `pressGuard.ts` 주석("무시된 누름은 창을 늘리지 않는다"·음수 경과는 창 밖) · `repo-traps.md` 다이얼로그 절(확정 재누름 잠금은 래퍼/페이지가 쥔다).

## 결과 기준선 (sync 커밋에서 측정)

| 검사 | 기준선 | 뜻 |
|---|---|---|
| 적합성(코드==모델) | 같음 | 모델 `GuardAllows`·전역 창 하나가 실제 `guardPress`·`openPressGuardWindow` 와 생성 입력 300건(시계 되감김·버튼 둘 포함)에서 같다 |
| 반례 재현 R1~R3 | 기대대로 | 실제 페이지 위에서 R1·R2(일정 확정)·R3(위치 허용)이 아직 그대로 일어난다 |
| `nav`·`assign`·`delete` × 4속성 | 성립 | 홈 이동(161 상태)·숙소 지정(405)·위저드 삭제(405) |
| `confirm` `TypeOK` | 성립 | 961 상태 |
| `confirm` `OnceOnly`·`NoFalseFailure`·`NoPassThrough` | 깨짐 | 결함 **FV-TAP-01** — `ItineraryPlanPage` [일정 확정하기]는 guardPress 뿐 잠금 ref·pending 비활성이 없다. 확정 응답이 400ms 보다 늦으면 다시 누른 탭이 POST 를 또 보내고(P1), 둘째의 409 가 확정된 화면에 실패 안내를 남기고 토스트를 지우며(P2 — TanStack `mutate` 호출별 콜백은 마지막 호출에만 돈다), 첫 응답의 창 다시 열기도 건너뛰어 [일정 수정]이 관통된다(P3) |
| `allow` `OnceOnly` | 깨짐 | 결함 **FV-TAP-02** — `LocationPage` default [허용](`handleAllow`)은 가드·잠금이 없다. 이미 허용된 기기(OS 창 없음)에서 같은 프레임 두 번 누르면 권한 조회 2회·`router.replace('/(onboarding)/push')` 2회 |
| `allow` 나머지 | 성립 | 4,262 상태 |

남은 깨짐은 **보고된 결함**이다(리포트 볼트 `사이클/20261102-trip1688-fv-tap/REPORT.md`). 모델이나 속성을 약하게 고쳐 통과시키지 마라. 제품 코드는 사용자가 요청할 때만 고친다.

## 실행 — 명령 하나

```sh
frontend/.claude/skills/verify-fv-tap/scripts/run.sh [--frontend <node_modules 있는 frontend>] [--model <모델 폴더 사본>] [--skip-jest|--skip-tlc]
```

- 기본 `--frontend` 는 이 스킬이 든 frontend. `pnpm install` 안 된 워크트리면 된 워크트리를 넘긴다.
- 약 30초. 처음엔 mise 로 Temurin 25 · TLC 1.7.4 를 받는다(네트워크, `brew install mise`). `TLA2TOOLS`·`JAVA` 로 바꿔 쓸 수 있다.
- 기준선과 모두 같으면 exit 0. 끝 표의 「결과」와 「기준선」 칸을 본다.
- 검사 파일은 `checks/*.check.ts(x)` 다 — `.test` 이름이면 리포 jest·tsc 에 섞인다. 스크립트가 리포 밖 임시 폴더에 `.test` 이름으로 복사해 `--roots` 로 돌리고 지운다(`FV_TAP_KEEP=1` 이면 남긴다).
- 반례 경로와 상태도는 **`/statechart` 스킬**로 `model/MCTapGuard.tla`(view = `model/view.mjs`)를 돌려 읽는다. cfg 의 `Path` 를 보고 싶은 경로로 바꾼 사본에서 돌린다. 깨진 규칙마다 가장 짧은 경로가 한국어 단계(「버튼을 누른다(400ms) — 요청이 나간다」)로 나온다.

## 이 변경이 덮는 코드에 닿는가

아래 파일을 바꿨으면 이 스킬을 돌린다. 스크립트가 sync 커밋 대비 바뀐 파일을 `!! 동기화` 로 먼저 알린다.

| 파일 (frontend/ 기준) | 함수·식 | 모델 대응 | 대조 방법 |
|---|---|---|---|
| `src/shared/lib/pressGuard.ts` | `guardPress` · `openPressGuardWindow` · `WINDOW_MS` · 모듈 전역 `openedAt` | `GuardAllows` · `openedAt` · `Window` | 적합성(fast-check, 실제 코드) |
| `src/pages/home/ui/HomePage.tsx` | `pushDestination`(이동 전용 guardPress 대표) | `MCFlags.nav` | 읽기 |
| `src/pages/trip/trip-new-step2/ui/TripNewStep2Page.tsx` | `handleAssign` · `assignLockRef` · `onAssign={guardPress(handleAssign)}` | `MCFlags.assign` | 읽기 |
| `src/pages/trip/trip-new-step1/ui/TripNewStep1Page.tsx` | `LeaveDialogContainer` `remove` · `lockedRef` · `done` | `MCFlags.delete` | 읽기 |
| `src/pages/itinerary/itinerary-plan/ui/ItineraryPlanPage.tsx` | `handleConfirm` · CTA `guardPress(handleConfirm)` · `goEdit` | `MCFlags.confirm` · `YouTapNext` | 읽기 + 재현 R1·R2 |
| `src/features/edit-itinerary/model/useConfirmItinerary.ts` | 훅 `onSuccess`(setQueryData → CTA 바뀜) | `flipOnHookOk` | 읽기 + 재현 R1 |
| `src/pages/onboarding/onboarding-location/ui/LocationPage.tsx` | `handleAllow` · `goToPushGuarded` | `MCFlags.allow` | 읽기 + 재현 R3 |
| `backend/.../itinerarygeneration/application/ConfirmItineraryService.kt` | PLANNED 가 아니면 `ConflictDetected`(409) | 가정 A3 `conflict` | 가정 — 바뀌면 `TapGuard.tla` ASSUMPTION 과 재현의 가짜 서버를 함께 고친다 |

guardPress 를 쓰는 다른 파일(`grep -rln guardPress src`)은 위 다섯 모양 중 하나로 읽힌다 — 이동 전용(`nav`), 잠금 ref + 성공 시 창 열기(`assign`/`delete`), 잠금 없는 mutate(`confirm`). 새 버튼이 어느 모양인지 모르겠으면 `MCFlags` 에 경로를 하나 더하고 `run.sh` `BASELINE` 에 네 줄을 더한다.

## 동기화

- **sync 커밋: `f153fe2458645aff9ac73701a411125505e33999`** (develop, 2026-11-02). 이 커밋에서 위 표의 코드와 모델이 같다는 것을 적합성·재현·읽기로 확인했다.
- sync 커밋은 **위 표의 코드를 새 커밋에서 다시 읽어 모델이 그 코드를 그대로 기술한다고 확인한 뒤에만** 앞으로 옮긴다(이 파일과 `scripts/run.sh` 의 `SYNC=` 두 곳). 스크립트가 exit 0 이라는 것만으로 옮기지 마라 — 적합성은 `pressGuard.ts` 만 기계로 보고, 페이지 배선(`MCFlags`)은 읽어서 맞춰야 한다.

## 결과 읽기 — 실제 버그인가, 모델 오류인가

1. **적합성 「다름」** → 앱 결함이 아니다. `pressGuard.ts` 가 모델과 달라졌다. 로그의 `Counterexample`(누름·창 열기 순서와 시각 간격)과 「사건 i 에서 갈림 — 실제 / 모델」이 어디서 갈렸는지 알려 준다. 의도한 변경이면 아래 「의도한 변경일 때」로, 아니면 그 diff 가 회귀다.
2. **TLC 결과가 기준선과 다름**(새로 깨짐) → `/statechart` 로 반례 경로를 읽고, **그 경로를 실제 코드에서 한 단계씩 재현한다** — `checks/repro.integration.check.tsx` 에 R 하나를 더해 `run.sh` 로 돌린다(`Date.now` 를 손으로 움직이고, 응답은 MSW 핸들러의 문으로 잡는 패턴). 재현되면 결함으로 보고하고, 안 되면 모델 오류를 먼저 의심한다(모델이 한 덩어리로 본 단계가 코드에선 둘인가, `MCFlags` 가 코드와 다른가, 가정 A1~A4 가 틀렸나).
3. **기준선 「깨짐」이 「성립」으로** 바뀜 → 결함이 고쳐졌을 수 있다. 그 재현 R 도 실패(「어긋남」)해야 정합이다. 둘 다 확인되면 기준선(이 파일 표 + `run.sh` `BASELINE`)을 바꾸고, 그 재현 R 은 "고쳐진 동작"을 단언하도록 뒤집는다.
4. **반례 재현 「어긋남」, 적합성 「같음」** → 결함이 고쳐졌거나 화면 testID(`sheet-cta-button-0`·`itinerary-confirm-error`·`onboarding-location-allow`)·문구가 바뀌었다. 재현 로그의 ✕ 를 보고 가른다.

## 의도한 변경일 때 모델 고치기

1. `pressGuard.ts` 판정이 바뀌면 `model/TapGuard.tla` CODE MIRROR `GuardAllows` 와 `checks/conformance.check.ts` `modelGuardAllows` 를 함께 고친다.
2. 페이지 배선이 바뀌면 `model/MCTapGuard.tla` `MCFlags` 의 그 경로 레코드를 고친다(옆 주석의 파일·식 이름 유지). 플래그로 못 적는 새 모양이면 `TapGuard.tla` 액션을 고친다 — **코드에서 한 덩어리가 아닌 것을 한 액션으로 합치지 마라**: `await`/응답 사이에 사용자가 다시 누를 수 있으면 두 액션이다.
3. 먼저 모델 사본에서 시험하려면 `cp -R model <사본>` 뒤 `run.sh --model <사본>`.
4. `run.sh` 가 기준선과 같거나, 다르면 위 「결과 읽기」로 판정한다. 속성(INVARIANT)을 약하게 바꿔 맞추지 마라.
5. 코드를 다시 읽어 대조한 뒤 sync 커밋을 옮긴다.

## 범위·가정 (통과가 뜻하는 것)

- **경계**: 버튼 하나 + 바뀐 화면의 버튼 하나, 시간 0~1초(100ms 틱 10개), 요청 ≤ 3건. 경로마다 상태 161~4,262개 전수.
- **가정**: A1 이동(`router.push/replace`)은 그 틱에 누른 화면을 치운다(전환 애니메이션 동안 옛 화면이 눌리는 것은 모델 밖) · A2 바뀐 화면의 버튼은 guardPress 로 감싸져 있다 · A3 확정은 이미 확정이면 409, 삭제(404=done)·권한 재조회는 다시 받아들인다 · A4 응답 지연은 0틱 이상 아무 값, 네트워크 실패는 어느 요청에나. TanStack `mutate(vars, {onSuccess, onError})` 의 호출별 콜백은 마지막 호출에만 돈다(`latestOnly` — 재현 R1 의 「토스트 없음」으로 실측).
- **덮지 않는 것**: guardPress 를 쓰는 나머지 17파일의 배선(모양만 위 다섯으로 분류, 개별 대조 안 함) · 가드 없는 버튼 전반(T7 lint 가 인라인 router 이동만 막는다) · 화면 전환 애니메이션 시간 · 백 버튼·스와이프 뒤로 · 같은 버튼을 두 손가락으로 동시에 · 여행 중 허브 [도착]·[방문 완료](`arriveBusy`·`completeBusy` — `verify-visit-flow` 몫) · 서버 쪽 멱등성 자체(백엔드 몫).

## 모델 파일

- `model/TapGuard.tla` — 명세(변수·CODE MIRROR `GuardAllows`·ASSUMPTION·액션·속성). `model/MCTapGuard.tla` — 경로별 배선 `MCFlags`(CODE MIRROR, 읽어서 대조). `model/MCTapGuard.cfg` — 상수(`run.sh` 가 `Path` 줄만 갈아 끼운다). `model/view.mjs` — `/statechart` 용 한국어 라벨.
- `checks/conformance.check.ts` — 적합성(jest node 버킷). `checks/repro.integration.check.tsx` — 반례 재현 R1~R3(jest integration 버킷, MSW 가짜 서버). 셋 다 "지금 일어난다"를 단언한다.

## 증명 기록

sync 커밋에서 ① `pressGuard.ts` 의 `elapsed >= 0` 을 `elapsed > 0` 으로 깨자(같은 프레임 두 탭이 통과) → `!! 동기화` + 적합성 「다름」(반례: 같은 시각 탭 A 두 번 → 실제 AA / 모델 A). 모델 사본 `GuardAllows` 를 같게 맞추자 `nav`·`assign`·`delete` `NoPassThrough` 「깨짐」(4~9 상태). ② `TripNewStep2Page.tsx` 의 `if (assignLockRef.current) return;` 을 지우자 → `!! 동기화`(그 파일). 모델 사본 `assign.lock = FALSE` 로 맞추자 `assign` `OnceOnly`·`NoFalseFailure` 「깨짐」. 둘 다 `cp` 사본으로 원복 → 기준선 그대로(exit 0).

*유지 판정: maintain-formal-verification-skill 결과로 판정한다 — 3회 연속 `in sync` 이고 그 사이 이 영역 결함 0 이면 실행 주기를 늘린다. 6개월 동안 결함을 1건도 못 내면 이 스킬을 뗀다(첫 실행에서 결함 2건 — FV-TAP-01 일정 확정·FV-TAP-02 위치 허용, 둘 다 실제 페이지에서 재현).*
