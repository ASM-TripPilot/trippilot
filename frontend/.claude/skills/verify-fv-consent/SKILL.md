---
name: verify-fv-consent
description: "설정의 동의 토글(위치 l06 · 개인화)과 법적 동의 기록(append-only), 진입마다 보내는 위치 권한 미러를 같은 계정 앱·웹 두 기기 기준으로 TLA+ 모델 체크 + 실제 코드 적합성 검사 + 실제 화면 반례 재현으로 검증한다. useLocationConsent·consentPutBody·LocationConsentPage/Screen·usePersonalization·PersonalizationScreen·settingsSections·SettingsPage·patchConsent 를 바꿀 때, '동의 토글 꼬일 수 있어?', '연타하면 동의 기록 두 번?', '웹이 위치 권한 덮어써?', 'verify-fv-consent' 요청 시 사용하라."
---

# verify-fv-consent — 동의 토글·법적 동의 기록 형식 검증

테스트는 누가 떠올린 순서만 본다. 이 스킬은 **같은 계정의 앱·웹이 위치·개인화 토글을 누르고(요청 ≤ 2), 서버가 저장하고, 응답이 끊기고, 다시 받기가 실패하고, 화면을 나갔다 들어오고, 진입마다 위치 권한을 보고하는 모든 순서**를 TLC 로 다 돌리고(476,372 상태), 그 모델이 실제 코드와 같은 판정을 하는지 fast-check 로 실제 훅에 대조하고, 깨진 규칙마다 실제 화면(MSW 가짜 서버)에서 반례를 재현한다.

## 지키는 약속

| 속성(모델 이름) | 사용자 말 | 피해 | 근거 |
|---|---|---|---|
| P1 `ShownMatchesServerLoc` · `ShownMatchesServerPers` | 요청이 다 끝난 뒤, 마지막으로 동의를 바꾼 기기의 화면(위치는 l06 토글과 l05 목록 칩)은 서버 동의 상태와 같은 값을 보인다 | 동의가 서버엔 켜졌는데 화면은 꺼짐 — 사용자는 동의 안 했다고 믿고, 위치정보가 쓰인다(위치정보법상 동의 상태 고지와 실제가 다르다) | BR-U6-29(토글 하나 → L2·L3 동시) · BR-U0-12(현재 상태 = 최신 증적 fold) · INV-4(침묵 실패 금지) |
| P2 `NoDuplicateRecordLoc` · `NoDuplicateRecordPers` | 같은 동의 동작(승낙·철회)을 법적 증적에 연달아 두 번 쌓지 않는다 | 증적은 append-only(앱 역할에 DELETE 없음)라 되돌릴 수 없다 — 감사 시 "한 번 누름에 두 번 동의"가 남는다 | BR-U0-12(append-only 증적) · BR-U0-13(앱 역할 UPDATE/DELETE 불가) · TRIP-1194 주석(같은 PUT 2회는 중복 행) |
| P3 `MirrorFollowsApp` | 요청이 다 끝난 뒤, 서버의 OS 위치 권한 미러는 위치를 실제로 쓰는 앱 기기의 권한과 같다(앱이 한 번이라도 보고한 뒤) | 웹에서 위치 화면만 열어도 미러가 NOT_DETERMINED 로 바뀌어 서버 유효 능력(`serverLocationService` = L1∧L2)이 꺼진다 — 지금은 이 능력을 읽는 코드가 없어 잠재 결함 | BR-U6-31(OS 권한 미러로 토글 비활성) · G182 `LocationConsent.capabilities` · 2026-10-31 웹 QA 관측(TRIP-1689 결정: 범위 포함) |

## 결과 기준선 (sync 커밋에서 측정)

