# U5 Records & Reflection — Frontend Components

> **정본 = 리포 실제 층 배치**(2026-08-22 실측). `frontend/README.md`가 적는 이상적 구조가 아니라 **지금 코드가 서 있는 자리**를 기준으로 쓴다 — U3 `frontend-components.md`가 같은 이유로 재작성됐다(TRIP-173에서 `screens/containers/hooks/store`가 `pages/`로 이주해 사라졌다).
> **화면**: 라이브 Figma 밴드 `j` — 코드 7(j01~j07·결번 없음) · 상태 변형 포함 17프레임.
> **현재 상태**: `src/app/(tabs)/records.tsx` = **28줄 "기록 준비 중" 셸**(TRIP-290 · `StateNotice`). 밴드 `j` 라우트 **0** → **프런트가 이 유닛의 본체다.**

---

## 0. 층 배치 — 실재 선례에서 유도

| 층 | 실재 관례 | U5 적용 |
|---|---|---|
| `src/app/` | Expo Router. 깊은 경로는 `trips/[tripId]/itinerary/…` 꼴(실측 12라우트) | `trips/[tripId]/records/…` 로 같은 꼴 |
| `src/pages/<slice>/` | `index.ts` + `ui/` — 라우트당 슬라이스 1개 | 7 슬라이스 |
| `src/features/<domain>/{model,ui}/` | `model/`=순수 로직·훅, `ui/`=화면·카드 | **`record` · `reflection` 2개로 가른다** |
| `src/shared/` | `api`·`ui`·`map`·`location`·`date`·`storage`·`version`·`bootstrap` | `map` 확장 · **`photo` 신설** |
| `src/__tests__/` | `*Structure.test.ts` 구조 가드 (실측 60+) | 가드 5 신설 |

### 0.1 feature를 2개로 가르는 이유

`record`(기록: 방문·사진·메모·동기화)와 `reflection`(회고: 서술·요약·스타일)은 **실패 모드가 다르다.** 기록은 오프라인·권한·충돌로 실패하고, 회고는 생성 실패로 실패한다. 한 feature에 넣으면 `model/`이 두 종류의 폴백을 섞는다. 백엔드 모듈 경계(`archive` / `reflection`)와도 1:1로 맞는다.

---

## 1. 라우트 (`src/app/`)

| 라우트 | 화면 | 비고 |
|---|---|---|
| `(tabs)/records.tsx` | **`j07` 여행 캘린더 + 지난 여행 목록** | **셸 교체.** 기록 탭의 허브 — US-REC-14가 "'기록' 탭·마이페이지 양쪽 진입"이라 탭 루트가 캘린더다 |
| `trips/[tripId]/records/index.tsx` | `j01` 방문 기록 | 5상태(default·offline·error·manual-checkin·sync-conflict) |
| `trips/[tripId]/records/compare.tsx` | `j02` 기록 비교 | 계획｜실제｜변경 3탭 |
| `trips/[tripId]/records/reflection/[date].tsx` | `j03` 오늘의 회고 | 4상태(default·data-insufficient·empty·error) |
| `trips/[tripId]/records/summary.tsx` | `j04` 여행 요약 | 2상태(default·error) |
| `trips/[tripId]/records/share.tsx` | `j06` 공유 카드 | 2상태(default·no-photo) · **BottomTab 없음**(전체화면) |
| `records/style.tsx` | `j05` 여행 스타일 분석 | 2상태(default·data-insufficient) · **여행이 아니라 계정 단위**라 `trips/` 밖 |

> **탭 라우트와 같은 이름의 디렉토리는 공존한다 — 선례 있음.** `(tabs)/records.tsx`(→ `/records`)와 `app/records/style.tsx`(→ `/records/style`)는 충돌하지 않는다. 리포에 **정확히 같은 꼴이 이미 있다**: `(tabs)/explore.tsx` + `app/explore/places.tsx`·`app/explore/region.tsx`(실측). 단 `app/records/index.tsx`를 만들면 그때는 충돌한다 — 만들지 않는다.

