# U10 GPS·위치 자동화 — Business Logic Model

> **유닛**: U10 GPS·위치 자동화 — **새 컴포넌트 없음.** C1 Auth(위치 동의·법정 로그) · C9 Plan-B Detection(`DELAY` 신호원) · C12 Travel Archive(자동 방문 수용·실제 경로 소유) + **클라이언트 위치 계층**(`frontend/src/shared/location/`)의 위치 자동화 부분을 확장한다(DEC-U10-18).
> **스토리**: 신규 없음 — **부분 이관분**만 다룬다. US-ONTRIP-01(자동 도착·이탈) · US-PLANB-13(실제 경로·토글) · US-REC-03(GPS 방문 기록) · US-REC-08(요약의 GPS 경로) + U4 NFR MOBILE-U4-01/02/04/05/07(§13 커버리지)
> **답변(2026-10-12)**: **Q1=B · Q3=B(사용자 직접 선택)** · 나머지 Q2·Q4~Q22 = A/C 추천안(Q4=C, 그 외 A) — 사용자 지시 "확인하고 입력안한거는 다 추천으로". 계획서 `construction/plans/u10-gps-location-automation-functional-design-plan.md`
> **실장 우선**(U5 선례): 리포 실물 > 패키지 계약 정본 > 라이브 Figma > 기존 aidlc 산출물 > 인셉션. 리포 실측은 2026-10-12 기준(마이그레이션 최신 **V2.62**).
> **범위**: 설계 문서만(SCOPE 2026-10-12). 코드는 팀이 `backend/`·`frontend/`에서 직접 개발한다. 마이그레이션 번호는 **머지 시점에 정한다**(제안 번호를 적지 않는다 — `VisitCheck.kt` 주석이 지적한 V2.28 충돌 선례).

---

## 0. 이 유닛이 다른 유닛과 다른 점 — 판정 대부분이 기기에서 일어난다

U4·U5는 "서버가 판정하고 클라이언트는 그린다"였다(BR-U4-03). U10은 반대 방향이 섞인다.

- **기기가 판정한다**: 지오펜스 진입·체류·이탈, 경로 표본 수집·다운샘플(DEC-U10-8). 서버는 **결과(시각·출처)와 하루치 요약 경로**만 받는다.
- **서버가 파생한다**: `DELAY`(체류 초과·이동 지연)는 좌표 없이 **방문 체크 시각만으로** 서버가 만든다(DEC-U10-9).
- **아무것도 막지 않는다**: U10이 통째로 꺼져도(권한 거부·플래그 OFF·심사 반려) 지금의 수동 체크인 앱이 그대로 남는다(INV-4 · MOBILE-U4-03). U10은 U0·U4·U5의 api·이벤트만 소비하고 역방향 의존을 만들지 않는다.

---

## 1. 결정 (DEC-U10-\*)

