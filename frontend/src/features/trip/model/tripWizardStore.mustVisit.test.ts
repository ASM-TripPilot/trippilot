import type { MustVisitSeedItem } from './mustVisitSeed';
import { useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-209 AC-5 · AC-12 · 01b §5-1·§5-2 — 시드 목록이 **드래프트 안에서** 사는 규칙.
 *
 * 무엇을 보장하나:
 *  - 시드는 **한 번만** 채워진다 — 재조회·리렌더가 사용자가 뺀 항목을 되살리지 않는다.
 *  - 개별 제거가 **정확히 하나만** 지운다(같은 식별자가 두 개 들어 있어도).
 *  - 제거가 다른 축(여행지·인원·`touched`)을 건드리지 않는다.
 *
 * 🔴 왜 "정확히 하나"가 이 파일의 급소인가 — 문제로그
 * `2026-08-02 값 일치로 지우는 제거 API는 중복에서 무너진다`. **바로 이 스토어의**
 * `removeDestination` 이 `filter` 로 지우다가 "부산 하나를 지우려는데 부산이 전부 사라지는"
 * 사고를 냈다(code-critic W-3 실측). 시드 쪽도 첫 손이 자연스럽게 잡는 코드가
 * `mustVisits.filter(m => m.sourcePoiId !== id)` 다 — 같은 함정이 같은 파일에 두 번째로 놓인다.
 * `seedMustVisits` 가 중복을 걸러 주니 "실전에서는 중복이 안 온다"는 반론이 가능하지만, 그
 * 불변식은 **순수 함수 하나에만** 걸려 있고 이 setter 는 누구나 부를 수 있다.
 *
 * ⚠️ 이 스토어 파일에 서버 DTO 이름(`SavedPlace`·`savedPlaceId`·`savedAt`·`savedCount`·
 * `dataStatus`)이 들어가면 `src/__tests__/savedPlacesStructure.test.ts` 가 즉시 red 를 낸다 —
 * 그 가드는 `tripWizardStore.ts` 를 **이름째** 감시한다(frontend/README.md §66). 그래서 시드
 * 항목은 서버 응답이 아니라 `MustVisitSeedItem`(자체 뷰모델)이다.
 *
 * 3동작 뼈대: 준비=스토어 상태 만들기 → 실행=액션 호출 → 단언=`getState()` 값.
 *
 * ── 졸업 조건 ── **A. 영구 규칙 — 유지한다.** "제거는 하나만"·"시드는 1회"는 드래프트가 사는 한
 * 유효하고 항목이 늘어도 갱신이 필요 없다.
 */

const store = () => useTripWizardStore.getState();

function seed(
  sourcePoiId: string,
  name = `장소-${sourcePoiId}`
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl: null };
}

beforeEach(() => {
  // 모듈 싱글턴이라 앞 테스트가 남긴 값이 뒤 테스트로 샌다.
  store().reset();
});

describe('N2 · 시드 목록의 초기값과 1회성 채우기', () => {
  it('N2-1 처음에는 비어 있고 아직 채워지지 않은 상태다', () => {
    expect({
      mustVisits: store().mustVisits,
      initialized: store().mustVisitsInitialized,
    }).toEqual({ mustVisits: [], initialized: false });
  });

  it('N2-2 두 번째 채우기는 무시된다 — 사용자가 뺀 항목이 되살아나지 않는다', () => {
    // 준비 + 실행 ① — 담은 장소가 도착해 시드가 채워졌다.
    store().initMustVisits([seed('poi-1'), seed('poi-2')]);

    // 긍정 짝 — 첫 호출은 실제로 반영됐다. 없으면 아래 "안 바뀐다"가 공허하다.
    expect(store().mustVisits.map((m) => m.sourcePoiId)).toEqual([
      'poi-1',
      'poi-2',
    ]);
    expect(store().mustVisitsInitialized).toBe(true);

    // 실행 ② — 재조회·리렌더로 같은 자리가 다시 불린다(실제 앱에서 늘 일어난다).
    store().initMustVisits([seed('poi-9')]);

    // 단언 — 목록이 갈아엎어지지 않는다. 갈아엎으면 사용자가 방금 x 로 뺀 항목이
    // 되돌아오고, 사용자는 자기가 뺀 곳이 여행에 등록되는 것을 보게 된다.
    expect(store().mustVisits.map((m) => m.sourcePoiId)).toEqual([
      'poi-1',
      'poi-2',
    ]);
  });

  it('N2-6 reset 이 시드와 플래그를 함께 되돌린다', () => {
    store().initMustVisits([seed('poi-1')]);

    store().reset();

    expect({
      mustVisits: store().mustVisits,
      initialized: store().mustVisitsInitialized,
    }).toEqual({ mustVisits: [], initialized: false });
  });
});

