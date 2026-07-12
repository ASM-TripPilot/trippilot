# TripPilot U1 API 설계 (계약 초안)

> 대상 유닛: U1 기반·계정·온보딩 (M1 Auth · M2 Profile · C3 Moderation) · 기준일 2026-07-06
> 근거 정본: `domain-entities.md`(엔티티·불변식), `business-logic-model.md`(플로우 7종), `logical-components.md`(LC-2 인증필터·화이트리스트·LC-3 레이트리미터), `tech-stack-decisions.md`(Spring Security 6.4·필터체인)
> 상태: **설계 초안** — 미실행. U2 스플래시가 의존하는 계약(부트스트랩·세션)의 공급자측 정본.

## 0. 범위

U1이 노출하는 HTTP API 계약을 정의한다. 대응 플로우: 소셜 통합 / 약관·재동의 / 취향 위저드 / 토큰 회전·탈취 감지 / 삭제 라이프사이클 / 닉네임 + 부트스트랩(U2 계약). 실현가능성·검증은 서버가 소유하며, 소셜 토큰 교환은 전부 서버측(시크릿 비노출).

> **⚠️ MVP 스코프 — 소셜 로그인 전용.** 1차는 소셜 로그인(Google·Apple·Kakao·Naver)만 노출한다. 이메일 가입·인증·비밀번호 로그인·비밀번호 재설정 엔드포인트는 **후속 이연**(아래 각 섹션에 이연 표기). 원설계는 보존하며 이메일 로그인 도입 시 복원한다.

## 1. 공통 규약

| 항목 | 결정 |
|---|---|
| Base path | `/api/v1` |
| 포맷 | `application/json; charset=utf-8`, 필드 camelCase |
| 인증 | `Authorization: Bearer <accessToken>` — 무상태 검증(서명·exp·iss·aud). 기본 `authenticated()`, 공개는 화이트리스트만(§2) |
| 액세스 토큰 | 수명 1시간, 자기서명 검증형(서버 미저장) |
| 리프레시 토큰 | 수명 90일, 회전형. 응답 본문으로 전달 → 클라이언트 OS 보안 저장소 보관. 갱신 시 회전(단일 비행) |
| 시각 | ISO-8601 UTC (`2026-07-06T09:00:00Z`) |
| 상관 ID | 요청 `X-Request-Id`(선택) → 응답 반향 + 로그 MDC. 미제공 시 서버 생성 |
| 멱등성 | 상태변경 재시도 안전 필요 엔드포인트(가입·삭제요청)는 `Idempotency-Key` 헤더 수용(선택) |
| 검증 | 전 요청 DTO 서버 검증(SECURITY-05) — 클라이언트 검증은 UX용, 서버가 정본 |
| 에러 | 일반화 응답(SECURITY-15) — 인증·인가 실패는 원인 비노출. 봉투는 §5 |
| Rate-limit | 초과 시 `429` + `Retry-After`(초) 헤더 (LC-3) |

### 1.1 토큰 응답 스키마 (`TokenPair`)

```json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "refreshToken": "def502...",
  "refreshExpiresIn": 7776000,
  "account": { "accountId": "9b1e...", "status": "ACTIVE", "onboardingCompleted": false }
}
```

## 2. 공개(인증 불요) 엔드포인트 화이트리스트

`NFR-U1-SEC-16` 전수 목록. 이외 전 경로는 인증 필요.

```
POST /api/v1/auth/social/{provider}
POST /api/v1/auth/token/refresh
GET  /api/v1/terms            (현행 약관 열람 — 온보딩 표시용)
GET  /api/v1/terms/{termsType}
GET  /api/v1/bootstrap        (Bearer 선택 — 세션 유효성 겸용 판정)
GET  /api/v1/health/liveness  (LB 전용)
```

> 이연(후속): `POST /auth/signup/email` · `POST /auth/login/email` · `POST /auth/email/verify(+/resend)` · `POST /auth/password/reset/request(+/confirm)` — 이메일 로그인 도입 시 화이트리스트에 복원.

## 3. 엔드포인트 카탈로그

### 3.1 인증·세션 (M1)

| Method · Path | 설명 | 주요 응답 | Flow·Story |
|---|---|---|---|
| POST `/auth/social/{provider}` | 소셜 code 교환(서버측) → 신규=가입(연령확인 동반)·기존=로그인, 즉시 ACTIVE | `200` TokenPair (`isNewUser`) | FLOW-1, D22 |
| POST `/auth/token/refresh` | 리프레시 회전. 재사용 감지 시 체인 무효화 | `200` TokenPair / `401` | FLOW-5, D36 |
| POST `/auth/logout` | 현재 기기 체인 revoke | `204` | INV-R3 |

