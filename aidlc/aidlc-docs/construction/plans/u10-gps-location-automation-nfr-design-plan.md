# U10 GPS·위치 자동화 — NFR Design Plan

> **선행**: U10 NFR Requirements 승인(2026-10-12) · 산출물 2종 `u10-gps-location-automation/nfr-requirements/` · Q14=A("얇게, 3주제")
> **방침**: **3주제만** 돈다 — ① 백그라운드 실행 패턴 ② 다운샘플·"정지 지점 재구성 불가" 판정(O-U10-8) ③ 로컬 파일 큐·손상 복구·킬 스위치 캐시. 서버 쪽은 기존 패턴 **참조만** 하고 재설계하지 않는다. G-U10-5·6(저장소·플래그)은 `tech-stack-decisions.md`에서 닫혔으므로 다시 열지 않는다.
> **실장 우선**: U3·U4·U6·U10 NFR Req 선례대로 리포 실물을 먼저 보고 정했다(아래 Step 1).
> **Infrastructure Design 증분**: 통합 인프라 문서 1건 결정(2026-08-31, `shared-infrastructure.md` 머리말)에 따라 유닛별 `infrastructure-design/` 폴더를 만들지 않고 `shared-infrastructure.md`에 `## U10 증분 (2026-10-12)` 절을 덧붙인다. 이 계획서가 그 증분의 계획도 겸한다.
> **작성**: 2026-10-12

---

## Step 1 결과 — 실측 (2026-10-12)

| 자산 | 실물 | 설계 함의 |
|---|---|---|
| 인증 HTTP 클라이언트 | `frontend/src/shared/api/index.ts` `createAuthedApiClient` — 401이면 `refreshTokens()` single-flight 후 재시도, 리프레시 실패면 `onSessionExpired()`. 토큰은 **메모리 홀더**(`getAccessToken`)에서 읽는다. 전역 timeout 15초 | ★ 백그라운드 태스크가 이 클라이언트(=orval 생성 함수 경유 `mutator.ts`)를 쓰면 **백그라운드에서 갱신이 일어나고**(SEC-U10-04 위반), 리프레시 실패가 **로그아웃**으로 번진다. 앱이 죽었다 깨면 메모리 홀더가 비어 무인증 요청이 나간다 → **전용 전송 경로**가 필요(P-BG-U10-3) |
| 토큰 저장 | `frontend/src/shared/storage/index.ts` — `SecureStore.getItemAsync` 기본 옵션(`WHEN_UNLOCKED`) | 잠긴 기기 wake에서 읽기가 **throw**한다 → "잠김"으로 접는다 |
| 액세스 토큰 수명 | `backend/common/security/.../JwtProperties.kt` `accessTokenTtl = 1h` · 리프레시 90일 | ★ 백그라운드가 갱신하지 않으므로 **마지막 포그라운드 갱신 후 ≤1시간**만 백그라운드 전송이 가능하다. 그 뒤는 포그라운드를 기다린다 — 당일 폐기(BR-U10-22)와 겹쳐 전달률(REL-U10-04) 위험(Q3) |
| `expo-file-system` | 전이 설치 `19.0.23`. iOS 새 API `File.write`는 `atomically: false`(`ios/FileSystemFile.swift`), `move`는 `FileManager.moveItem` — **목적지가 있으면 실패**(`ios/FileSystemPath.swift`). 레거시 `writeAsStringAsync`는 iOS만 `atomically: true`, Android 레거시 `moveAsync`는 `renameTo` | ★ "임시 파일 → 원자적 교체"를 **양 플랫폼 공통 원시 연산 하나로 만들 수 없다** → A/B 교대 쓰기로 같은 보장을 낸다(P-STORE-U10-2) |
| 앱 엔트리 | `frontend/package.json` `"main": "expo-router/entry"` · 전역 프로바이더는 `app/_layout.tsx` → `@/app` | 앱이 꺼진 상태에서 OS가 깨우면 UI가 그려지지 않을 수 있어 **라우트 트리 모듈 평가가 보장되지 않는다** → 태스크 정의를 라우트 트리 밖 엔트리에 둔다(P-BG-U10-1) |
| 지오펜스 스텁 | `frontend/src/shared/location/geofence.ts` `registerGeofences → {armed:false, reason:'native-geofencing-not-wired'}` | 반환 계약 유지(REL-U10-07) |
| 스케줄러·락 | `@SchedulerLock`은 **`OutboxRelay.kt` 하나뿐**. `TripEndSweeper`·`LocationLegalLogRetentionSweeper`·`NotificationSchedulePoller`는 **ShedLock 없이 조건부 쓰기**로 멱등(각 클래스 주석) | ★ tech-stack §1 "스케줄링·락 … `TripEndSweeper`·`LocationLegalLogRetentionSweeper`" 근거 표기는 **드리프트**(그 둘은 ShedLock을 안 쓴다). `SERVER_TIMEOUT` 스위퍼는 조건부 UPDATE 선례, `DELAY` 스캐너는 PERF-U10-06대로 ShedLock(§4) |
| `DELAY` 중복 방어 | `V2.18` `ux_plan_b_trigger_active (trip_id, kind, slot_key) WHERE state='ACTIVE'` | 다중 복제본 경합의 최후 방어선이 이미 DB에 있다 |
| 재생 멱등 PBT 선례 | `backend/modules/archive/src/test/.../OfflineReplayPropertyTest.kt` | PBT-U10-3 재사용 |
| 새 테이블 권한 | `V1.7__grants.sql` `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user` | `actual_route_day` 파기용 DELETE 권한에 **별도 GRANT 마이그레이션 불필요** |
| 운영 스위치 선례 | `deploy/eks/runtime_secrets.py` `BACKEND_KEYS`·`BACKEND_DEFAULTS`(`PUSH_MODE` 등) + `aws-deploy.yml` 입력 `push_mode` + 차트 `trippilot.secretEnv`(optional) · 배포마다 `rolloutNonce`로 파드 재시작 | 킬 스위치를 **커밋 없이** 바꿀 수 있는 기존 통로(Q2) |
| 관측 | EKS에서 OTel·Micrometer OTLP 꺼짐 · 인프라 Q3=A(CloudWatch 로그 + 최소 알람, OTel G-05는 범위 밖) | OBS-U10-06~10 카운터는 운영에서 안 보인다 → **구조화 로그 1줄이 운영 원천**(증분 §관측) |

