import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { placeRegionParams, placeRegionQueries } from '@/entities/trip';

/**
 * TRIP-1809 · d04 로 가는 지역 파라미터의 실제 왕복.
 *
 * 무엇을 보장하나: 보내는 쪽(`placeRegionParams`)이 만든 값이 진짜 라우터를 지나 받는 쪽(`placeRegionQueries`)에서
 * 지역별 이름·코드로 되돌아온다. expo-router 는 객체 href 의 배열을 쉼표 문자열 하나로 합치는데(`region=중구,중구`),
 * `jest.mock('expo-router')` 를 쓰는 화면 테스트는 배열을 그대로 넣어 이 일을 못 본다 — 그래서 라우터를 진짜로 돌린다.
 * 3동작: 준비 = 받는 쪽 대역 화면 → 실행 = router.push → 단언 = 되돌아온 지역 조건.
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷에서 로드가 실패한다.
 */
function Probe() {
  const { region, regionCode } = useLocalSearchParams<{
    region?: string | string[];
    regionCode?: string | string[];
  }>();
  return (
    <Text testID="queries">
      {JSON.stringify(placeRegionQueries(region, regionCode))}
    </Text>
  );
}

const ROUTES = { index: () => null, 'explore/places': Probe };

async function goWith(
  destinations: Parameters<typeof placeRegionParams>[0]
): Promise<unknown> {
  renderRouter(ROUTES, { initialUrl: '/' });
  act(() => {
    router.push({
      pathname: '/explore/places',
      params: placeRegionParams(destinations),
    });
  });
  const text = await screen.findByTestId('queries');
  return JSON.parse(String(text.props.children));
}

describe('TRIP-1809 · d04 지역 파라미터 왕복 (실제 라우터)', () => {
  it('이름이 같은 두 지역이 각자의 코드로 돌아온다', async () => {
    expect(
      await goWith([
        { region: '중구', regionCode: '11140' },
        { region: '중구', regionCode: '26110' },
      ])
    ).toEqual([
      { region: '중구', regionCode: '11140' },
      { region: '중구', regionCode: '26110' },
    ]);
  });

  it('코드 없는 여행지가 섞이면 지역마다 이름으로만 돌아온다', async () => {
    expect(
      await goWith([{ region: '서울', regionCode: '11' }, { region: '경주' }])
    ).toEqual([{ region: '서울' }, { region: '경주' }]);
  });

  it('한 지역은 이름과 코드 한 쌍으로 돌아온다', async () => {
    expect(await goWith([{ region: '고성군', regionCode: '48820' }])).toEqual([
      { region: '고성군', regionCode: '48820' },
    ]);
  });
});
