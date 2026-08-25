# U5 Records & Reflection — Functional Design Plan

> **유닛**: U5 Records & Reflection — **C12 Travel Archive**(방문·사진메타·메모·변경이력 = plan/actual/changelog 3계층 소유) · **C13 AI Reflection/Summary**(당일 회고·전체 요약·스타일 분석 — 딥 모듈)
> **스토리**: **US-REC-01~14 (14개)**
> **범위 주의(SCOPE.md)**: 설계 문서까지. 코드는 팀이 `backend/`·`frontend/`에서 직접 개발
> **선행**: U0(2026-07-17) · U1(2026-07-23) · U2·U3(2026-08-07) · U4(2026-08-09) 설계 종료. U4의 `visit_check`·`change_log_entry`·`actual_route_point` 결정이 이 유닛의 직접 전제다
> **착수 지시**: 2026-08-22 사용자 — "그냥 시작해" (범위 기본값 = **얇게**: FD 우선, NFR 2단계는 Q9에서 확정) · **실장 우선 원칙 명시 지시**: 리포에 구현·결정된 것이 있으면 그것을 따른다(순위는 §실장 우선 순위)

---

## 실장 우선 순위 (2026-08-22 사용자 지시)

위가 이긴다. 아래가 위와 다르면 **아래를 정정 대상으로 기록**하고 위를 따른다.

1. **리포 실물** — `backend/modules/*` 코드·Flyway 마이그레이션 · `frontend/src/*` 실제 배치 · `ai/src/trippilot/*`
2. **패키지 계약 정본** — `backend/docs/design/openapi.yaml` · `ai/docs/openapi.json` · `frontend/README.md` · `docs/conventions/*`
3. **라이브 Figma**(화면 정본)
4. **기존 aidlc 산출물** — U0~U4 FD·NFR (상속, 재서술 금지)
5. inception 문서 — 위와 충돌하면 **인셉션이 진다**(정정 상신 대상으로만 기록)

> **예외 — 따르지 않고 사용자에게 올린다**: 실물이 INV-1~4 · 보안/법정로그 append-only · 요구사항과 정면 충돌할 때. 버그일 수 있어 설계로 굳히지 않는다.

---

## Step 1 결과 — 기존 자산 (2026-08-22 실측)

