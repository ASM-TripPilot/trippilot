# U1 Accommodation & Trip Setup — Frontend Components

> **아키텍처 정본 = `frontend/README.md`.** 층 구조·폴더 규약을 이 문서에 옮겨 적지 않는다 — 사본은 갈라진다. 이 문서가 정하는 것은 **컴포넌트의 책임·상태·서버 연동**이지 그것이 놓일 폴더가 아니다. 상태 관리 스택(TanStack Query=서버 상태 · Zustand=UI 상태 · RHF+Zod=폼 · NativeWind)과 testID 규약 `{feature}-{screen}-{role}`도 그 정본을 따른다.
> **클라이언트 검증은 전부 UX 사본** — 판정 정본은 서버(`business-rules.md`).
> 화면 정본 = 라이브 Figma 밴드 d·e·g. 상태 변형은 **구 프레임의 동작·문구만 취하고 레이아웃은 신 default 기준으로 재해석**(Q14=A).
>
> **서버 연동 열 표기(2026-07-29 정정)**: 경로 정본은 언제나 `backend/docs/design/openapi.yaml`이고 아래 표는 그 사본이다. `⚠️ 계약 미존재`는 **이 문서가 계약보다 앞서 나간 자리** — 백엔드 계약·모듈이 생기기 전까지 프론트가 붙을 수 없다(후속 티켓 C 대기). 정정 전에는 존재하지 않는 경로가 실재하는 것처럼 적혀 있었다.

## 1. 라우트 골격 (U1이 추가하는 부분)

```text
src/app/
  (tabs)/
    explore.tsx                # d01 탐색 랜딩 — U0의 빈 셸을 U1이 채움
  explore/
    region.tsx                 # d1b·e00 지역 선택 (purpose 파라미터로 분기)
    destination/[region].tsx   # d03 목적지 상세
    places.tsx                 # d04 장소 탐색·담기
    saved-places.tsx           # d02 담은 장소
    community.tsx              # d05 여행자 일정 — 1차는 자리만(BR-U1-05)
  stays/
    index.tsx                  # e02 숙소 검색 결과
    [stayId].tsx               # e03 숙소 상세 (+ OTA 선택 바텀시트)
    saved.tsx                  # e04 저장한 숙소
    register.tsx               # e05 숙소 등록 (3탭)
  trips/
    new/
      _layout.tsx              # 2단계 위저드 셸(진행 표시 1/2·2/2)
      step1.tsx                # g01 여행지·꼭 갈 곳·기간·인원
      step2.tsx                # g02 거점 숙소
    [tripId]/
      bases.tsx                # 거점 관리·커버리지 해소 시트
      must-visits.tsx          # 필수 방문지 관리
```

- 위저드·등록·상세는 **몰입 화면**이므로 탭바를 숨긴다(U0 BR-U0-29 상속).

## 2. 탐색 컴포넌트 (밴드 d · C7)

