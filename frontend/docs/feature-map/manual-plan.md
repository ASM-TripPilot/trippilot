---
id: manual-plan
band: h
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/itinerary/manual/index.tsx
  - app/trips/[tripId]/itinerary/manual/add.tsx
---

# 직접 짜기 (장소 추가 · 시각 · 저장하고 확정)

AI 없이 빈 일정에서 시작해 사람이 장소를 하나씩 넣는다. 편집기(지도 + 시트)에서 일차를 고르고 [장소 추가] 또는 카드 사이 "+"로 장소 추가 화면을 연다. 장소를 검색하거나 카테고리 칩으로 거른 뒤 [추가]를 누르면 시각 시트가 뜨고, [적용]하면 그 자리에서 곧장 서버에 저장된다. 편집기에서는 시각 칩으로 시각을 고치고, 길게 눌러 순서를 바꾸고, 아래로 끌어 지운다. [저장하고 확정하기]로 저장과 확정을 한 번에 하고 완성 일정 보기 화면으로 간다.

## Sub-features

- `manual-create` 첫 진입에 일정이 없으면 빈 직접 짜기 일정을 서버에 만든다(`generationMode=MANUAL`). 일정이 이미 있으면 그대로 이어 편집한다.
- `manual-fresh` `fresh=1`(추천안의 「비우고 시작」)이면 기존 미확정 일정을 비우고 새로 시작한다. 확정 일정은 비우지 않는다.
- `manual-fresh-error` 비우고 시작 실패 → `빈 일정으로 시작하지 못했어요. 일정 탭에서 다시 열어 주세요`.
- `manual-editor` 편집기 — 시트 제목 `일정 만들기`, `N일차 · M월 D일(요일) · N곳`, 일차 칩(2일 이상), 카드, 안내줄.
- `manual-add` 점선 [장소 추가] → 그날 끝에 추가하는 장소 추가 화면.
- `manual-add-between` 카드 사이 "+" → 그 뒤에 끼우는 장소 추가 화면.
- `manual-time` 카드 시각 칩(또는 `시간대 설정` 칩) → 시각 조정 시트 → [적용](로컬 편집, 저장 전).
- `manual-reorder` 길게 눌러 끌어 순서 바꾸기(로컬 편집).
- `manual-drag-delete` 아래 삭제 영역으로 끌어 지우기(로컬 편집).
- `manual-save-confirm` [저장하고 확정하기] → 저장(PUT) → 토스트 → 시간 충돌이 없으면 곧장 확정 → 완성 일정 보기로 replace.
- `manual-conflict` 저장 응답에 시간 충돌이 있으면 `N곳에서 시간이 안 맞아요` 다이얼로그 → [고치기]/[그대로 확정].
- `manual-unspecified` 시각 미지정 카드는 저장에서 빠지고 `시간대를 정하지 않은 N곳은 저장에서 빠졌어요` 안내.
- `manual-save-error`/`manual-confirm-error` 저장·확정 실패 인라인 안내.
- `manual-back` 뒤로(버튼·스와이프) → 일정 탭.
- `add-search` 장소 추가 — 검색창(디바운스) + 카테고리 칩 8종 + 무한 스크롤 목록, 그날 지역으로 거른다.
- `add-time-sheet` [추가] → 시각 시트(직전 카드 뒤로 제안 시각) → [적용] → 즉시 서버 저장.
- `add-toast` 저장 성공 토스트 — 서버가 시각을 밀었으면 그 사실을 말한다.
- `add-added` 담은 행은 `추가됨`으로 바뀐다(화면을 떠날 때까지).
- `add-error` 저장 실패 → `장소를 담지 못했어요. 잠시 후 다시 시도해 주세요`.
- `add-empty` 검색 결과 0 → `검색 결과가 없어요`.

## How to get to it (user POV)

