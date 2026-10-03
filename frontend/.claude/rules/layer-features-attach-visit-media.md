---
paths:
  - "src/features/attach-visit-media/**"
---
# `src/features/attach-visit-media/`

| 파일 | 역할 |
|---|---|
| `src/features/attach-visit-media/model/photoAttach.ts` | (TRIP-1155로 features/record에서 이사) `photoAttach(asset, gpsConsent) → AddPhotoRequest` — 동의가 없거나 좌표가 없으면 `exifLat`/`exifLng` **키 자체를 안 만든다**(`undefined`로도 안 싣는다 — [[키 부재 vs 값 undefined]]). 동의는 boolean DI로 받는다 |
| `src/features/attach-visit-media/model/photoAttach.test.ts` | (TRIP-1155로 features/record에서 이사) PBT + 긍정 짝(consent=true→실림) |
| `src/features/attach-visit-media/model/pickPhotoForVisit.ts` | (TRIP-1155로 features/record에서 이사) `pickPhotoForVisit()`(TRIP-1070 신규) — `shared/photo`의 `pickPhotoAsset()`을 부르고 결과가 `picked`가 아니면 문구표(`PICK_NOTICE`)로 `{notice}`를 접는다(취소는 `null` — 무안내). `picked`면 **그때** `getMeLocationConsent()`를 1회 조회해 `gpsRecordingOptIn === true`일 때만 좌표 키를 살린다. 화면을 열 때가 아니라 고른 뒤 읽는 이유는 마운트 조회를 없애고 누른 순간의 최신 동의값을 쓰기 위함(02a §2-6) — "형제 통합 테스트가 red가 된다"는 초기 근거는 03b가 반증(이 리포 MSW `onUnhandledRequest:'error'`는 콘솔 에러만 찍고 테스트를 실패시키지 않는다) |
| `src/features/attach-visit-media/ui/MemoInline.tsx` | (TRIP-1155로 features/record에서 이사) **`BottomSheetTextInput`**(TRIP-1085 — j01이 셸 시트 안으로 들어가 키보드가 시트를 밀어 올려야 해서 교체. ⚠️ **시트 밖에서 그리면 실기 throw** — jest 목은 시트 문맥을 요구하지 않아 못 잡는다 — 실기 스모크가 유일한 그물) `maxLength=2000`(서버 권위의 UX 사본 — `fireEvent.changeText`는 maxLength를 우회하므로 prop 값으로 잠금). 공백이면 무발화. **저장 경로는 `onBlur` 하나**(`submitBehavior="blurAndSubmit"` — return=키보드 내림→blur→1회; `onSubmitEditing` 저장 금지, 병행하면 이중 저장). jest는 이 연쇄를 흉내 못 내 return 실기는 6-b. ⚠️ **seed-once 파생 상태**(`useState(text ?? '')`) — 리스트에서 `key` 없이 재활용되면 다른 카드 메모가 잔류한다([[seed-once 파생 상태]]) |
| `src/features/attach-visit-media/ui/MemoInline.test.tsx` | (TRIP-1155로 features/record에서 이사) maxLength 잠금·공백 게이트·blur 저장·submitEditing 0회(M5)·submitEditing+blur 1회(M6) |
