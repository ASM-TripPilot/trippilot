import { isCandidatesDemoted, resolveFallbackNotice } from './draftView';

/**
 * TRIP-304 · 폴백·강등 배너의 **판정 규칙층**(model 순수 함수 `resolveFallbackNotice`).
 *
 * 무엇을 보장하나 — 세 신호(`isFallback`·`solveMode`·298 `demoted`)가 하나의 배너로 접힐 때 어느
 * 하나만 골라야 하고, 그 선택이 심각도 순위 **MINIMAL > LOW(demoted) > DETERMINISTIC** 를 따른다.
 *
 *  - 🔴 세 신호가 겹쳐도 배너는 하나 — 접기 순서 `minimal → demoted → deterministic`(01b 결정 2).
 *  - 🔴 **MANUAL 함정**: `solveMode=MINIMAL` 이라도 `isFallback=false` 면 폴백이 아니라 **선택**이다
 *    (openapi 원문). minimal 갈래는 `isFallback=true` 를 함께 봐야 한다 — 안 그러면 직접 만들기
 *    빈 일정에 "최소 일정 폴백" 오배너가 뜬다(맹점 후보 ①·INV-4).
 *  - `demoted` 갈래는 298 `isCandidatesDemoted` 를 재사용한다(01b 결정 2) — 이 파일은 두 판정이
 *    같은 답을 내는지(동작)만 잰다. "함수를 정말 재호출했나"라는 구현 세부는 심판하지 않는다.
 *
 * 3동작 뼈대: 준비=신호 조합을 만든다 → 실행=`resolveFallbackNotice(...)` → 단언=어느 배너/없음.
 *
 * *(개념)* **판별 유니온** — `{ kind: 'minimal' | 'deterministic' | 'demoted' }` 처럼 "종류 꼬리표를
 * 단 값". 화면이 `switch` 없이 꼬리표 하나로 그릴 배너를 고른다. 신호 없으면 `null`(배너 0건).
 */

describe('🔴 F-1 · AC-1 — DETERMINISTIC 폴백은 deterministic 배너다 (BR-U3-11)', () => {
  it('isFallback=true & solveMode=DETERMINISTIC → { kind: "deterministic" }', () => {
    expect(
      resolveFallbackNotice({ solveMode: 'DETERMINISTIC', isFallback: true })
    ).toEqual({ kind: 'deterministic' });
  });
});

describe('🔴 F-2 · AC-2 — MINIMAL 최소 일정은 minimal 배너다', () => {
  it('solveMode=MINIMAL & isFallback=true → { kind: "minimal" }', () => {
    expect(
      resolveFallbackNotice({ solveMode: 'MINIMAL', isFallback: true })
    ).toEqual({ kind: 'minimal' });
  });
});

describe('🔴 F-3 · AC-6 — LOW 강등 단독은 demoted 배너다 (298 isCandidatesDemoted 재사용)', () => {
  it('candidatesSummary.level=LOW → { kind: "demoted" } 이고, 298 판정과 답이 같다', () => {
    // solveMode 는 폴백이 아닌 정상값(FULL_AI, isFallback:false) — demoted 신호만 살아 있다.
    expect(
      resolveFallbackNotice({
        solveMode: 'FULL_AI',
        isFallback: false,
        candidatesSummary: { level: 'LOW' },
      })
    ).toEqual({ kind: 'demoted' });

    // 짝 — 재사용하는 298 판정이 같은 입력에 true 다. demoted 갈래가 그 판정과 어긋나면 여기서 갈린다.
    expect(isCandidatesDemoted({ level: 'LOW' })).toBe(true);
  });
});

describe('🔴 F-4 · AC-4 — 아무 신호 없으면 배너 0건(null)', () => {
  it('정상값·조용한 요약·전부 미도착 세 경우가 모두 null 이다', () => {
    // (a) 정상 경로 — FULL_AI 성공, 요약 없음.
    expect(
      resolveFallbackNotice({ solveMode: 'FULL_AI', isFallback: false })
    ).toBeNull();

    // (b) 요약은 왔지만 조용한 값(OK) — 298 화이트리스트가 안내를 안 켠다.
    expect(
      resolveFallbackNotice({
        solveMode: 'FULL_AI',
        isFallback: false,
        candidatesSummary: { level: 'OK' },
      })
    ).toBeNull();

    // (c) 데이터가 아직 안 온 첫 렌더 — 세 입력 전부 undefined.
    expect(resolveFallbackNotice({})).toBeNull();
  });
});

describe('🔴 F-5 · AC-3 — MINIMAL 이 LOW 를 이긴다 (심각도 최상위 하나만)', () => {
  it('MINIMAL(＋isFallback) 과 LOW 가 동시에 와도 minimal 하나만 반환한다', () => {
    expect(
      resolveFallbackNotice({
        solveMode: 'MINIMAL',
        isFallback: true,
        candidatesSummary: { level: 'LOW' },
      })
    ).toEqual({ kind: 'minimal' });
  });
});

describe('🔴 F-6 · AC-3 — LOW 가 DETERMINISTIC 을 이긴다 (접기 순서 잠금)', () => {
  it('DETERMINISTIC(＋isFallback) 과 LOW 가 동시에 오면 demoted 를 반환한다', () => {
    // 접기 순서는 minimal → **demoted → deterministic**. deterministic 을 먼저 보는 구현은
    // 여기서 { kind:'deterministic' } 를 내며 죽는다. 실제 후보 누락(LOW)이 알고리즘 강등보다 심각하다.
    expect(
      resolveFallbackNotice({
        solveMode: 'DETERMINISTIC',
        isFallback: true,
        candidatesSummary: { level: 'LOW' },
      })
    ).toEqual({ kind: 'demoted' });
  });
});

describe('🔴 F-7 · AC-7 — MANUAL 방어: (MINIMAL, isFallback=false) 는 폴백이 아니다', () => {
  it('MINIMAL 이라도 isFallback=false 면 minimal 을 안 켜고, 다른 신호가 있으면 그쪽만 켠다', () => {
    // (a) 순수 MANUAL — 빈 일정을 직접 만든 것이지 실패가 아니다. 배너 0건.
    //     minimal 갈래에서 `&& isFallback` 을 지운 구현은 여기서 { kind:'minimal' } 를 내며 죽는다.
    expect(
      resolveFallbackNotice({ solveMode: 'MINIMAL', isFallback: false })
    ).toBeNull();

    // (b) 같은 (MINIMAL, false) 인데 LOW 요약이 함께 왔다 → demoted 는 여전히 발동해야 한다.
    //     isFallback 게이트는 **minimal 갈래만** 막는다 — demoted 까지 삼키면 정당한 강등을 놓친다.
    expect(
      resolveFallbackNotice({
        solveMode: 'MINIMAL',
        isFallback: false,
        candidatesSummary: { level: 'LOW' },
      })
    ).toEqual({ kind: 'demoted' });
  });
});
