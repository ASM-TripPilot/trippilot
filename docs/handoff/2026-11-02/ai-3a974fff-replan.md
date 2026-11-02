---
session: 3a974fff-f720-44d2-8ff9-ac62465cd11b
area: ai
cwd: ai
branches_seen: [develop]
current_branch: develop (작업은 /Users/juna/dev/trippilot/wt-regen — 미커밋 없음, develop 에 분리됨)
span_kst: "10-19 → 11-02"
ended_by: user-consolidation (세션 정리로 종료)
status: 확인-대기
resume_local: "claude --resume 3a974fff-f720-44d2-8ff9-ac62465cd11b"
related_prs: [1409, 1411, 1451, 1452, 1454, 1512, 1575, 1577, 1612, 1623, 1624, 1635, 1686, 1688, 1709]
tickets: [TRIP-1396, TRIP-1398, TRIP-1609, TRIP-1668]
session_name: 재계획 담당 세션 (다시 짜기 배선·구성 프롬프트·생성 동네 분산 소유) — "재계획 대상일 요청으로 받기"
handed_to:
  - "trippilot-7f — 다시 짜기 후속(아래 1~3)"
  - "trippilot-79 — 푸시 전달 후속(아래 4)"
---
# 다시 짜기 추천 이유·같은 장소·푸시 전달 — 코드는 다 머지, 남은 것은 확인·외부 작업

