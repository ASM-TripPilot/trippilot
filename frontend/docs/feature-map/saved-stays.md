---
id: saved-stays
band: e
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/stays/saved.tsx
---

# 저장한 숙소 (e04)

사용자는 하트로 저장했거나 직접 등록한 숙소를 한 목록에서 보고, 카드를 눌러 상세로 가고(Trip.com 인기 숙소는 제휴 시트로 바로 외부 이동), 카드의 하트를 눌러 저장을 푼다. 여행의 거점으로 쓰는 숙소는 풀 수 없다는 안내가 뜬다. 목록 아래 [숙소 직접 등록]으로 등록 화면에 간다. 목록이 비면 [숙소 둘러보기]로 숙소 검색에 간다.

## Sub-features

- `saved-stays-list` 앱바 「저장한 숙소」 + 부제 `저장한 숙소 N곳 · ♥로 저장한 곳` + 세로 카드 목록(이름·숙소 그림·찬 하트).
- `saved-stays-loading` 「저장한 숙소를 불러오는 중」 스켈레톤.
- `saved-stays-error` 「저장한 숙소를 불러올 수 없어요」 / 「잠시 후 다시 시도해 주세요」 + [다시 시도].
- `saved-stays-empty` 「마음에 드는 숙소를 저장해 보세요」 + [숙소 둘러보기] → 숙소 검색.
- `saved-stays-guest` 토큰이 없으면 조회하지 않고 「로그인하면 저장한 숙소를 볼 수 있어요」 + [로그인하기].
- `saved-stays-open` 카드 → 숙소 상세. 외부키 없는 핀·직접 등록 숙소는 `savedStayId`로 상세를 연다.
- `saved-stays-open-tripcom` `TRIPCOM` 출처 카드 → 상세 대신 제휴 고지 시트 → 호텔 상세 아웃바운드(외부 브라우저).
- `saved-stays-unsave` 카드 하트 → 행이 즉시 사라지고 서버 삭제. 실패하면 행이 제자리로 돌아온다.
- `saved-stays-unsave-base` 거점으로 쓰는 숙소(409)면 「여행의 거점으로 쓰는 숙소라 지울 수 없어요\n여행에서 거점을 먼저 바꿔 주세요」 배너(버튼 없음).
- `saved-stays-unsave-network` 그 밖의 실패면 「저장을 풀지 못했어요」 배너 + [다시 시도].
- `saved-stays-register` 목록 아래 [숙소 직접 등록] → 숙소 등록(e05).

## How to get to it (user POV)

- 숙소 검색 결과(e02) 우하단 흰 하트 FAB(testID: `stay-search-fab-saved`, 라벨 「저장한 숙소」).
- 홈 담은 곳 FAB(testID: `home-saved-menu-toggle`)을 펼친 뒤 「저장한 숙소」 미니 FAB(testID: `home-saved-stays-fab`).
- 탐색 탭 담은 곳 FAB(testID: `explore-saved-menu-toggle`)을 펼친 뒤 testID: `explore-saved-stays-fab`.
- 딥링크 `com.trippilot.travel://stays/saved`(`trippilot://` 스킴은 실화면에서 라우팅되지 않는다 — stay-detail.md Gotchas).
- 푸시 알림 탭으로 오는 경로는 없다.

## Driving it with agent-device

Preconditions:

- 소셜 로그인 완료. 결과 얼굴을 보려면 저장한 숙소가 1곳 이상(숙소 검색 결과에서 하트를 눌러 만든다). 빈 얼굴은 저장 0곳인 계정에서만 보인다.
- 거점 해제 거부(409)를 보려면 어떤 여행(지난 여행 포함)의 거점으로 지정된 저장 숙소가 있어야 한다.
- Trip.com 분기를 보려면 인기 숙소 카드 하트(`curated-stays.md`)로 저장한 숙소가 있어야 한다.