---

## 실행 계획

- [x] 1. NFR Req 2종 · FD 4종 · 계획서(FD·NFR Req) · U4/U0 NFR Design(문체) 정독 · 리포 실측(위 표)
- [x] 2. 질문 판정 — 3주제 중 **설계자가 혼자 정하면 안 되는 것**만 질문(Q1~Q3). 나머지(전송 경로 분리 · A/B 쓰기 · 엔트리 위치 · RDP 채택)는 실장 사실이 답을 정해서 질문하지 않는다
- [x] 3. 답변 수집 — 2026-10-12 사용자 일괄 지시로 **전부 권고안 적용**. 모호 답변 없음(명확화 파일 불필요)
- [x] 4. `nfr-design-patterns.md` — 실장 입력 · 주제 ①(P-BG-U10-1~6) · 주제 ②(P-PRIV-U10-1 · P-PERF-U10-1) · 주제 ③(P-STORE-U10-1~4) · 서버 재사용 참조 · 커버리지 · 드리프트·FD 개정 제안 · 미결
- [x] 5. `logical-components.md` — LC-U10-1~9(FE) · 서버 재사용 표 · PBT 게이트 배치 · 6-b 추가 항목
- [x] 6. 정합 검증 — NFR Req(MOBILE·PERF·SEC·REL·OBS-U10) · FD(BR-U10-12·22·35~38·46 · INV-U10-9 · PBT-U10-F1~F7) · U0 SEC-02·09와 충돌 없는지(아래 「정합 검증」)
- [x] 7. **Infrastructure Design 증분** — `shared-infrastructure.md` 끝에 `## U10 증분 (2026-10-12)` 추가: 킬 스위치 env · `DELAY` 스캐너(5분 · ShedLock) · `SERVER_TIMEOUT` 스위퍼 · 마이그레이션 3 · EAS `production-automation` · 신규 AWS 자원 0(검증) · 관측 카운터와 §12 Q3 관계 · **롤링 배포 창의 M-U10-a CHECK 위험(2단계 분리)** 발견
- [ ] 8. 완료 메시지 → **승인 게이트** → `audit.md`·`aidlc-state.md` 기록(오케스트레이터 몫)

