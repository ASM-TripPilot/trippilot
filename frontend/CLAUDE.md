# CLAUDE.md — frontend 개발 하네스

This file provides guidance to Claude Code (claude.ai/code) when working in `frontend/`.

> **위치·범위**: 프로젝트 전반 가이드(리포 구조·정본 문서·아키텍처·빌드/테스트·컨벤션)는 **리포 루트 `CLAUDE.md`**에 있다 — Claude Code를 frontend/에서 실행하면 상위 디렉토리 CLAUDE.md로 함께 자동 로드된다. 이 파일은 **frontend 개발 하네스 규칙만** 담는다.

## 하네스: TripPilot 개발 사이클

**목표:** 루프 엔지니어링 기반 TDD 개발 사이클(인지→메모리→설계→테스트→구현→검증→리팩토링→기록)을 사용자 검토 게이트 2개(테스트 승인·구현 승인)와 함께 운영한다.

**트리거:** TripPilot **frontend** 코드 변경 작업(기능/화면/티켓/버그/리팩토링/스캐폴딩) 요청 시 `trippilot-dev-cycle` 스킬을 사용하라(하네스 소재: `frontend/.claude/`). backend/ai 코드 작업용 하네스는 아직 없다 — 해당 요청 시 하네스 부재를 알리고 일반 워크플로우로 진행하라. 단순 질문·문서 열람·문서 편집은 직접 응답 가능(단, 의미 있는 문서 변경은 옵시디언 개발일지에 기록).

**변경 이력:** 원장은 옵시디언 `TripPilot/하네스 변경이력.md`다 — 하네스(에이전트·스킬·settings·이 파일)를 변경하면 반드시 그 표에 행을 추가하라(append-only, 날짜·변경 내용·대상·사유). 리포 쪽 diff는 git 히스토리(`frontend/.claude/`)로 추적한다.
