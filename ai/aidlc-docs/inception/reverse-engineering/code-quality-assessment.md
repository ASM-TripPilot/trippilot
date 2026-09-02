# Code Quality Assessment

> **역사 기록 — 2026-07-12 리버스 엔지니어링 시점의 관측이다.** 아래 "설계 문서만 존재 (소스 코드 미작성)"은 그 시점 사실이고 현재는 아니다 — U1~U6 이 구현돼 `ai/src/trippilot/` 이 가동 중이다. 현재 상태 정본은 `../../../claude.md` §Current Status.

## Current State: 설계 문서만 존재 (소스 코드 미작성)

본 프로젝트는 소스 코드가 아직 작성되지 않은 상태이므로, 코드 품질 평가 대신 **설계 문서 품질 및 구현 준비도**를 평가한다.

## Design Documentation Quality

### Overall: Excellent
- 6개 설계 문서가 일관된 구조와 상호 참조로 작성됨
- 결정 근거(ADR)가 명확하게 기록됨
- 불변식 4종이 구조적으로 정의되어 검증 가능

### Document Coverage

| 영역 | 상태 | 비고 |
|---|---|---|
| 아키텍처·전략 | 완비 | ai-architecture.md — WHY/WHAT 명확 |
| 구현 설계 | 완비 | ai-implementation-design.md — 인터페이스·시퀀스·알고리즘 |
| 데이터 모델 | 완비 | ai-data-design.md — 스키마·캐싱·게이트 |
| 프롬프트 설계 | 완비 | ai-prompt-design.md — feature별 스펙 |
| 테스트 전략 | 완비 | ai-testing-guide.md — PBT 속성 12+, oracle, CI |
| 결정 기록 | 완비 | ai-adr.md — ADR-0008~0015, AI-D01~D05 |

### Design Strengths (좋은 패턴)
- **4대 불변식** — 아키텍처 제약이 코드 수준 PBT로 검증 가능하게 설계됨
- **Hexagonal Architecture** — Port/Adapter 분리로 외부 의존 fake 교체 가능 (D37)
- **결정론 보장** — 시드 고정·무작위성 제거로 동일 입력→동일 출력 (U5-P3)
- **폴백 계단** — 모든 외부 호출에 다단 폴백 정의 (INV-4)
- **테스트 가능 설계** — 순수 함수 분리(G116), Oracle 대조, 계층 분리(D37)
- **컨텍스트 최소화** — 서버 재조회(D31)로 프롬프트 주입 구조적 차단
- **소요시간 미표시** — 타입 수준에서 INV-3 보장 (VisitSlotDisplay에 필드 부재)

### Design Risks / Technical Debt (구현 시 주의)
- LLM 벤더·모델 미확정 — 프롬프트 최적화 지연 가능
- 어셈블리 라이브러리 미확정 — day1 5초 벤치마크 필요
- Places API 약관 미검토 — 웹 소싱 합법성 확인 선결
- 체류시간 정적 테이블 실측 보정 필요 (G51)
- 이동 안전계수 캘리브레이션 필요 (G106)
- 취향 7축 택소노미 UX팀 협의 미완
- Kotlin↔Python 서비스 간 프로토콜(REST/gRPC) 미확정

## Implementation Readiness

| 항목 | 준비도 | 차단 요소 |
|---|---|---|
| C1 LLM Gateway | 높음 | LLM 벤더 계약 |
| C2 Assembly Engine | 높음 | 어셈블리 라이브러리 벤치마크 |
| M7 Place Data | 높음 | Places API 벤더·약관 |
| 도메인 모델 | 완료 | — |
| 테스트 프레임워크 | 완료 | — |
| 인프라/배포 | 낮음 | 컨테이너·CI 파이프라인 설정 필요 |

## Recommendations for Implementation Start

1. **즉시 착수 가능**: 도메인 모델(Poi, ItineraryProblem/Solution) + Port 인터페이스 + PBT generators
2. **어셈블리 우선**: C2 핵심 로직(HC1~HC4 + 휴리스틱) — 어셈블리 라이브러리 벤치마크와 병행
3. **LLM 의존 최소화**: C1은 fake로 시작, 벤더 확정 후 실 어댑터 추가
4. **데이터 레이어**: M7 후보 풀 생성 파이프라인 + 수집 게이트 — Places API 벤더와 독립