- 방식 고르기 `직접 짜기` → 편집기 push. `itinerary-method.md`.
- 생성 화면의 AI 한도 얼굴 [직접 짜기 이어가기](testID: `ai-limit-manual-cta`) → 편집기로 replace. `ai-generate.md`.
- 추천안: 폴백 인터스티셜 [직접 짜기], 0곳 얼굴 [직접 고르기], MANUAL 일정 셸의 [편집하기] → 편집기 push. 폴백 안내 `처음부터 직접 짜기` → 비우기 확인 [비우고 시작] → `fresh=1`로 push. MANUAL 일정이 0곳이면 추천안이 편집기로 replace.
- 홈·일정 탭 카드: MANUAL 미확정 일정이면 목적지가 추천안이고, 0곳이면 거기서 편집기로 replace된다.
- 장소 추가 화면은 편집기 [장소 추가]·"+" 외에 다음에서도 열린다 — 추천안 다른 후보 0건 [장소 검색], 같이 짜기 0건 [장소 검색], 일정 편집 화면의 장소 추가.
- 딥링크: `/trips/{tripId}/itinerary/manual`(`?fresh=1`), `/trips/{tripId}/itinerary/manual/add`(`?date=YYYY-MM-DD&insertAfter=N`).

## Driving it with agent-device

Preconditions:

- 로그인 상태, 일정이 없는 미래 여행(방식 고르기 → `직접 짜기`). 첫 진입이 서버에 빈 일정을 만든다(AI 한도는 쓰지 않는다 — 확인 필요).
- 여행 지역에 장소 데이터가 있어야 장소 추가 목록이 찬다(개발 서버 후보풀).
- AI 서버 모드(fake/http)와 무관하다. 단 서버가 저장 때 시각을 다시 맞춰(이동 반영) 돌려줄 수 있다.