| 검사 | 기준선 | 뜻 |
|---|---|---|
| 적합성(코드==모델) | 같음 | 모델 CODE MIRROR 식(표시·누름 값·잠금·미러 보고·l05 칩)이 실제 코드와 생성 입력 100건+ 에서 같다 |
| 반례 재현 R1~R6 | 기대대로 | R1~R5 는 처음 결함 FV-CONSENT-01~04 를 재현했고 TRIP-1689 수정 뒤 "고쳐졌다"를 단언한다. R5b·R6 은 지켜지는 짝 |
| `TypeOK` · 교착 없음 | 성립 | |
| `NoDuplicateRecordLoc` | 성립 | **서버가 지킨다**(값이 바뀔 때만 기록, 가정 S1). 클라 잠금을 모델에서 빼도 성립, 서버 S1 을 빼면 깨짐 — 클라 잠금은 보조다 |
| `ShownMatchesServerLoc` | 성립 | FV-CONSENT-03 고쳐짐 — 무효화를 `onSettled` 로 옮겨 실패해도 서버 값을 다시 받고, 다시 받기 실패면 l06 오류 얼굴 + l05 칩 숨김(R3·R4) |
| `MirrorFollowsApp` | 성립 | FV-CONSENT-04 고쳐짐 — 웹(`Platform.OS === 'web'`)은 진입 미러 보고를 하지 않는다(R5) |
| `NoDuplicateRecordPers` | 깨짐 | **남은 길은 서버 몫(⏳ BE PR 대기)**. FV-CONSENT-01 의 연타는 고쳐졌다(R1 — 개인화 `inFlightRef`). 그래도 깨지는 가장 짧은 길은 **앱·웹이 동시에 승낙**(클라 잠금은 기기 하나만 막는다)이고, 한 기기에서도 다시 받기 실패 뒤 옛 값을 보고 다시 누르면 쌓인다. 서버 `changeConsent` 가 매번 증적을 쌓기 때문이다(가정 S2) |
| `ShownMatchesServerPers` | 깨짐 | FV-CONSENT-02 의 응답 유실은 고쳐졌다(R2 — 성공·실패 모두 `finally` 재조회 + 실패 안내). 남은 길은 **다시 받기 실패** 하나 — 개인화 화면엔 조회 오류 얼굴이 없어 캐시의 옛 값을 토글로 보인다(위치 l06 은 오류 얼굴로 값을 주장하지 않는다). 고치려면 개인화 화면에 오류 얼굴이 필요하다(설계 결정 — TRIP-1689 끝 보고) |

**남은 깨짐을 가른 모델 사본 측정(TRIP-1689 수정 뒤, 측정함(모델))**:

| 사본 | `NoDuplicateRecordPers` | `ShownMatchesServerPers` | 뜻 |
|---|---|---|---|
| 서버 S2 → S1 규칙(`logs == (v # srv[k])`) | **성립** (453,622) | 깨짐 | BE 가 "같은 동작이면 무기록"으로 고치면 증적 중복은 모두 막힌다 |
| 기기 하나(`Devs = {"app"}`), 장애 전부 | 깨짐 | 깨짐 | 한 기기에서도 다시 받기 실패 뒤 재누름은 쌓인다 |
| 기기 하나 + 다시 받기 실패 없음 | **성립** | **성립** | 연타·응답 유실만으로는 더 이상 안 깨진다(FV-CONSENT-01·02 고쳐짐) |
| 두 기기 + 다시 받기 실패 없음 | 깨짐 | **성립** | 화면 불일치는 다시 받기 실패 때만, 증적 중복은 두 기기 동시 누름으로 남는다 |

**BE PR 이 머지되면**: `ConsentFlow.tla` `ServerApply` 의 `logs` 를 `(v # srv[k])` 로 바꾸고(S2 주석의 ⏳ 지움), 재현 가짜 서버 S2(`/me/consents/:termsType`)도 값이 바뀔 때만 쌓게 고친 뒤, 기준선 `NoDuplicateRecordPers` 를 **성립**으로 바꾼다. `ShownMatchesServerPers` 는 서버와 무관하게 깨짐으로 남는다(개인화 오류 얼굴이 생길 때까지).

깨짐은 **보고된 결함**이다. 모델이나 속성을 약하게 고쳐 통과시키지 마라. 제품 코드는 사용자가 요청할 때만 고친다.

## 실행 — 명령 하나

```sh
frontend/.claude/skills/verify-fv-consent/scripts/run.sh [--frontend <node_modules 있는 frontend>] [--model <모델 폴더 사본>] [--skip-jest|--skip-tlc]
```

