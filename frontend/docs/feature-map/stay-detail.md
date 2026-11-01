---
id: stay-detail
band: e
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/stays/[stayId].tsx
---

# 숙소 상세 · 외부 예약 (e03 · 제휴 고지 시트 l07)

사용자는 숙소 한 곳의 이름·최저가·지역·편의시설·위치 지도·주소·전화·객실 수를 보고, 상단 원형 버튼으로 뒤로·공유·저장을 하고, 「외부에서 예약하기」를 누르면 제휴 고지 시트(「외부 사이트로 이동」)를 거쳐 서버 아웃바운드 URL을 외부 브라우저로 연다. 예약·결제는 앱 밖에서 일어난다. 상세 데이터는 `GET /stays/{stayId}` 하나에서 오고, 그 결과에 따라 로딩·404·400·네트워크 오류 얼굴이 갈린다. 하단 탭바가 없는 몰입 화면이다. 제휴 시트는 인기 숙소 카드·저장한 숙소(Trip.com 숙소)도 같은 흐름을 쓴다.

## Sub-features

- `stay-detail-ready` 사진 칸(숙소 그림)·이름·최저가(`{천단위}원~` 또는 「가격 미확인」)·지역·「이 숙소 편의시설」·「위치」 지도·주소·전화·객실·제휴 안내·[외부에서 예약하기]를 그린다.
- `stay-detail-loading` 응답 전 가운데 스피너와 뒤로 버튼만 보인다.
- `stay-detail-error` 5xx·네트워크 실패면 「숙소 정보를 불러올 수 없어요」 / 「다시 시도하거나 목록으로 돌아가세요」 + [다시 시도].
- `stay-detail-notfound` 404면 같은 문구, [다시 시도] 없음.
- `stay-detail-invalid` 400 또는 빈 `stayId`면 같은 문구, [다시 시도] 없음.
- `stay-detail-amenities-missing` 편의시설이 비면 「미확인」, 주소가 비면 「미확인」, 객실이 비면 「미확인」, 전화가 비면 전화 줄 자체가 없다.
- `stay-detail-save` 상단 하트로 저장/해제한다. 요청 중엔 잠긴다. 미인증이면 요청 없이 로그인 화면으로 간다.
- `stay-detail-share` 상단 공유 원 → OS 공유 시트에 `{이름}` 또는 `{이름}\n{주소}`가 실린다(링크 없음).
- `stay-detail-phone` 전화 줄 → `tel:{번호}` 열기. 실패는 조용히 삼킨다.
- `stay-outbound-sheet` [외부에서 예약하기] → 제휴 고지 시트: 본문·OTA 행(`{표시명} · {가격}`)·수수료 고지·「이 안내를 다시 보지 않기」·[취소]·[{표시명}로/으로 이동].
- `stay-outbound-go` [이동] → 시트가 닫히고 서버 아웃바운드(`{API}/stays/{stayId}/outbound`)가 외부 브라우저로 열린다.
- `stay-outbound-dont-show` 체크한 채 [이동]하면 계정 설정에 저장되고, 다음부터는 시트 없이 바로 외부로 간다.
- `stay-outbound-error` 브라우저조차 못 열면 시트가 「링크를 열 수 없습니다」 얼굴로 바뀌고 [다시 시도]를 낸다.
- `stay-detail-visual` 최저가는 굵은 금액 + 흐린 ~ 두 톤이고, 위치 지도 핀에는 번호 글자가 없다. 편의시설이 5개를 넘으면 가로 스크롤 없이 줄을 바꿔 다 보인다. *(2026-11-01 jest 축소로 실화면 전용)*
- `stay-ota-visual` 제휴 고지 시트에서 고른 OTA 행의 라디오는 분홍으로 채워지고, 「이 안내를 다시 보지 않기」를 누르면 상자가 분홍으로 채워졌다가 다시 누르면 빈 상자로 돌아간다(실제로 체크하지 말고 모양만 본다 — sim-qa §5). *(2026-11-01 jest 축소로 실화면 전용)*