- **편집기 첫 화면.** 진입하면 시트 머리 `일정 만들기`, testID: `sheet-header-meta`가 `0곳`, 뒤로 testID: `itinerary-edit-back`, 점선 testID: `itinerary-edit-add-place`(`장소 추가`), 안내 testID: `itinerary-edit-add-saved-hint`(`장소를 추가하면 바로 저장돼요`)가 보인다. 0곳이면 끌기 안내 testID: `itinerary-edit-guide`가 없고 CTA `저장하고 확정하기`(testID: `sheet-cta-button-0`)가 잠겨 있다.
- **일차 칩.** 2일 이상 여행이면 testID: `itinerary-edit-day-${dayIndex}`(`1일차`…)가 보인다. `itinerary-edit-day-2`를 누르면 헤더가 `2일차`·그날 날짜로 바뀐다.
- **장소 추가 열기.** `itinerary-edit-add-place`를 누른다. 장소 추가 화면이 열리고 머리가 `장소 추가 · N일차`(편집기에서 고른 날)다. 목록 testID: `itinerary-place-list`, 검색창 testID: `itinerary-place-search`(자리표시 `장소·맛집·명소 검색`), 칩 testID: `itinerary-place-category-${testId}`(`all` `전체`·`맛집`·`명소`·`카페`·`전시`·`미술`·`야경`·`술집`)가 보인다.
- **검색.** 검색창에 `경복궁`을 한글로 입력한다(`agent-device fill`). 잠시 뒤 목록이 바뀐다. 결과가 없으면 testID: `itinerary-place-empty`(`검색 결과가 없어요`).
- **카테고리.** `itinerary-place-category-카페`를 누른다. 목록이 카페로 걸러진다.
- **추가 → 시각.** 행의 testID: `itinerary-place-add-${poiId}`(`추가`)를 누른다. 키보드가 내려가고 시각 시트(testID: `${testIDPrefix}-sheet`, 접두 `itinerary-edit-time`, 제목 `시각 조정`, 부제 `시작·종료를 돌려서 맞춰요`)가 직전 카드 뒤 제안 시각으로 열린다. `시작`/`종료` 세그먼트로 휠을 바꾸고 [적용](testID: `${testIDPrefix}-apply`)을 누른다.
- **시각 오류.** 종료를 시작보다 이르게 두면 `종료 시각은 시작보다 늦어야 해요`(testID: `${testIDPrefix}-error`)가 뜬다.
- **저장 결과.** [적용] 직후 서버에 저장되고 토스트 testID: `itinerary-place-added-toast`가 뜬다 — 기본 `추가했어요 · 일정에 바로 저장됐어요`, 서버가 시각을 바꿨으면 `추가했어요 · 이동 시간을 반영해 HH:mm으로 맞췄어요`(뒤 카드가 밀리면 `· 뒤 N곳도 시간이 밀렸어요`). 행은 testID: `itinerary-place-added-${poiId}`(`추가됨`)로 바뀐다. 토스트는 시각(HH:mm)만 말하고 소요 시간 숫자는 없다.
- **추가 실패.** 네트워크를 끊고 [적용]한다. 머리 아래 testID: `itinerary-place-add-error`(`장소를 담지 못했어요. 잠시 후 다시 시도해 주세요`)가 뜬다.
- **편집기에 반영.** 뒤로(testID: `sheet-daychip-back`)를 누른다. 편집기에 카드 testID: `slot-stopcard-${slotKey}`가 생기고 헤더가 `1곳`, 지도에 핀이 뜬다. 완성 일정 보기 전이라도 서버 저장이 됐는지는 일정 탭에서 다시 열어 확인한다.
- **카드 사이 추가.** 카드가 2장 이상이면 카드 사이 testID: `itinerary-edit-insert-${index}`("+")를 누른다. 그 뒤에 끼우는 장소 추가 화면이 열리고, 담은 장소가 그 자리에 들어간다.
- **시각 고치기.** 카드 시각 칩(`HH:mm–HH:mm`, 미지정이면 `시간대 설정`)을 누른다. 시각 시트(접두 `itinerary-manual-time`)가 열린다. [적용]하면 카드 시각이 바뀐다 — 이건 로컬 편집이라 [저장하고 확정하기] 전까지 서버에 없다. 고정 카드에는 시각 칩 누름이 없다.
- **순서 바꾸기.** 카드를 길게 눌러 다른 카드 위치로 끌어 놓는다. 번호·연결선 순서가 바뀐다.
- **끌어 지우기.** 카드를 길게 눌러 시트 아래로 끈다. CTA 자리가 삭제 영역 testID: `itinerary-edit-dropzone-bar`로 바뀌고, 그 위에서 놓으면 카드가 사라진다.
- **저장하고 확정.** `sheet-cta-button-0`(`저장하고 확정하기`)을 누른다. 토스트 testID: `itinerary-manual-saved`(`일정을 저장했어요`) → testID: `itinerary-confirmed-toast`(`일정이 확정됐어요`)가 뜨고 완성 일정 보기 화면으로 replace된다. 이후 확인은 `itinerary-view.md`.
- **시간 충돌.** 저장 응답에 충돌 카드가 있으면 testID: `itinerary-edit-save-conflict`(`N곳에서 시간이 안 맞아요`)와 testID: `itinerary-edit-save-back`(`고치기`)·testID: `itinerary-edit-save-asis`(`그대로 확정`)가 뜬다. [고치기]는 편집기에 남고, [그대로 확정]은 확정으로 간다.
- **미지정 제외.** 시각 미지정 카드가 있는 채 저장하면 testID: `itinerary-manual-unspecified-notice`(`시간대를 정하지 않은 N곳은 저장에서 빠졌어요`)가 뜬다.
- **저장·확정 실패.** 저장 직전 네트워크를 끊으면 testID: `itinerary-manual-save-error`(`일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요`), 확정만 실패하면 testID: `itinerary-manual-confirm-error`(`일정을 확정하지 못했어요. 잠시 후 다시 시도해 주세요`)가 뜬다.
- **비우고 시작.** 추천안 폴백 안내에서 [비우고 시작]으로 들어오면(`fresh=1`) 편집기가 빈 상태로 시작한다. 실패하면 testID: `itinerary-manual-fresh-error`가 뜬다.
- **뒤로.** `itinerary-edit-back`을 누르거나 스와이프로 뒤로 간다. 어느 쪽이든 일정 탭 목록으로 간다.

## Gotchas