> **이연(후속 — 이메일 로그인).** `POST /auth/signup/email`(가입→PENDING_VERIFICATION), `/auth/email/verify(+/resend)`, `/auth/login/email`, `/auth/password/reset/request(+/confirm)`. 원설계(FLOW-2·자동로그인·재설정 시 전 기기 무효화 INV-R3)는 보존.

### 3.2 온보딩 — 약관·동의 (M1)

| Method · Path | 설명 | 응답 | 근거 |
|---|---|---|---|
| GET `/terms` | 현행 약관/문서 목록(타입·버전·본문) | `200` `TermsVersion[]` | INV-T2, N5 |
| GET `/me/consents` | 항목별 현재 동의 상태(증적 폴드) | `200` | INV-C2 |
| POST `/me/consents` | 온보딩 일괄 동의 제출 — **필수 2종(이용약관·개인정보) + 선택 마케팅** (와이어프레임 c06) | `200` | FLOW-3 |
| PATCH `/me/consents/{termsType}` | 개별 GRANT/REVOKE(설정·재동의) | `200` | FLOW-3, US-E1-18 |
| PUT `/me/marketing-consent` | 마케팅 수신 동의 토글(수집만) | `200` | N8 |

### 3.3 위치 동의 3층 (M1)

| Method · Path | 설명 | 근거 |
|---|---|---|
| GET `/me/location-consent` | L1 미러·L2·L3 현재 상태 + 유효 능력 매트릭스 | G182 |
| PUT `/me/location-consent` | L2(법정)·L3(GPS 옵트인) 변경 → 증적 추가·철회 시 파기 트리거 | INV-L4 |
| PATCH `/me/location-consent/os-permission` | L1 OS 권한 미러 보고(단말→서버) | G182 |

> **와이어프레임 정합(c06/c08/l06)**: `LOCATION_TERMS`(위치기반서비스 약관·법정 동의 L2)는 온보딩 약관 게이트(c06)에서 받지 않고 **위치 동의 플로우(c08 프리프롬프트·l06 위치정보 동의)** 에서 수집한다 — `PUT /me/location-consent` 시 `consent_record(LOCATION_TERMS)` 증적을 남긴다. 즉 온보딩 완료 필수 약관은 이용약관·개인정보 2종이고, 위치 동의는 **위치 기능 게이트**(온보딩 게이트 아님). c08 "나중에 하기"·l06 "동의를 꺼도 계속 동작" 반영. → 정본 INV-C3(필수 3종) 대비 변경.

### 3.4 프로필·닉네임 (M2 · C3)

| Method · Path | 설명 | 근거 |
|---|---|---|
| GET `/me/profile` | 프로필 조회(닉네임·온보딩 완료 여부) | US-E1-11 |
| POST `/nickname/suggestions` | 자동 생성 닉네임 후보(사전 검증 통과값) | G23, INV-P1 |
| POST `/nickname/check` | 닉네임 유효성(길이·금칙어·유니크) 검사 — 매칭 원문 미노출 | C3, INV-B3 |
| PATCH `/me/profile/nickname` | 닉네임 변경(3검증 통과 시) | INV-P1 |
| POST `/onboarding/complete` | 온보딩 완료 처리(멱등) — 약관+닉네임 판정 | FD-U1-09, INV-P2 |

### 3.5 취향 7축 (M2)

| Method · Path | 설명 | 근거 |
|---|---|---|
| GET `/me/preferences` | 7축 조회 — **항상 완전한 응답**(미설정 축은 중립 기본값 파생 주입, `isNeutralDefault` 표시) | INV-PR5, US-E1-14 |
| PUT `/me/preferences` | 7축 저장(부분 허용, 즉시 반영) | US-E1-12 |

### 3.6 계정 라이프사이클 (M1)

| Method · Path | 설명 | 응답 | 근거 |
|---|---|---|---|
| GET `/me` | 계정 요약(status·이메일·소셜연결) | `200` | — |
| POST `/me/deletion` | 삭제 요청 → DELETION_PENDING, 연쇄 범위 고지·GPS 즉시 파기 | `200` `{purgeAt, cascadeSummary}` | FLOW-6, D18/D34 |
| DELETE `/me/deletion` | 유예 내 철회 → ACTIVE 복원(GPS 미복원) | `200` / `404` | INV-D2 |

### 3.7 부트스트랩 (U2 소비 계약)

| Method · Path | 설명 | 근거 |
|---|---|---|
| GET `/bootstrap` | 앱 기동 분기 — **우선순위: 강제 업데이트 > 재동의 > 세션**(공급자측 정본) | FD-U1-10, N3/N4/G5 |

## 4. 주요 요청/응답 예시

### 4.1 소셜 로그인/가입 (서버 code 교환)

신규 `(provider, sub)`=가입(즉시 ACTIVE), 기존=로그인. 최초 가입 시 연령 확인을 함께 받는다(N1/D33 — 경로 무관 필수).