## How to get to it (user POV)

- 숙소 검색 결과(e02) 카드 testID: `stay-card-{key}` 탭.
- 탐색 탭 숙소 레인 카드 testID: `explore-stay-card-{key}` 탭.
- 저장한 숙소(e04) 카드 testID: `saved-stay-card-{savedStayId}` 탭 — 단 Trip.com 출처(`TRIPCOM`) 숙소는 상세 대신 제휴 시트가 그 자리에서 열린다.
- AI 도우미 다음 행동 `OPEN_OTA`(`params.stayId` 있음) → `/stays/{stayId}` push.
- 딥링크 `com.trippilot.travel://stays/{externalSource}:{externalId}` (예: `…/stays/LOCALDATA:123`). `trippilot://` 스킴은 실화면에서 라우팅되지 않는다(Gotchas).
- 제휴 시트 자체는 인기 숙소 카드·「Trip.com에서 전체 숙소 보기」에서도 열린다 — `curated-stays.md`.
- 푸시 알림 탭으로 오는 경로는 없다(알림 `STAY_DETAIL`은 마이 → 등록 숙소로 간다, `stay-register.md`).

## Driving it with agent-device

Preconditions:

- 소셜 로그인 완료. dev-api에서 `GET /stays/{stayId}`가 200을 주는 숙소 키 하나(숙소 검색 결과에서 카드를 눌러 얻는 것이 가장 확실하다).
- 「이 안내를 다시 보지 않기」가 꺼진 계정. 켜져 있으면 마이 → 설정의 제휴 안내 스위치(testID: `settings-affiliate-toggle`)로 다시 켠다 — 안 그러면 시트 없이 바로 외부로 나간다.
- 오류 얼굴 검증용: 존재하지 않는 키(404 기대)와 네트워크 끊김 상태.

