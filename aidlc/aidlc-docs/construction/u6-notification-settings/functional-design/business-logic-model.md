# U6 Notification & Settings — Business Logic Model

> **유닛**: U6 — **C14 Notification**(이중 경로 · catch-up · 종류별 토글) + **설정/마이페이지 리드**
> **스토리**: US-NOTIF-01~12 (12개) · 라이브 Figma 밴드 `l` 16프레임(코드 7 · 결번 없음)
> **답변(2026-08-24)**: **Q1~Q9 전부 A**
> **실장 우선**: 리포 실물 > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션
> **시각 확인**: `l01 default` · `l02 default` · `l02 permission-denied` · `l03 default` · `l05 default` · `l06 default` **6프레임**(로컬 export). 나머지 10프레임은 노드 트리 이름 수준

---

## 0. 이 유닛의 지형 — 절반은 이미 있고 절반은 백지다

| 스토리군 | 백엔드 | 프런트 | U6가 할 일 |
|---|---|---|---|
| 알림 01~05 | **전무**(테이블 0·코드 0·포트 0) | `expo-notifications` **설치+플러그인 등록**, 사용처 0 | 모듈·테이블 3·어댑터·화면 2 **전부 신규** |
| 마이페이지 06~08 | U1·U5 데이터 **읽기만** | 셸(`my.tsx` 26줄) | 화면 2 (`l03`·`l04`) |
| 계정·설정 09~12 | **`/me/*` 12경로 실재** | 없음 | 화면 3 + **배선 명세** |

### 0.1 이벤트 인프라 실측 — 초안 정정 (2026-08-24) ★

초안은 *"아웃박스 구현 0건 · 구독할 이벤트도 0"* 이라고 썼다. **둘 다 틀렸다.** 원인은 내가 `backend/shared/`를 뒤진 것인데 **그런 디렉토리가 없다**(실제는 `backend/common/`). 정확한 지형은 이렇다.

| 조각 | 실재 | 위치 |
|---|:-:|---|
| `DomainEvent` · `DomainEventPublisher` 계약 | ✅ | `common/core/event/` |
| `EventEnvelope`(아웃박스 적재용 직렬화) + **PBT 테스트** | ✅ | `common/core/event/` · `EventEnvelopePropertyTest` |
| **인프로세스 발행 구현** `SpringDomainEventPublisher` | ✅ | `app/event/` (+테스트) |
| `outbox_event` 테이블 | ✅ | V1.0 |
| **`shedlock` 테이블** | ✅ | V1.0 (분산 스케줄 락) |
| **실제 발행 중인 이벤트 5종** | ✅ | `auth.AccountCreated` · `auth.AccountDeletionRequested` · `auth.AccountDeletionCancelled` · `itinerary.ItineraryGenerated` · `itinerary.ItineraryConfirmed` |
| 발행자를 주입받는 모듈 | ✅ | auth · itinerary-generation · saved-accommodation · itinerary-recalculation |
| **아웃박스 릴레이**(`@Scheduled` + ShedLock) | ❌ | **이것만 없다** |
| ShedLock 라이브러리 의존성 | ❌ | `libs.versions.toml`에 없음(테이블만 선재) |

즉 **구멍은 하나다 — 릴레이.** 계약·envelope·발행 구현·락 테이블·PBT는 이미 서 있고, `EventEnvelope.kt` 주석이 *"아웃박스 릴레이(@Scheduled + ShedLock)는 후속"* 이라고 명시해 뒀다.

**이벤트 이름 규약도 실측이 정본이다**: `{module}.{EventName}`(예: `itinerary.ItineraryGenerated`). 인셉션이 쓴 `StayRegistered`·`PlanBTriggered`·`ReflectionReady`는 **이 규약으로 다시 지어야 한다**(§4).

---

## 1. 결정 (DEC-U6-\*)