**[정정 · TRIP-184 준비, 2026-08-02] 담기 계약이 생겼다 — 이 절 머리의 "계약 미존재" 경고는 담기·장소 목록에 한해 해소됐다.** `origin/develop` openapi 실측: `GET /places?region&category` → `Place[]` · `POST /saved-places`(409=이미 담음 · 404=POI 없음/비-ACTIVE) · `GET /saved-places` → `SavedPlace[]` · `DELETE /saved-places/{savedPlaceId}`(타 계정 404). 백엔드도 TRIP-212(place-data 코어)·TRIP-214(saved_place + poi_snapshot 동결) 완료. **경로 이름이 이 문서가 앞서 적어둔 것과 다르다** — `/places/{poiId}/save` → `POST /saved-places`, `/me/saved-places` → `GET /saved-places`. 아래 표를 그에 맞게 정정했다.
> 이전 문장(2026-07-29 시점에는 사실): "장소 도메인은 openapi 경로 0개·백엔드 모듈 0개 — 후속 티켓 C 대기". **탐색 랜딩·지역·목적지 상세(`/explore/landing`·`/regions`·`/regions/{region}`)는 여전히 계약 미존재다.**

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `ExploreLanding` | 4구획(여행지 칩 · 묵을 곳 · 가볼 곳 · 여행자 일정) + 하단 "담은 곳 N곳 · 여행 만들기" | 구획별 독립 쿼리(하나 실패해도 나머지 렌더) | ⚠️ 계약 미존재 (`/explore/landing`) |
| `RegionPicker` | **d1b·e00 공용** — `purpose: 'trip' \| 'stay'`로 카피·다음 목적지 분기(BR-U1-07) | props: purpose | ⚠️ 계약 미존재 (`/regions`) |
| `DestinationDetail` | 인기 스팟 그리드(담기 토글) · "이 지역에서 묵을 곳" · "{지역}으로 여행 만들기" | — | ⚠️ 계약 미존재 (`/regions/{region}`) |
| `PlaceExplorer` | **d04** 검색바 + 카테고리 칩 + **정렬 칩 3종**(요즘 담긴 순·지금 뜨는 순·가까운 순) · 2열 사진 그리드 카드(♥ 토글 · 담긴 카드는 `♥ 담음` 배지) · 하단 고정 CTA `③ 담은 장소로 여행 만들기` | Zustand: 담기 낙관적 업데이트 | `GET /places` · `POST /saved-places` · `DELETE /saved-places/{savedPlaceId}` |
| `SavedPlaceList` | **d02** 헤더 `담은 장소` + 부제 `6곳 · 마음에 든 순서대로` · 순번 배지(1..N) + 썸네일 + 이름 + 📍지역구 + 태그 칩 1개 + ♥(해제) · 하단 CTA `이 장소들로 여행 만들기`. empty: `마음에 드는 곳을 담아 보세요` / `부산 인기 장소를 둘러보고 ♥로 담으면 여기에 모여 바로 여행이 돼요` / CTA `장소 둘러보기` | — | `GET /saved-places` · `DELETE /saved-places/{savedPlaceId}` |
| `CommunityTeaser` | **1차 자리만** — 섹션 헤더 + 준비 중 안내. 실데이터·상세 라우팅 없음(BR-U1-05) | — | — |

### 2-1. 라이브 Figma 실측 노드 (2026-08-02 · TRIP-184 준비)

밴드 d 행(y=5881)의 프레임을 라이브로 전수 확인했다. 화면 상세의 정본은 언제나 라이브이고 아래는 **어느 노드를 열어야 하는지의 색인**이다.

| 화면 | 노드 | 변형 |
|---|---|---|
| d01 explore-landing | `1672:1183` | default 1개 |
| **d02 place-save** | `1693:1183` / `1695:1183` | **default · empty 2개** |
| d03 여행지 상세 | `2091:2020` | default 1개 |
| **d04 장소 목록** | `1692:1183` | **default 1개뿐**(e02와 달리 상태 변형 프레임이 없다) |
| d05 통합 검색 결과 | `2176:2336` | default 1개 |
| **d06 장소 상세** | `1907:1083` | default 1개 — **이 문서에 행이 없는 화면** |
| d1b 지역 선택 | `1834:2283` | default 1개 |

**d06은 담기 화면이 아니다.** 열어보면 `이 일정에 추가` CTA · "이 장소를 추천한 이유"(AI 추천 근거) · "여기서 현재 위치서 560m · 반경 내"로 **일정 생성·여행중 맥락**이고 ♥ 담기 CTA가 없다. 즉 US-EXPL-04(담기) 소관이 아니다. 이 관측은 `audit.md` 2026-07-29T05:10:00Z 항목이 남긴 **후속 B(장소 상세 스토리 신설 — Inception 변경이라 승인 게이트 필요)**의 근거를 보강한다. 이 문서에 행을 추가하지 않은 이유가 그것이다 — 스토리 없이 컴포넌트만 늘리면 근거 없는 구현이 된다.

### 2-2. 라이브 Figma ↔ 계약 드리프트 5건 (2026-08-02 실측 · 결정 포함)

**아래는 전부 "화면이 계약보다 앞서 나간" 자리다.** 결정은 TRIP-184 서브태스크 분해 시점에 사용자가 확정했다.