| ID | 결정 | 근거 |
|---|---|---|
| **DEC-U10-1** ★ | **백그라운드 지오펜스 전면 도입.** 여행 중 설명 화면을 거친 뒤 OS '항상 허용'을 **정식 요청**한다. 거부·미응답·강등이면 **수동 체크인으로 내려간다** — when-in-use 단계에서 포그라운드 자동 도착을 따로 만들지 않는다(단발 측위 용도 — 재계획 기준점·주변 추천 — 는 지금 그대로) | **Q1=B(사용자 선택).** 추천안 C(단계형)와 달리 승격을 "자동 기록을 켜는 행위"에 묶지 않고 여행 중 첫 진입에서 묻는다(DEC-U10-11). 포그라운드 자동 단계를 두지 않는 것은 Q1=B 문면("거부하면 수동으로 강등")을 그대로 따른 것 — 단계를 하나 더 두면 상태기계·심사 설명이 둘로 갈린다 |
| **DEC-U10-2** ★ | **이탈 → 자동 완료.** 도착이 확정된 슬롯에서 최소 체류(10분)를 채운 뒤 리전을 벗어나면 `completedAt = 이탈 시각`, `completion_source = AUTO_GEOFENCE_EXIT`. 수동 [방문 완료]는 폴백으로 남는다. **보조 규칙**: 이탈을 놓친 채 다음 슬롯 자동 도착이 확정되면 직전 미완료 슬롯을 `AUTO_NEXT_ARRIVAL`로 완료한다(§5.3) | Q2=A. Q8이 물은 "Q2=C 보조 규칙 병행"은 답이 비어 있어 **설계자 판단으로 채택** — 단, 이 출처의 체류는 이동 시간까지 먹으므로 `DELAY` 체류 초과 입력에서 **제외**한다(BR-U10-24). 실측 후 철회 여지는 O-U10-3 |
| **DEC-U10-3** ★ | **백그라운드 저전력 연속 경로 기록.** 조건 = OS '항상 허용' + 정확한 위치 + 앱 위치 동의(L2·L3) + **여행 날짜 구간 안** + 기능 플래그 ON. 저정확도(Balanced/Low)·이동 거리 필터·지연 일괄 전달(deferred updates). iOS는 여행 중 상태바 위치 표시가 **계속 뜬다**(숨기지 않는다 — 설명 화면에 미리 고지) | **Q3=B(사용자 선택).** 추천안 C(단계형)와의 차이는 "거부한 사람에겐 경로 없음"이 그대로 성립한다는 것뿐이다 — DEC-U10-1이 이미 거부를 수동 강등으로 정했으므로 B와 C의 실질 차이는 포그라운드 구간 기록 유무다. **when-in-use 사용자의 포그라운드 구간 경로도 기록하지 않는다**(B 문면 그대로 · DEC-U4-7 개정) |
| **DEC-U10-4** ★ | **원시 좌표는 기기 밖으로 나가지 않는다.** 기기가 당일 원시 표본을 모아 **다운샘플한 일 단위 폴리라인 + 기기 산출 거리**만 서버에 올리고, 업로드 확인(ack) 뒤 원시 표본을 지운다. 서버 행은 (여행, 날짜)당 1행 | Q4=C. §2에서 Q3=B와 정합 |
| **DEC-U10-5** | **실제 경로는 `archive`(C12)가 소유한다.** 엔티티는 점열 `actual_route_point`가 아니라 일 단위 `actual_route_day`다(`domain-entities.md` §3) | Q5=A. **DEC-U5-6 개정**(U4 소유 → archive). 소유 근거였던 "Plan-B 기준점 계산"은 TRIP-992에서 단발 좌표(`replan_session.origin_*`, V2.56)로 해결됐고 LEGAL-U4-05가 그 좌표의 경로 적재를 금한다 — 남은 소비자는 기록·요약뿐 |
| **DEC-U10-6** | **완료 출처 칸을 신설한다** — `visit_check.completion_source`(`AUTO_GEOFENCE_EXIT` · `AUTO_NEXT_ARRIVAL` · `MANUAL`). 기존 `source`는 **도착 출처**로 의미를 좁혀 읽는다(컬럼명 유지). 사용자가 시각을 고치면 출처는 두고 `updated_at`만 바뀐다 | Q6=A. 체류(`completed − arrived`)가 `DELAY` 입력이라 완료가 추정인지 서버가 알아야 한다 |
| **DEC-U10-7** | **보존 = 여행 기록 수명.** 여행·계정 삭제 시 CASCADE, **L3(GPS 옵트인) 철회 시 그 계정의 실제 경로 전량 즉시 파기** + `PURGE` 로그(`LocationPurgeScope.ACTUAL_ROUTE`). 기기 쪽 원시 표본·미전송 큐도 같은 순간 지운다 | Q7=A. `PHOTO_EXIF`(`GpsRecordingOptOutSubscriber`)·`REPLAN_ORIGIN`(TRIP-992) 패턴 재사용. 위치정보법 목적 달성 후 파기 해석은 법무 확인(O-U10-1) |
| **DEC-U10-8** ★ | **지오펜스 판정은 기기에서, 서버엔 결과만**(좌표 0). 자동 도착·완료는 신설 **배치 엔드포인트 `POST /trips/{tripId}/visits/auto-events`** 하나로 보낸다 — 이벤트마다 `eventId`·`kind`·`occurredAt` | Q11=A. 기존 `ArriveRequest.source=AUTO_GEOFENCE` 계약을 살리되, ① 백그라운드 wake 한 번에 요청 1회(MOBILE-U4-07) ② 오프라인 재전송 시 발생 시각 보존(Q18) ③ 완료 요청이 `visitCheckId`를 모르는 상태(도착도 큐에 있음)를 한 번에 풀기 위해 배치로 묶는다 — 기존 `/visits`·`/complete`는 수동 경로로 그대로 |
| **DEC-U10-9** ★ | **`DELAY`는 서버가 방문 체크 시각만으로 파생한다.** planb-detection이 `VisitChecked`를 구독하고(체류 초과 · 완료 시점), **서버 스케줄러**가 진행 중 체류 초과·이동 지연을 판정한다. **이동 지연과 진행 중 체류 초과는 자동 기록이 무장된 여행에만** 켠다 | Q10=A. **DEC-U4-6·BR-U4-04("서버 스케줄러 없음 · 지오펜스 wake 1회 판정") 개정** — wake 판정은 좌표를 서버로 보내야 성립하는데 DEC-U10-8이 그것을 막는다. 무장 조건은 수동 사용자 허위 알림 방지(BR-U6-11과 정합) |
| **DEC-U10-10** | **위치 법정 로그는 구간 단위.** 경로 기록 세션 시작·종료에 `COLLECTION` 1건씩, 지오펜스 무장 구간 시작·종료에 `USE` 1건씩, 그리고 서버가 하루치 경로를 **실제로 저장한 순간** `COLLECTION` 1건. 자동 도착 1건마다 남기지 않는다. 원시 좌표 금지 | Q12=A + 파사드 규약("실제로 저장했을 때 남긴다"). 기기 내 판정이 "이용"인지·기기 내 보관이 "수집"인지의 최종 해석은 **법무 확인**(O-U10-1) |
| **DEC-U10-11** | **'항상 허용'은 여행 중 i01 허브 첫 진입에서 설명 1장 → OS 승격 요청.** 온보딩은 지금처럼 when-in-use만 묻는다. 거절은 정상 경로 | Q13=A. 5.1.1 — 목적을 설명한 뒤 요청. TRIP-936이 피한 "온보딩에서 always" 형태를 만들지 않는다 |
| **DEC-U10-12** ★ | **기능 플래그 뒤 분리 출시.** 플래그는 **빌드 시점 값**이고 JS 동작뿐 아니라 **네이티브 권한 표면**(`app.config.ts`의 always 문구·`UIBackgroundModes: location`·Android 백그라운드 위치·포그라운드 서비스 권한)까지 함께 켠다. 플래그 OFF 빌드는 지금 앱과 권한 표면이 **글자 단위로 같다** | Q14=A. §2.2 심사 위험 완화. 원격 킬 스위치는 두지 않는다(원격 설정 인프라 0 — O-U10-7) |
| **DEC-U10-13** | **동의 축을 늘리지 않는다.** 앱 토글(L2+L3, BR-U6-29) ON + OS '항상 허용' = 자동 기록 · 경로. 동의 고지 문구에 "백그라운드 자동 방문 기록 · 이동 경로"를 추가한다 | Q15=A · LEGAL-U4-01. 목적 범위 확대는 O-U5-8과 함께 법무 확인(O-U10-1) |
| **DEC-U10-14** | **강등 즉시 무장 해제 + 화면 1줄.** always → when-in-use · 정확 → 대략 · 앱 토글 OFF · 여행 구간 이탈 · 플래그 OFF 중 하나라도 걸리면 지오펜스·경로 즉시 중지, 열린 구간 종료 보고, i01에 "자동 기록이 꺼졌어요 · 설정 열기" 1줄. 푸시 없음 | Q16=A. 침묵 실패 금지(INV-4) |
| **DEC-U10-15** | **자동 기록만 되돌릴 수 있다.** 자동 출처의 도착/완료를 사용자가 되돌리면 그 슬롯은 그날 자동 대상에서 빠진다. 수동 기록 계약은 그대로 | Q17=A. 완료를 되돌리면 재계획 잠금(INV-U4-04)도 풀린다(BR-U10-31) |
| **DEC-U10-16** | **회선이 없을 때의 자동 이벤트는 기기에 당일 한정 보관 → 재연결 시 재전송.** 서버에 이미 기록이 있으면 서버 값이 이긴다(충돌 UI 없음). 사용자 입력 오프라인 기록은 여전히 범위 밖 | Q18=A. 2026-09-11 보류 결정의 이유(무거운 충돌 UI)에 걸리지 않는다 — 사람이 만든 입력이 아니다 |
| **DEC-U10-17** | **계획 슬롯만 자동.** 즉석 방문(`slot_key = null`) 자동 감지 없음 | Q19=A |
| **DEC-U10-18** | **컴포넌트 = C1 · C9 · C12 + 클라이언트 위치 계층.** | Q20=A. ✅ `unit-of-work.md` 개정 블록은 이미 "C9·C12·C1(위치 동의는 auth 모듈 소유)"로 적혀 있다(2026-10-12 실측) — D-U10-3은 **해소 상태**로 기록만 한다 |
| **DEC-U10-19** | **새 화면 없음 + 최소 추가 5종, Figma 먼저.** ① 승격 설명 1장 ② i01 방문 카드 "자동 기록" 표시·되돌리기 ③ i01 강등 안내 1줄 ④ l06 고지 문구·자동 기록 상태 행 ⑤ 실제 경로 레이어·토글(i01 지도 · j 기록/요약 지도) | Q21=A. §14 Figma 대조 — 다섯 다 **프레임이 없다** → `figma-build` 선행(G-U10-9) |
| **DEC-U10-20** | **산출물 = SCOPE 4단계**(FD → NFR Req → NFR Design → Infra 증분) | Q22=A |
| **DEC-U10-21** | **리전 = 진행 중 슬롯 + 당일 남은 슬롯 중 다음 순번, 합계 최대 10.** 도착·완료·건너뛰기·일정 변경·날짜 전환마다 다시 고른다 | Q9=A. **U4 NFR P-MOBILE-U4-1 "슬라이딩 창 2" 개정** — 진행 중 슬롯이 리전에서 빠지면 이탈(DEC-U10-2)을 못 잡는다. 10은 iOS 상한 20의 절반(숙소·타 앱 여유) |
| **DEC-U10-22** | **판정 임계 = 반경 150m · 정확도 100m 초과 표본은 판정 근거로 쓰지 않음 · 도착은 진입 후 3분 체류로 확정(도착 시각 = 진입 시각 소급) · 완료는 최소 체류 10분 + 이탈(이탈 후 3분 재진입 없음).** 값은 설정으로 빼 실측 조정한다 | Q8=A. `geofence.ts`의 `DEFAULT_RADIUS_M = 120`(근거 없는 자리값, 주석 자인)을 대체. 값은 O-U10-2 |

---

## 2. 두 긴장의 정합

### 2.1 Q1=B·Q3=B(백그라운드 전면) ↔ Q4=C·Q11=A(프라이버시)

사용자는 **수집 면은 넓게**(승인한 모두에게 백그라운드 지오펜스 + 연속 경로), **서버로 가는 면은 좁게**(원시 좌표 0)를 골랐다. 둘은 충돌하지 않는다 — **수집 장소와 저장 장소를 가르면** 성립한다.