| 자산 | 실재 | U5 관련성 |
|---|---|---|
| `backend/modules/` | auth · profile · place-data · accommodation-search · saved-accommodation · trip · itinerary-generation · itinerary-recalculation · planb-detection · weather-context · change-log · moderation · build **(13)** | **`archive`·`reflection` 2모듈 전무** — C12·C13 백엔드는 신규 |
| ⚠️ `visit_check`(V2.21) + 코드 | 테이블 실재. 코드는 **`itinerary-recalculation`(U4) 모듈**에 있다 — `domain/VisitCheck.kt` · `application/VisitCheckService.kt` · `adapter/in/web/VisitCheckController.kt` · `adapter/out/persistence/VisitCheckPersistence.kt` + 테스트 3 | **C12의 핵심 책임(방문 체크·actual 계층)이 이미 구현돼 있고, 소유 모듈이 정본과 다르다.** V2.21 주석이 명시: *"이 테이블은 U5 C12 Travel Archive 로 이관 예정이고, 확장은 U5 가 승계한다"* → **Q1** |
| 같은 마이그레이션 | 컬럼 = `trip_id`·`slot_key`("{date}#{poiId}" 경계키)·`poi_id`·`arrived_at`·`completed_at`·`skipped_at`·`source(AUTO_GEOFENCE\|MANUAL)`. **체류는 파생**(컬럼 없음). 유니크 `(trip_id, slot_key) WHERE slot_key IS NOT NULL` — 즉석 방문은 다건 허용 | **사진·메모 컬럼을 일부러 안 만들었다**(정본 G-U4-5: "여기서 미리 늘리면 이관 시 두 설계가 충돌한다") → U5가 확장 주체 |
| `openapi.yaml` `/trips/{tripId}/visits*` | **5경로 실재** — `POST /visits`(도착·즉석) · `GET /visits/days/{day}` · `PATCH /visits/{id}`(시각 보정) · `POST /{id}/complete` · `POST /{id}/skip`. 설명에 **US-REC-01 명시** | **US-REC-01은 백엔드 계약까지 완료.** U5는 사진·메모·조회 확장분만 |
| `change-log` 모듈 + `V2.11` | `ChangeLogEntry(tripId, actor, source_type, reason, before/after_snapshot, at)` · append-only(앱 롤 UPDATE/DELETE 회수) · 여행 삭제 시 캐스케이드 | **US-REC-04의 changelog 계층이 선재**. C12가 "changelog 소유"인데 실물은 독립 모듈 → **Q8** |
| `actual_route_point` | **U4 FD `domain-entities.md §3.3`에 설계됨 · 마이그레이션 없음**(V2.14~V2.27에 부재) | US-REC-03(GPS 기록)의 저장소. G-U4-5가 **"U5 C12가 승계, U5 설계에서 확정"**으로 남김 → **Q5** |
| `ai/docs/openapi.json` | 경로 **5종** — `/ai/v1/itinerary/{generate,validate,repair,alternatives,explanations}` + `/`·`/health` | **회고·요약·스타일 분석 표면이 없다.** C13은 AI 딥 모듈인데 AI 서비스 쪽 진입점 부재 → **Q2** (참고: 루트 CLAUDE.md의 "경계 3종"은 낡음 — 실측 5종) |
| `backend/docs/design/전체-최소-스키마.dbml` | 기록·회고(j) 블록에 **선재 설계** — `visit_record`(status·sync_state·checkin_type) · `photo(storage_key)` · `memo` · `gps_track(polyline·distance_m·steps)` · `reflection(day_date·content·stats)` · `trip_summary` · `style_analysis(account 단위·sample_trip_count)` | **실장(V2.21 `visit_check`)과 이름·모델이 다르다**(`visit_record` vs `visit_check`, `photo.storage_key`=S3 전제 vs 인셉션 로컬참조) → **Q3** + 선재문서 정합 갭 |
| `frontend/src/app/(tabs)/records.tsx` | **28줄 "기록 준비 중" 안내 셸**(TRIP-290) — `StateNotice` 패턴 | **밴드 `j` 라우트 0** — U3·U4와 동형, **프런트 설계가 본체** |
| `frontend/src/features/execution/` | `actualDistance.ts`·`useActualRoute.ts`·`slotProgress.ts`·`liveViewStore.ts` + `LiveItineraryScreen`·`LiveSlotCard`·`PlaceDetailScreen` | **실제 이동거리·실제 경로 산출이 U4 프런트에 이미 있다** — 회고 stats(`12km`)의 원천 후보. 재사용 대상 |
| `frontend/src/app/(tabs)/my.tsx` | 26줄 셸 | U6 소관(밴드 `l`) |

> **U3·U4와 다른 점**: 백엔드가 "통째 신규"가 아니다. **US-REC-01(방문 체크)은 실물이 이미 있고**, U4가 남긴 이관 지시(G-U4-5·V2.21 주석)를 U5가 집행해야 한다. 설계의 첫 일이 신설이 아니라 **승계·경계 정리**다.

---

## 라이브 Figma 밴드 `j` 대조 (2026-08-22 관측)

관측: 캔버스 `1228:1045` 행 **`y=14190`**, **프레임 17개 = 화면 코드 7 + 상태 변형 10**. **결번 없음**(j01~j07).
`j01`(default·offline·error·manual-checkin·sync-conflict 5) · `j02`(1) · `j03`(default·data-insufficient·empty·error 4) · `j04`(default·error 2) · `j05`(default·data-insufficient 2) · `j06`(default·no-photo 2) · `j07`(1).
`[보관]` 접두사·구세대 프레임 **없음** — 단일 세대다. 저작권 표기 `© Kakao`(신세대).
시각 확인(스크린샷): **`j01 default`·`j03 default` 2장**. 나머지 15프레임은 **노드 트리 이름 수준 매핑** — 남은 프레임의 시각 확인은 Step 3~6에서 수행한다.