| # | 드리프트 | 근거 | 결정 |
|---|---|---|---|
| F-1 | **사진이 계약에 없다** — d04는 2열 사진 그리드, d02는 썸네일 리스트인데 `Place` 스키마에 `imageUrl`이 없다(poiId·nameKo·category·lat·lng·region·openingHours·savedCount·dataStatus) | openapi `components.schemas.Place` | **계약 보강 요청**(TRIP-184 [BE] 칸). FE는 사진 자리를 두고 계약이 오면 연결 |
| F-2 | **정렬 축 3종** — d04에 `정렬: 요즘 담긴 순(활성) · 지금 뜨는 순 · 가까운 순`. `GET /places` 파라미터는 `region`·`category`뿐 | openapi `/places` | **클라이언트 처리** — `savedCount` 내림차순 클라 정렬. `가까운 순`은 좌표 파라미터가 없어 **미노출**(미충족 기록) |
| F-3 | **검색이 계약에 없다** — d04 검색바 placeholder `장소 · 명소 · 맛집 검색` + 필터 아이콘. US-EXPL-04 정상 AC는 "카테고리 필터·**검색**" | openapi `/places` · stories.md US-EXPL-04 | **클라이언트 처리** — 받아온 목록에서 이름 부분일치 필터 |
| F-4 | **카테고리 값 불일치** — 칩은 6종(전체·명소·맛집·카페·야경·자연), 계약 `PoiCategory` enum은 7종(…쇼핑·문화). 게다가 d04 카드 라벨에 **`바다`**(해운대 해변), d02 태그에 `감성 골목`·`미식` 등 enum에 없는 값이 그려져 있다 | openapi `PoiCategory` · d04/d02 라이브 | **계약 enum이 정본** — 칩은 enum 7종으로 그린다(Figma 6칩과 다름). `바다`는 Figma 표기일 뿐 도메인 값이 아니다 |
| F-5 | **태그 필드가 없다** — d02 카드마다 태그 칩 1개(감성 골목·야경·카페·바다·명소·미식). `Place`에 `tags` 없음 | openapi `Place` · d02 라이브 | **계약 보강 요청**(같은 [BE] 칸). 계약 오기 전까지 태그 칩 미렌더 |

**BR-U1-06 표기 위치도 어긋난다** — 이 문서·BR은 "N 저장"·"지금 급상승" 배지를 말하는데, 라이브 d04에는 "N 저장" 배지가 없고 정렬 칩 `지금 뜨는 순`으로, d05 카드에는 `🔥 지금 급상승`으로 나타난다. **집계 실패 시 배지를 생략할 뿐 카드를 숨기지 않는다**는 BR-U1-06의 실질(파생 집계는 장식)은 그대로 유효하다.