| 데이터 | 생성 | 기기 보관 | 서버로 가는 것 | 서버 보관 |
|---|---|---|---|---|
| 원시 위치 표본(위도·경도·정확도·시각) | 기기(백그라운드 태스크) | **당일분만**, 업로드 ack 후 삭제, 철회 시 즉시 삭제 | **없음** | 없음 |
| 지오펜스 진입/이탈 이벤트 | OS → 기기 | 판정 끝날 때까지 | 없음 | 없음 |
| 자동 도착/완료 결과 | 기기 판정 | 전송 큐(당일 한정) | `slotKey`·`poiId`·`kind`·`occurredAt` — **좌표 0** | `visit_check` 시각·출처 |
| 하루치 경로 | 기기 다운샘플 | 업로드 전까지 | 다운샘플 폴리라인 + 거리 + 표본 수 | `actual_route_day` 1행 |
| 수집·이용 구간 사실 | 기기 보고 | — | 구간 id·종류·시작/종료 시각·표본 수 | `location_automation_interval` · `location_legal_log`(좌표 없음) |

- **연속 기록은 기기 안에서 끝난다.** 서버가 받는 위치 형태의 데이터는 **다운샘플 폴리라인 하나**뿐이다 — 이것도 위치정보이므로 L3 동의 게이트·저장 시 `COLLECTION` 로그·철회 시 파기를 전부 건다(INV-U10-1·4).
- **다운샘플은 저장 시점의 최소화**다 — PERF-U4-04("표시 전 다운샘플")를 저장 시점으로 당긴 것이다. 정밀 동선 재현(어느 가게 앞에 몇 분 서 있었나)이 서버 데이터로는 불가능할 만큼만 남긴다(BR-U10-36 허용 오차·점 상한).
- **거리는 기기가 원시 표본으로 잰다.** U5 DEC-U5-12가 (a) "클라 산출 → 서버 전송"을 **검증 불가**라며 거절했던 바로 그 경로다. U10은 원시 좌표를 서버에 두지 않기로 했으므로(Q4=C) 서버가 더 나은 값을 만들 방법이 없다 — 대신 서버는 **폴리라인 길이를 하한, 속도 상식선을 상한으로 클램프**한다(BR-U10-38). DEC-U5-12의 "서버 저장값은 근사치 유지"는 이 범위에서 개정한다.

### 2.2 Q1=B와 앱 심사 위험 (TRIP-936)

