# 2026-07-24 — 20260723-trip172-social-real-wiring

**결말: 코드층 완료로 종결** (게이트①-1 승인 → ②-1 승인(경고#1 조건부) → ②-2 재제시 승인 + 검증 n=1 PASS(재제시 후 해소) + 실기 스모크 n=1 **부분PASS**) · 브랜치 `feature/TRIP-172-FE-app-structure-auth`

> 상세는 옵시디언 개발로그(`TripPilot/개발로그/2026-07-24 20260723-trip172-social-real-wiring.md`)가 정본이다. 이 파일은 요약본 — [메모리]는 이 파일을 읽지 않는다.

## 무엇을 했나

TRIP-172 소셜 로그인 실연동. `EXPO_PUBLIC_AUTH_FAKE=1`을 끄면 드러나는 결함 A~F 중 **A·C·D·E·F 해소, 결함 B(연령확인) 미수정**.

- **결함 A**(로그인해도 로그인 화면에 머문다): `fetchBootstrap`을 인증 클라이언트로 교체 + `resolveBootstrapDestination`이 `onboardingCompleted`를 봄 + `tokenManager.subscribeAccessToken` 신설로 로그인 성공 시 재조회 배선.
- **결함 D**(재시작 시 토큰 미복원): `useBootstrapGate`가 `hydrate`를 첫 조회보다 먼저 실행.
- **결함 E**(인가 실패가 화면을 가둠): `authorize()` reject를 `phase='error'`로 표면화(INV-4), `'exchanging'` phase 신설, `phaseRef` 흐름 잠금.
- **결함 C**(kakao/naver 미설정): `oauthConfig.ts`에 kakao·naver discovery/usePKCE/requiresState 채움(naver는 PKCE 미지원 — `state` 직접 생성 + `codeVerifier` 더미 대체).
- **결함 F**(에러코드 화면 침묵): `SocialLoginScreen.tsx` 에러 배너를 화이트리스트→블랙리스트로 전환.
- **결함 B(연령확인) 미수정** — 인터뷰 결정이 AC로 전환되지 않아 테스트도 구현도 없었다. 재전송 구조(같은 인가코드 재사용, IdP가 거부) 그대로 남음. **다음 사이클 1순위.**
- 03b 경고#1(연령 403 매핑) 대응 중 `??`(널 병합) 우선순위 함정 발견 — 1차 수정(`case 403`)이 실경로에서 죽은 가지였고, `normalizeSocialError` 경계의 번역표(`SERVER_ERROR_CODE_TRANSLATIONS`)로 재수정.

## 게이트·검증

- **게이트①** ①-1 승인(1차, "oauthConfig.ts는 유지로 가") — 승인 테스트/인프라 10건 해시 동결.
- **게이트②** ②-1 승인(1차, "고치고 승인 ㄱㄱ", 경고#1 수정 조건부) → `shared/api/index.ts` 재수정으로 ②-2 재제시 → 승인. 독립 code-critic(03b) 차단 0·경고 2·참고 3, 실제 조치 1건(경고#1), 미처리 4건은 전부 후속 티켓으로 이관.
- **검증 n=1 PASS(재제시 필요)**(`04_qa-verifier_report_1_PASS.md`): 정적 검사 4종 PASS · 게이트① 해시 10/10 · 게이트② 해시 7/8 불변+1건 승인된 변경 · red 소급 원수치 재현(vacuous 없음) · 경계면 QA(INV-3 클린·구조지도 98/98·openapi 드리프트 2건 기록) → 게이트②-2로 해소.
- **실기 스모크 n=1 부분PASS**(`04b_smoke_1_부분PASS.md`): JS 층 4항목 PASS. **⚠️ AC-S7(3종 실기 로그인) 실행 불가** — 네이티브 팟 0건·dev build 7/20·FAKE=1·kakao/naver clientId 부재·google iOS 키 미발급. FAIL 아님, 별도 사이클로 이관. **⚠️ 실기 미검증**임을 명기.
- **구조 지도**: `frontend/docs/structure.md` 갱신(스텁 1건 채움 — oauthConfig kakao/naver, 신규 파일 0건). `subscribeAccessToken` 재사용 API 등재. `structure-index.cjs --check` → `OK — 98행/98파일 일치 · 개념 42개 실존`.

## 후속 (이관)

1. **결함 B(연령확인) 수정 — 다음 사이클 1순위.** 게이트①부터 새 사이클(화면 계약 + 기존 테스트 9건 변경).
2. AC-S7 실기(환경 준비 후) — 구글 iOS 클라이언트 재발급 → 리디렉션 URI 확정 → env 주입+FAKE 해제 → 네이티브 리빌드 → 번들 값 확인.
3. 경고#2(케이스8 "구독 해제 누수 가드" 테스트 보강).
4. 참고#1(재조회 유실 창)·참고#2(난수 강도)·참고#3(naver code_verifier 관용성).
5. bootstrap 콜드스타트 3~4회 연결 HTTP 층 계측(관찰, 미확정).
6. `SERVER_ERROR_CODE_TRANSLATIONS` 번역표 단위 테스트 신설.

## 교훈

- **단락 평가 연산자(`??`)의 폴백 가지는 "코드가 있다"와 "실행된다"가 다르다** — `case 403` 폴백이 실경로에서 0회 실행됐음을 세 층(테스트·뮤테이션·1차수정)이 놓쳤고 implementer 자진 보고로만 드러났다. 하네스 규칙 후보(실측 1건, 관찰 지속).
- **게이트①은 AC↔테스트 매핑만 보지 AC 집합의 완전성(goal 결함목록↔AC목록)은 안 본다** — 인터뷰에서 확정된 결함 B가 AC로 안 옮겨져 통째로 증발했다. 하네스 규칙 강한 후보(실측 1건, 관찰 지속).
- **`pnpm test`(`test:node && test:integration`)는 red 상태에서 `&&`로 끊긴다** — verify-gates 정본("쪼개 부르지 마라")과 반대로, red 진단 시엔 두 버킷을 각각 돌려야 했다. 하네스 규칙 후보(실측 1건, 관찰 지속).
- 서브에이전트 API 중단 3회 — `SendMessage` 재개 + 해시 대조(변조 0건)로 컨텍스트 손실 없이 복구. 기존 문제로그(`2026-07-21 test-designer 시정 라운드 API 중단 2회`)에 보강 기록.

상세(전줄 주해·뮤테이션 표·해시 전체값·이해부채 5건·문제로그 3건 신규+1건 보강)는 옵시디언 개발로그 참조.
