# E13. 출시·데모 준비

> 이 문서의 `PR*`, `REL-*`, `ST-*`는 실제 Jira 키가 아니라 `Requirement ID`/`External ID`다. 실제 이슈 키는 Jira 생성 시 자동 발급한다. `scope.md`의 PR1~PR9와 다른 문서의 P1~P9는 같은 항목이며 여기서는 PR1~PR9로 통일한다.

## Epic

- **Issue Type**: Epic
- **Epic ID**: E13
- **Summary**: `[E13] 2026년 11월 출시·데모 준비`
- **Fix Version**: `MVP-2026.11`
- **Priority**: P0
- **Target Sprint**: S0~S9
- **Unit**: Release
- **Components**: legal, partnerships, security, qa, operations, mobile, server
- **목표**: 비개발 선결 과제, 시스템 검증, 스토어 후보, 운영 준비와 데모 시나리오를 완료해 2026-11-30에 승인된 릴리스 후보로 시연한다.
- **범위 제외**: E10~E12 출시, 앱 내 예약·결제, 해외·다국어, 제품 정본에 없는 데모 전용 기능
- **Source**: [범위 §7](../scope.md), [NFR](../nfr.md), [인프라](../infrastructure.md), [시나리오](../scenarios.md)

### Epic 완료 기준

- [ ] PR1~PR9가 증빙 링크와 함께 완료되고 미완 게이트가 없다.
- [ ] E1~E9와 E0의 release-blocking 이슈가 Done이며 P0/P1 Bug가 0건이다.
- [ ] 11-13 Feature Complete, 11-20 Code Freeze, 11-24 RC, 11-27 Go/No-Go 승인을 통과한다.
- [ ] 보안·개인정보·성능·복원력·80% coverage·E2E 결과가 승인됐다.
- [ ] 스토어 후보와 동일한 불변 빌드로 11-30 시나리오 A/B/C 데모를 수행한다.

---

## PR1. 위치기반서비스사업 신고 및 법무 자문

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S3
- **Due Date**: 2026-09-04
- **Owner Role**: Legal/PO
- **Blocks**: E6·E7 위치 기능 활성화, Go/No-Go
- **Source**: `scope.md` PR1, N2, D34, ADR-0017

**완료 조건**:

- [ ] 적용 서비스와 수집·이용·제공 흐름을 위치정보 전문 변호사가 검토했다.
- [ ] 위치기반서비스사업 신고를 제출하고 접수·완료 증빙을 보관했다.
- [ ] 신고 범위가 OS 권한·법정 동의·GPS 기록 옵트인 3층 모델 및 포그라운드 수집과 일치한다.
- [ ] 위치정보 수집·이용·제공 사실 확인자료는 append-only로 6개월 이상 보존하고 앱 역할이 수정·삭제할 수 없음을 법무·DB 테스트로 확인했다.
- [ ] 신고 완료 전 위치 기능을 비활성화할 feature flag와 사용자 안내가 검증됐다.

**Sub-tasks**:

- [ ] `ST-PR1-01` `[LEGAL]` 위치 데이터 흐름·보존·파기·제3자 제공 목록을 법무 검토본으로 확정한다.
- [ ] `ST-PR1-02` `[LEGAL]` 사업 신고 서류를 제출하고 접수번호·보완 요청·완료 증빙을 Jira에 첨부한다.
- [ ] `ST-PR1-03` `[PO]` 신고 범위와 제품 화면·정책 문안·운영 절차의 차이를 0건으로 정리한다.
- [ ] `ST-PR1-04` `[QA]` 신고 미완 feature flag에서 위치 기능이 fail-closed 되는지 검증한다.

---

## PR2. 국내 지도 API 약관 검토·계약

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S1
- **Due Date**: 2026-08-07
- **Owner Role**: Partnerships/Legal
- **Blocks**: E3 설계 완료, E5 도로 거리, Go/No-Go
- **Source**: `scope.md` PR2, D08, D13

**완료 조건**:

- [ ] 카카오 장소 검색·지오코딩, 카카오모빌리티 도로 거리, 네이버 2차 폴백의 사용 약관·쿼터·표시 의무를 확정했다.
- [ ] 사용자 확정 숙소·POI 스냅샷 영구 저장의 약관 적합성을 서면 확인했다.
- [ ] 캐시 TTL, 원본 소실, 출처 표기, 금지 사용과 삭제 요청 절차가 구현 티켓에 반영됐다.
- [ ] 개발·운영 자격 증명과 비용 한도·80% 쿼터 알람이 준비됐다.

**Sub-tasks**:

- [ ] `ST-PR2-01` `[LEGAL]` provider별 저장·캐시·표시·재배포 조항을 비교하고 허용 행렬을 승인한다.
- [ ] `ST-PR2-02` `[PARTNER]` 개발/운영 앱 등록·계약·쿼터 신청을 완료한다.
- [ ] `ST-PR2-03` `[ARCH]` 확정 스냅샷과 TTL 캐시의 데이터 경계를 D13 계약에 반영한다.
- [ ] `ST-PR2-04` `[OPS]` 자격 증명·비용·쿼터 대시보드와 provider 장애 연락망을 검증한다.

---

## PR3. 기상청 공공데이터 API 활용 신청

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S5
- **Due Date**: 2026-10-02
- **Owner Role**: Backend/PO
- **Blocks**: E7 날씨 자동 트리거
- **Source**: `scope.md` PR3, D10, D27

**완료 조건**:

- [ ] 단기예보·기상특보 API 활용 신청과 운영 키 발급을 완료했다.
- [ ] 강수확률 60% 이상·기상특보 판정에 필요한 필드·갱신 주기·격자 변환을 확인했다.
- [ ] 호출 쿼터·출처 표기·캐시 허용 조건과 장애 연락 경로를 기록했다.
- [ ] 운영 키 미발급·쿼터 초과·지연 시 날씨 트리거만 중지하고 수동 Plan-B는 유지되는지 검증했다.

**Sub-tasks**:

- [ ] `ST-PR3-01` `[PARTNER]` 공공데이터 활용 신청·운영 키 발급 증빙을 첨부한다.
- [ ] `ST-PR3-02` `[BE]` 샘플 응답·격자 좌표·특보 코드를 contract fixture로 고정한다.
- [ ] `ST-PR3-03` `[QA]` 결측·지연·쿼터 초과·오래된 캐시의 Plan-B 저하 모드를 검증한다.

---

## PR4. TourAPI 활용 신청 및 캐싱 조건 확인

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S1
- **Due Date**: 2026-08-07
- **Owner Role**: Backend/Legal
- **Blocks**: E3 숙소·POI 데이터
- **Source**: `scope.md` PR4, D09, D13

**완료 조건**:

- [ ] TourAPI 활용 신청과 운영 키 발급을 완료했다.
- [ ] 국내 숙소·POI 필드, 이미지·영업시간·좌표의 이용·저장·캐시·출처 조건을 확인했다.
- [ ] 데이터 없음·폐업·소실·중복 ID 처리와 canonical POI 매핑 정책이 승인됐다.
- [ ] 데이터 채움률 표본과 카카오/네이버 폴백 기준을 수치로 기록했다.

**Sub-tasks**:

- [ ] `ST-PR4-01` `[PARTNER]` API 활용 신청·키·쿼터 증빙을 첨부한다.
- [ ] `ST-PR4-02` `[LEGAL]` 저장·이미지·출처·캐시 조건을 D13 허용 행렬에 반영한다.
- [ ] `ST-PR4-03` `[DATA]` 주요 국내 권역 표본의 채움률·중복·결측 리포트를 만든다.
- [ ] `ST-PR4-04` `[QA]` TourAPI 0건·소실·invalid response 폴백 fixture를 승인한다.

---

## PR5. OTA 어필리에이트 제휴 계약

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S7
- **Due Date**: 2026-10-30
- **Owner Role**: Partnerships/Legal
- **Blocks**: E9 제휴 고지, Go/No-Go
- **Source**: `scope.md` PR5, ADR-0003·0012, US-E3-05·06

