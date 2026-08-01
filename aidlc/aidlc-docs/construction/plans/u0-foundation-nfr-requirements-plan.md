# U0 Foundation — NFR Requirements Plan

> 입력: `construction/u0-foundation/functional-design/` 4종 (BR-U0-01~30). 기확정 컨텍스트: security-baseline **Full(blocking)** · resiliency-baseline **Full** · PBT **부분(PBT-02·03·07·08·09 blocking)** (aidlc-state Extension Configuration) · 단일 리전+다중 AZ · 기존 조직 프로세스(Jira·Slack·Git) · RESILIENCY-04(CI/CD·롤백)·14(복원력 테스트)는 NFR Design 이연.
> 스택 전제: backend 스캐폴드(Kotlin/Spring/Gradle·Flyway V1.x)·frontend 정본(`frontend/README.md`) 기존재 — tech-stack-decisions.md는 신규 선택이 아니라 **기존 결정의 기록+U0 델타**가 중심.

## 실행 계획

- [x] 1. 기능 설계 분석 — 인증·온보딩·부트스트랩·삭제 흐름의 NFR 표면 식별
- [x] 2. 질문 확정 — 사용자 캘리브레이션 지시 "적당한 규모 서비스 + 쾌적한 사용자 경험"(2026-07-17)으로 Q1~Q6 권장안 채택 + UX 절(NFR-U0-UX) 신설·레이트리미터 PostgreSQL 선택(과설계 회피)
- [x] 3. `u0-foundation/nfr-requirements/nfr-requirements.md` — 규모·성능·UX·가용성·보안·복원력·관측성·준수 + PBT 게이트 매핑 (BR 참조 연결)
- [x] 4. `u0-foundation/nfr-requirements/tech-stack-decisions.md` — 기존 결정 기록 + U0 델타 6종 + Infra Design 이연 목록
- [ ] 5. 완료 메시지 → 승인 게이트 → audit·state 반영

## 질문 (2026-07-17 확정 — 사용자 캘리브레이션 "적당한 규모 서비스 + 쾌적한 사용자 경험")

**Q1. 규모 가정** — MVP 설계 부하 가정을 확정해 주세요. 추천: DAU 1만 / 피크 동시 약 500 세션 / 가입 폭주 시나리오(마케팅 스파이크) 10x 헤드룸.
[Answer]: 권장 채택 — DAU 1만·MAU 5만·피크 ~500 세션·~50 RPS·10x 헤드룸(SCALE-01~03)

**Q2. 핵심 API 응답 목표** — 추천: 부트스트랩·로그인·온보딩 저장 p95 < 500ms(서버 처리), 스플래시 총 대기는 3초 타임아웃(BR-U0-27 기확정), 앱 콜드 스타트→첫 화면 < 2.5초 목표.
[Answer]: 권장 채택 + 체감 성능 상향 — PERF-01~04(화면 전환 300ms 체감·온보딩 낙관적 진행 추가)

**Q3. 가용성 목표** — 추천: 월간 99.9%(다중 AZ 전제), 인증 저하 시에도 읽기 전용 진입 불가(인증 필수 앱이라 fail-closed) + 스플래시 로컬 폴백(BR-U0-27)이 완충.
[Answer]: 권장 채택 — AVAIL-01~03

**Q4. 인증 남용 방어 정책** — 소셜 전용이라 비밀번호 브루트포스는 없음. 추천: `/auth/social/*`·`/auth/token/refresh` IP·계정 기준 레이트리밋(429+retryAfter, 임계는 운영 조정 가능하게 외부화), 재사용 감지(BR-U0-08)는 건당 보안 이벤트 알림.
[Answer]: 권장 채택 + 닉네임 검사 경로 추가, 카운터 정본은 PostgreSQL(적당 규모 — Redis 미도입, 병목 실측 시 재평가) — SEC-03

**Q5. 토큰 서명·키 관리** — 추천: JWT ES256 + JWK 셋(kid 롤오버 가능 구조), 서명 키는 시크릿 매니저 보관(제품 선정은 Infrastructure Design). 대칭(HS256)·none 거부 고정.
[Answer]: 권장 채택 — SEC-01 · tech-stack §3

**Q6. 관측성 수준(U0)** — 추천: 서버 stdout 구조화 JSON(상관 ID·PII 마스킹 — TRIP-148 자산) + 보안 이벤트 5분류(가입·로그인 실패 급증·재사용 감지·429 급증·삭제 요청) 정의까지. 수집·대시보드·알림 라우팅 제품은 Infrastructure Design 이연. 클라는 Sentry(프론트 정본 기확정).
[Answer]: 권장 채택 — OBS-01~03

**추가(캘리브레이션 파생)**: "쾌적한 사용자 경험"을 검증 가능한 요구로 구체화 — NFR-U0-UX 절 신설(침묵 실패 금지·스켈레톤 표준·입력 보존·취소 안내 톤·접근성 기본).
