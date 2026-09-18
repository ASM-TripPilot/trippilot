# U0 Foundation — Functional Design Plan

> **유닛**: U0 Foundation & Walking Skeleton (Auth C1 · User Profile C2 · 앱셸/내비 · 크로스커팅 스캐폴딩)
> **스토리**: US-SHELL-01~04 (스플래시·홈·5탭·탭바 숨김) + US-ONB-01~15 (인증·약관·닉네임·위치권한·취향 7종·페이스) = 19개
> **범위 주의(SCOPE.md 2026-07-17)**: 이 유닛의 산출물은 설계 문서까지 — Code Generation 없음. 코드는 팀이 `backend/`·`frontend/`에서 직접 개발.
> **기존 구현물**: backend에 Flyway V1.0~V1.6(outbox·auth_account·auth_location·auth_session·moderation 등)과 `backend/docs/design/openapi.yaml`(U1-API 설계, 20 경로)이 이미 존재 — 본 설계의 정합 기준선(Q2 참조).

## 실행 계획

- [x] 1. 유닛 컨텍스트 분석 — unit-of-work.md(U0)·story-map(19 스토리)·inception stories 에픽 A·B·components C1/C2
- [x] 2. 질문 수집·모호성 해소 — Q1~Q9 답변 + 보충 4건 확정(2026-07-17): 소셜4종만 / 기준선=main V1.0~V1.7+openapi(전 브랜치 무변경 확인) / 자격증명 양쪽 수용 / 스킵 개별+일괄 / 필수 동의 3종+연령 포함·재동의 이연 / 토큰 1h·90d 회전·다기기·체인 무효화 / 5탭=홈·탐색·일정·기록·마이 / 삭제 30일 유예+재로그인 복구 / 크로스커팅 골격만
- [x] 3. `u0-foundation/functional-design/business-logic-model.md`
- [x] 4. `u0-foundation/functional-design/domain-entities.md`
- [x] 5. `u0-foundation/functional-design/business-rules.md` — BR-U0-01~30
- [x] 6. `u0-foundation/functional-design/frontend-components.md`
- [x] 7. 정합 검증 — business-logic-model.md §8: 정합 확인 7항 + 갭 G-1~G-4 (G-1: openapi SocialLoginRequest에 SDK 토큰 미수용 → 개정 필요)
- [ ] 8. 완료 메시지 제시 → 사용자 승인 게이트 → audit.md·aidlc-state.md 반영

## 질문 (모두 [Answer]: 에 답해 주세요)

**Q1. 인증 수단 범위** — U0 인증은 소셜 4종(Google·카카오·네이버·Apple)만이고 이메일 가입·비밀번호 로그인은 이연이 맞습니까? (현 openapi.yaml에도 이메일 가입 경로 없음)
[Answer]: 맞음

**Q2. 기존 구현물의 지위** — 이미 main에 머지된 backend Flyway V1.0~V1.6 스키마와 openapi.yaml을 U0 기능 설계의 **기준선(변경 시 마이그레이션 필요한 제약)**으로 수용합니까, 아니면 설계 문서가 우선이고 스키마를 재작업할 수 있습니까?
[Answer]: 다른 브랜치도 백엔드 작업물 있음 확인 할 수 있으면 확인

**Q3. 소셜 로그인 자격 증명 계약** — 프론트는 카카오·네이버를 네이티브 SDK 간편 로그인으로 구현 예정이라 서버에 **인가 코드가 아닌 SDK 발급 토큰**이 전달될 수 있습니다. `/auth/social/{provider}`가 (a) 인가 코드만, (b) SDK 토큰만, (c) 양쪽 모두 수용 — 어느 쪽으로 설계합니까?
[Answer]: 일단 양쪽으로 해보자

**Q4. 온보딩 취향 7단계 건너뛰기 정책** — 각 단계 개별 건너뛰기 + 전체 일괄 건너뛰기(탈출구) 둘 다 허용하고, 미설정 축은 중립 기본값으로 채워 일정 생성이 항상 가능해야 합니까?
[Answer]: 맞음

**Q5. 약관·동의 구성** — 필수/선택 동의 항목 구성을 확정해 주세요 (예: 서비스 이용약관+개인정보 필수, 위치기반서비스 별도 필수, 마케팅 선택). 약관 버전 갱신 시 재동의 흐름과 연령 확인(만 14세 이상?)도 U0 포함입니까?
[Answer]: 서비스 이용약관, 위치기반만 일단

**Q6. 세션·토큰 정책** — 액세스 토큰 수명 / 리프레시 토큰 수명·회전 여부 / 다기기 동시 로그인 허용 여부 / 리프레시 재사용 감지 시 처리(체인 전체 무효화?)를 확정해 주세요. (기존 auth_session 스키마가 회전 체인을 전제한다면 Q2 답변과 정합 필요)
[Answer]: 이건 추천해줘

**Q7. 5탭 구성 확정** — 앱셸의 5탭이 무엇인지 확정해 주세요 (예: 홈 · 일정 · 기록 · 알림 · 마이). 이 답은 frontend 라우트 골격(src/app/(tabs)/)의 기준이 됩니다.
[Answer]: 홈 탐색 일정 기록 마이

**Q8. 계정 삭제 정책** — 즉시 파기입니까, 유예 기간(예: 30일) 후 파기입니까? 유예 중 재로그인 시 복구 허용 여부도 함께.
[Answer]: 30일 이후

**Q9. 크로스커팅 스캐폴딩 깊이** — U0에서 아웃박스 릴레이·레이트리미터·감사 로그 파이프라인을 (a) 실동작까지, (b) 인터페이스+테이블 골격까지 중 어디까지 설계합니까? 위치 권한은 U0에서 프리프롬프트 프레임만 두고 실제 OS 발화는 후속 유닛(탐색·여행 중)으로 미루는 게 맞습니까?
[Answer]: 골격만