- **진입·본문.** 숙소 검색 결과에서 카드를 누른다. testID: `stay-detail-root`가 뜨고 사진 칸 testID: `stay-detail-hero`, 가격줄 testID: `stay-detail-price-row`, 「이 숙소 편의시설」, 「위치」 지도 testID: `stay-detail-map`, 주소 testID: `stay-detail-address`, 객실 testID: `stay-detail-rooms`가 보인다.
- **편의시설.** 값이 있으면 testID: `stay-detail-amenities` 안에 칩 testID: `stay-detail-amenity-{값}`(아이콘 testID: `stay-detail-amenity-icon-{값}`)이 4칸 이하면 한 줄, 넘으면 줄바꿈 격자로 뜬다. 비면 testID: `stay-detail-amenities-empty` 「미확인」.
- **가격.** 응답에 가격이 있으면 `{천단위}원`과 `~`가 따로 그려지고, 없으면 「가격 미확인」 한 덩어리다. 「· 1박」 접미는 없다.
- **로딩.** 진입 직후 testID: `stay-detail-loading`이 잠깐 보인다.
- **404.** 딥링크 `com.trippilot.travel://stays/LOCALDATA:does-not-exist`로 연다. testID: `stay-detail-notfound`에 「숙소 정보를 불러올 수 없어요」가 보이고 testID: `stay-detail-retry`는 없다. 404는 자동 재시도가 꺼져 있어 바로 뜬다.
- **네트워크 오류.** 네트워크를 끊고 진입한다. testID: `stay-detail-error`와 testID: `stay-detail-retry` [다시 시도]가 보인다. 연결을 되살리고 [다시 시도]를 누르면 testID: `stay-detail-root`로 바뀐다.
- **뒤로.** 어떤 얼굴에서든 testID: `stay-detail-back`(라벨 「뒤로」)이 있고 들어온 화면으로 돌아간다.
- **저장.** testID: `stay-detail-save`(라벨 `{이름} 저장`)를 누른다. 안쪽 글리프가 testID: `stay-detail-save-outline` → testID: `stay-detail-save-filled`로 바뀌고 selected가 된다. 결과는 저장한 숙소(e04) 목록에서 그 이름으로 다시 확인한다. 다시 누르면 해제된다.
- **공유.** testID: `stay-detail-share`(라벨 「공유」)를 누른다. iOS 공유 시트가 뜨고 내용이 숙소 이름(주소가 있으면 둘째 줄에 주소)이다. 공유 시트는 취소로 닫는다.
- **전화.** 응답에 전화가 있으면 testID: `stay-detail-phone`(「전화」 + 번호)이 보인다. 누르면 `tel:` 열기를 시도한다. 시뮬레이터에선 아무 반응이 없는 것이 현재 동작이다.
- **제휴 시트 열기.** 본문 끝 「예약·결제는 제휴 파트너 사이트에서 진행돼요」(testID: `stay-detail-affiliate-notice`) 아래 testID: `stay-detail-book` 「외부에서 예약하기」를 누른다. testID: `stay-ota-sheet`(제목 「외부 사이트로 이동」)가 뜨고 본문 「외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.」, OTA 행 testID: `stay-ota-option-{externalSource}`(표시명 + ` · ` + 가격), 수수료 고지 testID: `stay-ota-notice-box`, 체크박스 testID: `stay-ota-dont-show`(「이 안내를 다시 보지 않기」), testID: `stay-ota-cancel` [취소], testID: `stay-ota-confirm` [이동]이 보인다.
- **표시명.** `NAVER`→「네이버로 이동」, `AGODA`→「아고다로 이동」, `TRIPCOM`→「Trip.com으로 이동」, 사전에 없는 코드(`LOCALDATA` 등)→ OTA 행 「외부 사이트」, 버튼 「외부 사이트로 이동」.
- **취소.** testID: `stay-ota-cancel`을 누른다. 시트가 닫히고 상세 화면 그대로다. 다시 [외부에서 예약하기]를 누르면 체크가 해제된 상태로 다시 열린다.
- **이동.** testID: `stay-ota-confirm`을 누른다. 시트가 닫히고 Safari가 `…/stays/{stayId}/outbound`를 열어 서버 리다이렉트를 따라간다. **열리는 것까지만 확인하고 결제·예약은 진행하지 않는다.** 앱으로 돌아오면 상세 화면이 그대로 있다.
- **다시 보지 않기.** 시트에서 testID: `stay-ota-dont-show`를 눌러 checked로 만들고 [이동]한다. 앱으로 돌아와 [외부에서 예약하기]를 다시 누르면 시트 없이 곧장 브라우저가 열린다. 마이 → 설정의 testID: `settings-affiliate-toggle`이 꺼져 있는 것으로 저장을 다른 화면에서 확인하고, 스위치를 다시 켜서 원복한다.
- **이동 실패 얼굴.** 브라우저 열기가 실패하면 시트 제목이 「링크를 열 수 없습니다」, 본문 「잠시 후 다시 시도하세요.」, testID: `stay-ota-error-box`(「외부 링크 URL을 확인할 수 없거나 연결에 실패했습니다.」), testID: `stay-ota-retry` [다시 시도]로 바뀐다.

## Gotchas