---

## 질문 (`Q1=A Q2=A Q3=A` 한 줄 가능)

### Q1. "정지 지점 재구성 불가"를 무엇으로 보장하나 ★ (O-U10-8)

FD는 허용 오차 15m · 점 상한 2,000을 제안하고 "다운샘플 결과만으로 개별 정지 지점을 재구성할 수 없어야 한다"를 목표로 걸었다. 그런데 **허용 오차 기반 단순화(RDP)는 이 목표의 반대 방향**이다 — 꼭짓점(꺾이는 곳·끝점)을 남기는 것이 그 알고리즘의 보장이고, 정지 지점은 바로 그 꼭짓점(GPS 튐 지그재그 · 세그먼트 끝점)으로 남는다. 게다가 iOS 자동 정지(`pausesUpdatesAutomatically`)는 **멈춘 곳에서 기록을 끊으므로** 세그먼트 끝점 = 정지 지점(숙소 포함)이 된다.

A) **단순화와 별개로 "닻 배제" 단계를 둔다** — 닻 = 원시 표본에서 찾은 체류 지점(반경 100m 안 3분 이상) + 원시 세그먼트 양 끝점. **닻 반경 R_priv = 150m 안의 원시 점을 전부 지운 뒤** RDP(ε 15m, 상한 2,000)를 돌린다. 판정 기준 = "출력의 어떤 꼭짓점도 어떤 닻의 150m 안에 없다"(PBT로 반증). 대가 = 지도의 실제 경로가 숙소·방문지 **150m 앞에서 끝나거나 그 구간을 직선(현) 하나로 지난다**
B) RDP만 — ε를 크게(예: 50m) 잡아 지그재그를 지운다. 세그먼트 끝점·되돌아 나온 끝은 그대로 남는다(숙소 노출)
C) 정지 지점을 지우되 반경을 정확도 게이트와 같은 100m로

> 추천 근거: 목표를 보장하는 것은 단순화가 아니라 배제다 — B는 끝점을 원리적으로 못 지운다. 150m는 이 시스템이 "그 장소에 있다"고 판정하는 반경(BR-U10-13 지오펜스)이라, 출력이 "그곳에 머물렀다"와 "그곳 반경을 지나갔다"를 구분하지 못하게 만드는 최소값이다. C(100m)는 지오펜스 반경보다 작아 계획 장소 주변의 비계획 체류를 반경 안쪽에서 드러낸다. 거리는 원시 표본으로 재므로(BR-U10-38) 배제가 거리 값을 줄이지 않는다. 값은 설정이고 조정은 규칙 개정이 아니다(O-U10-2와 같은 지위).

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q2. 서버 킬 스위치 값을 어디에 두나 (REL-U10-06 · 인프라 증분)

킬 스위치는 **문제가 터졌을 때 빨리 끄는** 장치다. 실물에는 런타임 값을 바꾸는 통로가 둘 있다.

A) **`PUSH_MODE` 선례 — `trippilot-backend` 시크릿 그룹의 허용 키 `LOCATION_AUTOMATION_ENABLED`(기본 `"true"`) + 배포 입력 `location_automation: keep|on|off`.** 끄기 = 워크플로 실행 1회(입력 `off`) — 커밋·리뷰 없이
B) Helm `config.locationAutomationEnabled` — 끄기 = values 커밋 → develop 머지 → 배포
C) DB 설정 테이블 + 관리 API — 재시작 없이 즉시

