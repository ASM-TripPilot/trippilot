---
paths:
  - "src/features/edit-preferences/**"
---
# `src/features/edit-preferences/`

| 파일 | 역할 |
|---|---|
| `src/features/edit-preferences/model/preferenceSelection.ts` | (TRIP-1155로 features/onboarding에서 이사, TRIP-1162로 `shared/pref` 본체가 여기로 합류) 본체 — 공개 API `@/features/edit-preferences`로 import. `toggleMulti`(복수 축)·`toggleSingle`(단일 축), `null`=미설정, 전부 해제 시 `[]`가 아니라 `null`로 복귀(US-ONB-14) |
| `src/features/edit-preferences/model/preferenceStore.ts` | (TRIP-1155로 features/onboarding에서 이사) **Zustand 스토어** — 취향 6축 세션 메모리. 스토어 자체는 persist 없음(서버 영속은 `PrefStep2Page`가 완료 순간 1회 PUT). `create(createPreferenceDraft)` 형태 — 제네릭 직접 호출(`create<`)은 구조 가드를 오탐시킨다 |
| `src/features/edit-preferences/model/preferenceInput.ts` | (TRIP-1155로 features/onboarding에서 이사) 순수 함수 `toPreferenceInput` — 스토어 slug를 서버 `PreferenceInput`의 한국어 enum으로 7축 번역(`budgetRawAmount`는 항상 `null`). 동행 `'pet'`은 `companionTypes`가 아니라 `petFlag` 특례, 미지 slug는 드롭. 호출자는 `PrefStep2Page` 한 곳(fire-and-forget, 실패해도 온보딩 완료를 막지 않음) |
| `src/features/edit-preferences/model/preferenceDraft.ts` | (TRIP-1155로 features/settings에서 이사) `initialSelection(view)`·`buildPreferenceInput(view, selection)` — `PreferenceView` ↔ `PreferenceInput` 역변환. 안 만진 축은 **키 자체를 omit**(openapi "생략=미변경, null=초기화"). [[역변환 함수 (View→Input)]] |