> ⚠️ `j01~j05`·`j07`은 디자인상 **BottomTab을 그린다**(기록 탭 활성). 탭 그룹 밖 라우트에서 탭바를 어떻게 유지할지는 U3·U4 선례를 따른다 — 새 관례를 만들지 않는다.

---

## 2. `src/pages/` 슬라이스 (7)

| 슬라이스 | 라우트 | 조립하는 것 |
|---|---|---|
| `records-calendar/` | `(tabs)/records` | 월 캘린더 + 마킹 + 지난 여행 목록 + 빈 상태 안내 |
| `trip-records/` | `records/index` | Day 탭 + 지도 + 방문 카드 목록 + 즉석 방문 추가 + 동기화 배지 |
| `records-compare/` | `records/compare` | 3탭 세그 + 지도 레이어 + 라벨 행 목록 |
| `daily-reflection/` | `reflection/[date]` | Day 탭 + 진행중 칩 + stats + 지도 + 서술 + 사진 그리드 + 변경 행 + 편집 |
| `trip-summary/` | `records/summary` | 총계 stats + 지도 히어로 + 날짜 카드 + 공유 진입 |
| `share-card/` | `records/share` | 포맷 세그 3 + 카드 프리뷰 + 캡션/해시태그 + 저장·공유 |
| `travel-style/` | `records/style` | 반경 지도 + 카테고리 막대 + stat 2 + 근거 링크 |

---

## 3. `src/features/record/`

### `model/`

| 파일 | 책임 | 규칙 |
|---|---|---|
| `visitStatus.ts` | 세 timestamp → `UPCOMING\|IN_PROGRESS\|COMPLETED\|SKIPPED` **파생** | BR-U5-07 · INV-U5-01 |
| `useTripRecords.ts` | plan/actual/changelog 3종 합본 조회 | `GET /trips/{id}/visits/days/{day}` + 계획·변경 조인 |
| `useVisitCheck.ts` | 도착·완료·건너뜀·시각 보정 뮤테이션 | 실장 5경로 그대로 |
| `syncQueue.ts` | 오프라인 큐 — 적재·순서 재생·**멱등 수렴** | BR-U5-17~20 · **PBT-U5-F2** |
| `conflict.ts` | `updated_at` 비교로 충돌 판정, 선택지 2종 산출 | BR-U5-21·22 |
| `photoAttach.ts` | 로컬 자산 선택 → 메타 추출(촬영시각·EXIF) → 동의 게이트 | BR-U5-11·12 |
| `photoAvailability.ts` | 자산 접근 실패·타 기기 자산 판정 → **사유 문구** | BR-U5-14·15 · INV-4 |
| `stayAttribution.ts` | 날짜 → 기준 숙소 파생(없는 날 = 날짜만) | BR-U5-25·26 |
| `compareRows.ts` | 계획 vs 실적 → `실제\|계획(미방문)\|변경` 행 산출 | BR-U5-28·30 |

### `ui/`

`TripRecordsScreen` · `VisitRecordCard`(체크·시각·썸네일·메모 인라인) · `PhotoThumbStrip`(+ 타일) · `MemoInline` · `SpontaneousVisitButton` · `SyncBadge` · `ConflictSheet`(내 기기/서버 선택) · `RecordsCompareScreen` · `CompareSegment` · `CompareRow`(라벨 배지·미방문 칩·전후 장소) · `RecordsCalendarScreen` · `TripCalendarMonth` · `PastTripList` · `RecordGlyphs`

---

## 4. `src/features/reflection/`

### `model/`