| ID | 드리프트 | 문서 쪽 근거 | 라이브 |
|---|---|---|---|
| **D-U5-1** ★ | **회고 본문이 통계 재조합이라 "AI 생성"과 "폴백 기본 카드"가 구분되지 않는다** | US-REC-06 정상 = AI 초안 / 예외 = 실패 시 `방문 N곳·이동 Nkm·사진 N장` 기본 카드. C13 = **딥 모듈**(환각 금지·근거 기반) | `j03 default`의 서술 = **"오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요."** — 상단 stats(`4 방문·12km 이동·6 사진`)를 문장으로 옮긴 것. 템플릿으로 그대로 나온다. **화면상 AI를 부를 이유가 드러나지 않는다** → Q2의 실질 근거 |
| **D-U5-2** ★ | **기록의 쓰기 주체가 U4 화면과 겹친다** | C12가 사진·메모·방문체크 소유. U4 FD는 이 겹침을 **D-U4-4**로 이미 관측 | `i01`(U4 여행중 일정)에 사진 2장·메모 본문·`전체\|기록만` 필터·`[방문 완료][사진][메모]` 버튼. `j01`(U5 방문 기록)에도 **같은 3요소가 편집 가능한 형태로**(사진 `+` 타일·`메모를 남겨보세요` 입력·`즉석 방문 추가`). `i04`엔 "'기록' 탭에 자동으로 쌓여요" — j01을 읽기로 미는 문구인데 **j01은 쓰기 UI를 그대로 갖고 있다** → **Q6** |
| **D-U5-3** | **plan/actual/changelog 3종 구분이 지도 범례로 축약** | US-REC-04: "3종을 라벨·색상·아이콘으로 구분 표시" + 각 변경 이력은 **시각·전후 장소·사유** 포함 | `j02 기록 비교` = 지도(`실선 = 실제 동선 · 점선 = 계획(미방문) · 코랄 = 변경`) + 4행(`14:20 방문`·`15:40 방문`·`미방문 — 시간 부족`·`휴무로 대체 방문`). **사유는 있으나 "전후 장소"가 안 보인다** — `change_log_entry.before/after_snapshot`이 화면에 안 쓰인다 |
| **D-U5-4** | **US-REC-03(GPS 방문 기록) 전용 화면이 밴드 `j`에 없다** | US-REC-03: 동의 시 좌표·경로 자동 저장, 설정 OFF 시 즉시 중단 | 동선은 `j01`·`j03`·`j04` 지도에 그려지지만, 동의·ON/OFF는 **`l06 위치정보 동의`(밴드 l = U6)**. U5는 데이터 계층만 소유하고 토글 화면은 U6인지 확정 필요 → Q5 |
| **D-U5-5** | **US-REC-05(숙소·날짜 귀속) UI 근거가 마커 하나** | US-REC-05: 이동 숙박이면 **날짜별 기준 숙소를 구분**, 숙소 없는 날은 날짜만 | `j04`의 `숙 = 거점 숙소` 범례 + `bed` 노드. **이동 숙박(날짜별 다른 숙소) 표현이 없다.** 귀속은 데이터 규칙으로만 설계될 것 |
| **D-U5-6** | **US-REC-10(기록 기반 개인화) 화면 0** | US-REC-10: 누적 기록을 다음 여행 개인화 입력으로 사용 + **사용 항목·목적을 설정에서 안내** | 밴드 `j`에 없음. 안내는 `l05 설정`(U6), 소비처는 U3 일정 생성(**이미 설계 종료**) → 계약만 정의하고 U3 정정 상신할지 → **Q7** |
| **D-U5-7** | **US-REC-11(지난 여행 다시 보기) 전용 코드 없음** | US-REC-11: 마이페이지에서 여행 단위 목록 → 3종 구분 재열람 | `j07 여행 캘린더` 하단 `지난 여행 3개` 목록에 흡수. 마이페이지 진입(`l03`)은 U6. **"여행 단위 3종 재열람"은 `j02`가 받는 것으로 보이나 진입 경로가 명시돼 있지 않다** |
| **D-U5-8** | **정합 ✅ — 폴백이 전부 그려져 있다** | ADR-0011 침묵 실패 금지 · C13 PBT(입력 비어도 기본 카드 비지 않음) · INV-3(소요시간 비노출) | `j03` 4상태(default·**data-insufficient**·empty·error) · `j05 data-insufficient`(누적<10 게이지) · `j06 no-photo`(사진 없는 카드) · `j04 error` · `j01 error` — **US-REC-06·08·09·13의 예외가 화면으로 존재한다.** `j06`은 포맷 세그 3 + 캡션/해시태그 + `[이미지 저장][공유하기]`로 US-REC-13 그대로. `j05`엔 `근거가 된 방문 데이터` 링크(근거 제시 요구 충족) + `분석에 사용된 여행 3회 · 마지막 갱신 6.13`. **소요시간 표기 0건**(`12km`·`38km`·`1km` 거리만) |
| **D-U5-9** | **오프라인·동기화 충돌이 화면으로 확정돼 있다** | US-REC-12: 오프라인 로컬 저장 → 복구 시 자동 동기화, 충돌 시 사용자 선택 | `j01`에 **`offline`·`sync-conflict` 상태 프레임 실재**(+`manual-checkin`). dbml에도 `visit_record.sync_state{local,pending,synced,conflict}` 선재. **범위 축소(마지막 쓰기 승리) 여지가 화면 쪽에서 이미 닫혀 있다** → **Q4** |
| **D-U5-10** | 구조 관측 | — | 밴드 `j` **결번 없음**(j01~j07·17프레임). `j06`만 **BottomTab 없음**(전체화면 모달). 나머지 6화면 전부 `BottomTab`(기록 탭) + `fabSaved`(담은 곳 FAB — TRIP-489 계열 실장과 일치) |