| ID | 결정 | 근거 |
|---|---|---|
| **DEC-U6-1** ★ | **U6가 아웃박스 릴레이를 설계하고, 물리 배치는 `backend/common/core`(기존 `event/` 패키지)에 둔다**(Q1=A). U6 모듈이 아니라 **공용 자산**이다 — U7도 같은 걸 쓴다 | ⚠️ **2026-08-24 실측 정정** — 초안은 배치를 `backend/shared/`로 적었으나 **그런 디렉토리는 없다**(실제는 `backend/common/{core,security,test-support}`). 그리고 "구현 0건"도 틀렸다 — §2.0 참조 |
| **DEC-U6-1a** ★ | 릴레이가 하는 일은 **인프로세스 발행을 at-least-once로 승격**하는 것이다. 현재 `SpringDomainEventPublisher`는 **같은 JVM·같은 트랜잭션 맥락**에서 구독자를 부른다 — 알림처럼 **실패해도 본업이 살아야 하는** 소비자에겐 부족하다. U6 소비 경로는 `outbox_event` 적재 → **`@Scheduled` + ShedLock 릴레이** → `NotificationFacade`로 간다 | `EventEnvelope.kt` 주석이 이미 그 설계를 예고한다: *"아웃박스 릴레이(@Scheduled + ShedLock)는 후속 — 여기선 계약 타입만 소유한다"* |
| **DEC-U6-2** | 범위는 **알림 5 풀 설계 + 06~12는 화면 배선 명세**(Q2=A). 09~12의 도메인 규칙은 **U0 상속, 재서술 금지** | U0 FD에 닉네임·위치 3층·삭제 유예가 이미 있다. 중복 서술은 정본이 둘이 되는 비용을 만든다 |
| **DEC-U6-3** | 푸시는 **Expo Push Service**(`PushPort` ← `ExpoPushAdapter`)(Q3=A) | `expo-notifications`가 이미 설치·플러그인 등록됐다(`app.config.ts:38`) — **U4의 `expo-task-manager`와 달리 EAS 재빌드가 이미 지불됐을 가능성**이 크다. FCM 직결은 콘솔 블로커를 하나 더 만든다(U0 IdP·U4 기상청이 아직 미해결) |
| **DEC-U6-4** | catch-up은 **서버 저장 + `since` 커서 폴링**. **`RealtimePort`(WS/SSE) 미도입**(Q4=A) | "누락 0"은 실시간성이 아니라 **영속성**으로 달성된다. WS를 써도 끊긴 구간을 메우려면 폴링이 어차피 필요하다 |
| **DEC-U6-5** | 마이페이지는 **화면만 U6 소유**, 데이터는 기존 API 병렬 호출(Q5=A). **집계 엔드포인트 신설 없음** | `l03`의 섹션(프로필·스타일·여행목록·메뉴)이 시각적으로 분리돼 **따로 실패해도 된다**. TanStack Query가 이미 깔려 병렬·캐시가 공짜 |
| **DEC-U6-6** | 설정 4스토리는 배선만. **예외 = 계정 삭제 사전 고지 목록**은 U6가 소유한다(Q6=A) | "무엇이 함께 지워지는가"는 **유닛이 늘 때마다 갱신되는 목록**이다. U0가 쓸 때는 회고도 커뮤니티도 없었다 |
| **DEC-U6-7** | 제휴 고지 시트는 **U1 소유 유지**(`OtaChoiceSheet` · BR-U1-30). U6는 **"다시 보기" 설정만**(Q7=A) | `l07`은 설정 화면이 아니라 숙소 상세 위의 그 시트다 |
| **DEC-U6-7a** ⚠️ | **단, 저장 위치는 "기기 로컬"에서 "서버"로 정정한다.** `l05` 실물이 이 값을 **설정 화면의 토글**(`외부 이동 시 제휴 안내 다시 보기`)로 그린다 — 설정에 있는 값이 기기마다 다르면 사용자 모델이 깨진다 | 계획서 Q7 해설에서 기기 로컬을 권했는데 **시각 확인으로 뒤집혔다**. 설정 항목이므로 계정 단위 저장(§3.3) |
| **DEC-U6-8** | 알림 종류는 **8종**: `STAY` · `TRIP_PRE` · `TRIP_DAY` · `SLOT_PRE` · `PLAN_B` · `REFLECTION` · `COMMUNITY` · **`SYSTEM`**. 토글 가능한 것은 **7종**(`SYSTEM` 제외), `COMMUNITY` 행은 **U7 개통까지 UI에서 숨긴다**(Q8=A) | `l01`에 `시스템 · 2일 전`(새 기기 로그인)이 실재하고 `l02` 토글엔 없다 — "모든 알림을 꺼도 보안·계정 알림은 알림함에 표시"의 실체다. 커뮤니티는 화면이 **좋아요·댓글을 1행으로 병합**했으므로 값도 하나 |
| **DEC-U6-9** | 산출물은 **FD 4종**, NFR 필요 여부는 FD 종료 시 판정(Q9=A) | Q3=A로 푸시를 열었으므로 COST(발송량)·LEGAL(야간)·DATA(토큰 만료) 축이 실재한다 — **U5처럼 자동 스킵되지 않는다** |

