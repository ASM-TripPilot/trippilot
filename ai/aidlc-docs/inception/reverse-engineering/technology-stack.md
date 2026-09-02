# Technology Stack

## Programming Languages

| Language | Version | Usage |
|---|---|---|
| Python | 3.11+ (권고) | AI 서비스 전체 (C1 + C2 + M7) |
| Kotlin | (범위 밖) | TripPilot 백엔드 (M8, M9, M10, M11, M13, M16) |

## Frameworks (확정 필요)

| Framework | Version | Purpose |
|---|---|---|
| FastAPI (권고) | latest | HTTP API 서빙 (REST) |
| pydantic | latest | 스키마 검증·직렬화 |
| OR-Tools (후보) | latest | OPTW/TOPTW 어셈블리 (벤치마크 후 확정) |
| Timefold (후보) | latest | 제약 스트리밍 DSL 어셈블리 (대안) |

## Infrastructure (확정 필요)

| Service | Purpose |
|---|---|
| AWS Secrets Manager | LLM API 키 보관 |
| AWS CloudWatch | 비용 계측·쿼터 알람·어댑터 실패율 관측 |
| 컨테이너 런타임 (ECS/EKS) | Python AI 서비스 배포 (미확정) |
| POI Database | M7 정본 저장 (벤더 미확정) |
| Cache (Redis 등) | POI TTL 캐싱 (미확정) |

## Build Tools (확정 필요)

| Tool | Version | Purpose |
|---|---|---|
| uv/poetry (권고) | latest | Python 패키지·의존성 관리 |
| Docker | latest | 컨테이너 이미지 빌드 |
| GitHub Actions / CI | — | PR CI (PBT) + 릴리스 파이프라인 (LLM 회귀) |

## Testing Tools

| Tool | Version | Purpose |
|---|---|---|
| pytest | latest | 테스트 프레임워크 |
| Hypothesis | latest | Property-Based Testing (서버 PBT) |
| fast-check | latest | 클라이언트 JS PBT (범위 밖) |

## External APIs

| API | Purpose | Priority |
|---|---|---|
| LLM API (벤더 미확정) | 취향 해석·선호 점수·설명·회고·웹 추출 | 핵심 |
| 카카오모빌리티 | 도로 거리 (이동시간 추정 1순위) | 핵심 |
| 네이버 지도 | 도로 거리 (2순위 폴백) | 폴백 |
| Places API (카카오/구글) | POI 구조화 데이터 (웹 소싱 1단계) | 보강 |
| 기상청 예보 API | 날씨 트리거 (Plan-B) | 핵심 |

## Key Design Decisions Affecting Stack

| Decision | Impact |
|---|---|
| AI-D01: 전면 Python | C2(어셈블리)도 Python. Kotlin 인프로세스 전제 폐기 |
| D11: 서버 경유 단일 벤더 | API 키 서버 보관, 클라이언트 직접 호출 금지 |
| D37: 테스트 계층 분리 | PR CI에서 LLM·외부API fake, 어셈블리 실코드 |
| INV-4: 결정론 폴백 | 시드 고정, 무작위성 제거 필수 |
