# TripPilot

B2C 여행 슈퍼앱("여행자 슈퍼앱"). 사용자가 숙소·장소를 탐색/저장하면, 앱은 **예약 이후**를 책임진다 — AI 일정 생성, 여행 중 Plan-B 재계획, 여행 후 기록·회고. 예약·결제 자체는 외부 OTA 어필리에이트 링크에 위임한다.

> 설계 단계 — 코드는 아직 0줄. 이 리포는 정본 설계 문서(주로 한국어)를 담는다.

## 모노레포 구조

| 디렉토리 | 역할 |
|---|---|
| `docs/` | **기획 정본** (`docs/planning/`) + 팀 컨벤션 (`docs/conventions/`). 제품·아키텍처·도메인·유닛의 단일 진실 공급원 |
| `backend/` | 백엔드 (Spring Boot + Kotlin 모듈러 모놀리스). 설계 문서 `backend/docs/design/` |
| `frontend/` | 프론트엔드 (React Native + Expo). 설계·IO 문서 `frontend/docs/` |
| `ai/` | AI 레이어 설계 (일정/Plan-B/회고 아키텍처·프롬프트·솔버·테스트) |
| `aidlc/` | 팀원 소유 AWS AI-DLC(Amazon Q) 워크스페이스. 조율 없이 수정 금지 |

- 온보딩: `CLAUDE.md` → `docs/planning/`
- Figma 와이어프레임 PNG는 리포 외부 보관 (화면 IO 카탈로그만 `frontend/docs/와이어프레임-화면-IO정리.md`에 추적)
- 문서 충돌 시 `docs/planning/`이 정본