---

## 실행 계획

- [x] 1. 유닛 컨텍스트 — `unit-of-work.md`(U5) · `story-map`(14 스토리) · `stories.md` US-REC-01~14 + 에픽 H 사진 저장 모델 註 · `components.md` C12·C13 · `component-methods.md`(`ArchiveFacade` 4메서드 · `ReflectionFacade` 3메서드) · `unit-of-work-dependency.md`(U5 ← U0·U1·U3·U4)
- [x] 1b. **기존 자산 조사** — backend 13모듈(archive·reflection 전무) · **`visit_check` 실장이 U4 모듈에 있음** · openapi `/visits` 5경로 · `change-log`+V2.11 · `actual_route_point` 미마이그레이션 · ai 표면 5종(회고 없음) · dbml 선재 7테이블 · frontend `records.tsx` 셸
- [x] 1c. **라이브 Figma 밴드 `j` 대조** — 17프레임 관측(스크린샷 2), 드리프트 **D-U5-1~10** (위 표)
- [ ] 2. **질문 Q1~Q9 답변 수집** (아래 §질문) — 모호한 답이 있으면 `u5-records-reflection-functional-design-clarification-questions.md` 생성 후 재확인
- [ ] 3. `business-logic-model.md` — **DEC-U5-\*** · 기록 3계층(plan/actual/changelog) 소유·승계 경계 · 방문→사진/메모 부착 흐름 · 회고 생성 파이프라인과 **폴백 사슬**(AI→규칙→기본카드) · 스타일 분석 임계(≥10) 판정 · 오프라인 큐·충돌 해소 흐름 · 갭 **G-U5-\***
- [ ] 4. `domain-entities.md` — `visit_check` **승계·확장**(사진메타·메모·status enum) · 신설(`visit_photo_meta`·`visit_memo`·`reflection`·`trip_summary`·`style_analysis`·`actual_route_point`) · 기존 재사용(`change_log_entry`·`trip`·`stay`·`visit_slot`) · **INV-U5-\*** · 이벤트(`VisitChecked`·`TripEnded`·`ReflectionReady`) · **소유 경계표**(U4↔U5↔U6)
- [ ] 5. `business-rules.md` — **BR-U5-\*** + **PBT-U5-\***(C13 불변식: 입력이 비어도 기본 카드가 비지 않는다 · 스타일 임계 경계) + 미결 **O-U5-\***
- [ ] 6. `frontend-components.md` — 라우트(밴드 j 7코드) · 컴포넌트 · testID · **리포 실제 FSD 층 배치 기준**(`pages/`·`features/record`·`features/reflection`·`shared/` 승격) — U3 재작성 선례 준수. Q9에서 제외로 답하면 생략
- [ ] 7. 정합 검증 — U4 사후 정정(G-U4-5 `actual_route_point` 승계 확정 · V2.21 주석의 이관 집행) · 인셉션 정정 상신 목록 · 선재 dbml(`visit_record` vs `visit_check`) 갭 기록
- [ ] 8. 완료 메시지 → **승인 게이트** → `audit.md`·`aidlc-state.md`

---

## 질문 (Step 3) — `[Answer]:` 칸을 채워 주세요

> 형식: `Q1=A Q2=B ...` 로 한 줄에 답해도 됩니다. **전부 추천안(A)으로 밀어도 됩니다.** 모르겠으면 `Qn=니가 판단해` 라고 쓰면 근거를 대고 결정한 뒤 미결(O-U5-\*)로 남깁니다.

### Q1. `visit_check` 실장의 소유 이관 — 어디까지 옮기나 (★ 핵심)

V2.21 주석은 "U5 C12로 이관 예정, 확장은 U5가 승계"라고 못박았지만, 실물 코드는 U4 `itinerary-recalculation` 모듈에 있고 openapi 경로도 `trips` 태그다.

