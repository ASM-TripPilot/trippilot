# U6 Reflect — 비즈니스 규칙 + PBT 게이트 (FD)

> **초안 v0.1 (승인 대기)** — TRIP-538. 출력 계약 정본은 `reflection-template-design.md`(#334) — 본 FD는 계약을 변경하지 않는다.

## 1. 4대 불변식의 회고 사영

| 불변식 | 회고에서 | 적용 판정 |
|---|---|---|
| **INV-1** (closed-set) | 원 규칙(POI 후보 풀)은 비적용 — 회고는 후보를 생성하지 않는다. **정신의 사영은 적용**: `visit_ref ⊆ 방문 기록` · `source_event` 실재 · 자리표시자 어휘 closed-set · [P2] `photo_id ⊆ 입력 사진 집합`. 위반은 게이트가 판정·교체하고 GateDropEvent로 계측 | 사영 적용 |
| **INV-2** (솔버 검증값만) | **비적용** — 회고는 시각·순서를 만들지 않는다 (agent-structure-v2 §4: Reflect는 솔버 관문 스킵). 장면 순서는 일정 순서가 아니라 **연출 순서**다. 비적용을 구조로 표현: `ReflectionTemplate`에 시각·순서 필드 자체가 없다 | 비적용 (구조화) |
| **INV-3** (duration 미표시) | **적용** (표시 계층 규칙) — 캡션·부제·해시태그의 시간 표현(`\d+분`·`\d+시간`·`오전 \d+시` 류)은 하드 위반. 입력측에서도 시각·체류분을 프롬프트에 넣지 않는다 (원천 차단, 이중 방어) | 적용 |
| **INV-4** (결정론 폴백) | 3회 전부 실패 → 고정 폴백 템플릿(`is_fallback=true`, 서버 숫자만이라 거짓 없음) · [P2] 미동의·이미지 실패·비지원 → Phase 1 경로 강등 · 모든 전환에 FallbackEvent — 침묵 금지. 랭킹·교체·결합·폴백은 전부 결정론 | 적용 |

## 2. 규칙 (BR-U6R)

| # | 규칙 | 근거 |
|---|---|---|
| BR-U6R-01 | 회고 결과물은 계약 정본 스키마(봉투 §3.1 + 장면 시퀀스 §3.2)만 — `layout`·`kind`·`format`은 닫힌 enum. 본 FD·구현은 계약을 변경하지 않는다 | 계약 §1·§3 |
| BR-U6R-02 | LLM은 연출(장면 순서·layout 선택·캡션·표지·해시태그)만 — 캡션 속 숫자는 `PLACEHOLDER_VOCAB` 자리표시자로만, 실측값 바인딩은 렌더 시 서버. AI 요청에 통계 숫자를 넣지 않는다 | 계약 §2 (숫자 환각 구조 차단) |
| BR-U6R-03 | `visit_ref ⊆ 방문 기록` · EVENT 장면의 `source_event` 실재 · [P2] `photo_id ⊆ 입력 사진 집합` — 위반은 교체·생략 + GateDropEvent | INV-1 사영 |
| BR-U6R-04 | 캡션·부제·해시태그에 시간 표현 금지 (하드 위반) — 입력 vars에도 시각·체류분 미주입 | INV-3, G181 |
| BR-U6R-05 | 총 3회 생성(위반 0이면 조기 종료) → 결정론 사전식 랭킹(하드↓·소프트↓·채움↑·차수↑) → 최선 채택. LLM 심판 금지(1차) | 계약 §4.2 |
| BR-U6R-06 | 최선 후보의 잔존 하드 위반은 **장면/필드 단위 결정론 교체**(교체 맵 = business-logic-model §4) — 전체 드롭 없음 | 계약 §4.1 |
| BR-U6R-07 | 3회 전부 파싱 실패 → 고정 폴백 템플릿(`is_fallback=true`) — 폴백 스스로 하드 위반 0을 테스트가 고정 (FALLBACK_NUDGE 선례) | INV-4, 계약 §4.3 |
| BR-U6R-08 | 사진 바이너리는 Phase 1 요청에 절대 미포함 — "어느 방문에 몇 장" 수량 메타만. 방문·이벤트·페르소나는 백엔드가 조립 (AI stateless). 트리거·상태 머신은 정본 §4·5 무변(백엔드 소유) | 계약 §5 |
| BR-U6R-09 | [P2] 사용자 사진의 외부 LLM 전송은 **명시 동의 필수** — `VisionInput`은 유효한 `consent_ref` 없이 타입상 생성 불가. 동의 기록은 백엔드 append-only 법무 로그 체계 준용(consent-log — 앱 롤 DELETE 불가), AI는 consent_ref를 트레이스에 연결만 | SECURITY 계열, 법무 로그 선례 |
| BR-U6R-10 | [P2] 미동의·이미지 호출 실패·비지원 어댑터·게이트 드롭 → **Phase 1 텍스트 경로로 강등** + FallbackEvent(stage="vision") — 침묵 금지. 강등 결과의 출력 스키마는 Phase 1과 동일(드롭인). 조용한 이미지 무시 금지 — 비지원 어댑터는 명시 실패 | INV-4 |
| BR-U6R-11 | [P2] 시각 환각 불신 — 게이트는 검증 가능한 것만 강제(photo_id 멤버십·스키마·길이·금칙어). 시각 서술의 사실성 게이트는 두지 않고 캡션을 저위험(사용자 수정 가능 초안)으로 분류. 근거 실측(2026-08-25): responses 표면 `input_image` 라우팅 200 확인, 1×1 투명 PNG에 "64×17 연초록" 환각 | 검증 가능성 원칙 |
| BR-U6R-12 | 신규 LlmFeature(`REFLECTION_TEMPLATE` 등)는 BR-AF-07 5종 세트(FD 개정+tier_map+yaml+ROUTE-P1+audit) — 코드 단독 enum 확장 금지 | BR-AF-07 |
| BR-U6R-13 | 모델·티어 실체는 C1Config 설정값(하드코딩 금지) — 멀티모달 지원 프로바이더·모델 선정은 **TRIP-515 런북 소관**, 본 FD는 확정하지 않는다 | BR-U4-08, AI-D06 |
| BR-U6R-14 | 시간 예산 수치 미확정 — deadline 미지정(TRIP-473). 시간제약 재도입(2026-10 예정) 시 deadline·단계 스킵 조건은 후속 결정. N회 생성은 백그라운드 전제로만 허용 | AI-D07 정합 |
| BR-U6R-15 | 방문 0건 요청은 생성 진입 불가(post-init) — 트리거 단(백엔드 "방문 1건+")과 이중 방어. 스킵은 침묵이 아니라 명시 거부로 표현 | reflect-agent-design §2 |

## 3. PBT 게이트 (hypothesis — 전부 통과해야 유닛 종료)

| ID | 속성 | 전략 |
|---|---|---|
| RFL-P1 | **어떤 오염된 LLM 출력에도** 최종 산출물의 visit_ref 전부 ⊆ 방문 기록 ∧ EVENT 장면의 source_event 전부 입력 이벤트에 실재 ∧ 위반분 GateDropEvent 계측 | 오염 주입 generator (visit_ref 밖·가짜 이벤트 합성) |
| RFL-P2 | 최종 산출물(교체 후)의 캡션·부제·해시태그에 시간 표현 패턴 0건 — 고정 안전 문구·폴백 템플릿 포함 | 금칙 패턴 합성 스윕 |
| RFL-P3 | 자리표시자 어휘 밖 토큰 잔존 0 ∧ `{poi:i}` 인덱스 전부 visits 범위 내 | 어휘 밖 토큰 주입 |
| RFL-P4 | 랭킹·교체 결정론 — 동일 후보 집합 → 동일 채택·동일 교체 결과 (사전식 비교 유일해) | 후보 집합 무작위 → 이중 호출 동일성 |
| RFL-P5 | 3회 전부 파싱 실패 → `is_fallback=true` ∧ 폴백 템플릿 하드 위반 0 ∧ FallbackEvent ≥ 1 ∧ 시도별 LlmCallRecord(success=False) | FailingLlm·쓰레기 텍스트 |
| RFL-P6 | 신규 타입 전부 `from_dict(to_dict(x)) == x` (U5-P10 승계) — `ReflectionTemplate.to_dict()` 키가 계약 §3 JSON 키와 일치 | 신규 generator |
| RFL-P7 | 소프트 위반(장면 수 밖·길이 초과·중복 visit_ref)은 채택을 막지 않는다 — 하드 0·소프트 有 후보가 하드 有 후보보다 항상 우선 | 위반 조합 스윕 |
| VIS-P1 | [P2] consent 부재·granted=False인 **어떤 입력 조합에도** LlmRequest.images == () (이미지 파트가 요청에 실리지 않음) | VisionSpyLlm + 무작위 요청 조합 |
| VIS-P2 | [P2] 하이라이트 결과 photo_id ⊆ 입력 사진 집합 ∧ 중복 0 ∧ 개수 ≤ N. 실패 시 메타 규칙 폴백은 결정론 | 오염 photo_id 주입 |
| VIS-P3 | [P2] vision 경로의 어떤 실패에도 최종 응답 스키마 키 집합 = Phase 1 결과 키 집합 (드롭인) ∧ FallbackEvent(stage="vision") 발행 | 실패 지점 스윕 (타임아웃·비지원·파싱) |
| VIS-P4 | [P2] images 실린 요청이 텍스트 전용 어댑터에 가면 예외가 위로 새지 않고 폴백 신호로 수렴 (BR-U4-02 동형) | 텍스트 전용 FakeLlm |

## 4. DoD

- [ ] 위 PBT 전부 green + 기존 전체 스위트 회귀 green (**LlmRequest 확장 후 기존 텍스트 호출 무영향의 증빙**)
- [ ] 신규 LlmFeature 5종 세트 완료 (BR-AF-07): 본 FD 개정 반영 · tier_map · prompts yaml v0.1.0 · ROUTE-P1 통과 · audit 기록
- [ ] 아키텍처 테스트: agents/reflect에 L-1~L-3 활성 · yaml→prompts 한정 · SDK→adapters 한정 · ports 순수성(stdlib만) 유지
- [ ] `POST /ai/v1/reflection/generate`를 `ai/docs/openapi.json` 와이어 정본에 반영 (AI CI "실행 앱 스키마 == 커밋 계약" 게이트)
- [ ] 실 API·실 이미지 호출 CI 0건 (D37) — vision 스모크는 수동 스크립트로 별도
- [ ] Phase 2 코드 착수 조건: 백엔드 사진 업로드 API·동의 법무 로그 연동 확인 (TRIP-478 계열) + 미결 #1·#2·#6 해소

## 5. 미결 목록

| # | 내용 | 해소 시점 |
|---|---|---|
| 미결 #1 | [P2] 하이라이트 결과의 경계 전달 형태 — (b) BE 전용 `binding_hints` 부속(FE 미노출) vs (c′) 1차 미전달(vision 캡션만 적용) | BE 협의 (TRIP-478 연동) |
| 미결 #2 | [P2] 이미지 전달 형태 — 사전서명 URL vs 인라인 base64 (백엔드 사진 저장소 설계 종속) | TRIP-478 설계 |
| 미결 #3 | `template_id` 생성 규칙 — 요청 멱등키 파생안 (경계 계약 "멱등키 협의 중"과 연동) | 경계 계약 협의 |
| 미결 #4 | 캡션 길이 상한·장면 수 범위 확정 — 초기값 제안: 캡션 40자(remote config)·장면 3~8(계약값) | 계약 미결 #2 (FE 렌더러 1차) |
| 미결 #5 | 해시태그 허용 집합 실체 — 제안: 지역명·방문 POI명·브랜드 고정 태그 파생 | 계약 미결 #3과 연동 (운영 후) |
| 미결 #6 | [P2] vision을 별도 feature(`REFLECTION_TEMPLATE_VISION`, 추천 — 티어 라우팅 근거)로 갈지, 동일 feature 이미지 조건부로 갈지 | 실모델 검증 (K-2급) |
| 미결 #7 | [P2] 강등 사실의 응답 표면화 — 관측 이벤트는 필수(확정), BE 전용 degraded 필드 추가 여부는 별개 | 팀 결정 |
| 미결 #8 | `ReflectionDraft`(프롬프트 정본 §2.3, j03 초안)의 장기 지위 — 계약 §3.2 註 "기록 화면은 이 스키마의 부분 소비"로 수렴할지 | j03 소비 방식 확정 시 |
| 미결 #9 | [P2] 총 3회 생성 예산에 vision 시도 포함 여부 — 포함 제안(계약의 비용 상한 유지) | Phase 2 착수 시 |
