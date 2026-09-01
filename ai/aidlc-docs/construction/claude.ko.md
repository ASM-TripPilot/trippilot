# construction — CONSTRUCTION Phase 산출물

> English version: ./claude.md

CONSTRUCTION Phase에서 생성될 유닛별 상세 설계와 코드 요약이 여기에 들어갑니다.
"HOW — 어떻게 만드는가"를 정의합니다.

## 최초 계획 구조 (2026-07 계획 — 실물과 다르다)

```
construction/
├── plans/
├── u1-domain-ports/
│   ├── functional-design/
│   └── code/
├── u2-solver/
│   ├── functional-design/
│   ├── nfr-requirements/
│   └── code/
├── u3-m7-place-data/
│   ├── functional-design/
│   └── code/
├── u4-c1-gateway/
│   ├── functional-design/
│   └── code/
├── u5-orchestration-api/
│   ├── functional-design/
│   └── code/
├── u6-extended/
│   ├── functional-design/
│   └── code/
└── build-and-test/
```

## 현재 상태

CONSTRUCTION 진행 중이다 — 2026-09-02까지 여기 있던 "아직 미착수 · U1부터 순차 진행 예정"은
2026-07에 쓰인 뒤 갱신되지 않은 문장이다. 유닛별 기능 설계는 `<unit>/functional-design/` 에
있고, 유닛 목록은 여기에 다시 적지 말고 그 디렉토리를 볼 것. 진행 상태 정본은
`../../claude.md` §Current Status.

위 계획 트리와의 차이 둘은 누락이 아니라 결정이다:
- **`code/` 디렉토리 없음.** 애플리케이션 코드는 워크스페이스 루트(`ai/src/trippilot/`)에 쓰고
  `aidlc-docs/` 아래에는 두지 않는다 — `../aidlc-state.md` 의 Code Location Rules. 계획 트리가
  애초에 그 규칙과 모순이었다.
- **U5(Orchestration & API)는 기능 설계 문서가 없다.** FD 게이트 없이 코드로 바로 만들었다
  (TRIP-237/238 오케스트레이터, TRIP-239 FastAPI 경계, TRIP-241 실배선, TRIP-242 IntentRouter).