> 추천 근거: 끄는 속도가 장치의 존재 이유다. A는 이미 같은 목적(`push_mode` — 외부 발송을 켜고 끄기)으로 쓰는 통로라 신규 장치가 0이고, 값이 비밀이 아니어도 "커밋 없이 바꾼다"는 성질 때문에 시크릿 그룹에 둔다(`PLACE_GEOCODE_MODE`·`WEATHER_MODE`도 같은 이유로 거기 있다). B는 끄는 데 PR이 끼어 느리다. C는 관리 표면(인증·감사)을 새로 만드는 일이라 NFR Req Q6=B("신규 엔드포인트 없음")와 어긋난다. 반영 지연 = 배포 1회(롤아웃 nonce로 파드 재시작) — 인프라 Q6=B(이미지 핀)가 구현되면 재빌드가 빠져 더 짧아진다.

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

### Q3. 액세스 토큰 1시간 × 백그라운드 무갱신 → 당일 전달률 위험을 어떻게 다루나 (REL-U10-04)

SEC-U10-04(백그라운드 무갱신)는 승인됐다. 실측하니 액세스 토큰 수명이 **1시간**이라, 사용자가 아침에 앱을 한 번 열고 하루 종일 안 열면 오후의 자동 결과는 **포그라운드 복귀까지 못 나가고, 날짜가 바뀌면 버려진다**(BR-U10-22). "여행 중 앱을 안 여는 것이 정상 경로"라는 제품 원칙과 정면으로 맞닿는 지점이다.

A) **설계는 그대로 두고 측정으로 판정한다** — 기기는 토큰 `exp`를 먼저 읽어 만료면 요청을 아예 안 보내고(wake 예산 절약), 보류 사유(`LOCKED`·`TOKEN_EXPIRED`·`AUTH_401`)를 구간 END 보고 `heldCount` 옆에 사유별로 싣는다. 당일 전달률이 95% 미만이고 주원인이 `TOKEN_EXPIRED`면 재평가 트리거로 ① 자동 결과 큐 수명을 "여행 종료 + 1일"로(경로와 같게 — BR-U10-22 개정) ② 백그라운드 전용 범위 토큰(NFR Q4=C) 중에서 고른다
B) 지금 BR-U10-22를 개정해 큐 수명을 여행 종료 + 1일로 늘린다
C) 지금 백그라운드 전용 토큰을 설계한다

> 추천 근거: 서버는 `occurredAt`이 여행 구간 안이고 슬롯 날짜와 같으면 다음 날 받아도 정확히 기록한다(BR-U10-21 — 거절 사유에 "늦게 옴"이 없다). 그래서 위험은 **설계 결함이 아니라 BR-U10-22의 수명 선택**에서 나오고, 그 선택은 FD 결정이라 NFR Design이 혼자 뒤집지 않는다. 실측 전에 인증 정본(U0)을 건드리는 C는 과하다. A는 판정에 필요한 사유 분해만 더한다(필드는 이미 있는 END 선택 필드의 확장). **NFR Req §9 재평가 트리거에 "주원인 = 토큰 만료" 행을 더한다.**

[Answer]: A *(권고 적용 — 2026-10-12 사용자 일괄 지시 "그럼 권고로 ㄱㄱ")*

---

## 질문하지 않은 것 (실장 사실이 답을 정함)

| 항목 | 정해진 답 | 근거 |
|---|---|---|
| 백그라운드 전송 경로 | `authedClient`를 쓰지 않는 전용 경로 | 401 인터셉터가 갱신·로그아웃을 부른다(Step 1) — SEC-U10-04를 지키는 길이 이것 하나 |
| 원자적 교체 방식 | A/B 교대 쓰기(세대 번호) | iOS `File.write` 비원자 · `move` 덮어쓰기 불가(Step 1) — 플랫폼 공통 원시 연산이 없다 |
| 태스크 정의 위치 | 라우트 트리 밖 커스텀 엔트리(`frontend/index.ts`) | `expo-router/entry`만으로는 앱 종료 상태 wake에서 정의가 보장되지 않는다 |
| 단순화 알고리즘 | Ramer–Douglas–Peucker(+반경 사전 거르기) | PBT-U10-F5 "모든 원시 점이 허용 오차 안"을 **보장하는 유일한 후보** — Visvalingam(면적 기준)·균등 추출은 거리 상한이 없다 |
| `SERVER_TIMEOUT` 스위퍼 락 | ShedLock 없음 · 조건부 UPDATE | `TripEndSweeper` 선례 — 조건부 쓰기가 멱등의 전부 |

