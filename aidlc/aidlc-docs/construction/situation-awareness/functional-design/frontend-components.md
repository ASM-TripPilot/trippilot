# 변수 상황 자가 인지(situation-awareness) — Frontend Components

> **아키텍처 정본 = `frontend/README.md`, 배치의 사실 정본 = `frontend/docs/structure.md`(+ 리포).** 층 규약을 옮겨 적지 않는다. 이 문서가 정하는 것은 **어느 슬라이스에 무엇이 들어가고, 무엇을 서버에서 받고, 무엇을 판정하지 않는가**다. 구현 절차는 FE 하네스(`frontend/CLAUDE.md` 개발 사이클 · `verify-gates`)를 따른다.
> **화면 정본 = 라이브 Figma.** SA 가 처음 정하는 표면은 프레임이 없다(G-SA-12) — 아래 서술은 작도용 스펙이지 픽셀 정본이 아니다.
> **화면 번호는 코드 번호다**(프리뷰 라벨 `frontend/app/_dev/preview.tsx`): i01 허브 · i02 알약 · i03 위험 시트 · i04 요청 · i05 계산 중 · i06 초안 · i08 반영 시트. 옛 U4 FD 표기와의 대응: i08 트리거 칩 = i02 · i09 감지된 변화 = i03 · i10 재계획 요청 = i04 — 새 체계의 i10 은 현재 장소 상세다.
> 기준선 `origin/develop` `f52f58cf7`(2026-10-19). 서버 쪽 값·불변식은 `domain-entities.md`(같은 폴더)다.

---

## 0. 원칙

| 원칙 | 내용 |
|---|---|
| **판정·임계를 모른다** | 무엇이 위험인지, 언제 풀리는지, 무엇을 먼저 보일지는 서버가 정한다(BR-U4-03). 앱은 받은 순서(BR-SA-13 정렬)대로 그리고 변형 라벨·날짜 표기만 붙인다 |
| **FE 플래그 없음** | OTA 가 없어 켜고 끄는 단위는 서버 스위치다(DEC-SA-8). 새 필드가 없는 응답이면 화면은 기존 동작 그대로 — 옛 서버·되돌린 서버에 무해 |
| **새 로직은 새 파일** | 핫스팟(`LiveItineraryPage`·`LiveHubView`·`planb-draft`)에는 호출·전달 몇 줄만 더한다(§8) |
| **시각·소요시간·좌표 없음** | 알약의 '시'는 계획 `startAt` 을 자를 뿐 산술이 없다(DEC-U4-9 · INV-2·3). 소요·지연 분 숫자, 좌표를 그리지 않는다 |
| **판정은 순수 함수** | 진입 판정(`entryRoute`)·라벨·날짜 표기는 순수 함수로 두고 fast-check 로 잠근다(PBT-SA-21·22) |
| **알림 경로는 위험·주의만** | 기회는 앱 안 카드로만 — 푸시·알림함에 오지 않는다(DEC-SA-5·6) |
| **일정은 [적용]으로만** | 어느 진입이든 끝은 i06 의 사용자 [적용]이다(INV-SA-1). 트리거 경로에 원탭 즉시 적용을 쓰지 않는다 |

---

## 1. 묶음

| 묶음 | 내용 | 선행 | 닿는 조건 |
|---|---|---|---|
| **FE-A** | 푸시 수신·탭 라우팅 | 없음(계약 무관) | 앱 새 빌드 |
| **FE-B** | 진입 게이트 · 변형 라벨·날짜·출처 · 감시 3상태 · i06 낡음·미포함 안내 · i04 시드 | 트리거 상세·감시·변형·준비된 대안 계약 + `pnpm codegen` | 앱 새 빌드 |
| **FE-C** | 기회 카드 | 기회 조회 계약 + `pnpm codegen` | 앱 새 빌드 |
| **FE-D** | iOS 푸시 entitlement | ASC 번들 ID Push 권한 · EAS APNs 키(외부) | iOS 재빌드·심사 |

