import { resolveNearby, type NearbyDeps } from './resolveNearby';

/**
 * TRIP-183 '내 주변' 좌표 해석 — US-STAY-01 정상·예외 · BR-U1-11.
 *
 * **왜 훅이 아니라 순수 함수인가**: 판정에 필요한 것은 세 가지 물음의 답뿐이다 —
 * 권한을 줬나 · 현재 좌표를 얻었나 · 등록 숙소 좌표가 있나. 그 셋을 인자로 받으면
 * `expo-location`도 서버도 목킹하지 않고 분기를 전수 검사할 수 있다.
 * (TRIP-182의 `resolveStaySearchState`가 같은 이유로 순수 함수였다.)
 *
 * 실제 배선(권한 다이얼로그·GET /saved-stays)은 컨테이너가 하고 통합 테스트가 본다.
 */

/** 기본 스텁 — 각 테스트가 필요한 것만 덮어쓴다. */
function deps(over: Partial<NearbyDeps> = {}): NearbyDeps {
  return {
    requestPermission: async () => ({ granted: true }),
    getCurrentPosition: async () => ({ lat: 33.4996, lng: 126.5312 }),
    getSavedStayCoords: async () => null,
    ...over,
  };
}

describe('resolveNearby — 권한 허용', () => {
  it('현재 좌표로 조회한다 (US-STAY-01 정상)', async () => {
    const got = await resolveNearby(deps());

    expect(got).toEqual({ kind: 'granted', lat: 33.4996, lng: 126.5312 });
  });

  it('등록 숙소가 있어도 현재 좌표가 이긴다 — 대체는 권한이 없을 때만이다', async () => {
    const got = await resolveNearby(
      deps({ getSavedStayCoords: async () => ({ lat: 37.5, lng: 127.0 }) })
    );

    expect(got).toEqual({ kind: 'granted', lat: 33.4996, lng: 126.5312 });
  });
});

describe('resolveNearby — 권한 거부 (BR-U1-11)', () => {
  it('등록 숙소 좌표로 대체 조회한다', async () => {
    const got = await resolveNearby(
      deps({
        requestPermission: async () => ({ granted: false }),
        getSavedStayCoords: async () => ({ lat: 35.1796, lng: 129.0756 }),
      })
    );

    // kind가 'granted'가 아니라 'fallback'인 것이 요점 — 화면이 "대체했다"를 고지해야 한다.
    expect(got).toEqual({ kind: 'fallback', lat: 35.1796, lng: 129.0756 });
  });

  it('등록 숙소도 없으면 unavailable — 좌표 없이 조회하지 않는다', async () => {
    const got = await resolveNearby(
      deps({ requestPermission: async () => ({ granted: false }) })
    );

    // 좌표 없이 '내 주변'을 흉내내면 전국 목록을 주변이라고 부르게 된다(INV-4).
    expect(got).toEqual({ kind: 'unavailable', reason: 'denied-no-fallback' });
  });
});

describe('resolveNearby — 권한은 줬는데 좌표를 못 얻는 경우', () => {
  it('등록 숙소 좌표로 대체한다 — 권한 거부와 같은 구제를 받는다', async () => {
    const got = await resolveNearby(
      deps({
        getCurrentPosition: async () => {
          throw new Error('위치 확인 실패');
        },
        getSavedStayCoords: async () => ({ lat: 35.1796, lng: 129.0756 }),
      })
    );

    expect(got).toEqual({ kind: 'fallback', lat: 35.1796, lng: 129.0756 });
  });

  it('대체도 없으면 unavailable + 원인을 구분해 남긴다', async () => {
    const got = await resolveNearby(
      deps({
        getCurrentPosition: async () => {
          throw new Error('위치 확인 실패');
        },
      })
    );

    // 거부(denied-no-fallback)와 측위 실패(position-failed)를 한 값으로 뭉개지 않는다 —
    // 사용자에게 할 안내가 다르다(설정 열기 vs 다시 시도).
    expect(got).toEqual({ kind: 'unavailable', reason: 'position-failed' });
  });

  it('등록 숙소 조회 자체가 실패해도 던지지 않고 unavailable로 접는다', async () => {
    const got = await resolveNearby(
      deps({
        requestPermission: async () => ({ granted: false }),
        getSavedStayCoords: async () => {
          throw new Error('네트워크 실패');
        },
      })
    );

    // 여기서 예외가 새어 나가면 화면이 빈손으로 멈춘다. 결정론적 폴백(INV-4).
    expect(got).toEqual({ kind: 'unavailable', reason: 'denied-no-fallback' });
  });
});
