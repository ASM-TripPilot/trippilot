---
id: share-card
band: j
status: live-verified
live_verified_at: 2026-10-31 (8b50db304)
routes:
  - app/trips/[tripId]/records/share.tsx
---

# 공유 카드 (j06)

끝난 여행을 한 장의 이미지 카드로 만드는 화면이다. 사용자는 스토리 9:16·정방형 1:1·피드 4:5 중 포맷을 고르고, 카드(워터마크·방문 순서·지역/기간·제목·통계)를 미리 본 뒤 `이미지 저장` 으로 사진 앨범에 넣거나 `공유하기` 로 OS 공유 시트를 연다. 카드 아래에는 서버가 만든 추천 캡션·해시태그가 뜨고, 해시태그 줄은 직접 고칠 수 있다. 카드는 기기에서 그려 캡처한다(서버 이미지 없음).

## Sub-features

- `sc-pending` 요약·여행 조회 중이면 `공유 카드를 준비하고 있어요`.
- `sc-error` 요약 조회 실패면 `요약을 불러오지 못했어요` + `다시 시도`.
- `sc-not-ready` 요약 `ready:false`(여행 전·요약 전)면 `여행이 끝나면 만들 수 있어요` / `아직 공유할 여행 기록이 모이지 않았어요` + `돌아가기`.
- `sc-format` 포맷 세그먼트 3종(`스토리 9:16`·`정방형 1:1`·`피드 4:5`) — 미리보기 프레임 비율이 바뀐다. 스토리는 높이 530 상한, 나머지는 가용 폭 100%.
- `sc-default` 사진이 1장 이상인 여행: 기본 카드.
- `sc-no-photo` 사진 0장: 카드 아래 안내 — 방문이 있으면 `사진이 없어 방문 순서로 카드를 만들었어요`, 방문도 없으면 `사진과 방문 기록이 없어 여행 정보로 카드를 만들었어요`.
- `sc-visit-order` 방문이 있으면 카드 가운데에 방문 순서(최대 6줄), 방문 0곳이면 그 자리를 비운다.
- `sc-copy` 서버 추천 문구를 화면 진입 시 1회 요청한다. 기다리는 동안 캡션 자리 스켈레톤, 하루 상한에 닿으면 `오늘은 추천 문구를 모두 받았어요. 직접 편집해 쓸 수 있어요`, 실패·빈 해시태그면 지역으로 만든 `#{지역}여행` 해시태그 + 빈 캡션.
- `sc-hashtag-edit` 캡션 카드의 `편집` → 해시태그 줄이 입력칸으로 → `완료`. 10개 초과면 `해시태그는 10개까지 넣을 수 있어요`, 150자 초과면 `150자까지 쓸 수 있어요`.
- `sc-save` `이미지 저장` → 카드 캡처 → 사진 추가 권한 → 앨범 저장. 결과 `사진 앨범에 저장했어요` / `사진 앨범 권한이 없어 저장하지 못했어요` + `설정 열기` / `이미지를 만들지 못했어요. 다시 시도해 주세요`.
- `sc-share` `공유하기` → 캡처 → OS 공유 시트(PNG). 실패만 `이미지를 만들지 못했어요. 다시 시도해 주세요` 로 알린다.
- `sc-unarmed` 캡처 네이티브 3종(view-shot·media-library·sharing)이 없는 빌드면 하단 두 버튼을 그리지 않는다.

## How to get to it (user POV)

- j04 여행 요약 헤더의 `공유` 를 누른다(캡처 모듈이 있는 빌드에서만 버튼이 있다) (`trip-record`).
- 딥링크 `trippilot://trips/<tripId>/records/share` — 여행 전에도 열려 `sc-not-ready` 를 보인다. 시뮬레이터에선 `com.trippilot.travel://` 스킴으로 연다.
- 앱 안의 다른 진입은 없다.

## Driving it with agent-device

Preconditions:

- 요약이 ready 인 끝난 여행(만드는 법은 `trip-record` Preconditions 의 j04 항목 — 종료일이 KST 오늘 이전 + 서버 종료 스위퍼 통과). `sc-default` 는 그 여행에 사진 1장 이상, `sc-no-photo` 는 사진 0장.
- 캡처 3종이 들어간 dev build(재빌드 전 빌드는 j04 `공유` 와 j06 하단 버튼이 둘 다 없다 — 크래시 아님).
- `sc-not-ready` 는 여행 전·진행 중 여행 id 로 딥링크를 연다.
- 서버 추천 문구는 하루 횟수 제한이 있다 — 한 계정으로 여러 번 열면 `sc-copy` 상한 얼굴이 된다.
- 조작 절차·셀렉터 함정은 `trippilot-sim-qa` 스킬 §2.