- FE-A·FE-D 는 푸시가 기기에 닿는 경로(G-SA-7)의 앱 쪽 두 조각이다 — 나머지는 운영 실발송 1회 왕복 확인이다(§12 #5).
- 운영 켜기는 FE-A·B 가 스토어에 퍼지고 `minSupportedVersion` 을 올린 뒤다(O-SA-7 · DEC-SA-8). 이 묶음 이전 빌드의 동작은 §7.

---

## 2. FE-A — 푸시 수신·탭 라우팅

### 2.1 `src/shared/push/receive.ts` (신규)

| 함수 | 책임 |
|---|---|
| `installForegroundPresentation()` | 앱이 켜져 있어도 배너·알림 목록에 보이게 한다. 앱 진입 모듈(`src/app/entrypoint/AppProviders.tsx` 최상위 — `initSentry()` 옆)에서 1회 |
| `onPushReceived(listener)` | 포그라운드 수신 구독 — 해제 함수를 돌려준다 |
| `onPushTapped(listener)` | 탭 응답 구독 — 해제 함수를 돌려준다 |
| `takeLaunchPushTap()` | 콜드 스타트 탭을 꺼낸 뒤 지운다(같은 탭을 두 번 처리하지 않게). 실패는 null |

- `shared/push/index.ts` 배럴로만 낸다 — `index.view.ts`(네트워크·네이티브 없는 진입점)에는 넣지 않는다. 소비처는 배럴로 import 한다(페이지 테스트의 목이 배럴 경로에 걸려 있다).
- 탭 data 는 서버가 `{actionType, ...actionPayload}` 를 펼쳐 싣는다(`PushDispatchService.kt:147-150`) — 알림함 행과 같은 재료다.

### 2.2 `src/app/model/usePushRouting.ts` (신규)

- 입력은 `SplashGate` 의 `drawn`·`destination`(`SplashGate.tsx:29,62`). **`drawn ∧ destination === 'HOME'` 일 때만** 이동한다.
- 목적지 = `notificationAction(data.actionType, data)` — 알림함과 **같은 함수**(`notification-inbox/model/notificationAction.ts:22-49`)라 탭과 행이 다른 곳으로 가지 않는다. `pages/settings/notification-inbox/index.ts` 에서 export 한다.
- 로그인 전·부팅 중 탭은 보류했다가 HOME 이 되면 1회 이동한다. 같은 알림 식별자는 1회. 모르는 `actionType`·필수 필드 없음(null) → 이동 없음.
- 수신·탭 때 알림함·트리거 캐시를 무효화한다(`getGetMeNotificationsQueryKey` · `getGetTripsTripIdTriggersQueryKey`).
- 배선: `SplashGate.tsx` 1줄(훅 호출) · `AppProviders.tsx` 1줄(표시 정책 설치).
- `features/apply-replan/model/useApplyReplan.ts` 의 onSuccess 에 트리거 캐시 무효화 1줄 — 적용 뒤 소비된 트리거가 알약에 남지 않게(BR-SA-14).
- 적용 범위는 **모든 푸시**(리마인드 포함)다 — 포그라운드 배너와 탭 라우팅을 함께 받는다.
- 안드로이드 채널 지정은 범위 밖이다 — 서버가 `channelId` 를 싣지 않는다(`ExpoPushAdapter.kt:78-79`).

### 2.3 테스트 인프라

`__mocks__/expo-notifications.ts` 에 수신·탭·마지막 응답 조회·마지막 응답 지우기·표시 정책 5함수를 더한다(기본: 아무것도 하지 않음 — 기존 테스트에 새 호출 0). SplashGate 계열 테스트는 `requireActual` 펼침·훅 목으로 정비한다. 실제 수신·탭·포그라운드 표시는 jest 가 못 본다 → §12.

---

## 3. FE-B — 트리거 진입·표시

### 3.1 라우트 분기

`frontend/app/trips/[tripId]/planb/index.tsx` 는 `triggerId` 가 있으면 `PlanbEntryGate`, 없으면 `PlanbRequestPage`(기존 그대로)를 그린다. 알림 탭 · 알림함 PLAN_B 행 · i03 [대안 보기]가 모두 `?triggerId=` 로 들어오므로 **한 게이트**를 지난다. 기존 i04 통합 테스트(`PlanbRequestPage.integration.test.tsx`)는 그대로 통과한다. 라우트는 `prefill`·`includePoiId` 파라미터를 더 읽어 내린다(FE-C).

### 3.2 `pages/live/planb-request/ui/PlanbEntryGate.tsx` · `model/entryRoute.ts` (신규)

- **조회**: 트리거 상세 `GET /trips/{tripId}/triggers/{triggerId}` 로 날짜를 얻고, 그 날짜의 준비된 대안 `GET /trips/{tripId}/replan-sessions/prepared?date=` 를 잇달아 부른다 — **둘 합쳐 최대 3초**. 대기 얼굴의 접근성 이름은 `확인하고 있어요`.
- **결정은 한 번만 굳힌다** — 재조회·포커스 복귀로 화면이 바뀌지 않는다.
- **`entryRoute`(순수) 판정표 = BR-SA-23** — 위에서부터 처음 맞는 행. `stale` 은 `APPLIED` 가 아니면 상태와 무관하게 '없음'으로 읽는다.

| # | 준비된 대안 | 트리거 | 이동 |
|---|---|---|---|
| 1 | — | 상세 404 | 404 얼굴(없는 알림 · 다른 계정 은닉) |
| 2 | 조회 실패 · 3초 초과 | — | i04 — 트리거 id 그대로(기존 동작). 날짜는 서버가 강제한다(BR-SA-20) |
| 3 | `APPLIED` | 무관 | 허브 + `이미 반영한 대안이에요` |
| 4 | 없음 · `CANCELED` · `stale` | ACTIVE, 또는 `currentTriggerId` 있음 | i04 — §3.3 시드 |
| 5 | 없음 · `CANCELED` · `stale` | ACTIVE 아님 ∧ `currentTriggerId` 없음 | 허브 + `지금은 해당하지 않는 알림이에요` |
| 6 | `DRAFT` | 무관 | i06 비교(`미리 준비한 대안` 표식) |
| 7 | `COLLECTING` · `SOLVING` | 무관 | i05 |
| 8 | `NO_SOLUTION` · `FAILED` | 무관 | i06 의 대안 없음·실패 얼굴(BR-U4-26 대칭 3옵션) |

- **이동 방식**: i05·i06 은 `router.replace`(게이트를 스택에 남기지 않는다). 허브 안내는 전역 토스트(`src/shared/ui/Toast.tsx:52` `showToast` — 호스트가 Stack 밖이라 replace 뒤에도 남는다, `AppProviders.tsx:66-67`)를 띄우고 허브로 간다. i04 는 같은 라우트 안에서 게이트가 `PlanbRequestPage` 를 시드 props 와 함께 그린다.
- i04 로 갈 때 싣는 triggerId 는 원 트리거가 ACTIVE 면 그 id, 아니면 `currentTriggerId` 다. 게이트가 날짜를 놓쳐도 서버가 트리거 날짜로 다시 짠다 — 다른 날을 바꾸는 길이 없다.

> **[개정 · 2026-10-20 — 구현 반영]** §3.2 — 계약 밖 세션 상태(앱보다 새 서버가 늘린 값)는 `CANCELED` 처럼 **'없음'** 으로 읽는다 — 행 4·5(i04 시드 또는 허브)로 간다. i06 은 모르는 상태에 그릴 얼굴이 없어 빈 화면이 되기 때문이다(INV-4). 준비된 대안으로 갈 수 있는 상태는 `DRAFT`·`COLLECTING`·`SOLVING`·`NO_SOLUTION`·`FAILED` 다(#1423 · `frontend/src/pages/live/planb-request/model/entryRoute.ts:71-78,137-146`).
> **열린 질문** — i05 에서 기다리는 SYSTEM 세션이 `stale`(수집·산출 2분 — `business-rules.md` BR-SA-19 개정 블록)이 되면 게이트로 되돌려 다시 판정할지. 지금 i05 는 `stale` 을 읽지 않고 8분 상한(TRIP-1363)까지 기다린다(`frontend/src/pages/live/planb-draft/ui/PlanbSolvingPage.tsx:67-68`). **정본 결정 대기**.

### 3.3 i04 시드 — `PlanbRequestPage` 선택 props

| prop | 뜻 | 주지 않으면 |
|---|---|---|
| `seedReasons` · `seedDirectives` · `seedExcludedPoiIds` | 처음 켜 둘 사유·지시·제외 POI. 게이트가 준비 세션 입력(있으면 — `CANCELED`·`stale` 세션 포함)으로, 없으면 kind 사유로 채운다. **주의(CAUTION)는 빈 시드** | URL `triggerId` 의 kind 사유를 한 번 켜는 기존 감지 트리거 시드 |
| `prefill` | 자유 입력 초기값 | 빈 칸 |
| `includePoiId` | 기회 카드에서 넣으려던 POI. **서버에 보내지 않고** i05 → i06 라우트 파라미터로 잇는다(§3.6) | 없음 |

- 시드 props 가 오면(빈 배열 포함) kind 자동 시드 대신 그것을 쓴다 — 흐림(주의)에 날씨 사유를 넣으면 AI 가 실내·이동 짧게를 얹어 일정을 과하게 바꾼다.
- 날짜·범위: `targetDate` = 트리거 `affectedDate`(오늘이면 싣지 않는다), 미래일이면 `FULL_DAY` 한 칩(기존 `targetDate` 처리 그대로), 오늘이면 트리거 `scope`.
- `features/request-replan/model/replanRequest.ts` 에 `excludedPoiIds?` — 지정하지 않으면 요청 본문은 기존과 바이트까지 같다(`excludedPoiIds: []`).

> **[개정 · 2026-10-20 — 구현 반영]** §3.3 — 시드의 날씨 사유는 **정적 날씨 칩으로 남긴다.** 준비 세션 입력은 같은 날 위험의 합집합이라(BR-SA-18 ④) 휴무 알림으로 들어와도 시드가 `[WEATHER, TEMP_CLOSED]` 일 수 있다. 감지 칩(휴무)이 서면 정적 날씨 칩을 숨기고 제출에서 거르는 기존 동작대로면 처음 켜 둔 날씨 사유가 화면에도 요청 본문에도 없어진다 — 시드에 `WEATHER` 가 있으면 정적 날씨 칩을 보이고 제출 필터도 통과시킨다. 사용자가 그 칩을 끄면 빠진다. 시드 없는 진입은 종전 그대로다(#1423 · `frontend/src/pages/live/planb-request/ui/PlanbRequestPage.tsx:139-142,228-234` · `ReplanRequestSheet.tsx:191-198`).
> **열린 질문** — '주의(CAUTION)는 빈 시드'의 기준을 원 트리거(URL `triggerId` 의 상세)로 볼지 지금 트리거(`currentTriggerId`)로 볼지. 지금은 원 트리거의 `severity` 로 정하고, i04 에 싣는 id 는 원 트리거가 ACTIVE 가 아니면 `currentTriggerId` 다(`frontend/src/pages/live/planb-request/model/entryRoute.ts:85,103-106`) — 해제 뒤 다른 심각도로 다시 선 경우 둘이 갈린다. **정본 결정 대기**.

### 3.4 변형 라벨 · 날짜 표기 · 출처

`features/planb/model/triggerLabel.ts` 에 `VARIANT_LABELS: Record<TriggerVariant, string>`(타입이 12종 전수를 강제)과 `triggerLabel(kind, variant?)`. 모르는 값·null → kind 라벨(`TRIGGER_LABELS` 그대로).

| variant | 라벨 | variant | 라벨 |
|---|---|---|---|
| `RAIN` | 비 예보 | `CLOSED_DAY` | 휴무 |
| `SNOW` | 눈 예보 | `OUT_OF_HOURS` | 영업시간 밖 |
| `WIND` | 강풍 | `HOURS_MISMATCH` | 영업시간 확인 |
| `HEAT` | 폭염 | `HOLIDAY` | 공휴일 휴무 |
| `COLD` | 한파 | `PERMANENTLY_CLOSED` | 폐업 |
| `CLOUD` | 흐림 | | |
| `DUST` | 미세먼지 | | |

- **`triggerDayLabel(affectedDate, today)`**: 같은 날 null · 다음 날 `내일` · 그 밖 `M월 D일`. 상대 날짜어는 **표시 시점에만** 만든다 — 서버 문구에는 없다(BR-SA-12).
- **알약(i02)** `triggerPillCopy(kind, slot, {variant, dayLabel})` = `{dayLabel }{라벨}{ · 장소}{ 시}`(예 `내일 휴무 · 국립중앙박물관`). 날씨는 날짜 단위 신호라 슬롯이 없다 — 라벨만 보이고 영향 장소는 사유 문장이 말한다. '시'는 슬롯이 있는 날씨 행에 붙던 기존 템플릿 그대로이고 계획 `startAt` 을 자를 뿐이다. CLOSURE 는 그 장소 자체의 영업이라 `주변 시설` 꼬리를 떼고, DELAY 꼬리(`방면`)는 U10 소관이라 그대로 둔다.
- 알약 장소는 트리거 **자기 날짜**의 슬롯에서 찾는다(`parseSlotKey` 의 날짜) — 허브가 다른 날을 보고 있어도 맞는 장소가 나온다. 영향 배지(`slotBadgeLabel`)도 `triggerLabel(kind, variant)` 를 쓴다.
- **위험 시트(i03)** `RiskDetailSheet` props + `severity` · `dayLabel` · `attribution`: eyebrow `위험 요소 · {카테고리}`(RISK) / `주의 · {카테고리}`(CAUTION) + dayLabel, 제목 아래 `출처: {attribution}`(공공누리 1·3유형 표시 — BR-SA-24). `attribution` 이 없으면 그 줄이 없다.

### 3.5 감시 행 3상태 — `pages/live/live-itinerary/model/triggerWatchlist.ts` 가 `watch` 를 읽는다

위에서부터 처음 맞는 행을 쓴다 — **그 kind 의 ACTIVE 가 있으면 감시 상태보다 앞선다.**

| 응답 `watch`(그 묶음) | 그 kind 의 ACTIVE | 행 |
|---|---|---|
| 무관 | 있음 | `활성` + 사유 |
| 필드 없음(옛 서버) | 없음 | 기존 동작(정상) |
| `OFF` | 없음 | **숨김** |
| `UNKNOWN` | 없음 | `확인 불가` |
| `CHECKED` | 없음 | `정상` |

- `delay` 는 늘 `OFF` 라 발화한 DELAY 가 없으면 이동 행은 숨는다. U10 이 DELAY 를 발화하면 `OFF` 여도 `활성` 행으로 보인다(발화한 사실을 감시 상태가 가리지 않는다).
- 상태 문구는 `features/planb/config/watchLabels.ts` 에 `확인 불가` 를 더한다. 거짓 '정상'을 그리지 않는 것이 이 표의 목적이다(INV-SA-2 · G-SA-1).

### 3.6 i06 최소 변경 — `pages/live/planb-draft`(새 model 파일 + 배선)

| 상황 | 화면 |
|---|---|
| 세션 `initiatedBy = SYSTEM` | 머리에 `미리 준비한 대안` 표식 |
| apply 409 `EXPIRED`·`STALE` | `시간이 지나 이 대안은 지금 일정과 맞지 않아요` + [새 대안 보기] — 같은 입력(사유·지시·제외·범위·날짜·트리거)으로 새 세션을 열어 i05 로 replace(INV-SA-7) |
| `includePoiId` 가 초안 after 에 없음 | `‘{장소}’은 이번 안에 넣지 못했어요.`(조사는 장소명 받침에 맞춘다) — INV-4 |
| `NO_SOLUTION`·`FAILED` | 기존 대안 없음·실패 얼굴(BR-U4-26 대칭 3옵션) |

- 409 를 일반 실패로 접지 않는다 — 오류 코드로 가른다(`EXPIRED`·`STALE` 만 낡음 얼굴).
- i05·i06 라우트(`planb/solving.tsx`·`planb/draft.tsx`)는 `includePoiId` 를 한 줄씩 더 읽어 내린다.

> **[개정 · 2026-10-20 — 구현 반영]** §3.6 — `미리 준비한 대안` 표식은 SYSTEM 세션의 **초안 얼굴에만** 단다 — 대안 없음·실패 얼굴에는 달지 않는다(없는 대안을 준비했다고 말하지 않는다 — BR-SA-23 표의 DRAFT 행). 낡음 얼굴은 초안 얼굴 위의 안내라 표식이 남는다. 적용 409 가 **지난 날의 초안**(세션 날짜 < 오늘 KST — BR-SA-19 ①)이면 [새 대안 보기]를 두지 않는다 — 같은 날짜로 다시 열면 서버가 늘 409(지난 날짜는 다시 짤 수 없다)라 누를 때마다 실패하는 버튼이 된다. 낡음 문구는 그대로이고, 오늘·앞날·날짜 없음은 종전대로다(#1423 · `frontend/src/pages/live/planb-draft/ui/PlanbDraftPage.tsx:254-257,351`).

### 3.7 하지 않는 것

- 클라 재정렬 — 정렬은 서버 한 곳(BR-SA-13).
- `refetchInterval` 폴링 — 판정이 매시 :15 라 5분 폴링은 대부분 같은 값이다. 포그라운드 복귀 재조회(`AppProviders.tsx:38-44` focusManager)와 푸시 수신 무효화로 충분하다.
- 홈 경보 줄 — Figma 프레임 뒤 후속.
- l02 알림 설정 코드 — 서버 기본값(`PLAN_B` 푸시 ON)만 바뀐다(DEC-SA-5).

---

## 4. FE-C — 기회 카드 (DEC-SA-6 · BR-SA-22)

### 4.1 `pages/live/live-itinerary/model/useHubOpportunities.ts` (신규)

- 허브 active 얼굴에서 **보고 있는 날짜**로 `GET /trips/{tripId}/opportunities?date=` 를 부른다. 자격(여행 중·남은 날·범위)은 서버가 정한다 — 밖이면 빈 목록이다.
- 고르기(순수 함수 하나): ① 같은 날짜에 ACTIVE 날씨 위험(`WEATHER` ∧ `RISK`)이 있으면 행사 카드(`EVENT_*`)를 뺀다(비 오는 날 야외 축제 추천 방지) ② 남은 첫 항목 **1장**(서버 순위) ③ 그 항목의 `key` 를 기기에서 숨겼으면 그리지 않는다 — 숨긴 자리를 다음 항목으로 채우지 않는다(날짜당 1장).
- 숨김은 기기 로컬 편의값이다(`src/shared/storage/stringValue.ts`). 읽기·쓰기 실패는 삼키고 숨김 없이 그린다.
- 슬라이스 안에 둔다 — 소비처가 허브 하나다.

### 4.2 `pages/live/live-itinerary/ui/OpportunityCard.tsx` (신규 · props 만)

| kind | 제목 | 본문 |
|---|---|---|
| `EVENT_VENUE` | `‘{행사명}’ 기간이에요` | `{장소}에서 열려요 · 동선에서 {거리} · {M월 d일}까지` |
| `EVENT_NEARBY` | `‘{행사명}’ 기간이에요` | `행사장 가까이에 {장소}가 있어요 · 동선에서 {거리} · {M월 d일}까지` |
| `TRENDING` | `요즘 많이 찾는 곳이 동선 근처에 있어요` | `{장소} · 동선에서 {거리}` |

- 행사 카드 각주 `열리는 날·시간은 행사 안내를 확인해 주세요`. 금지: `오늘 열려요`·시각·`N분` — 주말만 여는 축제가 있다(INV-2·3). `{거리}` 는 서버 `distanceLabel` 그대로, `{M월 d일}` 은 `end`(일 단위)에서.
- 문장은 이 템플릿 한 곳에서만 만든다 — 서버는 재료(이름·거리 표시·기간)만 준다.
- props: `item` · `onPressReplan` · `onDismiss`. CTA **[넣어서 다시 짜기]** · ×(숨김).

### 4.3 [넣어서 다시 짜기] → i04

`/trips/{tripId}/planb?prefill=…&includePoiId=…`(오늘이 아니면 `&targetDate=`) — `prefill` = `{장소명} 꼭 넣어서 다시 짜 줘`. 트리거가 없어 게이트를 지나지 않는다. 그 뒤는 기존 자연어 재계획 → i05 → i06(미포함 안내 §3.6) → 사용자 [적용].

### 4.4 배선

- `LiveHubView.tsx` 슬롯 prop 1개 — `opportunityCard?: ReactNode`(알약 `triggerChip` 과 같은 꼴). 자리는 프레임을 따른다(G-SA-12).
- `src/mocks/handlers.ts` 기본 빈 응답 1줄.
- 실패·빈 목록이면 아무것도 그리지 않는다. 여행 전(D-1 포함)에는 카드가 없다 — 트리거 없는 재계획은 전날 창에서도 409 다(BR-SA-20).

---

## 5. FE-D — iOS 푸시 entitlement

- `frontend/app.config.ts:223-245` 의 `aps-environment` 삭제 래핑(`withEntitlementsPlist`)을 걷는다. 같은 기본 내보내기의 `withoutBackgroundFetch`(U10 — 백그라운드 fetch 제거)는 남긴다.
- 선행(외부): ASC 번들 ID Push 권한 · EAS APNs 키. 그 뒤 iOS 재빌드·심사.
- iOS 푸시가 열리기 전에는 알림함·허브 알약이 iOS 의 표면이고, 푸시는 Android 로 출발한다(O-SA-8).

---

## 6. 상호작용 흐름

```
[푸시 탭] [알림함 PLAN_B 행] [i03 대안 보기]
  -> /trips/{tripId}/planb?triggerId=...
  -> PlanbEntryGate: 트리거 상세 -> 그 날짜의 준비된 대안 (합쳐 3초)
       APPLIED                    -> 허브 + 토스트 '이미 반영한 대안이에요'
       없음/CANCELED/stale        -> i04 (시드)  또는  허브 + 토스트 '지금은 해당하지 않는 알림이에요'
       DRAFT                      -> i06 (미리 준비한 대안) -> [적용] -> 허브 i08 반영 시트
       COLLECTING/SOLVING         -> i05 -> i06
       NO_SOLUTION/FAILED         -> i06 대안 없음/실패 얼굴
       조회 실패 또는 3초 초과      -> i04

[허브 기회 카드 넣어서 다시 짜기]
  -> i04 (prefill, includePoiId, targetDate) -> i05 -> i06 (+ 미포함 안내) -> [적용]

[i06 적용 -> 409 EXPIRED/STALE]
  -> 낡음 얼굴 -> [새 대안 보기] -> 같은 입력으로 새 세션 -> i05
```

---

## 7. 이 묶음 이전 빌드(구 앱)

| 표면 | 구 앱에서 | 막는 것 |
|---|---|---|
| 푸시 탭 | 탭 리스너가 없어 앱만 열린다 | FE-A |
| 알림함 PLAN_B 행 | 게이트 없이 i04, `targetDate` 없음(= 오늘) | 서버가 트리거 날짜·`FULL_DAY` 로 강제(BR-SA-20) |
| 변형 | kind 라벨(폭염도 `비 예보`) | 운영 켜기 순서 — FE-B 보급과 `minSupportedVersion` 상향 뒤(O-SA-7) |
| 감시 행 | `정상` 만 | 같은 켜기 순서 |
| 알림 종류 | 모르는 kind 면 알림함이 죽는다(`NotificationInboxPage.tsx:35`) | 새 `NotificationKind` 를 만들지 않는다(DEC-SA-5) |

---

## 8. 핫스팟 배선 원칙

| 파일 | 더하는 것 | 원칙 |
|---|---|---|
| `pages/live/live-itinerary/ui/LiveItineraryPage.tsx` | 알약 장소를 자기 날짜 슬롯에서 · 라벨 인자(`variant`·`dayLabel`) · `RiskDetailSheet` 새 props · `watch` 전달 · 기회 훅 연결 | 배선 2~3줄 단위. 판정은 model 파일 |
| `pages/live/live-itinerary/ui/LiveHubView.tsx` | `opportunityCard` 슬롯 prop | 1개 |
| `pages/live/planb-draft` | 낡음·미포함 판정 model 파일 + 페이지 배선 | 새 파일 + 배선 |

- 핫스팟 본문에 판정 로직을 쓰지 않는다. 줄 수는 착수 전에 FE 팀원과 공유하고, QA 뒤 rebase 한다.

---

## 9. API 소비

| 소비처 | 경로 | 비고 |
|---|---|---|
| `useActiveTriggers`(i01·i02·i03·i04) | `GET /trips/{tripId}/triggers` | `watch` · `severity` · `variant` · `attribution` 추가(전부 선택 필드) |
| `PlanbEntryGate` | `GET /trips/{tripId}/triggers/{triggerId}` | Trigger + `state` + `currentTriggerId?` · 404 |
| `PlanbEntryGate` | `GET /trips/{tripId}/replan-sessions/prepared?date=` | `ReplanSession` 또는 404 |
| i05·i06 | `GET /trips/{tripId}/replan-sessions/{sessionId}` | `initiatedBy?` · `stale?` |
| i04 · i06 [새 대안 보기] | `POST /trips/{tripId}/replan-sessions` | 시드는 본문의 `reasons`·`directives`·`excludedPoiIds` |
| i06 | `POST …/replan-sessions/{sessionId}/apply` | 409 `EXPIRED`·`STALE` |
| `useHubOpportunities` | `GET /trips/{tripId}/opportunities?date=` | 빈 목록 = 없음 |
| `usePushRouting` | (무효화) `GET /me/notifications` · `GET /trips/{tripId}/triggers` | |

- 계약 변경 뒤 `pnpm codegen`(orval 설정 그대로). 새 필드는 전부 required 밖이라 계약 가드(`src/__tests__/openapiContract.test.ts`)·옛 픽스처·프리뷰가 깨지지 않는다.

---

## 10. testID (규약 `{feature}-{screen}-{role}` · 기존 접두 승계)

```
planb-entry-gate · planb-entry-gate-waiting
planb-risk-attribution · planb-risk-day-label · planb-risk-watch-{kind}
planb-draft-prepared · planb-draft-stale · planb-draft-stale-retry · planb-draft-include-missing
execution-live-opportunity-card · -opportunity-title · -opportunity-body · -opportunity-cta · -opportunity-dismiss
```

> **[공백]** 제안값이다. `planb-risk-watch-{kind}` 는 기존 testID 이고 상태 글자에 `확인 불가` 가 더해진다. 구현이 다른 값을 확정하면 이 절에 소급 기록한다.

> **[개정 · 2026-10-20 — 구현 반영]** 소급 기록(#1423) — 구현이 더한 testID 5개: `planb-entry-gate-notfound` · `planb-entry-gate-notfound-home`(게이트 404 얼굴과 그 [홈으로]) · `planb-entry-gate-applied-toast` · `planb-entry-gate-inactive-toast`(허브 토스트 2종) · `planb-draft-stale-failed`(낡음 얼굴에서 [새 대안 보기]가 실패했을 때의 안내). 위치 — `frontend/src/pages/live/planb-request/ui/PlanbEntryGate.tsx:75,78,120,126` · `frontend/src/pages/live/planb-draft/ui/ReplanDraftView.tsx:211`. 위 제안값 가운데 FE-B 몫은 그대로 쓰였고, `execution-live-opportunity-*` 는 FE-C(구현 중) 몫이다.

---

## 11. 검증 (FE)

전체 PBT 표(PBT-SA-01~22)는 `business-rules.md` 다. FE 가 지는 것은 아래 둘이다.

| ID | 대상 | 성질 |
|---|---|---|
| **PBT-SA-21** | `entryRoute` | 판정표 전수(준비 상태 × 트리거 상태 × 시간 초과)에서 결과가 §3.2 표의 행과 1:1. 대안으로 가는 결정은 두 조회가 다 준비됐을 때만 |
| **PBT-SA-22** | `triggerLabel` · `triggerPillCopy` · `triggerDayLabel` | `TriggerVariant` 전수 라벨(Record 강제) · 출력에 소요시간 패턴 0 · 월말·연말에도 다음 날은 `내일` · variant 가 없으면 옛 출력과 같다 |

- 단위: `usePushRouting`(HOME 탭 → 이동 + 무효화 · 보류 1회 · 콜드 스타트 1회 · 같은 식별자 1회 · 모르는 actionType 0 · 언마운트 해제) · `receive`(배너·목록 표시 · 꺼낸 뒤 지움 · 실패 null) · `OpportunityCard`(CTA · × 숨김) · `triggerWatchlist` 3상태.
- 통합: 허브(변형 알약 · `내일` 라벨 · 감시 행 3상태 · 출처 캡션 · 기회 카드 CTA · 적용 뒤 재조회) · 게이트(판정표 대표 행) · i06(409 얼굴 · 미포함 안내). 기존 i04·허브·알림함 단언은 그대로 통과한다.
- MSW 에서 `…/replan-sessions/prepared` 는 `…/replan-sessions/:sessionId` 패턴에도 걸린다 — 게이트 테스트는 prepared 핸들러가 먼저 맞게 건다.

---

## 12. 6-b 실기 전용 항목 (jest 원리적 사각)

| # | 확인 | 방법 |
|---|---|---|
| 1 | 콜드·웜 푸시 탭 → 판정표의 화면(Android · iOS 는 FE-D 뒤) | 실기 |
| 2 | 앱이 켜져 있을 때 배너·목록 표시 | 실기 |
| 3 | 스플래시·로그인 뒤 HOME 이 된 직후 1회 이동 | 실기 |
| 4 | 게이트 대기 얼굴의 터치 · i04 → i06 replace | 실기 |
| 5 | 운영 카나리 실푸시 1회 왕복 | 운영 · 내부 계정 |

---

## 13. 다른 유닛 FE 문서와의 관계

- **U4** `frontend-components.md`: i09 감시 목록은 i03 시트로 흡수된 그대로이고, 감시 3상태가 그 시트의 배지에 산다. 원 문서 §1·§2·§4·§6·§8·§9 의 개정 블록이 이 문서를 가리킨다.
- **U6** `frontend-components.md` §5 의 `shared/push/` "수신 핸들러·포그라운드 표시 정책"을 FE-A 가 만든다. 알림함 목적지 사영(`notificationAction`)은 푸시 탭과 공유한다.
- **U10** `frontend-components.md`: 이동(DELAY) 감시 행은 `delay` 가 `OFF` 가 아닐 때 나타난다. `app.config.ts` 의 `withoutBackgroundFetch` 래핑은 FE-D 와 같은 기본 내보내기에 있다.

---

## 14. 갭 (G-SA-\*)

갭 표의 본체는 `business-logic-model.md` §9(G-SA-1~14)다 — FE 쪽은 G-SA-1(감시 표면)·G-SA-7(푸시 도달)이 이 문서의 FE-B·FE-A·FE-D 로 닫히고, 아래는 G-SA-12 의 상세다.

| ID | 갭 | 다룰 곳 |
|---|---|---|
| **G-SA-12** | **SA 가 처음 정하는 표면의 화면 정본이 비어 있다** — 게이트 대기 얼굴 · 주의(CAUTION) 톤(알약·시트 eyebrow) · 출처 캡션 · 감시 `확인 불가` 행 · i06 `미리 준비한 대안` 표식·낡음 얼굴·미포함 안내 · 허브 토스트 2종 · 기회 카드(자리 포함) | 작도는 FE 팀원 몫이다. 프레임이 생기기 전에는 이 문서의 문구·자리가 작도 스펙이고, 프레임이 생기면 프레임이 정본이다(Figma = 화면 단일 정본). 홈 경보 줄은 프레임 뒤 후속 |
