# 약관·처리방침 초안 (TRIP-847)

**초안이다. 정본은 시드(`R__seed_reference_data.sql`)에 들어간 순간부터다.** 이 디렉토리는
검토 가능한 형태(md·PR 리뷰)로 본문을 다듬는 자리이고, 확정되면 시드로 옮기고 여기는 원본으로 남는다.

## 파이프라인

```
초안(이 디렉토리, PR 리뷰) → [미확정] 3건 해소 + 이름 2자리 채움 → 팀 승인
→ 시드 반영(reconsent_required=false — 사용자 0명인 지금만 무료) → 처리방침 URL 호스팅
```

## 파일 ↔ terms_type 대응

| 파일 | terms_type | 성격 |
|---|---|---|
| `privacy-policy.md` | PRIVACY_POLICY | 처리방침 — **위치정보 절(위치정보법 법정 7항목) 통합** |
| `location-terms.md` | LOCATION_TERMS | 위치기반서비스 이용약관 (lbsc 표준양식 구조) |
| `gps-recording-consent.md` | GPS_RECORDING | 위치정보 기록 동의 (선택) — EXIF 명시 포함 |
| `terms-of-service.md` | TERMS_OF_SERVICE | 서비스 이용약관 |
| `marketing-consent.md` | MARKETING | 광고성 정보 수신 동의 (선택) |
| `personalization-consent.md` | PERSONALIZATION | 기록 기반 개인화 동의 (선택) |

## 미확정 마커 규약

본문의 채워야 할 자리는 전부 `[미확정: 설명]` 형태다 — `grep -rn '\[미확정' backend/docs/legal/` 로 전수 조회.
전부 해소돼야 시드 반영 가능. 종류:

- ~~이름 2자리~~ — 해소(2026-09-16): 대표자·위치정보관리책임자·개인정보 보호책임자 = **송승윤**
- ~~확인자료 법정 보존기간~~ — 해소(2026-09-16): 제16조② **6개월**. 단 코드가 영구 보존이라
  **TRIP-881**(경과분 파기 정합)이 시드 반영의 새 게이트다
- **LLM 벤더·리전** — 국외 이전 고지 범위 확정 필요
- **연락처·주소** — 사업자등록 후

## 원칙 (작성 시 지킨 것)

1. **약관은 코드가 실제로 하는 것만 말한다.** 모든 파기·보존·동의 문장은 코드 근거가 있다
   (각 문서 하단 대조표). 코드보다 좋은 말 금지 — TRIP-847 코멘트의 칸 3 통과 기준.
2. 수집 항목·보유기간의 정본은 `CascadeSummary.forAccount()` 22범주 + 법정보존 2
   (`DeletionCascadeNoticeIT` 가 FK 스캔으로 강제) — TRIP-847 칸 1 표.
3. 위치정보법 법정 기재사항(2022 개정 — 보유목적·보유기간 명시, 처리방침 위치 절 7항목)을
   체크리스트로 대조했다 — 각 문서 하단.