---

## 2. 전달 파이프라인

### 2.1 이벤트 → 알림 (아웃박스 경유)

```
[U1/U4/U5 트랜잭션]
   도메인 변경 + INSERT outbox_event(event_id, event_type, aggregate_*, payload)   ← 같은 트랜잭션
        │  커밋
        ▼
[OutboxDispatcher · shared · 폴링]
   SELECT ... WHERE published_at IS NULL ORDER BY occurred_at LIMIT N   ← ix_outbox_unpublished
        │
        ├─ NotificationFacade.onDomainEvent(evt)   ← 멱등(event_id 기준)
        │      ├─ ① 종류 판정(event_type → NotificationKind)
        │      ├─ ② 억제 판정(중복 10분·빈도 상한·조용시간)  → 억제면 여기서 끝(기록은 남긴다)
        │      ├─ ③ notification INSERT (인앱함 = 항상 적재)
        │      └─ ④ 채널 판정(토글 × OS 권한) → 푸시 대상이면 PushPort
        │
        └─ 성공: published_at = now()  /  실패: attempts++ (다음 폴링에서 재시도)
```

**핵심은 ③이 ④보다 먼저**라는 것이다. **인앱함 적재가 푸시 발송의 성공 여부와 무관**해야 catch-up이 "누락 0"이 된다(BR-U6-12).

### 2.2 채널 판정 진리표

| 종류 토글(푸시) | 종류 토글(인앱) | OS 푸시 권한 | 인앱함 | 푸시 |
|:-:|:-:|:-:|:-:|:-:|
| ON | ON | GRANTED | 적재 | 발송 |
| ON | ON | DENIED | 적재 | **미발송**(토글은 `권한 필요`로 비활성 표시) |
| OFF | ON | — | 적재 | 미발송 |
| ON | OFF | GRANTED | **적재**(누적은 하되 목록에서 감춤 여부는 O-U6-3) | 발송 |
| — | — | — | **`SYSTEM`은 토글과 무관하게 항상 적재** | 정책상 발송 |

`l02 permission-denied` 실물이 이 표의 2행을 그린다 — 푸시 컬럼 헤더가 **`권한 필요`** 칩으로 바뀌고 푸시 토글이 전부 회색, 하단 문구가 **"푸시를 꺼도 인앱 알림은 알림함에 계속 누적됩니다"** 로 교체된다.

### 2.3 catch-up

```
앱 시작 / 포그라운드 복귀 / 당겨서 새로고침
   → GET /me/notifications?since={lastSeenAt}&limit=N
   → 서버는 notification 테이블에서 그대로 준다 (푸시 수신 여부와 무관)
```

앱이 3일 꺼져 있어도 잃지 않는다. 푸시는 **즉시성 보조 수단**이지 전달 보장 수단이 아니다.

---

## 3. 스토리군별 흐름

### 3.1 알림 발화 시점 (US-NOTIF-01~04)

| 종류 | 발화 | 원천 | 상태 |
|---|---|---|---|
| `STAY` | 숙소 등록/저장 직후 | U1 `StayRegistered` | 이벤트 **미실장** → G-U6-2 |
| `TRIP_PRE` | 여행 D-1 | **스케줄러**(시각 기반) | 이벤트가 아니다 — §3.2 |
| `TRIP_DAY` | 당일 오전 **기본 8시** | 스케줄러 | 사용자별 시각 설정은 O-U6-1 |
| `SLOT_PRE` | 일정 시작 전 **기본 30분**(0/15/30/60 선택) | 스케줄러 | 선택 UI가 `l02`에 **없다** → G-U6-5 |
| `PLAN_B` | 트리거 감지 시 | U4 `PlanBTriggered` | 이벤트 미실장 |
| `REFLECTION` | 회고 생성 완료 | U5 `ReflectionReady` | 이벤트 미실장(G-U5-13) |
| `SYSTEM` | 새 기기 로그인 등 | U0 auth | 토글 불가 |

### 3.2 시각 기반 알림은 이벤트가 아니다 ★

`TRIP_PRE`·`TRIP_DAY`·`SLOT_PRE` 셋은 **아무 일도 일어나지 않았는데 시각이 되어 발화**한다. 아웃박스로는 못 만든다.