- 기본 `--frontend` 는 이 스킬이 든 frontend. `pnpm install` 안 된 워크트리면 된 워크트리를 넘긴다.
- 약 80초(TLC 성립 두 줄이 각 30초). 처음엔 mise 로 Temurin 25 · TLC 1.7.4 를 받는다(네트워크, `brew install mise`). `TLA2TOOLS`·`JAVA` 로 바꿔 쓸 수 있다.
- 기준선과 모두 같으면 exit 0. 끝 표의 「결과」와 「기준선」 칸을 본다.
- 검사 파일은 `checks/*.check.tsx` 다 — 리포 jest·tsc·eslint 는 `.claude/` 를 빼므로 앱 게이트에 안 섞인다. 스크립트가 리포 밖 임시 폴더에 `.test.tsx` 로 복사해 `--roots` 로 돌리고 지운다(`FV_CONSENT_KEEP=1` 이면 남긴다).
- 반례 경로와 상태도는 **`/statechart` 스킬**로 `model/MCConsentFlow.tla`(config `model/MCConsentFlow.cfg`, view `model/view.mjs`)를 돌려 읽는다. 깨진 규칙마다 가장 짧은 경로가 한국어 단계로 나온다.

## 이 변경이 덮는 코드에 닿는가

아래 파일을 바꿨으면 이 스킬을 돌린다. 스크립트가 sync 커밋 대비 바뀐 파일을 `!! 동기화` 로 먼저 알린다.

| 파일 (frontend/ 기준) | 함수·식 | 모델 대응 |
|---|---|---|
| `src/shared/location/useLocationConsent.ts` | `status`·`consentOn` 도출 · `save`(`inFlightRef`·`put.isPending`) · `onSettled` 무효화(성공·실패 모두) 뒤 잠금 해제 · 진입 미러 보고(`mirroredRef`·`toOsPermission`·웹 제외) | `ShownLoc` · `CanTap` · `Intent` · `Reported` · `Reports` (적합성) · `Release`·`SendFail`·`ServerApply`·`RefetchOk`·`Enter`·`MirrorOk` (재현 R3·R4·R5·R6) |
| `src/shared/location/consentPutBody.ts` | L2·L3 같은 값 | `ServerApply` 의 한 값 `v` (적합성: PUT 바디) |
| `src/pages/settings/settings-location/ui/LocationConsentPage.tsx` · `LocationConsentScreen.tsx` | 로딩·오류 얼굴, 토글 off→`onGrant`, on→다이얼로그→`onRevokeConfirmed`, `saveFailed` | `ShownLoc = "hidden"` · `Intent` (재현) |
| `src/pages/settings/settings-personalization/model/usePersonalization.ts` · `ui/PersonalizationPage.tsx` · `ui/PersonalizationScreen.tsx` | `consentOn` 도출(isError 무시 — 오류 얼굴 없음) · `onToggle`(`inFlightRef` 잠금 · `try/catch` → `saveFailed` · `finally` 무효화 뒤 해제) · `saveFailed` 안내 | `ShownPers` · `CanTap` · `Intent` (적합성) · `Release`·`SendFail`·`ServerApply` · R1·R2 |
| `src/pages/settings/settings/model/settingsSections.ts` · `ui/SettingsPage.tsx` | `consentChip(locationConsent.isError ? undefined : …gpsRecordingOptIn)` · 같은 쿼리 구독(가정 C1) | `ChipLoc` (적합성은 값→칩만, isError→숨김은 R4 가 실제 SettingsPage 로) |
| `src/shared/api/index.ts` | `patchConsent`·`fetchTerms` | 개인화 요청(읽어서 대조) |
| `backend/modules/auth/.../application/LocationConsentService.kt` · `ConsentService.kt` · `domain/location/LocationConsent.kt` | 서버 규칙 — 가정 S1~S4 | 가정. 바뀌면 `ConsentFlow.tla` ASSUMPTION 주석·`ServerApply` 의 `logs` 식과 재현의 가짜 서버를 함께 고친다 |

## 동기화

- **sync 커밋: `f153fe2458645aff9ac73701a411125505e33999`** (develop, 2026-11-02). 이 커밋에서 위 표의 코드와 모델이 같다는 것을 적합성·재현·읽기로 확인했다.
- sync 커밋은 **위 표의 코드를 새 커밋에서 다시 읽어 모델이 그 코드를 그대로 기술한다고 확인한 뒤에만** 앞으로 옮긴다(이 파일과 `scripts/run.sh` 의 `SYNC=` 두 곳). 스크립트가 exit 0 이라는 것만으로 옮기지 마라 — 적합성은 CODE MIRROR 구역만 기계로 보고, 요청·무효화·잠금 해제 시점은 읽어서 맞춰야 한다.