- **A (추천)**: **`archive` 모듈 신설 + `visit_check` 소유 이관**. 코드 4파일 이동 + facade 재배치, 테이블은 그대로(마이그레이션 불필요). U4의 재계획은 `ArchiveFacade`를 통해 완료 슬롯을 읽는다(INV-U4-04 잠금 판정). — 정본대로이고, 사진·메모 확장이 U5 모듈 안에서 끝난다
- **B**: **현 위치 유지**. `archive` 모듈은 사진·메모·회고만 소유하고 방문체크는 U4 모듈이 계속 소유. — 코드 이동 0이지만 C12 책임이 두 모듈로 쪼개지고, 사진·메모가 방문 실적과 다른 모듈에 살게 된다
- **C**: **`archive` 신설 + 위임**. 테이블·persistence는 U4에 두고 `ArchiveFacade`가 U4 facade에 위임. — 이동 없이 경계만 세우지만 계층이 하나 늘어난다

`[Answer]`:

### Q2. 회고·요약·스타일 분석의 생성 주체 — AI를 어디서 부르나 (★ 핵심)

`ai/` 표면에 회고 계열 경로가 **없다**(5종 전부 itinerary). 그리고 D-U5-1대로 라이브 화면의 회고 본문은 통계 재조합 수준이다.

- **A (추천)**: **backend가 기존 `LlmGatewayPort`로 직접 생성**. `ai/` 신규 경계 없음 — 회고는 솔버가 필요 없는 순수 텍스트 생성이라 AI 서비스를 경유할 이유가 약하다. 실패 시 규칙 기반 문장 → 기본 카드로 2단 폴백
- **B**: **`ai/`에 `/ai/v1/reflection/{daily,summary,style}` 신설**. 프롬프트·트레이싱이 AI 패키지에 모이지만 **AI팀 협의·신규 계약·CI 스키마 강제**가 선행된다(U4 G-U4-3와 같은 블로커가 또 생긴다)
- **C**: **1차는 규칙 기반 템플릿만**(AI 호출 없음). D-U5-1대로 화면이 요구하는 문장은 템플릿으로 충분하고, US-REC-06의 "예외 = 기본 카드"가 이미 요구사항이라 품질 하한이 지켜진다. AI 생성은 재평가 트리거로 이연
- **D**: A + C 혼합 — 당일 회고는 규칙 기반, 여행 요약·스타일 분석만 LLM

`[Answer]`:

### Q3. 사진 저장 모델 — 인셉션 결정 유지 확인

인셉션(2026-07-12 결정)은 **로컬 자산 참조 + 서버는 메타데이터만**, 예외는 커뮤니티 공개 사진(U7). 그런데 선재 dbml `photo.storage_key`는 S3 업로드 전제로 보인다.

- **A (추천)**: **인셉션 유지** — 서버는 `visit_photo_meta`(로컬 자산 ID·촬영시각·EXIF 위치·연결 방문)만. dbml `photo.storage_key`는 **선재문서 갱신 대상**으로 기록. `ObjectStoragePort`는 U7 게이트까지 미개통
- **B**: **S3 업로드로 전환** — 멀티 디바이스·기기 변경 시 사진 유실 문제를 지금 해소. 비용·법적(EXIF 위치) 축이 커지고 U5 NFR이 두꺼워진다
- **C**: 로컬 참조 유지 + **공유 카드(j06) 렌더용 임시 업로드만** 허용

`[Answer]`:

### Q4. 오프라인·동기화 충돌(US-REC-12)의 범위

`j01`에 `offline`·`sync-conflict` 상태가 실재하고 dbml에 `sync_state{local,pending,synced,conflict}`가 선재다.

- **A (추천)**: **화면대로 전부 설계** — 로컬 큐 + `sync_state` 4상태 + 충돌 시 사용자 선택 UX. 화면이 이미 확정돼 있어 축소하면 그린 것을 못 쓴다
- **B**: **데이터 모델만 U5, 충돌 해소 UX는 이연** — `sync_state`와 큐는 정의하되 충돌은 "서버 승리 + 로컬 사본 보존" 규칙으로 단순화하고 선택 UI는 미결로
- **C**: 1차는 **온라인 전용**(오프라인 입력 차단 + 안내). 가장 얇지만 `j01 offline` 프레임이 사장된다

`[Answer]`:

### Q5. GPS 실제 경로(`actual_route_point`)의 소유·신설 — G-U4-5 집행

U4 FD가 설계했으나 **마이그레이션이 없다**(미실장). LEGAL-U4-04(여행 단위 파기)·LEGAL-U4-05(일회성 현재위치는 적재 금지)가 이미 U4 NFR에 있다.

- **A (추천)**: **U5가 신설·소유** — C12가 3계층 소유자이므로 `actual_route_point`도 U5 `archive` 모듈. U4 NFR의 법적 규칙(파기·적재 금지)은 **상속하고 재서술하지 않는다**. 동의 토글 화면(`l06`)은 U6
- **B**: **U4가 소유 유지**(Plan-B 기준점 계산에 쓰므로) + U5는 읽기만
- **C**: 1차 **미도입** — 동선은 `visit_check`의 방문 지점 연결선으로 근사하고(라이브 `j01` 지도가 실제로 그렇게 보인다), 연속 좌표 적재는 이연

`[Answer]`:

### Q6. 기록의 쓰기 주체 — `i01`(U4 여행중)인가 `j01`(U5 기록 탭)인가 (D-U5-2)

- **A (추천)**: **양쪽 쓰기 허용, 규칙은 U5가 소유** — 화면 둘 다 `ArchiveFacade`를 호출한다. 여행 중엔 `i01`이 자연스럽고, 끝난 뒤엔 `j01`뿐이라 한쪽을 막으면 경로가 사라진다(U4 G-U4-7이 이미 "완료 후 기록 진입점 없음"을 지적). U5 FD가 `i01`의 기록 요소도 **컴포넌트 재사용 대상으로 명시**
- **B**: **`i01`은 읽기 전용으로 정정** — 쓰기는 `j01`에만. `i04` 문구("기록 탭에 자동으로 쌓여요")와 일치하나 U4 화면 수정 요청이 발생한다
- **C**: 여행 중엔 `i01`만, 종료 후엔 `j01`만 (상태 기반 분기)

`[Answer]`:

### Q7. 스타일 분석·개인화(US-REC-09·10)의 소유와 U3 정정

`style_analysis`는 **account 단위**(여행 단위가 아님)라 U5 여행 기록과 생애주기가 다르다. 개인화 소비처인 U3는 **이미 설계 종료**.

- **A (추천)**: **U5가 산출·소유, 소비 계약만 정의**. U3 정정은 하지 않고 **인셉션 정정 상신 + G-U5-\* 갭**으로 남긴다(U3 재개는 별도 지시)
- **B**: U5가 산출하고 **U3 `business-logic-model`을 사후 정정**(U2·U3 사후 정정 선례 있음)
- **C**: 스타일 분석은 U5, 개인화 입력(US-REC-10)은 **범위 밖 이연**(U6 마이페이지·U3 재개 시)

`[Answer]`:

### Q8. `change_log_entry`의 소유 — 독립 모듈 유지?

C12가 "changelog 소유"인데 실물은 `change-log` 독립 모듈이고 U4가 이미 쓰고 있다.

- **A (추천)**: **독립 모듈 유지** — 실장 우선. C12는 **읽기 소비자**로 정의하고(US-REC-04 비교 화면), 정본의 "3계층 소유"는 *데이터 모델 소유*가 아니라 *열람 책임*으로 해석. 인셉션 정정 상신
- **B**: `archive`로 흡수 — 정본대로지만 U4가 쓰는 append-only 계약을 건드린다

`[Answer]`:

### Q9. 이번 유닛의 산출물 범위

- **A (추천 · "얇게")**: **FD 4종**(`business-logic-model`·`domain-entities`·`business-rules`·`frontend-components`) 후 **NFR Requirements·NFR Design은 SKIP 기록**(U3 선례 — 사유: U0·U1·U4 상속, 신규 정보 부재). Infrastructure는 자동 SKIP
- **B**: FD 4종 + **NFR Requirements 2종**까지(사진 저장·오프라인 큐가 새 축이라 얇게 재평가) → NFR Design은 그때 판단
- **C**: **U4와 동형 풀세트**(8종)
- **D**: FD 3종만(`frontend-components` 제외 — 프런트 착수 시점에 별도로)

`[Answer]`:

---

## 다음 단계

Q1~Q9 답변 수집 → (모호 시 명확화 파일) → Step 3~7 산출물 생성 → **완료 메시지·승인 게이트** → `audit.md`·`aidlc-state.md` 기록.