## 3. 숙소 컴포넌트 (밴드 e · C3·C4·C5)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `StaySearchResult` | 헤더 "{지역} · 날짜 미정 · N곳" · 필터 칩(가격대·지역·필터) · 카드 목록 | 필터 Zustand | `GET /stays/search` (region·amenity·stayType — 날짜·인원·정렬 없음: BR-U1-10/15) |
| `StayCard` | 이름 · **최저가 스냅숏(`120,000원~ · 1박`)** · 거리 · ♥ 토글. 스냅숏 없으면 "가격 미확인"(BR-U1-14) | props: stay | `POST /saved-stays` · `DELETE /saved-stays/{savedStayId}` |
| `PartialFailureBanner` | "일부 숙소 정보를 불러오지 못했어요 · 다시 시도"(BR-U1-17) | props: onRetry | — |
| `FilterZeroNotice` | 0건을 만든 필터를 지목 + 완화 제안(BR-U1-16). **[구현 결정 · TRIP-182, 2026-07-30]** 실제 구현은 아래 `StateNotice`의 얇은 래퍼(자체 마크업 없음) — 근거: `frontend/src/features/stay/ui/StaySearchScreen.tsx`의 `FilterZeroNotice` 로컬 함수 | props: culpritFilters | — |
| `StateNotice` | **[구현 결정 · TRIP-182, 2026-07-30]** `empty`·`filter-zero`·`error` **3상태 공용** 안내 블록(원형 배지 + 제목 + 부제 + 버튼 N) — 이 문서 승인(2026-07-23) 당시엔 없던 컴포넌트, 세 상태를 하나로 묶은 것은 요구사항이 아니라 구현 단계의 부품 분해 결정이다. 근거: `frontend/src/features/stay/ui/StateNotice.tsx` | props: icon·title·description·actions[](`variant: 'outline'\|'filled'\|'link'`)·dashed? | — |
| `SkeletonList` | **[구현 결정 · TRIP-182, 2026-07-30]** `loading` 상태 전용 — 라벨(`숙소를 모으는 중`) + 스켈레톤 카드 2장. 이 문서 승인 당시 loading 대응 컴포넌트 행이 없었다(§3 공백). 근거: `frontend/src/features/stay/ui/SkeletonList.tsx` | — | — |
| `StayDetail` | 사진 · 이름 · 라이브 정확가 · 편의시설 · 지도 · 제휴 고지 · CTA 2종 | — | ⚠️ 계약 미존재 (`/stays/{id}` · `/stays/{id}/live-price`) |
| `OtaChoiceSheet` | OTA별 이름·가격 라디오 + 제휴 고지 + [이동](BR-U1-30·31) | props: options | ⚠️ 계약 미존재 (`/stays/{id}/outbound` → 딥링크) |
| `AddToTripSheet` | `[일정에 추가]` — 여행 선택 → 거점 배정. 여행 없으면 생성으로(BR-U1-25) | — | `POST /trips/{tripId}/bases` |
| `SavedStayList` | "저장한 숙소 N곳 · ♥로 담아둔 곳" · `거점` 배지(파생) · "다른 숙소를 거점으로 지정" | — | `GET /saved-stays` |
| `StayRegisterTabs` | 3탭(지도 검색 · 링크 붙여넣기 · 핀 지정) 공용 셸(BR-U1-21) | Zustand: 탭·후보·좌표확정 | — |
| ├ `MapSearchTab` | 검색 → 후보 다중 시 라디오 선택 → 지도 확인 | RHF+Zod | `GET /stays/geocode` |
| ├ `LinkPasteTab` | OTA URL 파싱. 실패 시 원문 유지 + 타 탭 유도(BR-U1-24) | RHF+Zod: URL 형식 | ⚠️ 계약 미존재 (`/stays/parse-link`) |
| ├ `PinTab` | 지도 롱프레스로 핀 지정 → 역지오코딩 | — | ⚠️ 계약 미존재 (`/stays/reverse-geocode`) |
| └ `StayDateFields` | 체크인/아웃 · "N박 · 나중에 바꿀 수 있어요" | Zod: `checkOut > checkIn`(UX 사본) | `POST /saved-stays` |
| `MapApiFallback` | 지도 API 실패 시 핀 지정 폴백 안내(BR-U1-23) | — | — |

> **문구 소유자 — `filterZeroReasons` 코드→표시명 변환.** **[구현 결정 · TRIP-182, 2026-07-30]** 계약(`filterZeroReasons: string[]`)은 `stayType`·`amenity:오션뷰` 같은 기계 코드만 준다. 한글 표시명으로 바꾸는 책임은 **프론트가 소유**한다 — 근거: `frontend/src/features/stay/model/filterReasonLabel.ts`(축 이름 사전 2줄 + 모르는 축은 코드 그대로 폴백). 이 문서 승인 당시 이 변환의 소유자가 정해져 있지 않았다(공백). 서버가 표시명 필드를 새로 주는 것으로 이 소유권이 바뀌면 이 문단부터 갱신한다.

## 4. 여행 생성 컴포넌트 (밴드 g · C6)