---

## 정합 검증 (Step 6)

| 대상 | 결과 |
|---|---|
| MOBILE-U10-03(자동 정지 후 재개) | 일치 — P-BG-U10-4. "시작돼 있나" 질의에 기대지 않고 **지오펜스 wake마다 재시작 호출**로 구체화 |
| MOBILE-U10-04(wake에서 하는 일) | 일치 — P-BG-U10-2. **경로 업로드는 wake에서 하지 않는다**(목록에 없음) → 포그라운드 전용으로 명시 |
| PERF-U10-01(10초 · 8초 · 요청 2) | 일치 — 8초는 **상한**이고 실제 타임아웃 = min(8초, 남은 예산 − 여유)로 구체화. 두 요청이 각각 8초를 다 쓸 수는 없다 |
| PERF-U10-03(다운샘플 ≤ 2초 · 백그라운드 금지) | 일치 — P-PERF-U10-1 |
| SEC-U10-01·02(캐시 경로 · 삭제 시점) | 일치 — P-STORE-U10-1·4. 삭제 순서(OS 등록 해제 → 디렉토리 삭제)를 더한다 |
| SEC-U10-03·04(토큰 등급 · 무갱신) · U0 SEC-02·09 | **유지** — P-BG-U10-3이 집행 장치 |
| REL-U10-01(쓰기 → 원자적 교체) | 의도 일치, 수단 정밀화 — "임시 → 교체"(tech-stack 델타 2 문구)를 **A/B 교대 쓰기**로 바꾼다(같은 보장, 플랫폼 공통) |
| REL-U10-03(스위퍼 `@Scheduled` + ShedLock) | **정정 1건** — 조건부 UPDATE로 충분, ShedLock 미부착(선례 정합). 보장은 같다 |
| REL-U10-06(킬 스위치 · 오프라인 직전 값) | 일치 — P-STORE-U10-3. **다시 켜짐을 아는 경로(빈 배치 탐침)**를 더한다 — 꺼진 기기는 무장하지 않아 서버 응답을 받을 기회가 없기 때문 |
| BR-U10-36(다운샘플 목표) · O-U10-8 | **해소** — P-PRIV-U10-1(Q1=A) |
| BR-U10-37 · INV-U10-9(공백 안 잇기) | 일치 — 닻 배제가 만드는 현(弦)은 **기록이 이어진 구간 안**에서만 생긴다. 기록 공백은 여전히 세그먼트를 끊는다 |
| BR-U10-38(거리 = 원시 기준 · 서버 하한 = 폴리라인 길이) | 일치 — 배제·단순화는 길이를 줄이기만 하므로(삼각부등식) "거리 ≥ 폴리라인 길이"가 유지된다 |
| PBT-U10-F1·F5·F7 | **확장** — F1에 킬 스위치 입력, F5에 ⑥ 닻 배제, F7은 A/B 판독으로 구체화. **신규 F8**(wake 예산 계획) |
| FD §12.4 `endReason` | **추가 제안 1건** — `REMOTE_DISABLED`(킬 스위치 강등을 다른 사유와 구분 — OBS-U10-04). NFR Req가 이미 예고한 FD 개정 블록에 함께 |
| NFR Req §9 재평가 트리거 | **행 추가 제안 1건** — Q3=A |

---

## 다음 단계

산출물 2종 + 인프라 증분 완료 → **완료 메시지·승인 게이트** → `audit.md`·`aidlc-state.md` 기록(오케스트레이터) → (승인 시) U10 설계 종료. 코드 생성은 SCOPE 밖 — 팀이 각 패키지에서 착수(선행: Figma 5표면 · `expo-task-manager` 재빌드).