## 목적
다시 짜기(재계획) 배선과 구성 프롬프트(REPLAN_COMPOSITION), 생성 동네 분산(day_focus)의 주인. 10-23 부산 다시 짜기 한 건을 운영에서 끝까지 추적한 문서([부산 다시 짜기 한 번의 전체 과정](https://claude.ai/artifact/FCVygX4GMAKnFgq4PJm4kC))에서 나온 문제들을 고쳤고, 10-30 사용자 지시로 푸시가 사용자에게 안 가던 원인을 찾았다.

## 이 세션이 머지한 것 (요지)
| PR | 내용 |
|---|---|
| #1409 #1411 | "전부 취소"=하루 끝(END_DAY)·"집에 가고 싶어"=한 곳 더(SHORTER_DAY), 말로 온 밤 놀기는 밤 낱말 있을 때만 |
| #1451 #1452 #1454 | 서울 사흘이 모두 을지로 — 다일 반경·날마다 동네(day_focus)·보충 점수 척도·다시 짜기 지역 이동 |
| #1512 | 구성 프롬프트 0.7.0 후보 번호화(입력 −9.5%) — 근거 `ai/docs/서빙-최적화-실적.md` §8 |
| #1577 #1612 #1635 | Codex 리뷰 지적: END_DAY 빈 풀·DB 장애 500·1회 수리 이유 채택 뒤에만 |
| #1623 | 다시 짜기가 슬롯 추천 이유(placementReason)를 전부 비우던 것 — 고른 이유 싣고 안 바뀐 곳은 원래 이유 되싣기 |
| #1624 | 생성이 출처만 다른 같은 장소(이름 같고 200m 안)를 두 번 넣던 것 — 강등 대신 하나만 |
| #1686 | 다시 짜기 이유도 해시태그 5개(REPLAN_COMPOSITION 0.9.0, 공용 `explanation.hashtag_line`). Opus 실측: 형식 0/94→92/92, 출력 −14%, 품질 같음(잡음) |
| #1688 | 다시 짜기도 같은 장소는 후보에 하나만(`_one_per_place`, 원 일정 쪽 우선) + `_MIN_NAME_CHARS` 주석 정정 |

## 멈춘 지점 (11-02 확인)
- #1686·#1688·#1635 는 **개발 서버에 있음**(배포 1162b240 에 포함). **운영(main)엔 아직 없음** — 10-30 부터 운영은 출시 묶음(열차)·핫픽스 때만(TRIP-1659·#1678).
- 추천 이유 화면 표시: 앱은 `placementReason` 을 어디서도 그리지 않는다. FE 문의 **TRIP-1609**(담당 박태현) — FE 답 없음. AI 쪽 추천안을 댓글로 남김(장소 상세에 해시태그 칩 한 줄, 슬롯 카드는 그대로, null 숨김).
- 푸시: 앱·서버 모두 **Expo 푸시**(FCM 직발송 아님). 운영 서버는 실발송(`push=expo`)인데 10-30 기준 계정 120 중 기기 토큰 iOS 2개 — 앱 빌드가 `aps-environment` 를 지우고 있었다. **#1709(앱 세션)로 래핑 제거 머지**. **TRIP-1668 진행 중** — 남은 것은 아래 4.

## 다음에 이어서 할 일
1. **[7f] 개발 서버 확인** — 다시 짜기 한 번 뒤 BE 로그 `replan notes:` 와 그날 슬롯 `placement_reason` 이 `#… #…` 꼴(최대 5개)인지, 같은 장소 쌍둥이가 걸리면 노트 `same_place_dropped: N`. 운영은 다음 출시 묶음 뒤 같은 확인.
2. **[7f] TRIP-1609 FE 답 오면** — 형식·개수 요청이 있으면 `HASHTAG_COUNT`(gates/explanation.py) 한 곳 + 생성 EXPLANATION·구성 0.9.0 프롬프트 문구(테스트가 알려준다). 바꾸면 Opus 로 기준 판과 나란히 실측(아래 함정).
3. **[7f] KB-3 상황 문서를 구성 LLM 에 싣기 — 보수안으로 보류 중**(10-30, 사용자 "결정이 필요한것들은 웬만해서는 다 진행하는 방향으로 하자" 를 상황 감지 세션이 전달 → 추천안 없음 → 현행 유지). 사용자가 KB-5 때처럼 "실어서 써야지" 하면 진행. 부딪침: KB-3 "성격 유지 교체" vs 구성 규칙 "절반 이상 새 곳"(`composition.CHANGE_REFRESH`).
4. **[79] 푸시 전달 마무리(TRIP-1668)** — 순서는 티켓 11018 댓글: ① EAS 프로비저닝 프로파일이 Push 켠 뒤 재발급됐는지(`eas credentials`, #1598 서명 실패 재발 방지) ② 스토어/TestFlight 빌드의 `aps-environment` 가 production 인지 ③ **APNs 키(.p8)를 expo.dev → trippilot → Credentials → iOS 에 업로드**(사용자·백엔드 담당자 몫) ④ 새 빌드 실기기 알림 허용 → 운영 `app.push_token` 증가(읽기 전용 psql 파드) → expo.dev 푸시 도구 직접 시험 → 백엔드 경유(리마인드·상황 알림). 4까지 확인되면 TRIP-1668 닫기.

## 함정 / 주의
- **iOS 에 GoogleService-Info.plist 는 필요 없다** — 백엔드 담당자 메모의 Firebase 단계는 FCM 직발송 기준이다. Expo 푸시는 .p8 을 Expo 자격 증명에서 쓴다. 안드로이드 출시 때만 google-services.json + FCM V1 키를 EAS 에.
- **프롬프트 A/B 는 운영 모델로** — 운영은 10-30 기준 전 기능 `claude-opus-5-5`(리마인드만 로컬 모델, 티어 재배정은 키·시크릿 세션이 진행 중). `measure_prompt_ab.py` 는 모델명이 `claude*` 면 Anthropic 어댑터를 쓴다. **운영과 같은 Claude 잔액을 쓰므로 사용자 승인 뒤에만**(10-30 승인분은 소진). 로컬 컨테이너 Azure 키는 만료(401).
- 로컬 임베딩 컨테이너가 다른 세션의 KB-5 벡터 적재로 포화면 `EVAL_COMPOSE_KB5` 측정이 시한을 넘긴다 — 장소 설명 없이 잰다.
- 같은 장소 판정(`family.same_place`)은 **정규화 이름 같고 200m 안**만 뺀다. 단지 안 다른 명소(남산공원·남산골한옥마을)는 10-02 사용자 결정대로 강등(배제 아님) — 넓히지 말 것.
- 다시 짜기 `explanations` 칸은 BE 가 그날 **모든** 슬롯 이유를 통째로 바꾸는 값이다 — 비우면 원래 이유가 지워진다.
- 메모리(로컬 전용): `replan-reasons-and-twins` · `push-delivery-expo-path` · `generation-day-areas` · `replan-end-intent-decision` · `prompt-ab-local-run`.