## 결과 읽기 — 실제 버그인가, 모델 오류인가

1. **적합성 「다름」** → 앱 결함이 아니다. 코드가 모델과 달라졌다. 로그의 `Counterexample`(조회 상태·연타 수·단말 권한)과 Expected/Received 가 어느 식이 갈렸는지 알려 준다. 의도한 변경이면 아래 「의도한 변경일 때」로, 아니면 그 diff 가 회귀다.
2. **TLC 결과가 기준선과 다름**(새로 깨짐) → `/statechart` 로 반례 경로를 읽고, **그 경로를 실제 코드에서 한 단계씩 재현한다** — `checks/repro.integration.check.tsx` 에 R 하나를 더해 `run.sh` 로 돌린다(가짜 서버·응답 유실 `HttpResponse.error()` 패턴을 그대로 쓴다). 재현되면 결함으로 보고하고, 안 되면 모델 오류를 먼저 의심한다(모델이 한 덩어리로 본 단계가 코드에선 둘인가, 가정이 서버와 다른가). 실례: 첫 모델이 "l06 을 떠나면 다시 받기 없음"으로 적어 거짓 반례를 냈다 — l05 가 스택 아래에서 같은 쿼리를 구독해 늘 다시 받는다(가정 C1).
3. **기준선 「깨짐」이 「성립」으로** 바뀜 → 결함이 고쳐졌을 수 있다(예: BE PR 머지 뒤 `NoDuplicateRecordPers`). 재현 R 을 "고쳐진 동작"으로 뒤집어 실제 코드에서 확인한 뒤 기준선(이 파일 표 + `run.sh` `BASELINE`)을 바꾼다.
4. **반례 재현 「어긋남」, 적합성 「같음」** → 화면 문구·testID 가 바뀌었거나, 고친 동작(R1~R5)이 되돌아갔거나, R5b·R6 이 깨졌다. 재현 로그의 ✕ 를 보고 가른다. l05 칩의 isError 숨김(SettingsPage)은 적합성이 못 보고 R4 만 본다.

## 의도한 변경일 때 모델 고치기

1. `model/ConsentFlow.tla` 의 CODE MIRROR 구역 식을 새 코드에 맞춘다(옆 주석의 파일·식 이름 유지). 같은 식을 `checks/conformance.check.tsx` 의 `model*` 함수에도 옮긴다.
2. 요청·잠금·무효화가 바뀌었으면 해당 액션(`Tap`·`ServerApply`·`SendFail`·`RefetchOk`·`RefetchFail`·`Enter`·`Leave`·`Load`·`Mirror*`)을 고친다. **코드에서 한 덩어리가 아닌 것을 한 액션으로 합치지 마라** — 기준: `await` 사이에 사용자가 다른 버튼을 누를 수 있으면 두 액션이다. 잠금 해제 시점은 TanStack 이 `onSuccess`(무효화 재조회)를 `await` 한 뒤 `onSettled` 를 부른다는 데 기댄다(`@tanstack/query-core` `mutation.js`) — 라이브러리를 올리면 다시 확인한다.
3. 먼저 모델 사본에서 시험하려면 `cp -R model <사본>` 뒤 `run.sh --model <사본>`.
4. `run.sh` 가 기준선과 같거나, 다르면 위 「결과 읽기」로 판정한다. 속성(INVARIANT)을 약하게 바꿔 맞추지 마라.
5. 코드를 다시 읽어 대조한 뒤 sync 커밋을 옮긴다.

## 범위·가정 (통과가 뜻하는 것)