| 컴포넌트 | 책임 | state / props | 서버 연동 |
|---|---|---|---|
| `TripWizardLayout` | 2단계 진행 표시(1/2·2/2) · 뒤로가기 시 입력 보존 | Zustand: 위저드 드래프트 | — |
| `DestinationChips` | 다중 도시 칩(`부산 · 2박 ×`) + "도시 추가"(BR-U1-34) | RHF: 배열 필드 | ⚠️ 계약 미존재 (`/regions`) |
| `MustVisitSeedStrip` | 담은 곳에서 온 '꼭 갈 곳' 썸네일 · 개별 ×· "+N" · "더 담기"(BR-U1-37) | — | **[정정 2026-08-02]** `GET /saved-places`(시드 원본) · `/trips/{tripId}/must-visits` — 둘 다 실재한다. 이전 표기 "⚠️ 계약 미존재(`/me/saved-places`) — C 대기"는 해소 |
| `PeriodPicker` | 프리셋 칩(이번 주말·다음 주말·1박2일·3박4일) + 날짜 범위. 프리셋은 자동 채움일 뿐 수정 가능(BR-U1-36) | Zod: `end ≥ start`(UX 사본) | — |
| `PartyPicker` | 인원 스테퍼 + 동반 유형(혼자·친구·연인·가족)(BR-U1-39) | — | — |
| `PreferencePrefillCard` | "당신 취향으로 맞췄어요" + 칩 + [바꾸기] → 여행 단위 오버라이드(BR-U1-38) | — | `GET /me/preferences` |
| `BudgetInputField` | **[구현 결정 · TRIP-207, 2026-08-02]** 예산 총액 입력(선택) — 온보딩 취향 러프값(`PreferenceView.budget.rawAmount`) 프리필 + "온보딩에서 고른 '{티어}({구간})' 범위로 채웠어요" 안내 문구, 비우면 `budgetTotal` 키 자체를 전송하지 않는다(BR-U1-38 덮어쓰기 허용). 이 문서 승인 당시 §4 표에 예산 컴포넌트 행이 없었다(공백) — TRIP-182의 `StateNotice`·`SkeletonList` 구현 결정 소급 기록 방식을 따른다. 근거: `_workspace/20260802-trip207-budget-block/01_spec-analyst_brief.md` §3·§7-④ | Zustand: `budgetText`·`touched.budget`(파생값, 프리필은 스토어에 쓰지 않음) | `GET /me/preferences`(프리필 출처, `PreferencePrefillCard`와 동일 조회 재사용) |
| `BaseSectionList` | 구간별 거점("1~2박 6/10-6/12 부산 — {숙소} · 거점" + [변경]) | — | **[정정 · 2026-08-02]** 구간 행의 원본은 `GET /trips/{tripId}/bases`(BaseAssignment[])다. `GET /trips/{tripId}/coverage`는 **날짜별 판정·`blocked`**를 주는 별개 응답으로, 하단 CTA 차단에만 쓴다(BR-U1-44) · `DELETE /trips/{tripId}/bases/{baseAssignmentId}` |
| `BaseCandidateList` | 숙소 후보 카드 · "거점으로 지정" · 지정 시 "✓ N박 · {지역}에 지정됨" | — | `POST /trips/{tripId}/bases` |
| `CoverageResolveSheet` | **차단형 해소 시트** — 미해결 날짜별 선택(겹침: 후보 목록 / 공백: 직전 숙소·여행지 중심·숙소 지정)(BR-U1-44·45) | props: unresolvedDays | `GET /trips/{tripId}/coverage` → 해소는 `POST /trips/{tripId}/bases` 재배정 |
| `NoStayStartButton` | "숙소 없이 시작하기"(BR-U1-40) | — | `POST /trips` |
| `OverseasBlockDialog` | 국내 밖 목적지 차단 안내(BR-U1-35) | — | — |

**[라이브 실측 · 2026-08-02] 밴드 g에 변형 프레임이 늘었다** — `g01 · no-saved-places`(`2226:1732`) · `g01 · error`(`2226:1929`) · `g01 · blocked-overseas (dialog)`(`2228:1738`) · **`g03 필수 방문지 관리 · default`(`2230:1732`)**. `g01 · default`는 `1675:1183`. 이 문서 승인(2026-07-23) 당시 g01은 default 하나뿐이었고 "담은 곳 0"의 화면이 없어 TRIP-209가 그것을 미결로 남겼는데, **이제 프레임이 있다**(no-saved-places). g03은 US-TRIP-08(필수 방문지 지정 — 지라 티켓 미존재)의 화면이다.

