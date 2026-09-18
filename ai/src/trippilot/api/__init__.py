"""U5-03 — 백엔드가 호출하는 HTTP 경계 (FastAPI).

경로 정본: services.md §0 / agent-io-contracts.md §0.1
- POST /ai/v1/itinerary/generate · /validate · /repair (snake_case 와이어)

이 계층은 **얇다**: 스키마 검증 → 오케스트레이터 위임 → 도메인 타입을 표시 스키마로 사영.
판단(후보·점수·시각)은 전부 하위 계층(M7·C1·C2) 소유다.
"""