TRIP-936(묶음 PR #686, TRIP-935 첫 심사 블로커)은 '항상 허용'을 **명시적으로 껐다** — `frontend/app.config.ts` `locationAlwaysPermission: false` · `locationAlwaysAndWhenInUsePermission: false`, 주석 "'항상 허용' 위치는 쓰지 않는다(TRIP-936)". Q1=B는 이것을 되돌리므로 **2.5.4(백그라운드 위치는 목적에 맞게만) · 5.1.1(수집 정당화·용도 문구) · 5.1.5(위치는 기능과 직접 관련될 때만)** 반려 위험이 다시 실린다. 추천안 C였다면 "사용자가 켠 기능에서만 요청"으로 방어할 수 있었던 여지도 줄었다.

**완화 = Q14=A(DEC-U10-12).**
1. 백그라운드 기능은 빌드 플래그 뒤에 있고, 플래그 OFF 빌드는 현재 심사 통과 빌드와 권한 표면이 같다 — 반려가 다른 기능 출시를 막지 않는다.
2. 플래그 ON 빌드는 **심사 노트**(사용 시나리오 · 요청 지점 = 여행 중 허브 첫 진입 설명 화면 · 끄는 방법 = OS 설정·l06 토글) + **시연 영상** + 용도 문구(`NSLocationAlwaysAndWhenInUseUsageDescription`) + **App Privacy 답변·privacy manifest 갱신**(현재 `PreciseLocation` 목적 `AppFunctionality` 1종 — D-U10-10)을 함께 낸다.
3. 반려되면 플래그 OFF 빌드로 돌아가고 앱은 수동 체크인으로 동작한다(INV-4).
4. Android는 Play Console 백그라운드 위치 신고·시연 영상이 별도로 필요하다 — NFR Requirements 단계 몫.

> 이 위험은 **설계로 없앨 수 없고 출시 절차로만 줄인다.** 계획서 "예외 — 사용자에게 올린다"의 TRIP-936 충돌 조항에 해당하나, 사용자가 Q1=B를 직접 골랐고 Q14=A로 격리했으므로 이 FD는 그 결정을 따른다. NFR Requirements에서 심사 체크리스트로 구체화한다.

---

## 3. 자동화 단계 상태기계 (권한 사다리)

```
MANUAL    --(여행 구간 + 허브 첫 진입 + when-in-use + 토글 ON + 플래그 ON + 미질문)--> EXPLAINER
EXPLAINER --([켜기] + OS always 승인 + 정확한 위치)-------------------------------> ARMED
EXPLAINER --([나중에] / OS 거절 / 대략 위치)-------------------------------------> MANUAL
ARMED     --(always 철회 / 대략 위치 / 토글 OFF / 여행 구간 밖 / 플래그 OFF)--------> MANUAL
           (강등 = 즉시 무장 해제 + 열린 구간 END 보고 + i01 안내 1줄, DEC-U10-14)
```

텍스트 표현(동일 내용):

| 상태 | 진입 조건 | 하는 일 | 나가는 조건 |
|---|---|---|---|
| **MANUAL** | 기본. 아래 ARMED 조건 중 하나라도 거짓 | 지금 앱 그대로 — 수동 [도착]/[방문 완료], 단발 측위(재계획 기준점·주변 추천) | EXPLAINER 조건 충족 |
| **EXPLAINER** | 여행 날짜 구간 안 · i01 허브 진입 · OS when-in-use 허용 · 앱 토글 ON(L2·L3) · 플래그 ON · **이 계정·이 기기에서 아직 묻지 않음** | 설명 1장(DEC-U10-11) | [켜기] → OS 승격 요청 / [나중에] → MANUAL(재질문 규칙 BR-U10-05) |
| **ARMED** | OS always 승인 · 정확한 위치 · 앱 토글 ON · 여행 구간 안 · 플래그 ON | 지오펜스 등록(§4) · 경로 기록 태스크(§7) · 구간 START 보고(§10) | 위 조건 중 하나라도 거짓 → **강등**(§9) |

- **ARMED는 저장 상태가 아니라 매번 다시 계산하는 판정이다**(앱 시작·포그라운드 복귀·백그라운드 wake마다). 저장해 두면 OS 설정이 바뀐 뒤에도 "켜져 있다"고 믿는다.
- **when-in-use 단계에 "포그라운드 자동"이 없다**(DEC-U10-1). when-in-use 사용자는 수동 체크인 사용자다.
- **앱 토글 OFF 사용자에게는 EXPLAINER를 띄우지 않는다** — 위치 동의를 끈 사람에게 always를 묻는 것은 동의 의사와 반대다(BR-U10-04).
- 여행 구간 판정 기준 시간대는 백엔드 `TRAVEL_ZONE`(여행지 기준)과 같다 — 기기 시간대가 아니다(BR-U4-02 승계).

---

## 4. 지오펜스 생애주기 (C12 클라이언트 측 · LC-U4-8 GeofenceRegistrar 승계)

```
무장(ARMED 진입) --> 리전 선택 --> OS 등록(startGeofencingAsync) --> [진입/이탈 이벤트 대기]
                          ^                                              |
                          |                                              v
                          +---- 재선택 트리거 <---- 도착 확정 / 완료 확정 / 건너뜀 / 되돌리기
                                                   / 일정 변경(재계획 확정·편집) / 날짜 전환
해제: 강등(§9) 또는 여행 구간 종료 --> stopGeofencingAsync + 구간 END 보고
```

**리전 선택(DEC-U10-21)** — 입력은 기기가 이미 받은 당일 일정(`buildGeofenceRegions(slots, date)` 재사용)과 당일 방문 실적:

1. **진행 중 슬롯**(도착 확정 · 미완료 · 미건너뜀) — 이탈 감지에 필요하므로 **항상 포함**
2. 당일 남은 슬롯(실적 없음 · 좌표 있음 · 그날 되돌린 슬롯 제외) **계획 순번대로**
3. 1+2 합계 **최대 10**에서 자른다
4. 반경은 150m(DEC-U10-22). 좌표 결측 슬롯은 리전이 될 수 없다(현 `buildGeofenceRegions` 규칙 승계 — 그 슬롯은 수동 전용)

**겹치는 리전**(반경 합보다 가까운 두 슬롯): 한 이동에 진입 둘이 뜬다. 기기는 **같은 판정 창 안에서 중심이 더 가까운 하나**만 도착 후보로 올리고, 서버는 `(trip_id, slot_key)` 유니크로 하나만 확정한다(P-MOBILE-U4-1 중복 진입 규칙 승계).

---

## 5. 도착·완료 판정 흐름 (기기)

### 5.1 상태 (슬롯 단위, 기기 로컬)

```
IDLE --진입--> ENTERED(enterAt) --3분 내 이탈--> IDLE                         (지나가기 · 기록 없음)
                    |
                    +--진입 후 3분 이탈 없음--> ARRIVED(arrivedAt=enterAt) --> [큐: ARRIVE]
                                                  |
                                                  +--이탈(exitAt)--> EXIT_PENDING
                                                                        |
                                    3분 안 재진입 ----------------------+--> ARRIVED (이탈 취소)
                                    3분 재진입 없음 & exitAt-arrivedAt>=10분 --> COMPLETED(completedAt=exitAt) --> [큐: COMPLETE, AUTO_GEOFENCE_EXIT]
                                    3분 재진입 없음 & exitAt-arrivedAt<10분  --> ARRIVED 유지(자동 완료 안 함 · 수동 폴백)
```

- **판정은 다음 깨어남에서 소급 확정한다.** iOS 지오펜스는 "체류" 이벤트를 주지 않는다. 진입 wake에서 `enterAt`만 기록하고, 이후 아무 wake(경로 표본 일괄 전달 · 다른 리전 이벤트 · 포그라운드 복귀)에서 "진입 후 3분 동안 이탈이 없었나"를 본다. 도착 **시각**은 진입 시각이므로 확정이 늦어도 기록은 정확하다.
- **정확도 게이트**(BR-U10-12): 판정 창 안의 위치 표본 중 정확도 ≤100m가 하나도 없거나, iOS 정확도 권한이 "대략"이면 그 슬롯의 자동 판정을 **보류**한다(기록 없음 — 수동 폴백). 보류는 실패가 아니라 정상 경로다.
- **이탈 히스테리시스 3분**: 도심 다중경로·실내 GPS 튐으로 생기는 가짜 이탈을 흡수한다. 완료 시각은 **첫 이탈 시각**이다(재확인 대기 시간을 더하지 않는다).

### 5.2 수동과의 공존

| 서버에 이미 있는 것 | 기기 자동 이벤트 | 결과 |
|---|---|---|
| 없음 | ARRIVE | 생성(`source = AUTO_GEOFENCE`) |
| 수동 도착 | ARRIVE | 서버 409 `VISIT_ALREADY_RECORDED` → 큐에서 버림(서버 우선) |
| 수동 도착 · 미완료 | COMPLETE(이탈) | **완료 허용** — 진행 중 슬롯 리전이 이탈을 잡은 것. `completion_source = AUTO_GEOFENCE_EXIT`, 체류 기준은 서버 `arrived_at` |
| 완료(어느 출처든) / 건너뜀 | ARRIVE·COMPLETE | 409 → 버림 |
| 자동 되돌림 표식(그날) | ARRIVE·COMPLETE | 409 `VISIT_AUTO_SUPPRESSED` → 버림 |

### 5.3 보조 규칙 — 다음 도착 시 직전 완료 (DEC-U10-2)

다음 슬롯의 **자동 도착이 확정**됐는데 직전 순번 슬롯이 `ARRIVED`(미완료)이고 도착 후 10분이 지났으면, 직전 슬롯을 `completedAt = 다음 슬롯 enterAt`, `completion_source = AUTO_NEXT_ARRIVAL`로 완료한다. 마지막 슬롯은 이 규칙이 적용되지 않는다(이탈 또는 수동만). 이 출처의 체류는 이동 시간을 포함하므로 `DELAY` 체류 초과 판정에 쓰지 않는다(BR-U10-24).

---

## 6. 이벤트 큐 → 서버 (DEC-U10-8 · DEC-U10-16)

```
판정 결과 --> 로컬 큐 적재(eventId 생성) --> 즉시 전송 시도: POST /trips/{tripId}/visits/auto-events
                                               |  성공(항목별 결과) --> 항목 제거
                                               |  항목 409(서버 우선) --> 항목 제거
                                               |  네트워크 실패 --> 큐 유지, 다음 wake/포그라운드에서 재시도
                                               v
                       여행지 기준 날짜가 바뀐 시점에 남은 항목 --> 버림 + "보내지 못한 자동 기록 N건" 1줄(i01)
```

- **배치 1요청/깨어남**(MOBILE-U4-07): wake 예산이 짧다. 큐 전체를 순서대로 한 번에 보낸다.
- **멱등 키 2중**: 항목 `eventId`(클라 UUID — 같은 항목의 재전송) + `(trip_id, slot_key)` 유니크(다른 경로로 이미 기록됨). 서버는 항목별로 `APPLIED` / `ALREADY_RECORDED` / `CONFLICT` / `SUPPRESSED` / `REJECTED_CONSENT` / `OUT_OF_WINDOW` 결과를 돌려준다 — 409로 배치 전체를 깨지 않는다.
- **서버는 `occurredAt`을 믿되 범위를 본다**: 여행 날짜 구간 밖, 미래(서버 시각 + 5분 초과), 슬롯 날짜와 다른 날, 도착보다 앞선 완료는 `OUT_OF_WINDOW`로 거절한다(BR-U10-21).
- **당일 한정**: 날짜를 넘긴 항목은 버린다. 버린 사실은 **화면 1줄**로 알린다(침묵 실패 금지 — BR-U10-22). 사용자는 j01에서 수동으로 남길 수 있다.

---

## 7. 경로 기록 · 다운샘플 · 업로드 (DEC-U10-3·4)

```
ARMED + L3 ON + 여행 구간 --> startLocationUpdatesAsync(저전력, 거리 필터, 지연 일괄 전달) + 구간 START(COLLECTION) 보고
     |
     v 표본 일괄 도착(wake)
  기기 당일 원시 저장소에 적재 (정확도 > 100m 표본은 버림)
     |
     v 업로드 시점: 여행지 기준 날짜 전환 / 여행 구간 종료 / 강등 / 포그라운드 복귀 시 전날 미업로드분
  다운샘플(허용 오차 + 점 상한) --> 세그먼트 분할(기록 공백 > 임계) --> 거리 산출(원시 표본 기준, 공백 구간 제외)
     |
     v
  PUT /trips/{tripId}/routes/{date}  (전체 교체 · 멱등)
     |  200 ack --> 그날 원시 표본 삭제
     |  409 동의 없음 --> 원시 표본·큐 삭제 + 강등
     |  네트워크 실패 --> 원시 보관 유지, 다음 시점 재시도(여행 종료 + 1일까지, 그 뒤 삭제 + 1줄 안내)
     v
  서버: actual_route_day upsert + COLLECTION(STORE) 로그 + 요약 stats 재계산 트리거(§7.2)
```

### 7.1 무엇을 남기나

- **지오펜스 도착·이탈 지점은 별도로 경로에 박지 않는다.** 연속 기록이 같은 조건(ARMED)에서 돌기 때문에 이미 표본에 들어 있다. (추천안 C의 "도착/이탈 지점 포함" 문구는 when-in-use 경로가 없어진 Q3=B에서 의미가 없다.)
- **세그먼트**: 기록이 끊긴 구간(OS가 위치 갱신을 멈춤 · 기기 꺼짐 · 강등 후 재무장)을 선으로 잇지 않는다 — 이으면 실제로 가지 않은 직선이 "실제 경로"로 그려진다(BR-U5-55 정신 승계).
- **걸음 수는 만들지 않는다**(DEC-U4-8 · MOBILE-U4-06 승계).

### 7.2 요약·회고의 거리 출처 승격 (BR-U5-43 개정)

| 날짜 | `actual_route_day` 있음 | 없음 |
|---|---|---|
| 그날 거리 | 행의 `distance_m` (클램프 후) | 방문점 연결선 근사 |
| 그날 `distanceSource` | `ROUTE` | `VISIT_LINE` |

- 회고(하루) stats: 그날 기준 그대로.
- 여행 요약 stats: **모든 날이 `ROUTE`일 때만** `ROUTE`, 하나라도 근사면 `VISIT_LINE`(보수 표기). 날짜별 출처는 `DayHighlight`에 새 필드로 싣는다(§12.5) — US-REC-08 "동의 구간은 GPS 경로 · 미동의 구간은 수동 체크인 순서"가 날짜 단위로 성립한다. 기존 enum `[ROUTE, VISIT_LINE]`은 늘리지 않는다(생성 클라이언트 파손 방지).
- **늦게 온 경로**: 요약이 이미 생성된 뒤 경로가 올라오면 **stats만 재계산**한다(카드 본문 재생성 없음 — O-U10-5). U5 O-U5-2("소급 재계산할 것인가")를 **"한다, stats만"** 으로 닫는다.

---

## 8. `DELAY` 파생 (C9 · 서버 · DEC-U10-9)

좌표를 쓰지 않는다. 입력은 **계획 슬롯 시각**(`ItineraryFacade`) · **방문 실적 시각·출처**(`VisitChecked` 이벤트 · `ArchiveFacade`) · **자동 기록 무장 여부**(`ArchiveFacade.isAutomationArmed`, §12.4).

| 신호 | 판정 시점 | 조건 | 무장 필요 | `payload` |
|---|---|---|---|---|
| **체류 초과 — 완료 시점** | `VisitChecked`(완료) 구독 | `completedAt > 계획 종료 + T_over` **그리고** 다음 `isFixed` 슬롯이 위협됨(남은 여유 < 다음 구간 이동 하한) · `completion_source ≠ AUTO_NEXT_ARRIVAL` | 아니오 | `{"variant":"OVERSTAY","overMin":N}` |
| **체류 초과 — 진행 중** | 서버 스케줄러(주기) | 도착 있음 · 미완료 · `now > 계획 종료 + T_over` · 다음 고정 위협 | **예** | 〃 |
| **이동 지연** | 서버 스케줄러(주기) | 직전 슬롯 완료(자동 출처) · 다음 슬롯 도착 없음 · `now > 다음 슬롯 계획 시작 + 15분` | **예** | `{"variant":"TRANSIT","delayMin":N}` |

- **판정 이후는 기존 경로 그대로**: `TriggerService.evaluate(signal)` → 억제·민감도·빈도 상한(BR-U4-07·08) → `PlanBTriggered` → U6 `PlanBTriggeredSubscriber`(푸시). **새 트리거 종류 없음**(BR-U4-01 · DEC-U4-4 — 둘 다 `DELAY`의 payload 변형).
- **"이동 지연"은 "도착 기록 없음"으로 판정한다.** 그래서 수동 사용자에게는 허위 알림이 된다 → 무장 여행 + 직전 슬롯이 **자동으로** 완료된 경우만(그날 자동 기록이 실제로 돌고 있다는 증거). 위치 동의를 끄면 무장이 풀리므로 **BR-U6-11(철회 시 이동 지연 알림 중단)이 구조적으로 성립**한다.
- **시각 재추정 없음**(DEC-U4-9 승계): 지연은 배너·푸시 문구로만 알리고 슬롯 시각을 바꾸지 않는다. 문구에 소요시간을 쓰지 않는다 — `해운대 해변 · 이동 지연`(라이브 Figma i02 `이동 지연` 변형 실재)처럼 상태만(INV-3).
- `T_over`(체류 초과 임계)는 정본에 값이 없다 — **O-U4-3을 승계**해 O-U10-4로 남긴다(기본 제안 15분 = 이동 지연과 같은 값).
- 스케줄러는 리포에 선례가 있다(`notification` `NotificationSchedulePoller` · `trip` `TripEndSweeper`). 주기·대상(무장 여행만)은 NFR 단계 몫.

---

## 9. 강등 · 동의 철회 · 파기 흐름

| 사건 | 기기 | 서버 |
|---|---|---|
| OS always → when-in-use / 거부 | 즉시 지오펜스·경로 중지, 구간 END 보고(`PERMISSION_DOWNGRADE`), 당일 원시 표본은 **업로드 시도 후** 삭제(동의는 살아 있으므로 그날까지 모은 것은 기록 목적에 부합) | 구간 종료 기록 + `USE`/`COLLECTION` END 로그 |
| iOS 정확 → 대략 | 같음(`ACCURACY_REDUCED`) | 같음 |
| **앱 토글 OFF(L2·L3 철회)** | 즉시 중지 + **원시 표본·미전송 큐·미업로드 경로 즉시 삭제**(업로드하지 않는다) | `GpsRecordingOptOut` → archive 구독자가 **`actual_route_day` 전량 삭제** + `PURGE(ACTUAL_ROUTE, n)` · 열린 구간 강제 종료(`CONSENT_REVOKED`) · 이후 자동 이벤트·경로 업로드 거절. 기존 `PHOTO_EXIF` 파기와 **같은 구독자에서** 처리 |
| 여행 구간 종료 | 중지 + 마지막 날 업로드 + END 보고(`TRIP_ENDED`) | 끝나지 않은 열린 구간은 스위퍼가 종료(`SERVER_TIMEOUT`, G-U10-11) |
| 여행 삭제 / 계정 삭제 | — | CASCADE(`actual_route_day`·`location_automation_interval`). 계정 삭제는 기존 `REASON_ACCOUNT_DELETION` 경로로 `PURGE` 로그 |
| 플래그 OFF 빌드로 업데이트 | 태스크 미등록 → 자동으로 MANUAL. 기기 잔여 원시 표본은 첫 실행에서 삭제 | 열린 구간은 스위퍼가 종료 |

- **"수집 중단이 기존 기록을 지우지는 않는다"(BR-U5-54)는 방문 실적에만 해당한다.** 실제 경로는 L3 철회 시 지운다(Q7=A). 방문 실적(`visit_check` 시각·출처)은 좌표가 없으므로 철회와 무관하게 남는다.
- **철회 고지(BR-U6-30) 문구가 바뀐다**: 중단 목록에 "자동 방문 기록 · 이동 경로 기록(저장된 경로는 삭제)"이 들어가야 한다 — 현 `frontend/src/shared/location/revokeImpact.ts`의 `stops` 3종에 없다(G-U10-8).

---

## 10. 위치 법정 로그 흐름 (C1 · DEC-U10-10)

| 사실 | `event_type` | 언제 | `detail`(좌표 금지) | 기록 주체 |
|---|---|---|---|---|
| 지오펜스 무장 구간 시작/종료 | `USE` | 구간 START/END 보고 수신 | `intervalId · purpose=GEOFENCE_AUTO_VISIT · phase · tripId · at` (+END: `endReason · regionCount`) | archive → `LocationLegalLogFacade.recordUseInterval` |
| 경로 기록 세션 시작/종료 | `COLLECTION` | 〃 | `intervalId · source=ROUTE_TRACE · phase · scope=DEVICE · tripId · at` (+END: `pointCount`) | archive → `recordCollectionInterval` |
| 하루치 경로 서버 저장 | `COLLECTION` | `PUT /routes/{date}` 저장 성공 | `subjectId=routeDayId · source=ROUTE_TRACE · phase=STORE · pointCount` | archive → 기존 `recordCollection` 확장 |
| 경로 파기 | `PURGE` | L3 철회 구독 처리 | `scope=ACTUAL_ROUTE · purgedCount` | archive → `recordPurge` |

- **`location_legal_log`는 6개월 뒤 정리된다**(V2.49 `purge_expired_location_legal_log`). 구간 사실은 그보다 오래 필요하지 않다 — `location_automation_interval`(업무 데이터)은 여행 수명을 따르고, 법정 로그(증적)는 법정 기한을 따른다. **두 계층을 섞지 않는다**(P-DATA-U4-1 승계).
- 파사드 주석 "좌표를 쓰거나 내보내는 기능이 생기면 그 기능과 같은 PR에서 대응 메서드를 연다"에 따라 **`USE` 메서드는 U10 첫 PR에서 연다.**
- **`PROVISION`은 여전히 없다** — U10은 좌표를 AI 등 외부로 내보내지 않는다(`ai/docs/openapi.json`에 위치 필드 0, 2026-10-12 실측).

---

## 11. 폴백 표 (INV-4 — 침묵 실패 금지)

| 실패·결여 | 동작 | 사용자에게 보이는 것 |
|---|---|---|
| 플래그 OFF 빌드 | U10 전체 미동작 | 지금 앱 그대로(수동) |
| OS 위치 권한 없음 / when-in-use만 | MANUAL | 수동 [도착]·[방문 완료]. j01 `manual-checkin`(라이브 Figma 실재) |
| 설명에서 [나중에] / OS always 거절 | MANUAL | 같음. l06에 자동 기록 상태 "꺼짐 · 설정 열기" |
| 대략 위치(iOS 정밀 끔) | MANUAL(자동 보류) | i01 강등 1줄 |
| 무장 중 강등 | 즉시 해제 | i01 "자동 기록이 꺼졌어요 · 설정 열기" 1줄 |
| 지오펜스 등록 실패(OS 오류·리전 상한) | 그날 MANUAL로, 다음 재선택 시점에 재시도 | i01 강등 1줄(사유 다름) |
| 정확도 미달·판정 창 표본 없음 | 그 슬롯 자동 보류 | 슬롯은 "예정"/"방문 중" 그대로 — 수동 버튼 활성 |
| 지나가기(3분 내 이탈) | 기록 없음 | 없음(정상) |
| 최소 체류 미달 이탈 | 도착만 남고 완료는 수동 | 카드에 [방문 완료] 버튼 그대로 |
| 자동 이벤트 전송 실패 | 큐 보관 · 재시도 | 없음(당일 안) |
| 날짜 넘긴 미전송 이벤트 | 버림 | i01(또는 j01) "보내지 못한 자동 기록 N건" 1줄 |
| 서버가 자동 이벤트 거절(동의 없음) | 큐 삭제 + 강등 | 강등 1줄 |
| 경로 업로드 실패 | 원시 보관 · 재시도(여행 종료 + 1일까지) | 없음 → 기한 초과 시 1줄 + 그날 근사 표기(`VISIT_LINE`) |
| 경로 없음(그날 전부) | 거리 근사 | 기록·요약 "근사" 라벨(`summaryView.ts` 기존 `VISIT_LINE`→"근사") + 실제 경로 레이어 비활성·사유(BR-U5-53) |
| `DELAY` 판정 입력 결여(무장 아님) | 이동 지연 무발화 | 없음(정상 — PBT-U4-2 무발화 보존 승계) |
| 백그라운드 태스크가 OS에 의해 종료됨 | 다음 wake/포그라운드에서 ARMED 재계산 → 재등록 | 공백 구간은 경로 세그먼트가 끊겨 보인다(직선으로 잇지 않음) |

---

## 12. API 계약 초안 (백엔드 변경 — `backend/docs/design/openapi.yaml` 반영은 팀 PR)

> 표기는 초안이다. 이름·경로는 구현 PR에서 바뀔 수 있으나 **모양(좌표 0 · 항목별 결과 · 멱등 키)** 은 유지한다.

### 12.1 자동 방문 이벤트 배치 (신설)

```
POST /trips/{tripId}/visits/auto-events
요청: AutoVisitEventBatch {
  events: [ AutoVisitEvent {
    eventId: uuid,                         # 클라 생성 · 재전송 멱등
    kind: ARRIVE | COMPLETE,
    slotKey: string,                       # 필수 — 즉석 방문 자동 없음(DEC-U10-17)
    poiId: uuid,
    occurredAt: date-time,                 # ARRIVE=진입 시각(소급) · COMPLETE=이탈 시각 또는 다음 진입 시각
    completionSource?: AUTO_GEOFENCE_EXIT | AUTO_NEXT_ARRIVAL   # kind=COMPLETE 일 때만
  } ]                                      # 최대 N(예: 50) · 순서대로 적용
}
응답 200: AutoVisitEventResult { results: [ { eventId, outcome, visitCheck? } ] }
  outcome: APPLIED | ALREADY_RECORDED | CONFLICT | SUPPRESSED | REJECTED_CONSENT | OUT_OF_WINDOW
404: 여행 없음/타 계정
```

- **좌표 필드가 없다**(INV-U10-2). 서버는 `LocationConsentFacade.hasLocationLegalConsent`가 거짓이면 전 항목 `REJECTED_CONSENT`.
- 같은 `eventId`는 같은 결과를 돌려준다(BR-U10-20). 저장은 `visit_check`에만 한다 — 별도 수신 영수증 테이블을 두지 않고, `(trip_id, slot_key)` 상태 + `occurredAt` 비교로 재전송을 `ALREADY_RECORDED`로 수렴시킨다.
- `COMPLETE`가 `ARRIVE`보다 먼저 오거나 도착 행이 없으면 `CONFLICT`.
- 성공 시 `VisitChecked`를 도착·완료 모두에 대해 발행한다(§12.6).

### 12.2 자동 기록 되돌리기 (신설)

```
POST /trips/{tripId}/visits/{visitCheckId}/revert-auto
응답 200: VisitCheck | 409
  - 완료 출처가 AUTO_* 이면: completed_at · completion_source 를 비운다(도착은 유지)
  - 완료가 없고 도착 출처가 AUTO_GEOFENCE 이면: 도착을 비우고 그날 자동 억제 표식(auto_suppressed_at)을 남긴다
    · 사진·메모가 붙어 있으면 409 VISIT_HAS_MEDIA (먼저 지우라고 안내 — 기록을 조용히 잃지 않는다)
  - 둘 다 수동이면 409 VISIT_NOT_AUTO
  - 응답 후 VisitAutoReverted 발행
```

### 12.3 실제 경로 (신설)

```
PUT  /trips/{tripId}/routes/{date}        # 전체 교체 · 멱등
요청: RouteDayUpload {
  segments: [ string ],                   # 인코딩 폴리라인(정밀도 1e-5) · 다운샘플 후
  distanceM: integer,                     # 기기가 원시 표본으로 잰 값(공백 구간 제외)
  rawPointCount: integer, storedPointCount: integer,
  recordedFrom: date-time, recordedTo: date-time
}
응답 200: RouteDay { date, segments, distanceM(클램프 후), distanceClamped: boolean, updatedAt }
409 CONSENT_REQUIRED(L3 없음) · 422 OUT_OF_WINDOW(여행 구간 밖) · 413/422 점 상한 초과

GET  /trips/{tripId}/routes               # 날짜별 RouteDay 목록 — i01 지도·j 기록/요약 지도 레이어
```

- **소요시간·속도 필드 없음**(INV-3). `recordedFrom/To`는 기록 구간이지 이동 시간이 아니며 화면에 기간으로 표시하지 않는다(BR-U10-40).

### 12.4 자동화 구간 보고 (신설)

```
POST /trips/{tripId}/location-automation/intervals
요청: { intervalId: uuid, kind: GEOFENCE_ARMED | ROUTE_RECORDING, phase: START | END,
        at: date-time, endReason?: CLIENT_STOP | PERMISSION_DOWNGRADE | ACCURACY_REDUCED | CONSENT_REVOKED | TRIP_ENDED,
        pointCount?: integer, regionCount?: integer }
응답 204 · 멱등(intervalId + phase)
```

- 서버는 `location_automation_interval` 행을 열고 닫으며 §10 법정 로그를 남긴다.
- **`ArchiveFacade.isAutomationArmed(tripId, at): Boolean`** 을 신설해 planb-detection이 §8 무장 조건을 읽는다(동기 facade, 순환 없음 — archive는 planb-detection을 부르지 않는다).

### 12.5 요약·회고 (개정)

- `DayHighlight`에 `distanceKm`·`distanceSource` 추가(선택 필드 — 기존 클라 무해).
- `TripSummaryStats.distanceSource`·`ReflectionStats.distanceSource`의 enum은 그대로, **의미를 §7.2 규칙으로 개정**. `ReflectionStats` 설명문의 "`actual_route_point` 가 미실장이라" 문장은 갱신 대상.
- `ArchiveRecordFacade.findRouteDays(tripId): List<RouteDayView(date, distanceM, distanceClamped)>` 신설 — reflection이 폴리라인 없이 거리만 읽는다.

### 12.6 이벤트 (개정·신설)

| 이벤트 | 변경 |
|---|---|
| `archive.VisitChecked` | **도착에도 발행**(`completedAt = null`) — 이벤트 주석이 이미 "도착·건너뜀까지 넓힐 때 구독자를 고치지 않으려고 모양을 좁히지 않았다"고 대비해 뒀다. 필드 추가: `accountId`(planb-detection이 `evaluate`에 넘길 계정 — G-U10-3) · `arrivalSource` · `completionSource?` |
| `archive.VisitAutoReverted` | 신설 — `tripId · slotKey · visitCheckId · revertedPart(ARRIVAL\|COMPLETION)`. planb-detection은 그 슬롯의 활성 `DELAY`를 재평가 |
| `archive.ActualRouteStored` | 신설 — `tripId · date`. reflection이 요약 stats 재계산(§7.2) |

### 12.7 위치 동의 미러 (개정 제안)

`PATCH /me/location-consent/os-permission`의 `osPermission`은 `GRANTED|DENIED|NOT_DETERMINED` 3값이라 **when-in-use와 always, 정확/대략을 구분하지 못한다.** 서버 판정은 §12.4 구간 보고로 하므로 필수는 아니지만, l06 표시 정합과 관측(승인율 — NFR)을 위해 선택 필드 `scope: WHEN_IN_USE | ALWAYS`·`precise: boolean` 추가를 제안한다(G-U10-4).

---

## 13. 스토리 커버리지 (이관분)

| 스토리 · 이관 부분 | 흐름 | 규칙 | 엔티티 | 화면 | 비고 |
|---|---|---|---|---|---|
| **US-ONTRIP-01** 정상 "현재 위치가 다음 예정지 인근" — 자동 도착 | §3·§4·§5·§6 | BR-U10-01~22 | `visit_check`(+`completion_source`·`auto_suppressed_at`) | i01 카드 "자동 기록"(신규 표시) | 완료 자동화(이탈)는 원 스토리 확장 — 제품 원칙 2026-08-27 |
| US-ONTRIP-01 정상 "체류 시간 측정 · Plan-B 트리거(체류 초과·이동 지연) 입력" | §8 | BR-U10-23~28 | `plan_b_trigger`(기존) | i02 `이동 지연` 변형(라이브 실재) | 체류는 표시하지 않는다(INV-U4-03) |
| US-ONTRIP-01 예외 "권한 없거나 정확도 낮으면 보류 → 수동" | §3·§5.1·§11 | BR-U10-06·12 | — | j01 `manual-checkin`(실재) | |
| **US-PLANB-13** 실제 경로 + 계획 대비 토글 | §7 | BR-U10-33~41 | `actual_route_day` | i01 지도 레이어·토글(신규) | **걸음 수 제외**(DEC-U4-8 승계 — 스토리 문면과 다름, 재질문 안 함) |
| US-PLANB-13 예외 "권한 없거나 GPS 불가 → 레이어 비활성 + 사유" | §11 | BR-U10-41 · BR-U5-53 승계 | — | 〃 | |
| **US-REC-03** 정상 "방문 좌표·이동 경로 자동 저장" | §5·§7 | BR-U10-01~22·33~41 | `visit_check` · `actual_route_day` | j01 | **방문 "좌표"는 저장하지 않는다** — 방문 위치는 POI 좌표(C7)로 충분하고 기기 좌표를 실적에 붙이면 수집 면이 넓어진다(INV-U10-2). 스토리 문면과의 차이는 의도된 최소화 |
| US-REC-03 예외 "권한 거부 → 수동 기본 · OFF 시 즉시 중단" | §9 | BR-U10-42~46 | — | l06 | OFF 시 경로 **파기**까지(Q7=A) |
| **US-REC-08** "동의 구간은 GPS 경로 · 미동의 구간은 수동 체크인 순서" | §7.2 | BR-U10-38·39 | `actual_route_day` · `trip_summary`(재계산) | j 요약 | ⚠ 요약 지도 히어로 자체가 미배선(`DayHighlight` 좌표 없음) — G-U10-7 |
| U4 NFR MOBILE-U4-01(`expo-task-manager`) · 02(always 설정) · 04(리전 상한) · 05(연속 추적 금지 → 개정) · 07(wake 예산) | §3·§4·§6·§7 | BR-U10-07·08·20 | — | — | NFR Requirements에서 재정의 |

**미커버 0.** 단 US-REC-08 경로 지도는 U5 요약 지도 히어로 배선(G-U10-7)에 막혀 있다.

---

## 14. 라이브 Figma 대조 (계획서 1d · 2026-10-12 · 읽기 전용)

`get_metadata(1MTF3dtptIrbg8gld5IdO2, 1228:1045)` 전체를 받아 i·j01·l06 최상위 프레임 이름과 텍스트 노드를 추출했다(스크린샷은 찍지 않았다 — 판정 대상이 "프레임 유무"라 텍스트로 충분).

| 확인 대상 | 결과 |
|---|---|
| i 밴드 | `i01-[허브] 여행중 허브` 변형 12 · `i02-[변수] 변수 감지 · default/이동 지연/영업·휴무` · `i03` 위험 상세 시트 · `i04` 재계획 요청 · `i05` 다시 짜는 중 · `i06` 재계획안 · `i07` 일정 편집 · `i08` 변경 반영 시트 · `i09-[알림] 푸시 알림` · `i10` 현재 장소 상세. **승격 설명 · "자동 기록" 표시 · 강등 1줄 · 실제 경로 레이어/토글 — 프레임·텍스트 0** |
| j01 | `manual-checkin`(일반·풀 지도 2세대) 실재 — 문구 "GPS 미동의 — 수동 체크인으로 기록해요 / 위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요". U10 MANUAL 상태와 **일치**(문구 유지 가능). 자동 기록 출처 표시·경로 레이어 프레임 없음 |
| l06 | `default` · `dialog` · `permission-denied` 실재. 사용처 3행 = 이동 지연 감지 · 실시간 Plan-B 재계획 · 주변 숙소·일정 추천 / 계속 동작 = 예정 일정 알림 · 날씨·휴무 트리거. **자동 방문 기록 · 이동 경로 · 백그라운드 고지 없음**(G-U10-8) |
| 기타 | 텍스트 "자동 기록" 계열은 j01 manual-checkin 문구 1종뿐. 스크린샷 미확인 — 레이아웃은 Figma 작도(Q21) 단계에서 본다 |

→ DEC-U10-19의 ①~⑤ **전부 신규 작도 대상**. `figma-build`로 새 밴드에 먼저 그리고 정본 in-place 수정은 사람 검토 뒤(`frontend/.claude/rules/figma-traps.md`).

---

## 15. 다른 유닛 정본 개정 목록 (계획서 Step 7)

아래는 이 FD와 같은 날 해당 문서에 **`[개정 · 2026-10-12 · U10 FD]` 블록을 덧붙였다**(원문 보존 · append-only).

| 문서 | 대상 | 개정 요지 |
|---|---|---|
| U4 FD `business-logic-model.md` | **DEC-U4-6** · **DEC-U4-7** | 서버 스케줄러 도입(`DELAY`) · wake 판정 폐기 / 연속 경로 기록(백그라운드 저전력, 원시 좌표 기기 전용) |
| U4 FD `business-rules.md` | BR-U4-04 · BR-U4-36 · **BR-U4-37** · BR-U4-41 · O-U4-1 · O-U4-3 | wake 1회 판정 폐기 / 자동 도착 임계 / **완료 자동화(이탈) + 완료 출처, 체류 입력에서 `AUTO_NEXT_ARRIVAL` 제외** / 경로 = 백그라운드 연속 / 리전 10 / 체류 임계 → O-U10-4 |
| U4 FD `domain-entities.md` | §3.1 `visit_check` · §3.3 `actual_route_point` | 완료 출처·자동 억제 표식 / 점열 폐기 → `actual_route_day`(archive) |
| U4 FD `frontend-components.md` | §방문 완료(TRIP-396 소급 기록) | 수동 [방문 완료]는 폴백으로 유지, 자동 완료 추가 |
| U4 NFR `nfr-requirements.md` | MOBILE-U4-01·02·04·**05**·07 · LEGAL-U4-02 | 연속 추적 금지 철회(조건부 허용) · 리전 10 · 구간 로그 + 저장 시 로그 |
| U4 NFR `nfr-design-patterns.md` | P-MOBILE-U4-1 · P-DATA-U4-1 | 창 2 → 진행 중 + 다음 순번 최대 10 / 좌표 본체 = 기기(원시) + `actual_route_day`(다운샘플) |
| U5 FD `business-logic-model.md` | **DEC-U5-6** · DEC-U5-12 · §6 이동 거리 | 소유 U4 → archive · `actual_route_day` / 기기 산출 거리 + 서버 클램프로 `ROUTE` 승격 |
| U5 FD `business-rules.md` | BR-U5-43 · BR-U5-54 · BR-U5-55 · O-U5-2 | 날짜별 출처 규칙 / 철회 시 경로는 파기(실적은 유지) / degrade 해제 조건 / 소급 재계산 = stats만 |
| U6 FD `business-rules.md` | **BR-U6-11** · BR-U6-30 | 이동 지연 알림이 U10에서 실재하게 됨 — 무장 조건으로 구조적 성립 / 철회 고지에 자동 기록·경로 파기 추가 |

인셉션 정정 상신(직접 고치지 않는다): `components.md` C12 책임에 "실제 경로(일 단위) 소유" 추가 · C9 신호원에 "서버 스케줄러" · `requirements.md` LEGAL-01에 백그라운드 수집 목적 범위.

---

## 16. 갭 (G-U10-\*)

| ID | 갭 | 처리 |
|---|---|---|
| **G-U10-1** ★ | `VisitCheckService.arrive`·`complete`가 **서버 `clock.instant()`만** 쓴다 — 발생 시각을 받을 자리가 없어 소급 도착(진입 시각)·이탈 시각·오프라인 재전송이 불가 | §12.1 배치 엔드포인트가 `occurredAt`을 받는다. 수동 경로는 그대로 서버 시각 |
| **G-U10-2** | `VisitChecked`가 **완료 시에만** 발행되고 출처 필드가 없다 | §12.6 개정 |
| **G-U10-3** | `TriggerService.evaluate(accountId, …)`는 계정이 필요한데 이벤트 구독·스케줄러 경로엔 사용자 요청이 없다. `TripFacade`는 `findPeriod(accountId, tripId)`뿐이라 trip → 소유자 조회가 없다 | `VisitChecked`에 `accountId` 싣기(`PlanBTriggered` 선례) + 스케줄러용 `TripFacade` 소유자 조회 또는 시스템 경로 `evaluateAsSystem`. 백엔드 팀 결정 |
| **G-U10-4** | OS 권한 미러가 when-in-use/always·정확/대략을 구분 못 한다 | §12.7 선택 필드 제안 |
| **G-U10-5** | 기기 로컬 저장소(원시 표본·자동 이벤트 큐)용 라이브러리가 없다 — `frontend/package.json`엔 `expo-secure-store`만(소용량 키값) | NFR Design에서 선택(파일 저장 vs 경량 DB). 백그라운드 태스크에서 접근 가능해야 한다 |
| **G-U10-6** | **기능 플래그 장치가 리포에 0** — `EXPO_PUBLIC_*`는 키·엔드포인트 값뿐 | 빌드 플래그 1개를 `app.config.ts`에서 읽어 네이티브 권한 표면 + `extra`로 JS에 노출(DEC-U10-12). NFR Design |
| **G-U10-7** | US-REC-08 요약 지도 히어로가 **배선 전**(`DayHighlight` 좌표 없음 — `TripSummaryPage.tsx` "계약 공백") — 경로 폴리라인을 얹을 지도가 아직 없다 | U5 후속 티켓 선행 또는 U10 FE 티켓에 동반. 경로 레이어는 그 뒤 |
| **G-U10-8** | 철회 고지 `revokeImpact.ts` `stops`(이동 지연 알림·실시간 Plan-B·현 위치 추천)와 l06 사용처 3행에 **자동 방문 기록·이동 경로**가 없다 | Figma l06 먼저 → 코드. BR-U6-30 개정 블록 |
| **G-U10-9** | DEC-U10-19 ①~⑤ Figma 프레임 0(§14) | `figma-build` 선행 — 코드 티켓은 그 뒤 |
| **G-U10-10** | U6 BR-U6-11은 **존재하지 않는 알림**을 끄는 규칙이었다(D-U10-5) — `DELAY` 신호원이 0이었다 | U10 §8로 실재하게 된다. U6 개정 블록 |
| **G-U10-11** | 앱이 강제 종료·삭제되면 구간 END가 오지 않는다 → 무장 상태가 남아 이동 지연 오발 가능 | 스위퍼가 여행 종료 + 1일에 닫는다(`SERVER_TIMEOUT`). 그 전의 오발은 "직전 슬롯이 자동 완료" 조건이 1차로 막는다. 하트비트 도입 여부는 O-U10-6 |
| **G-U10-12** | 자동 되돌림으로 도착이 비워진 행(`auto_suppressed_at`만 있는 행)이 방문 목록·통계에 섞일 수 있다 | `listByDay`·`ArchiveRecordFacade`·요약 집계가 **타임스탬프 없는 행을 제외**해야 한다(BR-U10-32). 수동 도착은 그 행을 재사용 |
| **G-U10-13** | 선재 `전체-최소-스키마.dbml`의 `gps_track(polyline·distance_m·steps)`와 차이 확대(G-U5-3 승계) — `steps` 금지 · 소유 archive · 일 단위 · 세그먼트 배열 | backend 패키지 문서 — 팀 협의 |
| **G-U10-14** | 백그라운드 태스크·지오펜스 발화·OS 강등 전이는 **jest가 원리적으로 못 본다** | 순수 판정 함수(fast-check PBT) + 6-b 실기 체크리스트(`frontend-components.md` §8) |
| **G-U10-15** | 두 `useVisitCheck`가 있다 — `features/check-visit/model/` · `pages/live/live-itinerary/model/`(리포 실측) | 자동 기록 표시·되돌리기를 어느 훅에 붙일지 FE 착수 시 하나로 정리(`frontend-components.md` §3) |

> **[개정 · 2026-10-19 · situation-awareness FD]** G-U10-3 — 스케줄러 경로의 계정
> 스케줄러 경로의 계정은 trip `api` 의 새 좁은 퍼사드 `TripWatchFacade` 가 진행 중 여행과 함께 돌려준다(`TripFacade` 대역 보호). 단건 소유자 조회는 `TripOwnerFacade.findOwnedPeriod(tripId)`(`backend/modules/trip/src/main/kotlin/com/trippilot/trip/api/TripOwnerFacade.kt` — 알림 구독자 선례)가 맡는다. U10 의 진행 중 판정 스케줄러도 이 경로로 계정을 얻을 수 있고, 락·파일·설정 키는 상황 감시와 분리한다.
> → [DEC-SA-1](../../situation-awareness/functional-design/business-logic-model.md) · [BR-SA-02](../../situation-awareness/functional-design/business-rules.md)
