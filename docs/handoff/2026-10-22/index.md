---
date: 2026-10-22
written: 2026-10-22 KST
written_by: Claude Code (로컬 세션 3280e9e7 — 이 세션의 기억 + git/gh 실측)
sessions: 1
---
# 2026-10-22 세션 인수인계 상황판

> **이 문서가 출발점이다.** 맡을 세션을 고르고 그 문서의 "다음에 이어서 할 일"을 위에서부터 집행한다. 규약은 `../README.md`. 2026-10-20 상황판(AI 쪽 19세션)은 따로 있다 — 이 날은 프론트 단일 작업이다.

## 무슨 일이 있었나
- 서울·부산·제주만 서비스하기로 한 뒤, AI 로 만든 수묵담채(K6) 일러스트로 사진 없는 칸을 채우는 작업을 이어 왔다. 지역 커버(#1138)와 홈 히어로는 이미 develop 에 있다.
- 10-22: **장소 사진 칸 19곳을 `PlacePhoto` 한 부품으로 모으고 사진이 없거나 깨지면 카테고리 일러스트(10종×3변형)를 거는 PR #1554 를 develop 에 스쿼시 머지**했다(`8a0fb3316`).
- 이어서 **숙소 사진 칸**: 숙소 API 에 사진 필드가 없어 칸 전체가 회색이다. 유형별 그림은 데이터와 대응이 안 돼 버리고, **유형과 무관한 일반 숙소 그림 6장**으로 정했다. 에셋은 만들어 이 브랜치에 push 했고 **앱 연결이 남았다.**

## 세션 표

| # | 문서 | 역할 | 상태 | 다음 한 줄 |
|---|---|---|---|---|
| 1 | [root-3280e9e7-stay-generic-covers](root-3280e9e7-stay-generic-covers.md) | 숙소 일반 그림 연결 | **인수인계-대기** | 브랜치 확인 → 결정 3건 확인 → dev-cycle 로 숙소 사진 칸 6곳 `PlacePhoto` 연결 |

## WIP 브랜치 (push 됨)

| 브랜치 | 내용 | 상태 |
|---|---|---|
| `feature/stay-generic-covers` | 숙소 그림 6장(`frontend/assets/stay-covers/`) + 생성 스크립트 + README + 이 handoff | 코드 연결 전(에셋·문서뿐). PR 없음 |

정리 대상(삭제하지 않음): 로컬·원격 `feature/place-category-covers`(#1554 로 머지됨) · 로컬 `feature/region-cover-images`(#1138 로 머지돼 낡음).

## 열린 PR
없음. (#1554 머지 완료.)

## 공통 규칙·함정 (세션 문서의 "함정"에 상세)
- 프론트 코드 변경은 `frontend/CLAUDE.md` 의 `trippilot-dev-cycle` 로. push·PR·머지는 사용자가 시킬 때만, 커밋·PR 에 Claude 표기 금지, 답은 한국어.
- 시뮬레이터 확인 전 Metro 가 `CI=1` 인지 본다(옛 번들 서빙). push 훅은 gitignored `frontend/_workspace`·로컬 `ios/` 에 걸린다.
- develop 이 빨라 머지 직전 충돌이 잦다(`audit.md`·`structure.generated.md`).
