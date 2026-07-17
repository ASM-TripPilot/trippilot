# U0 Foundation — Domain Entities

> 기준선 = Flyway `V1.0~V1.7` (main). 표의 "테이블"은 기존 마이그레이션과의 매핑이며, 불변식 코드(INV-*)는 마이그레이션 주석의 것을 그대로 승계한다.

## 1. 엔티티 관계 개요

```
Account 1 ──── * SocialIdentity        (가입 수단 — 소셜 4종)
Account 1 ──── 1 Profile               (닉네임·온보딩 완료)
Account 1 ──── 1 PreferenceSet         (취향 7축 — 미설정 축 NULL)
Account 1 ──── * ConsentRecord         (동의 증적 — append-only·법정 보존)
Account 1 ──── 1 MarketingConsent      (현재 상태 — U0 UI 이연)
Account 1 ──── * RefreshSession        (기기별 회전 체인)
Account 1 ──── 0..1 DeletionSchedule   (활성 유예 최대 1)
TermsVersion * ─── * ConsentRecord     (terms_type+version 참조)
Outbox                                  (전 모듈 공용 이벤트 적재 — V1.0)
```

## 2. 엔티티 정의

### Account (`account`, V1.1)
| 속성 | 의미 | 규칙 |
|---|---|---|
| email | 소셜 제공 이메일 (NULL=미제공, Apple 릴레이 등) | 활성 계정 간 소문자 유일 (INV-A3) |
| age_method / birth_date / age_confirmed_at | 연령 확인 방식·근거·시각 | `BIRTH_DATE`면 birth_date 필수 (INV-A2) |
| status | `ACTIVE → DELETION_PENDING → DELETED` | 소셜 가입=즉시 ACTIVE. `PENDING_VERIFICATION`은 이메일 가입(이연) 예약값 — MVP 도달 불가 |
| sanction_status | `NONE/WARNED/COMMUNITY_SUSPENDED/FULLY_SUSPENDED` | U0은 NONE만 생성 — 제재 로직 후속 유닛 |

**상태 전이**: `ACTIVE --삭제요청--> DELETION_PENDING --재로그인 복구--> ACTIVE`, `DELETION_PENDING --purge_at 도래--> DELETED(파기)`.

### SocialIdentity (`social_identity`, V1.1)
- `(provider, provider_sub)` 전역 유일 (INV-S1) — 동일 소셜 계정의 중복 가입 차단.
- 계정 삭제 시 CASCADE (INV-S2). U0에서는 계정:소셜 = 1:1로 생성(복수 연결·병합은 후속).

### TermsVersion (`terms_version`, V1.2)
- 6종 타입: `TERMS_OF_SERVICE` · `PRIVACY_POLICY` · `LOCATION_TERMS` (**U0 필수 3종**) / `MARKETING` · `GPS_RECORDING` · `PERSONALIZATION` (이연 축 — 타입만 존재).
- `(terms_type, version)` 유일 (INV-T1), 현행판 = `effective_at` 최신 (INV-T2). `reconsent_required`로 재동의 필요 판 표시(흐름 이연 — G-4).

### ConsentRecord (`consent_record`, V1.2) — **append-only**
- `GRANT/REVOKE` 이벤트 축적, 현재 상태는 최신 레코드로 fold (INV-C2 인덱스).
- 계정 FK에 CASCADE 없음 — **계정 파기 후에도 법정 보존**. app 역할의 UPDATE/DELETE 권한 회수(V1.7).
- channel: `ONBOARDING`(U0 사용) / `RECONSENT`·`SETTINGS`(이연).

### Profile (`profile`, V1.5)
- 닉네임 2~20자, 전역 소문자 유일. 자동 생성 기본값으로 시드(US-ONB-03), 금칙어 검사(moderation V1.6) 통과 필수.
- `onboarding_completed_at` NULL=미완료 — 부트스트랩 `ONBOARDING_INCOMPLETE` 판정 근거.

### PreferenceSet (`preference_set`, V1.5)
| 축 | 값 도메인 (DB CHECK 그대로) | 선택 |
|---|---|---|
| styles | 휴양·관광·액티비티·미식·쇼핑·자연·문화예술 | 복수 |
| budget_tier / budget_raw_amount | 저가·중간·고급·럭셔리 / 양수 총액 | 단일 (총액은 tier 동반 — INV-PR3) |
| companion_types (+pet_flag) | 혼자·커플·친구·가족·부모님 (+반려동물 불리언) | 복수 |
| activities | 자연·역사문화·테마파크·맛집투어·카페·전시·야경·쇼핑 | 복수 |
| transport_modes | 도보·대중교통·렌터카·택시·자전거 | 복수 |
| food_tastes | 한식·양식·일식·중식·아시안 | 복수 |
| pace | 느긋하게·균형있게·알차게 | 단일 |

- 각 축 NULL=미설정 (INV-PR2). **중립 기본값은 저장하지 않고 조회 시 파생** — 개인화 입력 응답은 항상 완전(`isNeutralDefault` 플래그 동반).

### RefreshSession (`refresh_session`, V1.4)
- 기기별 회전 체인: `chain_id`당 현행(미회전·미폐기) 토큰 최대 1개 (INV-R1). `token_hash`만 저장(원문 미저장).
- 수명 90일(`expires_at`). `rotated_at`≠NULL 토큰 제시 = 재사용 감지 → 체인 전체 revoke.

### DeletionSchedule (`deletion_schedule`, V1.4)
- `purge_at = requested_at + 30일`. 계정당 활성 유예 1개 (INV-D1). `cancelled_at` = 재로그인 복구.
- `cascade_summary`(jsonb): 파기 시 삭제 범위 요약 — 후속 유닛이 도메인 추가 시 갱신 규약.

### Outbox (`outbox`, V1.0) — 골격만(Q9)
- U0 발행 이벤트: `AccountCreated`, `AccountDeletionRequested`, `PreferencesUpdated`(C2). 상태 변경과 단일 TX 적재. 릴레이 실소비는 후속 유닛(U1+).