**완료 조건**:

- [ ] 지원 OTA별 어필리에이트 계약·딥링크 형식·허용 파라미터·수수료 고지 문안을 확정했다.
- [ ] OTA 크롤링, 앱 내 예약·결제·재고·리뷰·평점 비제공 경계를 계약과 제품에 일치시켰다.
- [ ] 파트너 미지원·앱 미설치·링크 실패 시 검색 웹 fallback이 검증됐다.
- [ ] 예약 결과 postback 1탭 등록은 Future로 분리되고 MVP 수동 복귀 카드만 계약 범위에 있다.

**Sub-tasks**:

- [ ] `ST-PR5-01` `[PARTNER]` 대상 OTA 우선순위와 계약·딥링크 사양을 확정한다.
- [ ] `ST-PR5-02` `[LEGAL]` 광고·제휴 고지 문안과 노출 위치를 승인한다.
- [ ] `ST-PR5-03` `[QA]` provider별 앱/웹 딥링크와 fallback을 실기기에서 검증한다.
- [ ] `ST-PR5-04` `[ANALYTICS]` 개인정보 없는 outbound click event와 partner attribution을 검증한다.

---

## PR6. LLM 벤더 계약·비용·국외 이전 고지

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S4
- **Due Date**: 2026-09-18
- **Owner Role**: AI/Legal/Finance
- **Blocks**: E5, E8 AI 경로
- **Source**: `scope.md` PR6, D11, D31

**완료 조건**:

- [ ] 단일 관리형 LLM 벤더·모델 티어·데이터 보존/학습 제외·리전·SLA·DPA 조건을 계약했다.
- [ ] 개인정보 국외 이전·처리위탁 고지 문안과 최소 전송 필드가 법무 승인을 받았다.
- [ ] 기능별 token/call 예산, 사용자 rate limit, 월 비용 상한과 80% 알람을 확정했다.
- [ ] 서버 재조회 D31 권한 경계와 로그 redaction을 보안 리뷰했다.
- [ ] 계약 장애 시 결정론 솔버·기본 회고 카드 fallback으로 핵심 여정이 지속된다.

**Sub-tasks**:

- [ ] `ST-PR6-01` `[AI]` 모델 티어별 품질·지연·비용 benchmark와 추천안을 작성한다.
- [ ] `ST-PR6-02` `[LEGAL]` DPA·국외 이전·처리위탁·학습 제외 조건과 고지 문안을 승인한다.
- [ ] `ST-PR6-03` `[FINANCE]` 사용자/기능별 비용 예산·rate limit·중단 기준을 승인한다.
- [ ] `ST-PR6-04` `[SEC]` 전송 allowlist·권한 재조회·prompt/output logging 정책을 검증한다.

---

## PR7. 약관 3종 및 개인정보 문안 확정

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S3
- **Due Date**: 2026-09-04
- **Owner Role**: Legal/PO
- **Blocks**: E1 production 문안 활성화, E6/E7 위치 기능 출시, E9 정책 재열람, Go/No-Go. E1 개발은 버전된 비운영 placeholder 문안으로 병행 가능
- **Source**: `scope.md` PR7, N2·N3·N5·N8

**완료 조건**:

- [ ] 이용약관·개인정보처리방침·위치기반서비스 이용약관의 버전된 최종 문안이 승인됐다.
- [ ] 필수 3종 분리 동의, GPS 기록 선택 동의, 마케팅 선택 동의와 철회 효과가 문안과 일치한다.
- [ ] 중대/경미 개정 기준·재동의·공지·증적 보존 절차가 정의됐다.
- [ ] LLM 국외 이전, OTA 제휴, 보존·삭제·30일 유예·법정 로그 예외가 반영됐다.
- [ ] 앱 내 상시 열람 URL과 지원 이메일이 운영된다.

**Sub-tasks**:

- [ ] `ST-PR7-01` `[LEGAL]` 데이터 처리 목록과 약관 3종 최종본·버전·효력일을 확정한다.
- [ ] `ST-PR7-02` `[PO]` 동의 UI 문구·선택/필수·철회 결과를 법무 문안과 대조한다.
- [ ] `ST-PR7-03` `[OPS]` 버전 문서 호스팅·변경 공지·지원 이메일 운영 경로를 준비한다.
- [ ] `ST-PR7-04` `[QA]` 각 버전·재동의·철회·탈퇴 시나리오를 법무 승인본으로 UAT한다.

---

## PR8. 금칙어 기본 사전 확보

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S1
- **Due Date**: 2026-08-07
- **Owner Role**: Trust & Safety/PO
- **Blocks**: E1/E4 production 금칙어 검증·UAT와 Go/No-Go. S0 구현은 버전된 임시 최소 사전으로 병행 가능
- **Source**: `scope.md` PR8, C3, US-E1-03·US-E4-11

**완료 조건**:

- [ ] 한국어 중심 금칙어 사전의 출처·사용 권리·분류·버전이 승인됐다.
- [ ] 공백·기호·자모 분리·대소문자·숫자 치환 우회 정규화 정책을 정의했다.
- [ ] false positive 이의 처리·업데이트·긴급 차단 오너와 SLA가 있다.
- [ ] 사전 로딩 실패 시 로그인은 유지하되 닉네임·제목 저장만 fail-closed 된다.

**Sub-tasks**:

- [ ] `ST-PR8-01` `[T&S]` 사전 소스·라이선스·카테고리·초기 버전을 승인한다.
- [ ] `ST-PR8-02` `[BE]` 정규화·버전 로딩 계약과 fail-closed 경계를 C3에 전달한다.
- [ ] `ST-PR8-03` `[QA]` 우회·정상 단어·다국문자 corpus로 정확도와 회귀 fixture를 검증한다.

---

## PR9. 앱스토어·플레이스토어 계정 및 심사 요건

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S0~S6
- **Due Date**: 2026-10-16
- **Owner Role**: Mobile/PO/Legal
- **Blocks**: production signing, REL-13, Go/No-Go
- **Source**: `scope.md` PR9, N5, `infrastructure.md` §14.7

**완료 조건**:

- [ ] Apple Developer·App Store Connect·Google Play Console 조직 계정과 역할 분리가 완료됐다.
- [ ] Bundle/Application ID, signing, push capability, OAuth redirect, FCM/APNs 설정이 운영 계정에 연결됐다.
- [ ] 개인정보 URL·지원 URL·연락처·연령 등급·권한 사용 설명·데이터 안전 양식 요구를 정리했다.
- [ ] EAS production build/submit 자격 증명이 최소 권한으로 보관되고 복구 담당자가 지정됐다.

**Sub-tasks**:

- [ ] `ST-PR9-01` `[PO]` Apple/Google 조직 계정·계약·세금·역할 구성을 완료한다.
- [ ] `ST-PR9-02` `[APP]` app IDs, signing, APNs/FCM, OAuth redirect와 EAS production profile을 구성한다.
- [ ] `ST-PR9-03` `[LEGAL]` 권한 문구·privacy label/data safety·연령 등급 답변을 승인한다.
- [ ] `ST-PR9-04` `[SEC]` signing/EAS 자격 증명 보관·회전·복구 절차를 검토한다.

---

## REL-10. 요구사항 추적성과 통합 테스트 승인

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S2~S9
- **Due Date**: 2026-11-20
- **Owner Role**: QA/PO
- **Blocks**: Code Freeze
- **Source**: `user-stories.md`, `units.md` §4~§5, `nfr.md` §7

**완료 조건**:

- [ ] E1~E9 102개 Requirement ID가 Jira·PR·테스트·증빙과 1:1 연결되고 누락·중복이 0건이다.
- [ ] Unit/Integration/E2E가 통과하고 전체 및 변경 모듈 coverage가 80% 이상이다.
- [ ] CP1~CP5 공급자·소비자 계약 테스트와 저장→등록→일정→재계획→기록→알림 API E2E가 통과한다.
- [ ] 시나리오 A/B/C UI E2E와 주요 empty/error/permission/fallback이 후보 빌드에서 통과한다.
- [ ] U1~U8의 SECURITY-01~15, RESILIENCY-01~15, PBT-01~10 컴플라이언스 매트릭스가 모두 Pass 또는 근거 있는 N/A이고 Fail 항목이 없다.
- [ ] Out of Scope 기능이 UI·API·스토어 설명에 노출되지 않는다.

**Sub-tasks**:

- [ ] `ST-REL-10-01` `[QA]` 102 Story 추적성 매트릭스와 미충족 AC 리포트를 매 Sprint 갱신한다.
- [ ] `ST-REL-10-02` `[QA]` CP1~CP5 및 전체 API E2E를 RC 환경에서 실행한다.
- [ ] `ST-REL-10-03` `[E2E]` iOS/Android 시나리오 A/B/C와 실패 폴백을 실행·녹화한다.
- [ ] `ST-REL-10-04` `[PO]` AC·범위 제외·카피·데모 증빙과 U1~U8 컴플라이언스 매트릭스를 승인한다.

---

## REL-11. 보안·개인정보 릴리스 심사

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S7~S9
- **Due Date**: 2026-11-20
- **Owner Role**: Security/Privacy
- **Blocks**: Code Freeze
- **Source**: SECURITY-01~15, D18·D31·D34·D36

**완료 조건**:

- [ ] 인증·인가·IDOR·토큰 회전·브루트포스·입력·업로드·LLM 경계 위협 모델을 재검토했다.
- [ ] SAST/DAST/dependency/container/IaC/secret scan 결과에 Critical/High 미해결 이슈가 없다.
- [ ] 계정 삭제 30일 유예, GPS 즉시 파기, 법정 로그 보존, JSON 내보내기를 실제 데이터로 검증했다.
- [ ] PII·토큰·위치가 로그·분석·크래시·LLM payload에 불필요하게 남지 않는다.
- [ ] 위치정보 확인자료의 append-only·6개월 이상 보존과 일반·감사 로그 90일 이상 보존을 권한·수명주기 테스트로 확인했다.
- [ ] 개인정보처리방침·스토어 양식·실제 데이터 흐름의 차이가 0건이다.

**Sub-tasks**:

- [ ] `ST-REL-11-01` `[SEC]` 릴리스 threat model과 수동 인증/인가/LLM 경계 테스트를 실행한다.
- [ ] `ST-REL-11-02` `[SEC]` 자동 스캔 결과를 triage하고 Critical/High를 모두 닫는다.
- [ ] `ST-REL-11-03` `[PRIVACY]` 동의·철회·내보내기·삭제·법정 보존 데이터 lifecycle을 검증한다.
- [ ] `ST-REL-11-04` `[LEGAL]` 실제 처리 현황과 고지·스토어 답변의 최종 일치를 승인한다.

---

## REL-12. 성능·복원력·DR 승인

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S7~S9
- **Due Date**: 2026-11-20
- **Owner Role**: Platform/QA
- **Blocks**: Code Freeze
- **Source**: D38, RESILIENCY-01~15, `nfr.md` §1~§2

**완료 조건**:

- [ ] AI 일정은 첫 1일 5초/전체 20초, Plan-B는 10초, 일반 화면은 300ms 목표를 정의된 부하에서 측정한다.
- [ ] 목표 초과 시 결정론 fallback·수동 수정·사용자 고지와 관측 이벤트가 동작한다.
- [ ] 외부 API timeout/429/5xx/circuit open, DB failover, FCM 실패, 사진 업로드 실패를 주입해 저하 모드를 검증한다.
- [ ] 불변 이미지 롤백은 실제 리허설한다. 백업 격리 복원은 시간 단위 RTO/RPO로 실행하며, 정본의 Operations 이연을 적용하면 Release Manager·Platform 오너가 사유·위험·후속 실행일을 승인한다.
- [ ] 용량·비용·쿼터 80% 알람과 SLO 대시보드가 RC 트래픽을 표시한다.