```http
POST /api/v1/auth/social/kakao
{
  "authorizationCode": "abc...",
  "codeVerifier": "xyz...",
  "redirectUri": "trippilot://auth",
  "ageConfirmation": { "method": "SELF_DECLARED" }   // 신규 가입 시 필수, 기존 로그인 시 무시
}
→ 200 OK
{ ...TokenPair, "isNewUser": true }
```

### 4.3 토큰 회전

```http
POST /api/v1/auth/token/refresh
{ "refreshToken": "def502..." }
→ 200 OK  (새 TokenPair — 구 리프레시 회전 소비)
# 이미 회전된 토큰 재사용 시: 401 + 체인 전체 무효화 + 보안 알림 (INV-R2)
```

### 4.4 취향 조회(중립 기본값 파생)

```json
GET /api/v1/me/preferences → 200
{
  "styles": { "value": ["휴양","미식"], "isNeutralDefault": false },
  "transportModes": { "value": ["대중교통"], "isNeutralDefault": true },
  "pace": { "value": "균형있게", "isNeutralDefault": true },
  "budget": { "tier": null, "rawAmount": null, "isNeutralDefault": true }
}
```

### 4.5 부트스트랩

```json
GET /api/v1/bootstrap  (Authorization 선택) → 200
{
  "appUpdate": { "status": "NONE", "minSupportedVersion": "1.0.0" },
  "reconsent": { "required": true, "termsTypes": ["PRIVACY_POLICY"] },
  "session": { "state": "AUTHENTICATED", "onboardingCompleted": false }
}
```
클라이언트는 `appUpdate.status=FORCED` → `reconsent.required` → `session` 순으로 분기.

### 4.6 삭제 요청

```json
POST /api/v1/me/deletion → 200
{
  "purgeAt": "2026-08-05T09:00:00Z",
  "cascadeSummary": { "trips": 3, "archives": 12, "photos": 48,
    "legallyRetained": ["LOCATION_LEGAL_LOG","CONSENT_RECORD"] }
}
```

## 5. 에러 봉투·코드

```json
{ "error": {
    "code": "NICKNAME_TAKEN",
    "message": "이미 사용 중인 닉네임입니다.",
    "traceId": "req-9b1e...",
    "fields": [ { "field": "nickname", "reason": "duplicate" } ]   // VALIDATION_ERROR만
} }
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 입력 검증 실패(`fields` 포함) |
| 401 | `UNAUTHORIZED` | 토큰 없음·무효·만료(일반화 — 원인 비노출) |
| 401 | `REFRESH_REUSE_DETECTED` | 회전 토큰 재사용(체인 무효화됨) |
| 401 | `SOCIAL_AUTH_FAILED` | 소셜 code 교환·토큰 검증 실패(제공자 응답 무효) |
| 403 | `FORBIDDEN` | 권한 없음(일반화) |
| 404 | `RESOURCE_NOT_FOUND` | 대상 없음(유예 만료 후 철회 등) |
| 409 | `NICKNAME_TAKEN` | 닉네임 유니크 충돌 |
| 409 | `SOCIAL_EMAIL_CONFLICT` | 소셜 이메일이 타 계정과 충돌(BR-U1-03 처리) |
| 422 | `AGE_REQUIREMENT_NOT_MET` | 만 14세 미만(생성 차단) |
| 429 | `RATE_LIMITED` | 소셜 로그인·토큰 갱신 상한 초과(`Retry-After`) |
| 503 | `MODERATION_UNAVAILABLE` | 금칙어 사전 미로드 — 저장 보류(fail-closed, INV-B2) |

> 이연: `EMAIL_ALREADY_EXISTS`·`TOKEN_EXPIRED`(이메일 인증·재설정 토큰)는 이메일 로그인 도입 시 복원.

## 6. 설계 결정 (✅ 확정 2026-07-06)

1. **소셜 로그인 요청 형태** — `authorizationCode`(+PKCE)를 서버에 전달, 교환·검증은 전부 서버측(tech-stack §2.4 확정). → ✅ **확정**.
2. **온보딩 동의 제출 단위** — `POST /me/consents` 일괄 + 항목별 `PATCH` 병행. → ✅ **확정**.
3. **부트스트랩 인증 처리** — Bearer 선택 수용(무토큰=GUEST). → ✅ **확정**.
4. **API 버저닝** — path `/v1` 고정. → ✅ **확정**.
5. **닉네임 후보/검사 위치** — 별도 엔드포인트 `/nickname/*`(후속 UGC 재사용 고려). → ✅ **확정**.

## 7. 다음 단계

이 계약을 **OpenAPI 3.1(`openapi.yaml`)** 로 정식화 완료(취향 enum·`companionTypes` 반영). 클라이언트(Zod)·서버(DTO) 계약 테스트 기준으로 사용.