- **경계**: 기기 2(앱·웹), 동의 2(위치 = L2·L3 한 토글, 개인화), 동의 변경 요청 모델 전체 ≤ 2(`MaxReq`). 상태 476,372 전수(수정 전 1,342,716 — 개인화 잠금이 상태를 줄였다). 수정 전 모델은 요청 3 으로 늘려도 결과가 같았다(31,880,264 상태, TLC 7분 40초 — 측정함).
- **가정(서버, 백엔드 코드에서 읽음)**: S1 위치 PUT 은 값이 바뀔 때만 증적 · S2 개인화 PATCH 는 매번 증적(⏳ BE PR 대기 — 바뀌면 위 「BE PR 이 머지되면」) · S3 미러 PATCH 는 L1 만 덮고 증적 없음 · S4 요청 하나는 한 덩어리 — 위치 `update` 의 `find` 에 잠금이 없어 같은 계정 PUT 두 개가 동시에 처리되면 둘 다 기록할 수 있으나 모델 밖(백엔드 Kotest 몫). 네트워크: 서버 닿기 전 실패 · 저장 뒤 응답 유실 · 다시 받기 실패.
- **가정(클라이언트)**: C1 l05 설정 목록이 스택 아래에 있어 두 동의 쿼리가 늘 활성 · C2 개인화 화면은 늘 떠 있다(이탈 미모델) · C3 위치 토글 disabled(미러 DENIED ∧ 단말 미허용)는 모델 밖 · W1 웹의 expo-location 은 NOT_DETERMINED(웹 QA 관측 — jest 는 네이티브 목이라 웹 값을 못 낸다, R5 는 같은 값을 주입해 재현). 조회(Load)는 그 기기·그 종류 요청이 없을 때만.
- **덮지 않는 것**: 마케팅 동의 — **클라이언트에 토글이 없다**(서버 `ConsentService.toggleMarketing` 만 있음, `src` 에 MARKETING 토글 0건). 온보딩·재동의 동의(`useTermsConsent`·`ReconsentPage`), 알림 토글(법적 증적 아님), 위치 자동 기록 켜기(`useAutomationStatus`), 철회 시 파기 이벤트·파기 로그, 다른 기기 화면이 낡은 채 남는 것(포커스 재조회 — 앱은 focusManager 미배선), 서버 동시성(S4).

## 모델 파일

- `model/ConsentFlow.tla` — 명세(변수·CODE MIRROR·ASSUMPTION·액션·속성). `model/MCConsentFlow.tla`·`.cfg` — 상수(기기별 권한 함수는 cfg 에 못 적어 MC 모듈에 둔다). `model/view.mjs` — `/statechart` 용 한국어 라벨.
- `checks/conformance.check.tsx` — 적합성(jest node 버킷, 생성 훅·손수 API 자리만 목, `Platform.OS` 는 `jest.replaceProperty`). `checks/repro.integration.check.tsx` — 반례 재현 R1~R6(jest integration 버킷, MSW 가짜 서버, 실제 axios·생성 클라이언트). R4 는 실제 `SettingsPage` 위에 `LocationConsentPage` 를 같은 QueryClient 로 겹쳐 그린다(가정 C1 그대로). 수정 전 R2 는 실제 `patchConsent` 를 감싸 새는 거부를 셌다 — 잡히지 않은 거부는 jest 가 테스트 실패로 올리고 샌드박스 `process` 리스너로는 못 받는다(실측).

## 증명 기록

sync 커밋에서 (1) `useLocationConsent.save` 의 `if (inFlightRef.current || put.isPending) return;` 을 지우자 → `!! 동기화` + 적합성 「다름」(반례 `["on",false,"GRANTED","granted",2]`: 기대 PUT 1 / 실제 2) + R6 ✕. 모델 사본에서 같은 잠금을 빼자 `NoDuplicateRecordLoc` 는 성립(서버 S1 이 막음), 서버 S1(`logs == TRUE`)까지 빼자 깨짐. (2) `usePersonalization.onToggle` 에 잠금을 넣자(결함을 고치는 방향) → 적합성 「다름」 + R1·R2 ✕. 둘 다 `cp` 사본으로 원복 → 기준선 그대로.

TRIP-1689 수정 뒤(sync 아래 「동기화」) 고친 코드를 하나씩 되돌리자: (3) 개인화 `if (inFlightRef.current) return;` 삭제 → 적합성 「다름」 + R1 ✕. (4) 웹 가드 `if (Platform.OS === 'web') return;` 삭제 → 적합성 「다름」 + R5 ✕. (5) SettingsPage 칩의 `isError` 무시 → 적합성 「같음」(값→칩만 본다) + R4 ✕. 모두 `cp` 사본으로 원복.

*유지 판정: maintain-formal-verification-skill 결과로 판정한다 — 3회 연속 `in sync` 이고 그 사이 이 영역 결함 0 이면 실행 주기를 늘린다. 6개월 동안 결함을 1건도 못 내면 이 스킬을 뗀다(첫 실행 결함 4 — FV-CONSENT-01~04, 재현 4/4, TRIP-1689 에서 앱 쪽 수정).*