- **진입.** j04 에서 testID: `reflection-summary-share`(`공유`)를 누른다. 헤더 `공유 카드`, 포맷 세그먼트 testID: `reflection-share-format-seg`, 미리보기 testID: `reflection-share-preview-frame` 이 보인다.
- **포맷 전환.** testID: `reflection-share-format-{square}`(`정방형 1:1`) → `reflection-share-format-{feed}`(`피드 4:5`) → `reflection-share-format-{story}`(`스토리 9:16`)를 차례로 누른다. 프레임 비율이 바뀌고 1:1·4:5 에서 카드가 화면 좌우를 넘치지 않는다(과거 QA 087).
- **방문 순서.** 방문이 있는 여행이면 카드 안 testID: `reflection-share-visit-order` 에 번호·`N일차`·장소가 최대 6줄.
- **사진 없음 안내.** 사진 0장 여행이면 testID: `reflection-share-no-photo-notice` 가 `사진이 없어 방문 순서로 카드를 만들었어요`(방문 0이면 `사진과 방문 기록이 없어 여행 정보로 카드를 만들었어요`).
- **추천 문구.** 진입 직후 캡션 자리에 스켈레톤이 보였다가 testID: `reflection-share-caption-text`(서버 캡션)와 testID: `reflection-share-hashtags`(해시태그)가 채워진다. 하루 상한이면 testID: `reflection-share-copy-limit`(`오늘은 추천 문구를 모두 받았어요. 직접 편집해 쓸 수 있어요`)과 `#{지역}여행` 해시태그.
- **해시태그 편집.** testID: `reflection-share-caption-edit`(`편집`) → 입력 testID: `reflection-share-caption-input` 에 `#a #b` 를 `fill` → testID: `reflection-share-caption-save`(`완료`). `reflection-share-hashtags` 가 입력한 글로 바뀐다. 태그 11개를 넣고 완료하면 testID: `reflection-share-caption-error`(`해시태그는 10개까지 넣을 수 있어요`)가 뜨고 입력칸이 남는다.
- **이미지 저장.** testID: `reflection-share-save`(`이미지 저장`)를 누르고 OS 사진 추가 권한을 허용한다. 결과 testID: `reflection-share-result` 가 `사진 앨범에 저장했어요`. 시뮬레이터 사진 앱에서 새 이미지를 한 번 더 확인한다.
- **저장 결과 위치.** `reflection-share-result` 는 하단 버튼 뒤에 가려져 있다 — 문구는 접근성 트리(또는 스크롤)로 읽는다. 다음 `공유하기` 를 누르면 결과 안내가 지워진다.
- **저장 권한 거부.** 사진 권한을 거부한 상태에서 저장한다. `reflection-share-result` 가 `사진 앨범 권한이 없어 저장하지 못했어요` 이고 testID: `reflection-share-open-settings`(`설정 열기`)가 보인다.
- **공유하기.** testID: `reflection-share-export`(`공유하기`)를 누르면 OS 공유 시트가 PNG 와 함께 뜬다. 닫고 돌아와도 결과 안내가 없다(성공·취소는 알리지 않는다).
- **준비 전.** 진행 중 여행 id 로 딥링크를 연다. testID: `reflection-share-not-ready`(`여행이 끝나면 만들 수 있어요`)와 testID: `reflection-share-not-ready-back`(`돌아가기`).
- **조회 실패.** 네트워크를 끊고 연다. testID: `reflection-share-error`(`요약을 불러오지 못했어요`) → 복구 후 testID: `reflection-share-retry`(`다시 시도`).
- **조회 중.** 느린 네트워크에서 testID: `reflection-share-pending`(`공유 카드를 준비하고 있어요`)이 잠깐 보인다.
- **뒤로.** testID: `reflection-share-back` 을 누르면 j04 로 돌아간다.
- **교차 확인.** 카드 통계(방문 수)를 j04 `총 방문` 과 비교한다(과거 QA 115 — 회고·공유 집계 불일치 이력).

## Gotchas