- [실화면 전용] 끌어 순서 바꾸기·끌어 지우기(놓을 자리 계산, 삭제 영역 활성)는 드래그 목이 손가락 이동을 흉내 내지 않아 실화면으로만 확인된다. 시트 스크롤과 카드 끌기가 서로 제스처를 뺏지 않는지도 실화면 전용이다(`.claude/rules/traps-draglist.md`).
- [실화면 전용] 시각 시트(바텀시트)의 실제 열림·휠 스크롤·딤 덮임, 편집기·장소 추가 지도는 실화면 전용이다.
- **저장 단위가 둘이다.** 장소 추가는 [적용] 즉시 서버 PUT이고, 편집기의 시각·순서·삭제는 [저장하고 확정하기] 전까지 로컬이다. 편집기에서 바꾼 것이 있는 채 장소를 추가하면 토스트 끝에 `· 다른 수정은 저장해야 남아요`가 붙는다. 뒤로 나가면 로컬 편집은 사라진다.
- [저장하고 확정하기]는 저장 뒤 **확정까지** 한다 — 저장만 하고 머무르는 버튼이 없다. 확정을 되돌리는 화면이 없으니 테스트 여행으로 한다.
- 카드 사이 "+"로 들어와 두 곳을 연달아 담으면 둘째가 첫째와 같은 시각·같은 자리 기준으로 들어가 겹친다(자리 파라미터가 화면이 열린 동안 고정). 끝에 추가는 문제없다.
- 날짜 없이 열린 장소 추가 화면(추천안·같이 짜기의 [장소 검색])은 **1일차 끝**에 담는다. 같이 짜기 2차 생성 중(PARTIAL)에도 이 화면의 저장은 막히지 않는다 — 생성 중인 뒷날을 덮어쓸 위험이 있으니 그 경로로 담지 않는다.
- 확정된 일정에서 장소 추가 PUT은 서버 409를 받아 `itinerary-place-add-error`가 뜬다(일정 편집 레인에서 들어올 때). 일정이 아직 없으면(콜드) [추가]가 조용히 무시된다 — 회귀 심판이 없다.
- 장소 추가 목록은 그날의 지역으로 거른다. 여러 지역 여행이면 일정 조회가 끝날 때까지 목록 요청을 미룬다(빈 목록이 잠깐 보일 수 있다).
- 첫 진입 일정 생성(MANUAL POST)이 실패해도 `fresh=1`이 아니면 별도 안내가 없다(실패 안내는 `fresh` 갈래에만 있다) — 확인 필요.
- 직접 짜기 일정은 폴백이 아니라 선택이라 폴백 안내가 뜨지 않는 것이 정상이다.
- 2일 이상 여행에서 0곳이어도 일차 칩이 보이는지는 서버가 빈 날을 days로 주는지에 달렸다 — 과거 QA에서 0곳일 때 칩이 안 보여 2일차부터 담을 수 없던 사례가 있다(확인 필요).
- [실화면] 2026-10-31 첫 카드의 제안 시각은 `10:00–11:00` 이었다. 장소 추가 화면 검색창은 키보드를 띄운 채라 칩 첫 탭은 키보드만 내린다. 끌어 순서 바꾸기는 `agent-device gesture drag <카드> <카드> 900 800 300` 으로 재현됐다.
- [결함 의심 FM-L2-02] 직접 짜기에서 끌어 순서를 바꿔 시각이 뒤섞인 채(1번 14:22, 2번 09:00) [저장하고 확정하기]를 누르면 충돌 다이얼로그 없이 곧장 확정되고, 완성 일정에 그 순서·시각 그대로(1번 14:22–15:22, 2번 09:00–11:00, 1→2 연결선 `거리 정보 없음`) 남는다. 기대: `itinerary-edit-save-conflict` 로 막거나 서버가 시각을 다시 맞춘다.
- [실화면] 2026-10-31 도달 불가 — `manual-drag-delete`: `agent-device gesture drag` 로 카드를 `sheet-cta-root`·`sheet-cta-button-0` 위에 놓아도(2회) 지워지지 않았다 — 합성 드래그가 삭제 영역 판정에 안 걸리는 도구 한계로 추정, 손가락 확인 필요. `manual-fresh`·`manual-fresh-error`(폴백 추천안 없음)·`manual-unspecified`·`manual-save-error`/`manual-confirm-error`·`add-error`(네트워크 차단 수단 없음)·`add-empty`(미시도).