/**
 * ─── TRIP-288 추가분 (N2-7 ~ N2-9) ─────────────────────────────────────────────
 *
 * `addMustVisits` — 시드의 **두 번째 문**. 담은 목록이 늘어난 채 화면이 다시 그려질 때 들어오는
 * 자리이고, `initMustVisits`(첫 문)와 달리 **여러 번 불려도 일한다**. 단 하는 일은 더하기뿐이다.
 *
 * ⚠️ 왜 문을 새로 내는가 — 위 N2-2 가 "`initMustVisits` 2회차는 무시"를 못 박고 있다(승인 동결).
 * 재시드를 그 문으로 넣으려면 N2-2 를 고쳐야 하고, 그건 "사용자가 뺀 항목이 되살아나지 않는다"는
 * 계약을 스스로 무르는 것이다. 그래서 계약은 그대로 두고 **더하기 전용 문**을 따로 낸다.
 *
 * 무엇을 보장하나:
 *  - 두 번째 호출에서 **새 것만** 더한다(01b D2 · D11 — 기존 것 뒤에).
 *  - x 로 뺀 곳은 **다시 담아도** 안 돌아온다(D7 — 판정 기준은 `sourcePoiId` 하나).
 *  - 그 기억은 `reset()` 으로 **함께** 비워진다(D1 — 새 진입이면 예전 제외는 무효다).
 *  - 바뀐 게 없으면 `mustVisits` 를 **새 배열로 갈아 끼우지 않는다**(제약 11 · 렌더 루프).
 *
 * 3동작 뼈대: 준비=액션으로 상태 만들기 → 실행=`addMustVisits` → 단언=`getState()` 값.
 */
describe('N2 · addMustVisits — 재시드 (TRIP-288 AC-1 · AC-2 · AC-4)', () => {
  const ids = () => store().mustVisits.map((one) => one.sourcePoiId);

  it('🔴 N2-7 첫 호출은 채우고, 두 번째 호출은 새 것만 뒤에 더한다', () => {
    store().addMustVisits([seed('poi-1'), seed('poi-2')]);

    // 긍정 짝 — 첫 호출이 실제로 반영됐다. 없으면 아래 "더해진다"가 공허하다.
    expect(ids()).toEqual(['poi-1', 'poi-2']);
    expect(store().mustVisitsInitialized).toBe(true);

    // 실행 — 더 담기로 한 곳을 새로 담고 돌아왔다(같은 목록 + 새 한 건).
    store().addMustVisits([seed('poi-1'), seed('poi-2'), seed('poi-3')]);

    // 2회차가 통째로 무시되면(= N2-2 와 같은 문이면) `poi-3` 이 안 들어와 여기서 죽는다.
    expect(ids()).toEqual(['poi-1', 'poi-2', 'poi-3']);
  });

  it('🔴 N2-8 뺀 곳은 다시 담아도 안 돌아오고, 새로 진입하면 돌아온다', () => {
    store().addMustVisits([seed('poi-1'), seed('poi-2'), seed('poi-3')]);
    store().removeMustVisit('poi-2');
    expect(ids()).toEqual(['poi-1', 'poi-3']);

    // 실행 ① — 탐색에서 `poi-2` 담기를 풀었다 다시 담고, `poi-4` 를 새로 담아 돌아왔다.
    store().addMustVisits([
      seed('poi-1'),
      seed('poi-2'),
      seed('poi-3'),
      seed('poi-4'),
    ]);

    // 부정(`poi-2` 안 돌아옴)과 긍정 짝(`poi-4` 들어옴)이 한 단언 안에 있다.
    expect(ids()).toEqual(['poi-1', 'poi-3', 'poi-4']);

    // 실행 ② — 위저드에 **새로 진입**했다. 제외 기억은 드래프트의 일부라 함께 비워진다 —
    // 안 비우면 새 여행에서 "담았는데 안 들어오는" 새 증상이 생긴다(01b D1 · AC-1).
    store().reset();
    store().addMustVisits([seed('poi-1'), seed('poi-2'), seed('poi-3')]);

    expect(ids()).toEqual(['poi-1', 'poi-2', 'poi-3']);
  });

  it('🔴 N2-9 더할 게 없으면 목록을 새 배열로 갈아 끼우지 않는다 (렌더 루프 차단)', () => {
    store().addMustVisits([seed('poi-1'), seed('poi-2')]);
    const before = store().mustVisits;

    // 실행 — 같은 목록이 또 도착했다(게스트·미도착 상태에서는 매 렌더 일어난다).
    store().addMustVisits([seed('poi-1'), seed('poi-2')]);

    // 내용이 같아도 **새 배열**이면 화면이 다시 그려지고, 그 렌더가 이 액션을 다시 불러
    // 무한 루프가 된다(02a ★2 · §5 P3 실측 — render 가 던진다).
    expect(store().mustVisits).toBe(before);

    // 짝(긍정) — 그렇다고 아무 일도 안 하는 것은 아니다.
    store().addMustVisits([seed('poi-1'), seed('poi-2'), seed('poi-3')]);
    expect(store().mustVisits).not.toBe(before);
    expect(ids()).toEqual(['poi-1', 'poi-2', 'poi-3']);
  });
});