**DEC-U6-10** — **`notification_schedule` 테이블 + 스케줄러 폴링**으로 만든다. 일정이 생성·재계획될 때(U3·U4) 발화 예정 시각을 미리 적재하고, 스케줄러가 도래한 행을 집어 `NotificationFacade`로 넘긴다. 일정이 바뀌면 **미발화 행을 재계산**한다.
근거: U4가 `StalePartialSweeper`로 같은 꼴의 폴링 스케줄러를 이미 쓴다(U4 NFR "스케줄링 신규 인프라 0"). 새 인프라가 아니다.

### 3.3 설정 (US-NOTIF-09~12) — 배선 명세

`l05` 실물 6그룹 → 엔드포인트 매핑:

| 그룹 | 행 | 호출 | 소유 |
|---|---|---|---|
| 계정 | 닉네임·이메일(`여행자123`) | `GET/PATCH /me/profile`·`/me/profile/nickname` | U0 |
| 계정 | **데이터 내보내기** | **엔드포인트 없음** → **G-U6-3** | — |
| 여행 취향 | **7행** — 여행 스타일·**예산(`미설정`)**·동행 유형·선호 활동·이동 방식·음식 취향·일정 밀도 | `GET/PUT /me/preferences` | U0 |
| 위치정보 | 위치정보 수집 동의(`동의` 뱃지) | `GET/PUT /me/location-consent` | U0 |
| 알림 | 알림 설정 → `l02` | **U6 신규** | U6 |
| 제휴 안내 | **`외부 이동 시 제휴 안내 다시 보기` 토글** | **U6 신규**(DEC-U6-7a) | U6 |
| 위험 영역 | 계정 삭제(`위험` 뱃지) | `POST /me/deletion`(→ `DELETION_PENDING`, GPS 즉시 파기) · `DELETE`(유예 내 철회) | U0 + **고지 목록은 U6** |

> **예산이 `미설정`으로 그려져 있다** — U1이 `G-U1-09`로 "예산 입력 화면 부재"를 남겼던 그 항목이다. **`l05`가 그 입력 경로**다 → U1 갭 해소 경로로 연결(G-U6-6).

### 3.4 위치 동의 — 화면 1토글 vs 백엔드 3층 ★

`l06` 실물은 **토글 하나**(`위치정보 수집 · 동의함 · 정확한 위치 사용`) + 용도 3(이동 지연 감지 / 실시간 Plan-B / 주변 추천) + **"동의를 꺼도 계속 동작해요"**(예정 일정 알림 · 날씨·휴무 트리거).

백엔드는 **3층**이다 — `os_permission_mirror`(L1) · `legal_consent`(L2 법정) · `gps_recording_opt_in`(L3), `PUT`은 L2·L3 둘을 받는다.

**DEC-U6-11** — 화면 토글 하나는 **L2·L3를 함께** 움직인다(`legalConsent = gpsRecordingOptIn = 토글값`). L1은 OS 권한이라 토글이 아니라 **선결 조건**이고, 거부 상태면 `l06 permission-denied`가 토글을 비활성화한다.
근거: 화면이 용도로 든 3가지(이동 지연·실시간 Plan-B·주변 추천)가 전부 L3 수집을 전제한다. L2만 켜고 L3를 끄는 조합에 대응하는 UI가 **화면에 없다** — 없는 상태를 만들 수 있게 두면 "동의했는데 아무것도 안 되는" 상태가 생긴다.
⚠️ 철회 시 **파기 트리거**가 걸리고(openapi `PUT` 설명) `location_legal_log`에 `CONSENT_REVOKED`가 남는다 — U0 자산, U6는 건드리지 않는다.

---

## 4. 억제·빈도 (US-NOTIF-03)

- **중복 억제**: 동일 일정에 대한 `PLAN_B`는 **10분 내 1회**.
- **전역 빈도 상한**: 종류 무관 시간당 상한(값은 O-U6-2).
- **민감도(적게/보통/많이)**: US-NOTIF-03이 요구하고 U4가 `G-U4-6`으로 "`l02`에 신설 필요"를 남겼는데 **실물 `l02`에 없다** → G-U6-4.
- **조용시간**: 스토리에 없지만 푸시를 여는 이상 필요하다(야간 발송) → O-U6-4.
- 억제된 알림도 **인앱함에는 남긴다**(침묵 실패 금지). 억제는 "푸시를 안 쏜다"이지 "없던 일로 한다"가 아니다.