- **진입.** 숙소 검색 결과에서 testID: `stay-search-fab-saved`를 누른다. testID: `saved-stay-root`, 뒤로 testID: `saved-stay-back`, 제목 「저장한 숙소」, 부제 testID: `saved-stay-subtitle`이 `저장한 숙소 N곳 · ♥로 저장한 곳`이다.
- **로딩.** 진입 직후 testID: `saved-stay-loading`(「저장한 숙소를 불러오는 중」)이 잠깐 보인다.
- **카드.** 카드 testID: `saved-stay-card-{savedStayId}`, 하트 testID: `saved-stay-heart-{savedStayId}`(라벨 `{이름} 저장`, selected 고정), 안쪽 글리프 testID: `saved-stay-heart-filled-{savedStayId}`. 카드에 이름 외 지역·가격은 없다.
- **카드 → 상세.** 하트로 저장한 일반 숙소 카드를 누른다. testID: `stay-detail-root`가 열리고 같은 이름이 제목이다.
- **Trip.com 카드.** `TRIPCOM` 출처 카드를 누른다. 상세가 아니라 testID: `stay-ota-sheet`가 이 화면 위에 열린다. OTA 행은 testID: `stay-ota-option-TRIPCOM`(「Trip.com」, 가격 칸 없음), 버튼은 「Trip.com으로 이동」. [이동]하면 외부 브라우저가 열린다 — **열리는 것까지만, 예약 진행 금지**.
- **저장 풀기.** 거점이 아닌 카드의 testID: `saved-stay-heart-{savedStayId}`를 누른다. 그 행이 바로 사라지고 부제 N이 하나 준다. 숙소 검색 결과로 가서 같은 숙소의 하트가 testID: `stay-card-save-{key}-outline`인지 다른 화면에서 확인한다.
- **거점 숙소 해제 거부.** 거점으로 쓰는 숙소의 하트를 누른다. 행이 잠깐 사라졌다 제자리로 돌아오고 testID: `saved-stay-remove-error` 배너에 「여행의 거점으로 쓰는 숙소라 지울 수 없어요」가 뜬다. 버튼은 없다.
- **네트워크 해제 실패.** 네트워크를 끊고 하트를 누른다. 행이 돌아오고 배너 「저장을 풀지 못했어요」 + testID: `saved-stay-remove-error-retry` [다시 시도]가 뜬다. 연결을 되살리고 누르면 행이 사라진다.
- **직접 등록.** 목록 아래 testID: `saved-stay-register` 「숙소 직접 등록」을 누른다. testID: `stay-register-root`가 열린다. 등록에 성공하면 이 화면으로 돌아와 「숙소를 등록했어요」 토스트가 뜨고 새 숙소가 목록에 보인다.
- **빈 상태.** 저장 0곳 계정으로 진입한다. testID: `saved-stay-empty` 「마음에 드는 숙소를 저장해 보세요」, CTA testID: `saved-stay-browse` 「숙소 둘러보기」 → testID: `stay-search-root`. 빈 상태엔 [숙소 직접 등록]이 없다.
- **조회 실패.** 네트워크를 끊고 진입한다. testID: `saved-stay-error` 「저장한 숙소를 불러올 수 없어요」, testID: `saved-stay-error-retry` [다시 시도].
- **게스트.** 액세스 토큰이 없을 때만 testID: `saved-stay-guest` 「로그인하면 저장한 숙소를 볼 수 있어요」 + testID: `saved-stay-guest-login` [로그인하기] → 로그인 화면.

## Gotchas

- 이 목록에는 하트로 저장한 숙소와 직접 등록(지도 검색·핀) 숙소가 함께 나온다. 부제 「♥로 저장한 곳」과 달라도 정상이다(2026-10-16 QA Q-039).
- 핀·직접 등록 숙소 카드를 누르면 상세가 400/404 얼굴(「숙소 정보를 불러올 수 없어요」)로 끝난다 — 등록 숙소 상세는 정본 공백이다. 상세 검증엔 하트로 저장한 숙소 카드를 쓴다.
- 해제 결과는 이 화면에서 행이 사라지는 것만으로 판정하지 말고, 숙소 검색 결과(e02) 하트나 홈 「저장한 숙소」 배지(testID: `home-saved-stays-badge`) 숫자로 한 번 더 읽는다.
- 거점 해제 거부 배너는 다음 하트 조작 전까지 남는다. 등록 화면을 다녀와도 그대로 남는다(2026-10-21 QA N-016).
- 지난 여행의 거점이어도 409로 해제가 막힌다. 테스트 계정의 지난 여행 거점 숙소는 이 화면에서 지울 수 없다.
- 게스트 얼굴은 정상 로그인 흐름에서 도달 경로가 확인되지 않는다(토큰 삭제 상태에서만, 확인 필요).
- 이 화면은 탭바가 없는 스택 화면이다 — 탭바 좌표를 누르면 하단 [숙소 직접 등록]이 눌린다(sim-qa §2).
- [실화면 전용] Trip.com 카드의 제휴 시트 열림·딤과 외부 브라우저 열림은 실화면으로만 확인된다. 「다시 보지 않기」를 체크하면 계정 전체에서 시트가 사라진다(`stay-detail.md` Gotchas).
- 이 화면 하트 모양(`StayGlyphs`)은 검색 카드 하트와 다르다(traps-stay).
- [실화면] 2026-10-31 도달 불가 — `saved-stays-loading`(순간 상태)·`saved-stays-error`·`saved-stays-unsave-network`(네트워크 차단 수단 없음)·`saved-stays-empty`(계정에 저장 3곳)·`saved-stays-guest`(로그아웃 금지).
- [실화면] 2026-10-31 목록은 최근 저장이 맨 위다. [숙소 직접 등록]은 목록 끝이 아니라 화면 하단 고정 버튼이다. Trip.com 카드 [Trip.com으로 이동]은 Safari 에서 Google 「{숙소명}」 검색으로 갔다(서버 리다이렉트 결과 — 제휴 링크가 아니다).
- [실화면] 2026-11-02 실패 주입(sim-qa §2 `_dev/fault`)으로 열림 — `saved-stays-loading`·`saved-stays-error`(`/saved-stays` 지연·500).
