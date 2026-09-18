# U3 AI Itinerary Generation — Tech Stack Decisions

> **방침**: 상속 우선. U0·U1이 확정한 스택을 그대로 쓰고 **U3가 실제로 요구하는 델타만** 기록한다.
> **작성 근거 (2026-08-07)**: 사용자 지시 "ai랑 백엔드 확인해보고 그거를 우선시" — `ai/`·`backend/`·`frontend/` 실장을 직접 확인한 결과를 적었다. **초안 단계의 "델타 없음" 판단은 실장 확인으로 뒤집혔다**(아래 델타 3건).

---

## 1. 상속 (변경 없음)

| 계층 | 스택 | 확인 |
|---|---|---|
| backend | Spring Boot + Kotlin 모듈러 모놀리스 · PostgreSQL · Flyway(SQL-first, forward-only) · actuator | `modules/itinerary-generation` 이미 이 구조로 실재 |
| AI | Python · OR-Tools · Anthropic API 직접(**Bedrock 아님** — AI-D06) · 포트/어댑터 | `ai/src/trippilot/` |
| frontend | Expo + Expo Router · TypeScript strict · TanStack Query(서버 상태) · Zustand(UI 상태) · RHF+Zod(폼) · NativeWind | `frontend/package.json` |
| 지도 | **카카오 지도 JS SDK를 `react-native-webview`로 임베드** — `@/shared/map/KakaoMapView` | 실장 확인. `react-native-maps`·MapLibre·Mapbox는 **미도입** |
| 제스처·시트 | `react-native-gesture-handler` 2.28 · `react-native-reanimated` 4.1 · `@gorhom/bottom-sheet` 5.2 | 이미 있음 — **드래그 재정렬·핀 상세 시트는 추가 의존 불필요** |
| 관측 | `@sentry/react-native`(클라) · AI 관측 레코드 4종 · backend actuator | 이미 있음 |
| 네트워크 상태 | `@react-native-community/netinfo` | 이미 있음 — 오프라인 **감지**는 가능 |

## 2. U3 델타

### 델타 1 — `KakaoMapView` 확장 (필수)

**실장 현황**: `KakaoMapViewProps = { center, onMapMessage }` 뿐이다. 메시지 프로토콜도 `PIN_DROP` · `GEOCODE_OK` · `GEOCODE_FAIL` 3종이다. 게다가 **`source.html`이 마운트 시점 `center`로 한 번만 조립되고 이후 `center` 변경에 반응하지 않는다**(TRIP-199 5-a 주석).

**U3가 요구하는 것**(밴드 h 실측):
- `h11`·`h26` — **번호 핀 다중 표시**(1~5) + **동선 폴리라인**
- `h25` — 지도 미니뷰 + "지도 크게 보기"
- `h32` — **지도 스크러버**(슬롯 이동에 따라 지도 초점 이동) → **center 갱신이 필수**
- `h23` — 핀 탭 → 슬롯 상세 시트 → **핀 선택 메시지 필요**

**결정**: 새 지도 라이브러리를 도입하지 **않는다**. 기존 `KakaoMapView`를 확장한다 — `markers[]`(번호·좌표) · `polyline[]` · **`center` 갱신 반영** · 메시지 `MARKER_TAP` 추가. WebView 1장 유지(PERF-U3-03).

> 근거: 지도 벤더를 바꾸면 U1의 숙소 등록·핀 지정(`e05`)이 함께 흔들린다. 확장이 교체보다 싸다.
> **참고**: 라이브 Figma 시안은 OSM/CARTO 타일로 그려져 있으나 **실장은 카카오**다. 벤더 불일치는 U1에서 이미 결정된 사항으로 보고 따르되, 타일 저작권 표기 문구는 실장 기준으로 맞춘다.

### 델타 2 — 영속 로컬 저장소 (조건부)

**실장 현황**: `@react-native-async-storage/async-storage` 없음, TanStack Query persist 플러그인 없음. `expo-secure-store`는 소량 비밀용.

**결정**: **OFFLINE-U3-01(확정 일정 로컬 캐시)을 구현할 때** 저장소 의존을 추가한다. 후보 = `@react-native-async-storage/async-storage` + `@tanstack/query-async-storage-persister`(이미 쓰는 TanStack Query와 정합). **U3 화면 구현과 분리 가능**하므로 별도 티켓으로 다뤄도 된다.

> 지금 넣지 않는 이유: 확정 일정 캐시는 여행 중(U4) 시나리오에서 값을 하고, U3 화면 자체는 온라인 전제로 완결된다.

### 델타 3 — 가상화 리스트 (도입 안 함 · 트리거만)

**실장 현황**: `@shopify/flash-list` 없음. 기본 `FlatList`만.

**결정**: **도입하지 않는다.** 하루 5~10슬롯 × 며칠 규모에는 기본 리스트로 충분하다. **슬롯 200개 초과 실측 시** 재검토(PERF-U3-02).

## 3. backend 델타

| 항목 | 결정 |
|---|---|
| rate limit 라이브러리 | **도입하지 않는다.** COST-U3-01(진행 중 세션 거부)은 **기존 `GenerationSession` 상태로 구현** 가능하다 — bucket4j 같은 의존을 추가할 이유가 없다. COST-U3-03 일일 회차는 카운터 컬럼 + 설정값으로 충분 |
| `visit_slot.placement_reason` 컬럼 | **필요**(U2 O-U2-2 · U3 G-U3-7 승계) — `explanations` 영속 경로 부재. Flyway 마이그레이션 별도 티켓 |
| `ItineraryStatus` 역전이 | **필요**(BR-U3-29) — 현재 PLANNED→CONFIRMED 단방향. 확정 후 재편집 허용을 위해 도메인·DB 제약 확인 필요 |
| `itinerary_revision` 테이블 | **신설**(domain-entities §2.1). jsonb 스냅숏 + 정리 정책(DATA-U3-01) |
| actuator 노출 | 현재 `health,info`만. OBS-U3-02 지표 발행 시 노출 범위 확장 여부를 그때 결정(운영 보안과 함께) |

## 4. AI 델타

**없음.** U3는 AI 경계를 소비만 한다. `proposeSlotCandidates` 개통(U2 §7.1)은 **계약 추가**이지 스택 변경이 아니다. C1 토큰·타임아웃 설정(`max_tokens=1024` · `timeout_sec=2.5`)도 그대로 승계한다.

## 5. 이연 (Infrastructure Design 몫)

U0·U1과 동일하게 배포·클라우드 결정은 이연한다 — 지도 JS 키 배포 방식, 재생성 회차 상한의 저장 위치(설정 서버 vs DB), 관측 지표 수집 파이프라인.
