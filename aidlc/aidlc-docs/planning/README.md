# TripPilot 개발 기획

TripPilot의 개발 기획 정본이다. AI-DLC 산출물을 팀이 그대로 읽을 수 있게 재구성한 문서 모음이며, 원본을 열지 않아도 이 폴더만으로 제품·설계·개발 순서를 완전히 파악할 수 있다.

## 읽는 순서

기획 → 설계 → 로드맵/참조 순으로 읽으면 배경부터 실행 계획까지 자연스럽게 이어진다.

### 1. 기획 — 무엇을·누구를 위해 만드는가

| 문서 | 내용 |
|---|---|
| [overview.md](overview.md) | 제품 개요: TripPilot 비전·핵심 가치·여행자 슈퍼앱 정의 |
| [personas.md](personas.md) | 페르소나: 핵심 사용자 유형과 니즈 |
| [scenarios.md](scenarios.md) | 시나리오/여정: 대표 사용자 여정과 스토리 |
| [epics.md](epics.md) | 에픽: E1~E12 상위 기능 묶음 |
| [user-stories.md](user-stories.md) | 유저스토리: US-* 단위 요구사항과 인수 조건 |
| [scope.md](scope.md) | 범위: 포함/제외 경계와 릴리스 스코프 |

### 2. 설계 — 어떻게 만드는가

| 문서 | 내용 |
|---|---|
| [architecture.md](architecture.md) | 아키텍처: RN Expo 클라이언트 + Spring Boot Kotlin 모듈러 모놀리스 구조 |
| [domain.md](domain.md) | 도메인 모델: 핵심 엔티티·관계·경계 컨텍스트 |
| [flows.md](flows.md) | 주요 흐름: 핵심 유스케이스별 시퀀스 |
| [decisions.md](decisions.md) | 핵심 결정/ADR: ADR-#### 기술·설계 결정 근거 |
| [nfr.md](nfr.md) | NFR 기준: 성능·보안·가용성 등 비기능 요구사항 |
| [infrastructure.md](infrastructure.md) | 인프라: 배포·환경·PostgreSQL·운영 구성 |

### 3. 로드맵/참조 — 순서와 용어

| 문서 | 내용 |
|---|---|
| [units.md](units.md) | 개발 순서: U1~U11 유닛 분해와 의존·구현 순서 |
| [jira/README.md](jira/README.md) | Jira 실행 백로그: E0~E13, 128개 제품 Story, Subtask, 11월 릴리스·데모 계획 |
| [glossary.md](glossary.md) | 용어집: 도메인 용어 정의와 약어 |

## 유닛별 상세 설계

`units/` 아래에 개발 유닛별 상세 설계가 있다. U1~U8이 MVP 구현 범위의 상세 문서이며, 전체 유닛 순서·의존은 [units.md](units.md)에서 다룬다.

| 문서 | 유닛 · 범위 |
|---|---|
| [units/u1-foundation.md](units/u1-foundation.md) | U1 기반 · 계정 · 온보딩 |
| [units/u2-appshell.md](units/u2-appshell.md) | U2 앱 셸 · 홈 |
| [units/u3-place-stay.md](units/u3-place-stay.md) | U3 숙소 · 장소 |
| [units/u4-trip.md](units/u4-trip.md) | U4 여행 생성 |
| [units/u5-itinerary.md](units/u5-itinerary.md) | U5 AI 일정 생성 |
| [units/u6-execution.md](units/u6-execution.md) | U6 여행 중 실행 · Plan-B |
| [units/u7-archive.md](units/u7-archive.md) | U7 기록 · 회고 |
| [units/u8-notification.md](units/u8-notification.md) | U8 알림 · 마이 · 설정 |
