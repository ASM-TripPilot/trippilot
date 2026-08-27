# TripPilot

B2C 여행 슈퍼앱("여행자 슈퍼앱"). 사용자가 숙소·장소를 탐색/저장하면, 앱은 **예약 이후**를 책임진다 — AI 일정 생성, 여행 중 Plan-B 재계획, 여행 후 기록·회고. 예약·결제 자체는 외부 OTA 어필리에이트 링크에 위임한다.

> **구현 중.** 백엔드·프론트엔드·AI 서비스 모두 동작하는 코드가 있다(2026-08-27 기준 소스 2,100여 파일).
> 설계 문서(주로 한국어)도 같은 리포에 있으며, 문서와 코드가 어긋나면 **코드가 정본**이다.

## 모노레포 구조

| 디렉토리 | 역할 |
|---|---|
| `docs/` | 팀 프로세스 문서 — 컨벤션 (`docs/conventions/`: 브랜치·커밋·PR) + 도구 가이드 (`docs/guides/`: 지라·슬랙) |
| `backend/` | 백엔드 (Spring Boot + Kotlin 모듈러 모놀리스). 설계 문서 `backend/docs/design/` |
| `frontend/` | 프론트엔드 (React Native + Expo). 설계·IO 문서 `frontend/docs/` |
| `ai/` | AI 레이어 설계 (일정/Plan-B/회고 아키텍처·프롬프트·솔버·테스트) |
| `aidlc/` | 팀원 소유 AWS AI-DLC(Amazon Q) 워크스페이스. **기획 정본** = `aidlc-docs/inception/` (요구사항·스토리·유닛 U0–U9), **유닛별 설계** = `aidlc-docs/construction/`. 조율 없이 수정 금지 |

- 온보딩: `CLAUDE.md` → `aidlc/aidlc-docs/inception/`
- 화면 명세는 **Figma가 유일한 정본** — 리포에 사본을 두지 않는다(와이어프레임 PNG도 리포 외부). 밴드 맵·파일 키는 `frontend/.claude/skills/spec-perception/reference/figma-structure.md`
- 문서 충돌 시: 제품 요구사항·스토리·유닛은 `aidlc/aidlc-docs/inception/`, 패키지 아키텍처·구현 결정은 해당 패키지 정본(`frontend/README.md` · `backend/docs/design/` · `ai/`)이 우선