**[라이브 실측 · 2026-08-02, TRIP-207 [기록] 반영] `g01 · default`(`1675:1183`) 내부 구성이 바뀌었다 — 프레임 개수는 안 변했고 내용이 변했다.** 위 문단이 다루는 것은 g01의 **새 변형 프레임**이고, 이건 그 default 프레임 **안쪽**에 자식 노드가 늘어난 것이라 별개다: 예산 블록 `sec_budget`(`2225:2375`, 구분선 `d3w` `2225:2373` 포함, TRIP-207 소관 — `BudgetInputField` 위 행 참고) · 등록 숙소 날짜 가져오기 행 `stayImportRow`(`2225:2362`, TRIP-208 소관 — **이 문서는 이 노드에 컴포넌트 행을 아직 안 둔다**, TRIP-208 [기록]에서 소급). 근거: `_workspace/20260802-trip207-budget-block/01_spec-analyst_brief.md` §7-④.

**[구현 결정 · TRIP-209, 2026-08-06] `MustVisitSeedStrip` 등록 실패 표면 + 제출 잠금 — 이 문서 승인 당시 없던 공백을 게이트에서 확정.** `01_spec-analyst_brief.md` §8-③이 "must-visit 등록 실패의 문구·자리·재시도 어포던스는 정본에 없어 발명 대상"으로 관측했고, 3-a에서 사용자가 "(가) 반영"을 선택했다(`01b_ouroboros_seed.md` §4). 아래는 전부 **요구사항 근거가 아니라 우리가 정한 구현 결정**이다 — 다음 사이클이 요구사항 근거로 인용하지 말 것.

- 썸네일 상한 **3장 고정, 특례 없음**(4건이어도 3장 + `+1`). 근거: 게이트①-1 사용자 결정(`_workspace/20260805-trip209-mustvisit-seed/00_gates.md` 게이트① 절, 2026-08-06 02:50) — 4장 배치 시 폭 실측(424px > 358px 가용폭) 제시 후 확정.
- 등록 실패 배너 문구 `꼭 갈 곳 {N}곳 중 {M}곳을 등록하지 못했어요`. 근거: 게이트①-1 사용자 결정(제안대로).
- 배너 자리 = 기존 제출 실패 배너와 **같은 자리**(하단 CTA 위) · **다른 testID**(`trip-wizard-mustvisit-banner`) — 같은 배너를 재사용하면 [다시 시도]가 여행 생성을 다시 태워 여행이 하나 더 생긴다. 근거: 게이트①-1 사용자 결정.
- 재시도 사정거리 = **실패분만** 재등록(`POST /trips`는 다시 보내지 않는다). 근거: 게이트①-1 사용자 결정.
- 조회 실패 부제 `담은 곳을 불러오지 못했어요`(0곳 얼굴과 반드시 구분 — 캡션은 그리지 않는다). 근거: 게이트①-1 사용자 결정.
- **담은 목록 도착 전에는 `[다음]`을 잠근다(비회원은 예외 — 비회원은 조회 자체가 안 나가 "불러오는 중"이 영원히 참이므로, 그 값에 그대로 잠그면 비회원이 여행을 영영 못 만든다).** ⚠️ **정본 AC 문장 없음** — 이 결정의 근거는 브리프·Seed 어디에도 없고, 게이트①-1 승인 이후 code-critic 적대적 리뷰가 찾은 무방비 경로(담은 목록 미도착 상태에서 제출하면 꼭 갈 곳이 통째로 빠진 채 침묵 통과)를 메우며 사용자가 내린 **게이트①-2 결정**이다. 근거: 게이트①-2(`00_gates.md` 게이트①-2 절, 2026-08-06 13:22) — AC 코드를 날조하지 않고 "게이트 결정"으로 표기한다.

## 5. 폼 검증 (UX 사본 명세)

| 폼 | 클라 검증(Zod) | 서버 정본 |
|---|---|---|
| 숙소 등록 | 숙소명 필수 · 체크아웃 > 체크인 · 좌표 확정 여부 | BR-U1-22·26 — **[정정 · 2026-08-02] 오류 코드는 400(ValidationError)·404다.** 이 자리에 적혀 있던 `409/422`는 `/saved-stays`·`/trips/{tripId}/bases` 계약에 존재하지 않는다 |
| 링크 붙여넣기 | URL 형식 | BR-U1-24 (파싱 판정은 서버) |
| 여행 생성 | 종료일 ≥ 시작일 · 도시별 박수 합 ≤ 기간 · 인원 ≥ 1 | BR-U1-34·36 · INV-U1-14 |
| 필수 방문지 고정 | 날짜가 여행 기간 안 · 시각 형식 | BR-U1-49 |

