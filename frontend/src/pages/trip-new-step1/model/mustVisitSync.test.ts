import fc from 'fast-check';

import { planMustVisitSync, type MustVisitSyncPlan } from './mustVisitSync';

/**
 * TRIP-1113 — 이미 만든 여행의 꼭 갈 곳(서버)을 위저드 시드(화면)에 맞추는 계획.
 *
 * 무엇을 보장하나: 계획대로 추가·삭제하면 서버 목록이 시드와 같은 집합이 되고, 양쪽에 다 있는 곳은
 * 요청을 만들지 않는다. 적용한 결과로 다시 계획하면 할 일이 없다 — 재시도는 남은 차이만 보낸다.
 */

type Registered = { mustVisitId: string; sourcePoiId: string };

function registered(poiId: string): Registered {
  return { mustVisitId: `mv-${poiId}`, sourcePoiId: poiId };
}

/** 계획을 서버 목록에 적용한 결과 — 지울 id 를 빼고, 더할 poiId 를 새 행으로 붙인다. */
function apply(server: Registered[], plan: MustVisitSyncPlan): Registered[] {
  return [
    ...server.filter((row) => !plan.toDelete.includes(row.mustVisitId)),
    ...plan.toAdd.map((poiId) => ({
      mustVisitId: `mv-new-${poiId}`,
      sourcePoiId: poiId,
    })),
  ];
}

const POIS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
// 작은 풀에서 뽑아야 서버·시드가 자주 겹친다(겹침이 이 함수의 급소).
const SERVER_ARB = fc
  .uniqueArray(fc.constantFrom(...POIS), { maxLength: POIS.length })
  .map((ids) => ids.map(registered));
const SEED_ARB = fc.array(fc.constantFrom(...POIS), { maxLength: 8 });

describe('planMustVisitSync · 예시', () => {
  it('S-1 서버 A·B, 시드 B·C 면 C 만 더하고 A 만 지운다(B 는 요청 없음)', () => {
    const plan = planMustVisitSync({
      registered: [registered('poi-A'), registered('poi-B')],
      seedPoiIds: ['poi-B', 'poi-C'],
    });

    expect(plan).toEqual({ toAdd: ['poi-C'], toDelete: ['mv-poi-A'] });
  });

  it('S-2 둘 다 비었으면 할 일이 없다', () => {
    expect(planMustVisitSync({ registered: [], seedPoiIds: [] })).toEqual({
      toAdd: [],
      toDelete: [],
    });
  });

  it('S-3 시드에 같은 곳이 두 번 있어도 한 번만 더한다', () => {
    const plan = planMustVisitSync({
      registered: [],
      seedPoiIds: ['poi-C', 'poi-C'],
    });

    expect(plan.toAdd).toEqual(['poi-C']);
  });

  it('S-4 시드를 전부 뺐으면 서버에 있던 곳을 전부 지운다', () => {
    const plan = planMustVisitSync({
      registered: [registered('poi-A'), registered('poi-B')],
      seedPoiIds: [],
    });

    expect(plan).toEqual({ toAdd: [], toDelete: ['mv-poi-A', 'mv-poi-B'] });
  });
});

describe('planMustVisitSync · 성질(PBT)', () => {
  it('P-1 계획을 적용하면 서버의 꼭 갈 곳 집합이 시드 집합과 같아진다', () => {
    fc.assert(
      fc.property(SERVER_ARB, SEED_ARB, (server, seed) => {
        const plan = planMustVisitSync({
          registered: server,
          seedPoiIds: seed,
        });
        const after = new Set(
          apply(server, plan).map((row) => row.sourcePoiId)
        );

        expect([...after].sort()).toEqual([...new Set(seed)].sort());
      })
    );
  });

  it('P-2 양쪽에 다 있는 곳은 더하지도 지우지도 않는다', () => {
    fc.assert(
      fc.property(SERVER_ARB, SEED_ARB, (server, seed) => {
        const plan = planMustVisitSync({
          registered: server,
          seedPoiIds: seed,
        });
        const serverPois = server.map((row) => row.sourcePoiId);
        const deletedPois = server
          .filter((row) => plan.toDelete.includes(row.mustVisitId))
          .map((row) => row.sourcePoiId);

        expect(
          plan.toAdd.filter((poiId) => serverPois.includes(poiId))
        ).toEqual([]);
        expect(deletedPois.filter((poiId) => seed.includes(poiId))).toEqual([]);
      })
    );
  });

  it('P-3 같은 요청을 두 번 만들지 않고, 서버에 없는 id 를 지우지 않는다', () => {
    fc.assert(
      fc.property(SERVER_ARB, SEED_ARB, (server, seed) => {
        const plan = planMustVisitSync({
          registered: server,
          seedPoiIds: seed,
        });
        const serverIds = server.map((row) => row.mustVisitId);

        expect(new Set(plan.toAdd).size).toBe(plan.toAdd.length);
        expect(new Set(plan.toDelete).size).toBe(plan.toDelete.length);
        expect(plan.toDelete.filter((id) => !serverIds.includes(id))).toEqual(
          []
        );
      })
    );
  });

  it('P-4 적용한 결과로 다시 계획하면 할 일이 없다(재시도는 남은 차이만)', () => {
    fc.assert(
      fc.property(SERVER_ARB, SEED_ARB, (server, seed) => {
        const plan = planMustVisitSync({
          registered: server,
          seedPoiIds: seed,
        });
        const again = planMustVisitSync({
          registered: apply(server, plan),
          seedPoiIds: seed,
        });

        expect(again).toEqual({ toAdd: [], toDelete: [] });
      })
    );
  });
});
