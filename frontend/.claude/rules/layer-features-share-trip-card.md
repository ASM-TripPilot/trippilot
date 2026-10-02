---
paths:
  - "src/features/share-trip-card/**"
---
# `src/features/share-trip-card/`

| 파일 | 역할 |
|---|---|
| `src/features/share-trip-card/model/shareCapture.ts` | (TRIP-1155로 features/reflection에서 이사) (신규) `isShareCaptureArmed()`(모듈 3종 존재 판정, 없으면 null 조회 — 패키지 정적 import 없음) · `saveShareCardImage(ref)`/`shareShareCardImage(ref)`(캡처→저장/공유, 실패는 전부 `{status:'failed'}` 반환, throw 없음) — `shareCaptureNative.ts`를 `await import`로만 부른다 |
| `src/features/share-trip-card/model/shareCapture.test.ts` | (TRIP-1155로 features/reflection에서 이사) (신규) armed 판정 3종 개별 부재·저장/공유 성공·권한거부·각 단계 reject |
| `src/features/share-trip-card/model/shareCaptureNative.ts` | (TRIP-1155로 features/reflection에서 이사) (신규) 캡처 3종 패키지를 **정적 import**하는 유일한 파일(re-export). 옮기면 `eslint.config.js`의 캡처 어댑터 예외(이 파일 경로 하나만 캡처 3종 정적 import 허용)에서 빠져 lint error가 난다(`traps-reflection.md`) |