## 6. testID (규약 `{feature}-{screen}-{role}`)

`explore-landing-{section}`(regions·stays·places·community) · `explore-landing-createtrip` · `explore-region-{code}` · `explore-places-search` · `explore-places-save-{poiId}` · `explore-saved-createtrip`

**[공백 · 2026-08-02]** d04의 카테고리 칩·정렬 칩·카드 컨테이너, d02의 순번 목록 항목·해제 버튼·빈 상태의 testID는 이 문서에 정해져 있지 않다. TRIP-182가 e02 5상태의 이름을 구현에서 확정하고 이 절에 소급 기록한 것과 같은 방식으로, **TRIP-184 서브태스크의 게이트①에서 확정하고 그 값을 여기에 적는다.**
`stay-search-filter-{axis}`(price·region·more) · `stay-card-{stayId}` · `stay-card-save-{stayId}` · `stay-search-partialfailure-retry` · `stay-detail-book` · `stay-detail-addtotrip` · `stay-ota-option-{otaCode}` · `stay-saved-setbase-{stayId}` · `stay-register-tab-{route}`(mapsearch·linkpaste·pin) · `stay-register-submit` · `stay-register-mapconfirm`

**[구현 결정 · TRIP-182, 2026-07-30]** 위 `stay-search-partialfailure-retry` 외 나머지 4상태(loading·empty·filter-zero·error)의 testID — 이 문서 승인 당시 이 넷의 이름은 정해지지 않았다(§6 공백). 실제 구현이 확정한 값: `stay-search-loading` · `stay-search-skeleton-{i}`(i=0,1) · `stay-search-empty` · `stay-search-empty-region` · `stay-search-empty-filter` · `stay-search-register` · `stay-search-filterzero` · `stay-search-filterzero-clear` · `stay-search-filterzero-reset` · `stay-search-error` · `stay-search-error-retry` · `stay-search-error-register` · `stay-search-partialfailure`(배너 컨테이너 자체 — retry는 위와 동일). 근거: `frontend/src/features/stay/ui/StaySearchScreen.states.test.tsx`(게이트①-1 승인, TRIP-182).
`trip-wizard-step{n}-next` · `trip-wizard-destination-add` · `trip-wizard-period-preset-{code}` · `trip-wizard-party-stepper` · `trip-wizard-pref-change` · `trip-base-assign-{stayId}` · `trip-base-coverage-day-{date}` · `trip-base-nostay-start`

**[구현 결정 · TRIP-207, 2026-08-02]** 예산 testID 5종 — 이 문서 승인 당시 정해지지 않았다(공백). 게이트①에서 확정한 값: `trip-wizard-budget-block`(섹션 컨테이너) · `trip-wizard-budget-input`(총액 입력, 지라 티켓이 직접 지정) · `trip-wizard-budget-edit`(`수정` 어포던스) · `trip-wizard-budget-note`(프리필 안내 문구) · `trip-wizard-error-budget`(인라인 파싱 오류 — 위반 코드가 아니라 **블록 슬러그** 규약, 기존 `trip-wizard-error-destination`·`trip-wizard-error-period`와 동형). 근거: `_workspace/20260802-trip207-budget-block/02a_test-design_spec.md` §2-6.

**[구현 결정 · TRIP-209, 2026-08-06]** 꼭 갈 곳 시드 testID 9종 — 이 문서 승인 당시 정해지지 않았다(공백). 티켓 고정 4종: `trip-wizard-mustvisit-{sourcePoiId}`(썸네일) · `trip-wizard-mustvisit-remove-{sourcePoiId}`(썸네일 `x`) · `trip-wizard-mustvisit-more`(점선 `더 담기`) · `trip-wizard-mustvisit-empty`(점선 `가고 싶은 곳 담기`, 0곳). 게이트①에서 확정한 신규 5종: `trip-wizard-mustvisit-block`(섹션 컨테이너) · `trip-wizard-mustvisit-image-{sourcePoiId}`(썸네일 사진, 있을 때만) · `trip-wizard-mustvisit-overflow`(`+N` 박스) · `trip-wizard-mustvisit-retry`(조회 실패 재시도 행) · `trip-wizard-mustvisit-banner`/`-banner-retry`(등록 실패 배너). 근거: `_workspace/20260805-trip209-mustvisit-seed/02a_test-design_spec.md` §2-4.