**Sub-tasks**:

- [ ] `ST-REL-12-01` `[PERF]` 핵심 API·솔버·LLM·모바일 전환 부하 시나리오와 결과를 승인한다.
- [ ] `ST-REL-12-02` `[RESILIENCE]` 외부 의존·DB·스토리지·알림 장애 주입 테스트를 수행한다.
- [ ] `ST-REL-12-03` `[OPS]` 이미지 롤백과 DB/S3 복원 리허설을 수행해 RTO/RPO 증빙을 첨부하거나, 복원 이연 승인과 후속 일정을 첨부한다.
- [ ] `ST-REL-12-04` `[PO]` 미달 항목의 fallback 또는 출시 차단 결정을 기록한다.

---

## REL-13. 스토어 제출 패키지와 심사 대응

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S7~S9
- **Due Date**: 2026-11-24
- **Initial Submission**: 2026-11-13
- **Owner Role**: Mobile/PO/Legal
- **Blocks**: RC, Go/No-Go
- **Dependencies**: PR1, PR5, PR7, PR9, REL-11의 개인정보·스토어 데이터 흐름 사전 검토. REL-11 최종 보안 심사는 11-20까지 계속 진행

**완료 조건**:

- [ ] iOS/Android production signed build가 동일 release commit·환경으로 생성되고 checksum을 기록한다.
- [ ] 스크린샷·설명·키워드·지원/개인정보 URL·권한 설명·privacy/data safety 답변이 제품 범위와 일치한다.
- [ ] 심사 계정·샘플 데이터·위치 기능 검토 방법과 연락 담당자를 제공한다.
- [ ] 11-13 Feature Complete 후보와 메타데이터로 최초 심사를 제출하고 S9를 반려·보완·재제출 버퍼로 사용한다.
- [ ] Code Freeze 이후 바이너리가 바뀌면 승인된 최종 RC를 11-24까지 다시 제출하고 실제 배포 후보의 commit·checksum을 갱신한다.
- [ ] 제출·반려·보완·재제출 이력과 긴급 수정 의사결정 오너가 있다.

**Sub-tasks**:

- [ ] `ST-REL-13-01` `[APP]` production EAS build/submit과 서명·checksum·source commit을 고정한다.
- [ ] `ST-REL-13-02` `[PO]` 메타데이터·스크린샷·심사 노트·테스트 계정을 준비한다.
- [ ] `ST-REL-13-03` `[LEGAL]` privacy/data safety·권한·제휴 고지 답변을 최종 승인한다.
- [ ] `ST-REL-13-04` `[OPS]` 반려 triage·수정 승인·재제출 runbook을 준비한다.

---

## REL-14. 운영 준비와 릴리스 Runbook

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S8~S9
- **Due Date**: 2026-11-24
- **Owner Role**: Operations/Platform
- **Blocks**: Go/No-Go
- **Source**: `nfr.md` §8, `infrastructure.md` §10·§14

**완료 조건**:

- [ ] 배포·롤백·마이그레이션·백업 복원·외부 provider 장애·계정/위치 삭제 runbook이 있다.
- [ ] 운영 P1/P2/P3 알람 오너, 온콜 연락망, 초동·에스컬레이션·상태 공지 경로가 있다.
- [ ] feature flag·remote config·비용/쿼터 kill switch의 승인자와 감사 기록이 정의됐다.
- [ ] 운영 대시보드·로그 접근이 최소 권한이고 비상 접근 절차를 테스트했다.
- [ ] 지원 이메일·개인정보 요청·장애 문의·OTA 이관 응답 템플릿이 준비됐다.

**Sub-tasks**:

- [ ] `ST-REL-14-01` `[OPS]` 릴리스/롤백/복원/provider 장애 runbook을 dry-run 한다.
- [ ] `ST-REL-14-02` `[OPS]` 알람 라우팅·온콜·상태 공지와 인시던트 drill을 수행한다.
- [ ] `ST-REL-14-03` `[SEC]` 운영 IAM·비상 접근·감사 로그·kill switch 권한을 검토한다.
- [ ] `ST-REL-14-04` `[CS]` 지원·개인정보·제휴 이관 템플릿과 SLA를 승인한다.

---

## REL-15. 데모 시나리오·데이터·리허설

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S6~S9
- **Due Date**: 2026-11-27
- **Owner Role**: PO/QA/Demo Lead
- **Blocks**: 11-30 Demo
- **Source**: `scenarios.md` 시나리오 A/B/C

**완료 조건**:

- [ ] A(지유: 장소 저장→시각 고정→같이 고르기→확정), B(민준: 숙소 미등록 시작→완전 AI→숙소 권역 추천), C(하람: 비 예보→Plan-B→기록) 시나리오가 정본과 일치한다.
- [ ] 국내 장소·숙소·영업시간·날씨·여행 날짜·사진·알림 데이터가 재현 가능하고 개인정보를 포함하지 않는다.
- [ ] 스토어/RC 후보와 production profile은 실 provider만 사용하고 fake adapter 바인딩 시 fail-fast한다. deterministic fixture는 PR CI 또는 명시적으로 격리·표시된 비운영 데모 서버에서만 허용하며 기능을 속이는 앱 하드코딩은 없다.
- [ ] 30분 이내 본 시연, 10분 축약 시연, 네트워크/provider 실패 폴백 시연을 각각 리허설한다.
- [ ] 발표자·조작자·시간·기기·화면 미러링·예비 네트워크·예비 빌드와 복구 절차가 확정됐다.

**Sub-tasks**:

- [ ] `ST-REL-15-01` `[PO]` 시나리오 A/B/C의 화면 순서·메시지·성공 기준을 확정한다.
- [ ] `ST-REL-15-02` `[QA]` 비식별 seed 데이터와 deterministic 외부 fixture를 version control 한다.
- [ ] `ST-REL-15-03` `[APP]` iOS/Android 후보 기기·권한·푸시·외부 지도 앱 환경을 고정한다.
- [ ] `ST-REL-15-04` `[DEMO]` 본/축약/실패 리허설을 녹화하고 발견 Bug를 release blocker로 triage한다.

---

## REL-16. Go/No-Go 및 11월 30일 릴리스·데모 실행

- **Issue Type**: Task
- **Labels**: release
- **Parent**: E13
- **Priority**: P0
- **Target Sprint**: S9
- **Due Date**: 2026-11-30
- **Owner Role**: Release Manager
- **Dependencies**: PR1~PR9, REL-10~REL-15, E0~E9
- **Source**: 본 백로그의 출시 게이트

**완료 조건**:

- [ ] 11-27 Go/No-Go 회의에서 범위·품질·법무·보안·운영·스토어·데모 오너가 서명했다.
- [ ] 승인된 RC의 commit·이미지·모바일 build·DB migration·설정 checksum을 고정했다.
- [ ] 미해결 이슈는 P2 이하이며 사용자 영향·우회·오너·기한이 release note에 있다.
- [ ] 배포 또는 데모 환경 승격 후 smoke test와 대시보드 안정 상태를 확인했다.
- [ ] 11-30 시나리오 A/B/C를 수행하고 결과·실패·후속 조치를 기록했다.

**Sub-tasks**:

- [ ] `ST-REL-16-01` `[RM]` Go/No-Go 체크리스트와 기능·품질·법무·운영 서명을 수집한다.
- [ ] `ST-REL-16-02` `[INFRA]` 승인 RC를 승격하고 migration·smoke·관측 상태를 검증한다.
- [ ] `ST-REL-16-03` `[DEMO]` 11-30 데모를 실행하고 영상·로그·결과를 첨부한다.
- [ ] `ST-REL-16-04` `[RM]` release note·알려진 이슈·후속 Bug/Task를 발행하고 Epic 종료 여부를 결정한다.