describe('N2 · removeMustVisit — 개별 제거 (AC-5 · BR-U1-37)', () => {
  it('🔴 N2-3 같은 식별자가 둘 있어도 한 번 누르면 하나만 사라진다', () => {
    // 준비 — 같은 `sourcePoiId` 두 건을 **일부러** 넣는다. `filter` 로 지우는 구현은
    // 여기서 길이가 1이 되어 죽는다(문제로그 2026-08-02 · 같은 파일의 removeDestination 재발).
    store().initMustVisits([seed('poi-1'), seed('poi-1'), seed('poi-2')]);

    // 실행 — 사용자가 x 를 **한 번** 눌렀다.
    store().removeMustVisit('poi-1');

    // 단언 — 한 건만 빠지고 같은 식별자가 아직 하나 남아 있다.
    const ids = store().mustVisits.map((m) => m.sourcePoiId);
    expect(ids).toHaveLength(2);
    expect(ids.filter((id) => id === 'poi-1')).toHaveLength(1);
    expect(ids).toContain('poi-2');
  });

  it('N2-4 없는 식별자로 지우면 아무 것도 사라지지 않는다', () => {
    store().initMustVisits([seed('poi-1'), seed('poi-2')]);

    store().removeMustVisit('poi-없음');

    // "못 찾으면 전부 지운다" 같은 구현을 막는다.
    expect(store().mustVisits.map((m) => m.sourcePoiId)).toEqual([
      'poi-1',
      'poi-2',
    ]);
  });

  it('N2-5 제거가 다른 축을 건드리지 않고 [다음] 게이트에도 끼어들지 않는다', () => {
    // 준비 — 여행지·인원을 먼저 채워 둔다(사용자가 이미 건드린 축).
    store().addDestination('부산', 2);
    store().setParty(3);
    store().initMustVisits([seed('poi-1'), seed('poi-2')]);

    store().removeMustVisit('poi-1');

    // 단언 ① — 다른 축은 그대로다.
    expect(store().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
    ]);
    expect(store().party).toBe(3);

    // 단언 ② — `touched` 에 시드 축이 생기지 않는다. `touched` 는 "오류 문구를 보여도 되는
    // 축"의 집합이라(TRIP-206), 시드가 끼면 엉뚱한 축의 문구 게이트가 열린다.
    expect(store().touched).toEqual(['destinations', 'party']);

    // 짝(긍정) — 제거 자체는 실제로 일어났다.
    expect(store().mustVisits.map((m) => m.sourcePoiId)).toEqual(['poi-2']);
  });
});