## 7. PBT 대상 (클라이언트 순수 함수 · fast-check)

| 대상 | 속성 |
|---|---|
| ~~`resolveCoverage(trip, assignments) → DayResolution[]`~~ **[정정 · 2026-08-02] 클라이언트 대상이 아니다** — 실제 계약은 `GET /trips/{tripId}/coverage`가 날짜별 `status`(AUTO·GAP·OVERLAP)와 `blocked`를 **서버에서 계산해 준다**. 클라이언트가 같은 판정을 다시 구현하면 서버와 갈라지고 INV-2(사용자에게 보이는 판정은 서버·솔버 검증값)에 어긋난다. 이 줄은 계약보다 앞서 쓰였다. 클라이언트가 갖는 것은 **표시용 구간 파생**(`toBaseSections` — 박 번호 라벨·N박 묶음, TRIP-224)뿐이다 | 서버 소관(위 취소선) · 클라 대체 속성: 임의 배정 집합에서 결과 길이 = 입력 길이이고 다박 배정이 날짜 수만큼 쪼개지지 않는다(BR-U1-28) |
| `nightsSum(destinations) ≤ tripLength` | 임의 도시·박수 조합에서 위반 시 항상 거부(INV-U1-14) |
| `formatPrice(snapshot?)` | 스냅숏 없음 → 항상 "가격 미확인", 있음 → 항상 "~" 접미 시작가. **어떤 입력에서도 소요 시간 문자열을 만들지 않는다**(INV-3) |
| `seedMustVisits(savedPlaces)` | 중복 `sourcePoiId` 없음 · 원본 담기 해제와 독립(복사본 보존) |
| `resolveStaySearchState(input) → StaySearchState` | **[구현 결정 · TRIP-182, 2026-07-30]** 임의의 `(isPending, isError, itemCount, degraded, filterZeroReasons)` 조합에서 결과 `kind`가 5개 리터럴(`loading`\|`error`\|`results`\|`filter-zero`\|`empty`) 중 **정확히 하나**이고 "아무것도 아님"이 없다. 요구사항 근거는 INV-4(결정론적 폴백·침묵 실패 금지) — 단 이 성질을 PBT 대상으로 뽑을 수 있었던 것 자체는 구현이 판정을 순수 함수로 분리한 결정에서 비롯한다. 이 문서 승인 당시 상태 판정 완전성은 PBT 대상 목록에 없었다(공백). 근거: `frontend/src/features/stay/model/staySearchState.test.ts`(fast-check, numRuns 500) |
| `parseBudgetAmount(raw) → BudgetAmount` · `formatBudgetAmount(amount)` | **[구현 결정 · TRIP-207, 2026-08-02]** 표시값(`'1,200,000'`)↔전송값(`1200000`) 왕복 성질 — 임의 정수 n(0~1e12)에서 `parse(format(n))`이 `{kind:'amount', amount:n}`로 돌아오고, `format(n)`이 항상 `/^\d{1,3}(,\d{3})*$/` 모양이다. `0`도 유효값(falsy 판정 금지). 이 문서 승인 당시 예산 정규화는 PBT 대상 목록에 없었다(공백, 티켓이 명시 요구). `toLocaleString`/`Intl` 사용 0건도 함께 잠근다(node/Hermes 로케일 갈림 회피). 근거: `frontend/src/features/trip/model/budgetAmount.test.ts`(fast-check, `_workspace/20260802-trip207-budget-block/02a_test-design_spec.md` §3 N1) |

> **서버측 PBT**(참고): 커버리지 해소 결과의 전 날짜 확정성, 최저가 스냅숏 정규화·직렬화 왕복, 딥링크 파라미터 정확성 — U1 NFR 단계에서 확정. **closed-set 게이트 PBT(INV-1)가 CQ3=B로 U1에 편입**된다.