- OS 공유 시트·사진 권한 다이얼로그·시뮬레이터 사진 앱은 앱 밖이다. 저장 결과는 사진 앱에서, 공유는 시트가 떴는지로만 본다. **[실화면 전용]**
- 캡처 3종은 네이티브 모듈이다. 재빌드 전 dev build 는 버튼이 조용히 사라진다 — 버튼이 없으면 결함으로 판정하기 전에 빌드에 모듈이 있는지 확인한다(traps-reflection.md). jest 는 이 상태를 재현하지 못한다.
- `편집`·`완료` 가 고치는 것은 해시태그 줄이다(입력 testID 이름은 `caption-input` 이지만 캡션 본문은 고칠 수 없다).
- 캡션·해시태그는 캡처 이미지에도, 공유 시트 페이로드에도 들어가지 않는다 — 미리보기 프레임만 캡처된다. 편집 결과를 공유 결과물에서 찾지 않는다(아래 결함 의심).
- 딥링크로 바로 열어 스택에 이전 화면이 없으면 `reflection-share-back`·`reflection-share-not-ready-back` 이 아무 일도 하지 않는다(뒤로 폴백 없음) — 아래 결함 의심. 딥링크 진입 검증 시 이 버튼으로 나가는 경로를 "통과"로 적지 않는다.
- 추천 문구는 화면 마운트 때 1회만 요청한다. 다시 받으려면 화면을 나갔다 들어와야 하고, 그때마다 하루 횟수를 쓴다.
- 카드 지도 자리는 좌표 계약이 없어 회색 박스 위 방문 순서로 대신한다. 지도가 없는 것은 정상이다.
- 캡션 입력칸이 키보드에 가리는지, 키보드가 뜬 채 첫 탭이 `완료` 로 가는지는 실기 전용이다. **[실화면 전용]**
- testID 표기: `a-{x}` 는 `a-` 뒤에 실행 값 x 가 붙은 것이고, `a{-b}` 는 실제 testID `a-b` 다(하단 바·헤더·행 카드). 접근성 트리에서는 합친 값으로 찾는다.
- [실화면] 2026-10-31 코드 대조 의심 확인 — 해시태그를 `#fmcheck #해운대검증` 으로 고친 뒤 `이미지 저장` 한 앨범 PNG(894×1590)에도, `공유하기` 공유 시트 페이로드(`<uuid>.png · PNG 이미지 · 91KB`, 텍스트 없음)에도 해시태그·캡션이 없다. 미리보기 프레임만 캡처된다(편집 결과는 화면 표시용뿐).
- [결함 의심 FM-L5-02] 앱을 종료한 뒤 딥링크로 j06 에 콜드 진입하면 `reflection-share-back` 이 무반응이고 가장자리 스와이프도 안 먹어 화면에 갇힌다(앱 재시작·다른 딥링크 외 탈출 불가). 앱이 떠 있는 상태(탭 위)에서 연 딥링크는 뒤로·`돌아가기` 가 정상으로 탭 화면에 돌아온다.
- [실화면] 2026-10-31 서버 추천 캡션 얼굴은 못 봤다 — 부산·강남구 두 여행 모두 빈 캡션 + `#{지역}여행`(`#부산광역시여행`·`#강남구여행`) 폴백이었고 `reflection-share-copy-limit` 안내도 없었다(하루 상한이 아니라 실패·빈 응답 폴백으로 추정). `reflection-share-hashtags` testID 는 트리에 따로 잡히지 않고 해시태그 텍스트로 보인다.
- [실화면] 2026-10-31 사진 1장 여행(부산)도 카드에 사진이 들어가지 않고 회색 박스 위 방문 순서였다. 방문·사진 0 여행(강남구)은 가운데가 비고 통계가 `방문 0 · 이동 — · 사진 0`, 지역 줄에 `1박 2일` 이 붙는 다른 배치였다.
- [실화면] 2026-10-31 사진 추가 권한이 이미 허용된 시뮬레이터라 OS 권한 다이얼로그 없이 바로 저장됐다.
- [실화면] 2026-10-31 도달 불가 — `sc-error`·`sc-pending`(네트워크 차단·지연 수단 없음, pending 은 순간이라 못 잡음), 저장 권한 거부(권한 허용 상태), `sc-unarmed`(캡처 모듈이 있는 빌드), 서버 추천 캡션·상한 얼굴(위).