- 「이 안내를 다시 보지 않기」는 기기가 아니라 계정(`/me/settings.affiliateNoticeDismissed`)에 저장된다. 한 번 체크해 이동하면 같은 계정의 이후 모든 QA에서 시트가 사라진다 — 끝나면 반드시 testID: `settings-affiliate-toggle`로 원복한다.
- 외부 예약 링크는 열리는 것까지만 확인한다. 결제 진행 금지. 서버 아웃바운드가 클릭을 기록하므로 반복 클릭은 최소화한다.
- [실화면 전용] Safari가 실제로 열리는지, 서버 302가 어디로 가는지(제휴 딥링크인지 검색 결과인지)는 앱이 알 수 없다 — 브라우저가 열린 뒤의 404·503은 브라우저 화면에 뜬다. 과거 QA(2026-10-16)에선 `LOCALDATA` 숙소가 검색 결과로 갔는데도 시트는 제휴 고지를 띄웠다(얼굴은 지금 늘 제휴 모드). 웹검색 얼굴(「검색 결과로 이동」)은 현재 코드에서 도달 불가다.
- [실화면 전용] 이동 실패 얼굴은 `Linking.openURL`이 throw할 때만 뜬다. Safari가 있는 시뮬레이터에선 재현 경로가 확인되지 않았다(확인 필요).
- [실화면 전용] 제휴 시트의 실제 열림·딤(강한 배경막)·드래그로 닫기는 실화면으로만 확인된다. 배경막 탭이 닫기로 동작하는지도 실화면에서 본다.
- [실화면 전용] 전화 줄은 `tel:` 열기 실패를 조용히 삼킨다. 시뮬레이터 무반응은 결함이 아니라 현재 동작이며, 실기기에서만 통화 화면이 뜬다.
- [실화면 전용] 위치 지도는 네이버 네이티브 SDK다. Client ID가 없거나 dev build가 지도 전환 전 빌드면 회색 지도/testID: `map-failure` 표면이 보인다. 지도 화면은 접근성 캡처가 느릴 수 있다(sim-qa §2).
- 401(세션 만료)은 별도 얼굴이 없어 testID: `stay-detail-error`로 접히고 [다시 시도]를 눌러도 반복된다(traps-stay 「e03 GET」).
- 404·400·네트워크 얼굴은 문구가 같고 testID로만 갈린다. 문구로 판정하지 말고 testID로 판정한다.
- 저장한 숙소(e04)에서 지도 핀·직접 등록 숙소를 누르면 `stayId`가 `savedStayId`(UUID)라 이 화면이 400/404 얼굴로 끝난다 — 등록 숙소 상세는 정본에 없다(알려진 한계).
- 사진 칸은 계약에 사진 URL이 없어 숙소 키로 고른 일반 그림이다. 실제 숙소 사진을 기대하지 마라.
- 상단 뒤로·공유·저장은 스크롤 밖 고정 오버레이다. 스크롤해도 같은 자리에 있어야 한다(TRIP-1429 수정 — 2026-10-16 QA Q-034 회귀 확인 대상).
- 이 화면의 하트(`StayGlyphs`)와 검색 카드 하트는 모양이 다르다(traps-stay).
- 본문 「외부 OTA 사이트로 이동하며 … 진행됩니다.」·「… 받을 수 있습니다 (추가 비용 없음).」 문구는 법정성 문구로 테스트가 리터럴을 잠근다. 2026-10-21 QA N-013이 'OTA' 노출·합니다체를 지적했으나 지금도 그대로다.
- **[실화면] 2026-10-31 딥링크는 `com.trippilot.travel://…` 스킴으로만 화면이 바뀐다** — `simctl openurl "trippilot:///…"` 는 앱만 앞으로 오고 라우팅되지 않았다(이 dev build Info.plist 에 `trippilot` 스킴이 네이버 로그인 urlScheme 으로 한 번 더 등록돼 있다, [결함 의심 FM-L1-04]).
- [실화면] 2026-10-31 도달 불가 — `stay-detail-loading`(순간 상태)·`stay-detail-error`(네트워크 차단 수단 없음)·`stay-detail-invalid`(400 키 미확보)·`stay-outbound-dont-show`(계정 설정 오염 금지)·`stay-outbound-error`(Safari 있는 시뮬에서 openURL 실패 재현 불가)·`stay-detail-phone`은 줄 존재만 확인(시뮬 무반응이 정상).
- [실화면] 2026-10-31 가격 없는 `LOCALDATA` 숙소는 OTA 행이 「외부 사이트」 한 덩어리(` · {가격}` 없음)다. [외부 사이트로 이동]은 Safari 에서 Google 「{숙소명} 예약」 검색으로 갔다(서버 리다이렉트 결과).
- [실화면] 2026-10-31 공유 시트 미리보기엔 숙소 이름 한 줄만 보였다(주소 둘째 줄은 시트 미리보기로 판정 못 함).