| 파일 | 책임 | 규칙 |
|---|---|---|
| `useDailyReflection.ts` | 당일 회고 조회·생성 요청 | `source` 보존(BR-U5-33) |
| `reflectionFallback.ts` | **표시본 결정** — `edited ?? draft ?? 규칙문장 ?? 기본카드` | BR-U5-32·35 · **PBT-U5-F1** |
| `statsCard.ts` | `{visitCount, distanceKm, photoCount}` → 카드 모델. **빈 값도 0으로 채운다** | INV-U5-07 |
| `missingParts.ts` | 부분 데이터 누락 표기(사진 0 → 하이라이트 생략 사유) | BR-U5-34 |
| `useTripSummary.ts` · `useStyleAnalysis.ts` | 요약·스타일 조회 | |
| `styleThreshold.ts` | 누적 방문 <10 → 진행 게이지 + "정식 아님" | BR-U5-40·41 · **PBT-U5-F4** |
| `shareCard.ts` | 포맷(9:16·1:1·4:5)·캡션·해시태그 조립, 대표 사진 없으면 지도 카드 | BR-U5-46·47 |

### `ui/`

`DailyReflectionScreen` · `LiveProgressChip`(`여행 2일차 진행 중 · 지금까지 4곳`) · `ReflectionStatsRow` · `NarrativeBlock`(편집 진입) · `ReflectionPhotoGrid` · `ChangeSummaryRow` · `TripSummaryScreen` · `DayHighlightCard` · `TravelStyleScreen` · `CategoryBarList` · `StatTile` · `EvidenceLink`(`근거가 된 방문 데이터`) · `ShareCardScreen` · `ShareCardPreview` · `FormatSegment`

---

## 5. `src/shared/` 변경

| 대상 | 변경 | 왜 |
|---|---|---|
| `shared/map/KakaoMapView` | **레이어 3종 확장** — 실선(실제)·**점선(계획 미방문)**·코랄(변경) + 방문 순서 번호 핀 + 사진 썸네일 핀 + **반경 원**(`j05`) | U3가 이미 "다중 핀·폴리라인·center 갱신 미지원 → 확장 필요"로 정정했다. `j02`·`j05`가 그 위에 레이어·원을 더 요구한다 |
| `shared/photo/` | **신설** — 로컬 앨범 접근·자산 메타 추출·자산 유효성 | 기존에 없다. `expo-image-picker`/`expo-media-library` 계열 **신규 의존성 + prebuild 영향**(U4 `expo-task-manager` 선례처럼 **EAS 재빌드 1회**가 필요할 수 있다 — 착수 전 확인) |
| `shared/location` | 재사용(U4 신설분) — EXIF 저장 동의 게이트 | 신규 없음 |
| `shared/storage` | 재사용 — 오프라인 큐 영속화 | 신규 없음 |
| ~~`features/execution/model/actualDistance.ts` 재사용~~ → **`shared/geo/`로 승격** | ⚠️ **2차 셀프 검수 정정** — `features/record`가 `features/execution`을 import하는 것은 **ESLint `import/no-restricted-paths`로 금지**돼 있고 `src/__tests__/importBoundary.test.ts`가 그 규칙이 살아 있는지까지 잠근다("features/\* may not import another feature"). 따라서 "이동 대상 아님"은 **틀렸다** — `accumulateDistanceKm`·`GeoPoint`를 `shared/geo/`로 옮겨야 두 feature가 함께 쓴다 | U4 자산을 건드리므로 **U4 프런트 티켓과 조율 필요**(G-U5-14). `useActualRoute()`는 아직 `points: []` 고정이라 실제 경로 표시는 degrade 상태 유지(BR-U5-43 `VISIT_LINE`) |

---

## 6. 구조 가드 (`src/__tests__/`)

| 가드 | 잠그는 것 |
|---|---|
| `recordsStructure.test.ts` | 라우트 7 · pages 7 슬라이스 · feature 2분할 배치 |
| `recordPhotoBinaryGuard.test.ts` | **사진 바이너리 업로드 심볼 금지** — `storage_key`·multipart·`uploadForCommunity` 호출부가 그래프에 없다(BR-U5-11·16) |
| `reflectionFallbackStructure.test.ts` | 표시본 결정이 `reflectionFallback.ts` 한 곳에서만 일어난다(화면이 자체 폴백을 만들지 못하게) |
| `recordsDurationStructure.test.ts` | **예측 소요시간 심볼 금지**(INV-3) — 기존 `executionDurationStructure`·`liveTimeStructure` 선례. ⚠ **`travel-style`의 평균 체류(`avgDwellMinutes`)는 예외로 허용**한다(DEC-U5-13) — 가드가 심볼 이름만 보고 막으면 그린 화면을 못 만든다. 허용 심볼을 명시적으로 화이트리스트에 둘 것 |
| `syncQueueIdempotency.test.ts` | 큐 재생 경로가 `syncQueue.ts` 밖에 없다 |