---

## 5. 갭 (G-U6-\*)

| ID | 갭 | 처리 |
|---|---|---|
| **G-U6-1** ★ | **아웃박스 릴레이만 없다**(초안의 "구현 0건"은 오진 — §0.1). 계약·`EventEnvelope`·`SpringDomainEventPublisher`·`outbox_event`·`shedlock`은 실재 | DEC-U6-1·1a로 U6가 설계, 배치는 **`common/core`**. **ShedLock 라이브러리 의존성 추가**가 선행(테이블만 선재) |
| **G-U6-2** | **U6가 필요한 이벤트 3종이 아직 없다** — 숙소 등록(U1) · Plan-B 트리거(U4) · 회고 완료(U5). 반면 auth 3종·itinerary 2종은 **이미 발행 중** | 각 유닛이 발행부를 붙여야 한다. **U6 단독으로는 끝나지 않는 유닛** |
| **G-U6-9** | **이벤트 이름이 인셉션과 실장에서 다르다** — 실장 규약은 `{module}.{EventName}`(`itinerary.ItineraryGenerated`), 인셉션은 `StayRegistered` 꼴 | **실장 규약을 정본**으로. 인셉션 정정 상신 |
| **G-U6-3** | **데이터 내보내기 엔드포인트가 없다** — `l05`에 행은 있고 `/me/*` 12경로에 없다 | US-NOTIF-09 요구. 백엔드 신규 |
| **G-U6-4** | **Plan-B 민감도 UI 부재** — U4 `G-U4-6` 미반영 | 디자인 재요청 또는 `l02` `Plan-B 재계획` 행 확장 |
| **G-U6-5** | **`SLOT_PRE` 간격 선택(0/15/30/60) UI 부재** — `l02`는 on/off 토글만 | 디자인 확인. 기본 30분으로 동작은 가능 |
| **G-U6-6** | `l05` 취향 7행이 **`/me/preferences` 스키마와 1:1인지 미확인** — 특히 `예산`(U1 `G-U1-09`) | U0·U1 계약 대조 필요 |
| **G-U6-7** ★ | **`l03` 메뉴 6행 중 3행이 U7 소관**(`내 일정 공개/공유 설정`·`내가 공유한 일정`·`숨긴 사용자 관리`) | 1차에서는 **숨긴다**(COMMUNITY 토글과 같은 처리) |
| **G-U6-8** | **`l03` 스타일 dot 게이지 3축이 U5에 없다** | U5에 `trait_gauges` 신설 반영 완료. **산출식은 O-U5-9** |

---

## 6. 스토리 커버리지

| 스토리 | 화면 | 규칙 | 상태 |
|---|---|---|---|
| 01 숙소 등록 알림 | 푸시·`l01` | BR-U6-01~03 | U1 이벤트 대기(G-U6-2) |
| 02 단계별 리마인드 | 푸시·`l01` | BR-U6-04~07 | **스케줄러 신규**(DEC-U6-10) |
| 03 Plan-B 알림 | 푸시·`l01` | BR-U6-08~11 | 민감도 UI 부재(G-U6-4) |
| 04 회고 완료 알림 | 푸시·`l01` | BR-U6-12 | U5 이벤트 대기 |
| 05 채널·종류 토글 | `l02` 2상태 | BR-U6-13~19 | **완결 가능** |
| 06 마이 숙소·예약 | `l04` 3상태 | BR-U6-20·21 | U1 조회 |
| 07 여행 목록 분류 | `l03` | BR-U6-22·23 | U1 조회 |
| 08 마이 스타일 카드 | `l03` | BR-U6-24 | U5 조회 + `trait_gauges` |
| 09 계정·내보내기·삭제 | `l05`·dialog | BR-U6-25~27 | 내보내기 미구현(G-U6-3) |
| 10 취향 수정 | `l05` 7행 | BR-U6-28 | U0 배선 |
| 11 위치 동의 | `l06` 3상태 | BR-U6-29~31 | **1토글↔3층**(DEC-U6-11) |
| 12 제휴 고지 | `l07`(=U1 시트) + `l05` 토글 | BR-U6-32·33 | 시트 구현됨, 토글만 신규 |

**미커버 0.** 단 01~04는 **다른 유닛의 발행부가 붙어야** 실제로 울린다.
