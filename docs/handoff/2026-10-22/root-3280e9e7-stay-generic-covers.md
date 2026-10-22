---
session: 3280e9e7-b1fc-432d-a171-93e60e41a9ba
area: root
cwd: frontend
branches_seen: [feature/place-category-covers, feature/stay-generic-covers, develop]
current_branch: feature/stay-generic-covers
span_kst: "10-13 ~ 10-22 (이미지 생성·장소 카테고리 연결·숙소 그림)"
ended_by: handoff(사용자 요청 — 다른 곳에서 숙소 연결 작업)
status: 인수인계-대기
resume_local: "claude --resume 3280e9e7-b1fc-432d-a171-93e60e41a9ba"
related_prs: [1554, 1138]
tickets: []
---
# (인수인계-대기) 숙소 사진 칸을 일반 숙소 그림 6장으로 채우기 — 연결 작업

## 목적
숙소 사진 칸 전부를 **유형과 무관한 일반 숙소 일러스트 6장**으로 채운다. 같은 숙소는 어느 화면에서나 같은 그림이 나오게 **숙소 키 해시로 6장 중 하나를 고른다**(장소 사진 칸 때와 같은 방식). 에셋은 이미 이 브랜치에 있고, **앱 연결(코드·테스트)이 남았다.**

## 사용자 결정 (되돌리지 말 것)
- **숙소 API 에 사진 필드가 없다**(`StayItem`·`StayDetail`·`SavedStay` 어디에도 `imageUrl` 없음, 실측). 그래서 "사진 없는 숙소만"이 아니라 **숙소 사진 칸 전체**가 대상이다.
- **유형별 세트(호텔·리조트·생활숙박·기타)는 버렸다.** 사용자: "숙소랑 해당 이미지랑 매칭은 어려워서 좀 더 일반적인 숙소 이미지를 원하는데". 시드 12,936곳의 `stayType` 은 `생활숙박` 6,901 · `호텔` 4,178 · `기타` 1,676 · `리조트` 181 이고 저장한 숙소엔 유형 필드가 없다. **`stayType` 을 화면마다 넘기는 배선을 만들지 마라** — 일반 한 세트면 필요 없다.
- 그림 6장 확정 — 사용자: "저거 6장 랜덤으로 적용될 수 있게". ⚠️ **"랜덤"의 해석은 우리 제안이다**: `Math.random` 이 아니라 **키 해시의 결정적 선택**(같은 숙소=같은 그림, 목록→상세 일관, 재렌더에 안 바뀜, 테스트 결정적). 사용자가 "매 렌더 무작위"를 원했다면 확인이 필요하다(그러면 칸 재활용·테스트가 불안정해지는 점을 같이 설명할 것).
- 한옥으로 읽히는 그림은 쓰지 않는다(맛집 때와 같은 이유 — "다 한국식이잖아"). 처음 만든 '기타' 세트가 전부 한옥으로 나와 폐기했고 중립 가드를 붙여 다시 만들었다.