> 기존 `noStepCountStructure.test.ts`(걸음 수 금지 · BR-U4-41)는 **그대로 유효**하다 — 선재 dbml `gps_track.steps`가 이 가드와 충돌한다(G-U5-3).

---

## 7. 폼 검증 (UX 사본 — 권위는 서버)

| 입력 | 클라 검증 | 서버 권위 |
|---|---|---|
| 메모 | 2000자 상한·공백만이면 저장 안 함 | `visit_memo.text` |
| 시각 보정 | 도착 ≤ 완료 · 미래 시각 경고 | BR-U5-05(409) |
| 회고 수정 | 수정본을 비우면 초안 카드로 복원 | BR-U5-35 |
| 캡션·해시태그 | 길이·해시태그 개수 | 서버 저장 없음(온디바이스) |

---

## 8. testID (규약 `{feature}-{screen}-{role}`)

`record-trip-day-tab` · `record-trip-visit-card` · `record-trip-photo-add` · `record-trip-memo-input` · `record-trip-spontaneous-add` · `record-trip-sync-badge` · `record-conflict-choice-local` · `record-conflict-choice-server` · `record-compare-segment` · `record-compare-row` · `record-calendar-month` · `record-calendar-past-trip` · `reflection-daily-narrative` · `reflection-daily-edit` · `reflection-daily-stats` · `reflection-daily-photo-grid` · `reflection-summary-stats` · `reflection-summary-day-card` · `reflection-style-bar` · `reflection-style-evidence` · `reflection-share-format-seg` · `reflection-share-save` · `reflection-share-export`

> ⚠ **2026-09-01 — 위 회고 testID 는 문장 모델 전제다.** 산출물이 카드로 확정되면서(G-U5-4 해소 ·
> business-logic-model §5.3) `reflection-daily-narrative` 는 장면 단위(`cover`/`scenes[]`)로 갈릴 자리다.
> **여기서 새 이름을 짓지 않는다** — `j03` 화면이 아직 없어(실측: 프런트에 `features/reflection` 부재)
> 지금 지으면 근거 없이 계약을 좁힌다. 화면 설계와 함께 정한다.

---

## 9. PBT (`model/` 순수 함수 · fast-check)

| ID | 성질 |
|---|---|
| **PBT-U5-F1** | 임의의 회고 응답(초안·수정본·통계 결측 조합)에 대해 **표시본 카드가 항상 비어 있지 않다** — `cover` 가 있고 `scenes` 가 0개가 아니다 |
| **PBT-U5-F2** | 임의의 큐 시퀀스를 두 번 재생해도 **결과 상태가 같다**(멱등) |
| **PBT-U5-F3** | 위치 동의가 없으면 어떤 입력에도 **EXIF 좌표가 전송 페이로드에 실리지 않는다** |
| **PBT-U5-F4** | `sampleVisitCount` 9↔10 경계에서 임시 미리보기가 **정식 분석으로 승격되지 않는다** |

---

## 10. 시각 확인 상태 (정직 표기)

**5프레임만 스크린샷으로 확인**했다 — `j01 default` · `j02` · `j03 default` · `j04` · `j05`.
나머지 **12프레임**(`j06` 2 · `j07` 1 · `j01` 변형 4 · `j03` 변형 3 · `j04 error` · `j05 data-insufficient`)은 **노드 트리 이름 수준 매핑**이다(Figma MCP 호출 상한). 위 표의 해당 화면 구성은 **이름 기반 추정**이므로, 프런트 티켓 착수 전 시각 확인이 선행돼야 한다. 계획서 단계에서 이름만으로 세운 드리프트 1건(D-U5-3)이 스크린샷으로 **철회**된 전례가 이번 사이클에 이미 있다.