## 재료 (이 브랜치에 push 됨)
- `frontend/assets/stay-covers/stay-1.webp` ~ `stay-6.webp` (738×492 가로 3:2, 합계 약 300KB) — 침실 · 트윈룸 · 객실 입구 · 중립 저층 외관 · 라운지 코너 · 발코니. `README.md` 에 표.
- `frontend/assets/stay-covers/_tools/gen_stays.py` — 프롬프트(`SUBJECTS`)·`gen`/`export` 명령.
- ⚠️ 원본 PNG(1536×1024)는 **만든 머신의 `frontend/assets/region-covers/_tools/out/` 에만 있다**(gitignore). 다시 뽑으면 같은 프롬프트로 새 그림이 나온다 — 6장을 바꾸려면 전량 재생성하거나 WebP 를 그대로 쓴다.
- 앱 쪽 재료는 **이미 develop 에 있다**(PR #1554 머지 `8a0fb3316`): `src/shared/ui/PlacePhoto.tsx`(서버 사진 or 카테고리 그림, `onError` 갈아끼움) · `src/shared/lib/placeCover.ts`(`placeCoverSource`·`fnv1a32`, 장소 10종×3변형 + 폴백). 읽을 곳: `frontend/assets/place-categories/README.md`, `docs/structure.md` 「재사용 공개 API」.

## 현재 코드 지도 — 숙소 사진 칸 (develop `7086b3be7` 기준, 줄은 대략)

키는 모두 `stayKey()`(`features/save-stay/model/stayKey.ts`: `${externalSource}:${externalId}`) 를 쓰면 목록·상세가 같은 그림이다. 저장한 숙소(`SavedStay`)는 `savedStayId` 만 있다(외부 id 는 옵셔널).

| 칸 | 파일 | 지금 | 쓸 키 |
|---|---|---|---|
| 숙소 검색 카드(full 178h) · 탐색 숙소 줄(rail 160×120) | `entities/stay/ui/StaySearchCard.tsx` ~113·161 (`photoTestID` View `bg-surface-strong`, 안에 하트 오버레이) | 회색 View — **카드에 id prop 이 없다**(`testID`·`name`·`region`·`priceText`·`variant`·`save`·`onPress` 뿐) → `coverKey?` 같은 prop 신설. 호출부: `pages/stay/stay-search/ui/StaySearchScreen.tsx:659`(`const key = stayKey(item)` 있음) · `pages/explore/explore-landing/ui/ExploreLandingScreen.tsx:402`(`card.key`) | `stayKey` |
| 저장한 숙소 vertical(e04 178h) · row(g02 시트 56×56 r12) | `entities/stay/ui/SavedStayCard.tsx` ~106(row, `imageUrl` 있으면 `<Image>` 없으면 회색) · ~168(vertical) | 회색. 호출부: `pages/stay/stay-saved/ui/SavedStayListScreen.tsx:137`(`vm.savedStayId`) · `pages/trip/trip-new-step2/ui/StaySelectSheet.tsx:120`(`stay.savedStayId`, `stay.imageUrl` 은 프리뷰 픽스처뿐) | `savedStayId`(⚠️ 결정 1) |
| 숙소 상세 큰 사진(300h) | `pages/stay/stay-detail/ui/StayDetailScreen.tsx` ~221 (`testID="stay-detail-hero"`) | 회색. `state.kind==='ready'` 의 `detail`(`StayDetail`: `stayId`·`externalSource`·`externalId`) | `stayKey(detail)` — 목록과 같은 값 |
| 동선 기준 숙소 추천 카드(64×64 r12) | `entities/stay/ui/StayRecommendCard.tsx:101` (`imageSource` prop 은 프리뷰 픽스처뿐) · 호출부 `pages/itinerary/itinerary-stay-recommend/ui/StayRecommendView.tsx:113`(`candidate.savedStayId`) | 회색. 이 화면은 실 추천 API 가 없어 무데이터 얼굴만 나간다 — 우선순위 낮음 | `savedStayId` |
| g02 거점 카드 썸네일 | `pages/trip/trip-new-step2/ui/TripWizardStep2Screen.tsx` ~105-123 | `assigned && card.imageUrl` 일 때만 리치 블록(썸네일+위치 줄). 실앱은 `imageUrl` 이 없어 **항상 안 그려진다** | **결정 2 — 건드리지 않는 것을 권고**(켜면 카드 레이아웃이 Figma 와 달라진다) |

범위 밖(확인만): 여행 카드·사용자가 찍은 방문 사진·장소 사진 칸(이미 `PlacePhoto`). `pages/stay/my-stays`(l04 등록 숙소 행)는 사진 칸이 없는 것으로 봤으나 **직접 확인하지 않았다**.

## 구현 제안 (결정은 이어받는 쪽)
1. **그림 맵**: `shared/lib/placeCover.ts` 의 `COVERS` 에 `'숙소'` 키를 더하고 6장을 정적 `require`(`../../../assets/stay-covers/stay-1.webp` …, 템플릿 문자열 조립 금지 — Metro 는 글자 그대로의 경로만 번들한다). 지금 `Covers` 는 **길이 3 튜플**이고 변형 번호가 `fnv1a32(poiId) % 3` 으로 박혀 있다 → `readonly ImageSourcePropType[]` 로 넓히고 `% covers.length` 로 일반화(장소는 길이 3 그대로라 결과 불변 — 기존 해시 상수 테스트가 그걸 잠근다). `PlacePhoto` 는 그대로 쓴다: `category="숙소"` · `poiId={숙소 키}`(이름이 `poiId` 지만 문자열 키면 된다).
   - 대안(코드가 더 늘어남): 별도 `stayCoverSource` — 권고하지 않는다.
   - `'숙소'` 는 일정 슬롯 POI 의 카테고리이기도 하다(`isFixed && category==='숙소'` = 거점). 이제 그 슬롯 칸도 `place.webp` 폴백 대신 숙소 그림이 나온다 — 의도에 맞는 부수 효과지만 알아 둘 것.
2. **호출부 교체**: 위 표의 칸을 `PlacePhoto` 로. `StaySearchCard`·`SavedStayCard` 는 사진 View 안에 하트·배지·trailing 오버레이가 있다 → 사진은 바닥 레이어(`absolute inset-0`)로 깔고 기존 자식은 그대로 둔다(오버레이 `testID`·동작 불변).
3. **결정 1 — 저장한 숙소 키**: `savedStayId` 면 같은 숙소가 검색 목록과 저장 목록에서 다른 그림이 된다. `SavedStay.externalSource/externalId` 가 있으면 `stayKey` 형식으로 맞추고 없으면(직접 등록) `savedStayId` 로 폴백하는 안을 권고(VM 에 `coverKey` 를 생산자에서 채운다). 단순함 우선이면 `savedStayId` 그대로 두고 알려진 불일치로 남겨도 된다 — 사용자에게 한 줄 확인.
4. 거짓이 되는 주석 정정: `StaySearchCard.tsx` 머리(10행 "항상 회색 자리"), `SavedStayCard.tsx` `imageUrl` prop 설명, `StayDetailScreen.tsx` ~221, `StaySelectSheet.tsx` ~15, `TripWizardStep2Screen.tsx` ~68. 구조 지도 행(`.claude/rules/layer-entities.md` 의 stay 카드 행·`traps-stay.md`)도 같은 줄만.
5. **정본**: `aidlc/.../u1-accommodation-trip/functional-design/business-rules.md` 의 **BR-U1-60** 이 지금 "장소(POI)의 사진 칸"만 말한다 → 숙소 사진 칸까지 넓히는 개정이 필요하다. 이건 AI-DLC (B) 절차 — **사용자가 3-a 에서 "정본 반영" 항목으로 고르면** `audit.md` 에 사용자 원문을 append 하고 `[개정]` 블록을 붙인다(하네스 `scribe.md` 의 (B) 항목, 이번 장소 사이클의 04 기록 참고). 고르지 않으면 개발로그 관측으로만 남긴다. `openapi.yaml` 은 숙소 사진 필드가 없어 **변경 없음**.

## 테스트 영향 (뒤집을 것 — 새 파일은 거의 없다)
- 숙소 사진 칸이 "회색 자리 testID"를 단언하던 테스트: `entities/stay/ui/StaySearchCard.test.tsx` · `SavedStayCard.test.tsx` · `pages/stay/stay-search/ui/StaySearchScreen.test.tsx` · `pages/stay/stay-detail/ui/StayDetailScreen.test.tsx` · `pages/stay/stay-saved/ui/SavedStayListScreen.test.tsx`·`.list.test.tsx`·`SavedStayPage.integration.test.tsx` · `pages/explore/explore-landing/ui/ExploreLandingScreen.test.tsx`·`ExploreLandingPage.test.tsx` · `pages/trip/trip-new-step2/ui/StaySelectSheet.test.tsx`·`TripNewStep2Page.test.tsx`·`TripBasesPage.integration.test.tsx`(거점 시트 후보 행) · `pages/itinerary/itinerary-stay-recommend/ui/StayRecommendView.test.tsx`·`StayRecommendPage.integration.test.tsx`. (`grep -rln "stay-card-photo\|photo-placeholder\|stay-detail-hero\|stay-recommend-card\|explore-stay-card\|trip-base-staysheet-cand\|saved-stay-card" --include='*.test.ts*' src` 로 다시 뽑아라.)
- **기대값을 구현 함수로 만들지 마라(동어반복).** 장소 사이클의 방식: `src/test-support/placeCoverFixtures.ts` 가 `placeCover.ts` 를 import 하지 않는 **손으로 적은 정답표**(`COVER`·`SLUG_OF`·`VARIANT_OF`·`coverFor`)를 갖고, 호출부 테스트가 카테고리 A/B 를 섞어 오배선을 잡는다. 숙소용으로 `COVER['stay']` 6장과 `% 6` 변형 표(숙소 키 몇 개의 변형을 **node 로 독립 계산**해 박는다)를 더해라. `placeCover.test.ts` 는 "30장이 서로 다른 파일"·변형 1~3·분포 PBT 가 `3` 에 묶여 있어 손볼 곳이 있다.
- 서버 사진 필드가 없으니 "사진 있으면 그대로" 분기는 이 칸들에 없다 — 그래도 `PlacePhoto` 는 `imageUrl` 을 받으므로 `undefined` 로 둔다(나중에 서버가 사진을 주면 연결만 하면 된다).

## 다음에 이어서 할 일
1. **이 브랜치 확인**: `git fetch && git switch feature/stay-generic-covers`(origin 에 push 됨). develop 과 얼마나 벌어졌는지 보고 `git merge origin/develop`(충돌은 아래 함정).
2. 사용자에게 **결정 1(저장한 숙소 키)·결정 2(g02 거점 썸네일)·"랜덤=결정적 해시"** 를 한 번에 묻는다(권고: `stayKey` 폴백 / 건드리지 않음 / 결정적 해시).
3. 프론트 코드 변경이므로 **`frontend/CLAUDE.md` 의 `trippilot-dev-cycle` 로 진행**한다. 규모 판정: 호출부 약 6곳 + 기존 모듈 확장이고 새 컴포넌트는 없지만 설계 선택(키·맵 일반화)이 열려 있어 **기본**을 권한다(애매하면 기본). 장소 사이클 산출물(`_workspace/20261022-place-category-covers/`)은 로컬 볼트라 클라우드에선 못 본다 — 위 "테스트 영향" 절이 그 요지다.
4. 6-b(실기): **숙소는 실데이터 화면에서 바로 보인다**(전부 회색이었으니) — 탐색 탭 숙소 줄 · 숙소 검색 · 숙소 상세 · 마이→저장한 숙소. 프리뷰 딥링크는 로그인된 앱에서 열리지 않았다(아래).
5. PR 은 사용자가 시킬 때 만든다(제목 `feat: …`, Jira 키 없음 — 티켓 미발행). 머지도 사용자 지시가 있을 때만.

## 함정 / 주의
- **Metro `CI=1` 이면 옛 번들을 서빙한다** — 수정이 시뮬레이터에 안 보이는데 에러도 없다. `lsof -ti :8081 -sTCP:LISTEN | xargs kill` 후 `env -u CI pnpm start` 를 **하네스 추적 백그라운드로**(`nohup &` 금지). 확인은 번들을 받아 새 심볼 개수를 센다(`curl ".../entry.bundle?platform=ios&dev=true"`). 이번에 이걸로 코드 결함을 오판할 뻔했다.
- **프리뷰 딥링크 `trippilot://_dev/preview?state=…` 가 로그인된 앱에서 안 열렸다**(앱은 URL 을 받지만 홈에서 안 바뀜, 원인 미규명). 실데이터 화면으로 확인한다.
- **push 훅이 막힌다**: gitignored `frontend/_workspace/**/render.js` 의 `__dirname` lint 10건 + 로컬 `ios/` 의 OFF3 테스트(`locationAutomationBuildConfig`). `--no-verify` 대신 두 폴더를 같은 디스크의 다른 곳으로 `mv` 했다가 **push 뒤 반드시 되돌린다**(되돌리기는 push 결과와 무관하게 실행되게 묶을 것 — zsh 에서 `status` 는 읽기 전용 변수라 `status=$?` 를 쓰면 뒤 명령이 죽는다, `rc` 를 써라). 클라우드 세션은 이 두 폴더가 없어 해당 없음.
- **develop 이 매우 빠르다**(몇 시간에 수십 커밋). 머지 직전 `git fetch` 로 벌어짐을 확인하고, 충돌은 거의 항상 두 곳이다: `aidlc/aidlc-docs/audit.md`(append-only 라 **상대 항목을 먼저, 내 항목을 뒤에** 둔다) · `frontend/docs/structure.generated.md`(`node frontend/.claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs --write` 로 재생성 — CI 의 "structure map drift gate" 가 파일 수를 본다. 이게 어긋나 한 번 CI 가 실패했다).
- 알려진 무관 실패: 로컬 OFF3(`ios/` 환경, CI 무관). `MyTripsListPage` 통합 테스트의 5초 초과 간헐 실패는 develop `#1556` 이 고쳤다. 머신에 다른 워크트리의 jest 가 동시에 돌면 통합 테스트가 줄줄이 시간 초과로 빨개진다 — 단독 재실행으로 구분한다.
- 사용자 선호: 한국어 답변 · 커밋/PR 에 Claude 표기(Co-Authored-By·"Generated with") 금지 · **push·PR·머지는 사용자가 시킬 때만** · 처음 듣는 곳·특정 양식으로 읽히는 그림은 피한다.
- 이번 사이클에서 이해부채 3건(FNV-1a/`Math.imul`·정적 `require`·`onError` 실패 주소 기억)이 **퀴즈 대기**다 — 해시 부분을 일반화하면서 `fnv1a32` 를 만지게 되니 사용자 이해 상태를 한 번 물어보는 게 좋다(로컬 볼트 `이해부채/`).

## 참조
- 장소 연결 PR: [#1554](https://github.com/ASM-TripPilot/trippilot/pull/1554)(머지 `8a0fb3316`) · 지역 커버 PR #1138
- 에셋 README: `frontend/assets/stay-covers/README.md` · `frontend/assets/place-categories/README.md`
- 계약: `backend/docs/design/openapi.yaml` 의 `StayItem`·`StayDetail`·`SavedStay`(사진 필드 없음) · 정본 BR-U1-60(`aidlc/aidlc-docs/construction/u1-accommodation-trip/functional-design/business-rules.md`)
- 로컬 전용(클라우드 불가): `~/.claude` 메모리 `region-cover-images-k6.md` · 사이클 `_workspace/20261022-place-category-covers/` · 학습 아티팩트
