import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { MapSheetShell } from './MapSheetShell';

/**
 * TRIP-800 · AC-7 · 01b Q5 — 셸이 반경 원(`radiusCircle`)을 지도까지 흘린다(옵셔널 additive).
 *
 * 무엇을 보장하나:
 *  - 🔴 SR1 `radiusCircle` 을 주면 셸이 소유한 `<MapView>` 가 원을 그린다(네이버 목 `map-circle`) — 반경·중심이
 *    그대로 닿는다. h15 가 `mapFallback` 에 자체 지도를 끼우는 우회(폴백 슬롯 의미 오용)를 하지 않게 하는 자리.
 *  - 🟢 SR2 미전달이면 원이 없다 — 기존 셸 소비처(h07·h08·h11·h13·h14·h16·i 밴드) 무회귀 앵커.
 *
 * 기존 `MapSheetShell.test.tsx` 는 건드리지 않는다 — 새 prop 만 이 파일에서 잠근다.
 * 실 MapView 를 태우므로(목 아님) 네이버 목(`__mocks__/@mj-studio/react-native-naver-map.tsx`, 자동 적용)의
 * `map-circle` 에 props 가 그대로 실린다. 키가 없으면 MapView 가 실패 표면으로 떨어지므로 키를 넣고 돈다.
 * ⚠️ 원의 점선·색·실제 크기는 jest 사각(6-b 실기).
 *
 * 3동작 뼈대: 준비=키 + 원 prop → 실행=셸 렌더 → 단언=map-circle 의 radius·좌표.
 */

jest.mock('@gorhom/bottom-sheet');

// no-dynamic-env-var 회피 — 선언과 대입을 분리(MapView.test 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

const CENTER = { lat: 35.1587, lng: 129.1604 };

function renderShell(radiusCircle?: {
  center: { lat: number; lng: number };
  radiusM: number;
}) {
  render(
    <MapSheetShell
      center={CENTER}
      pins={[{ number: 1, lat: 35.16, lng: 129.16 }]}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      radiusCircle={radiusCircle}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
}

describe('TRIP-800 · 셸 반경 원 통과 (AC-7 · Q5)', () => {
  it('🔴 SR1 radiusCircle 을 주면 셸 지도에 원 1개 — 반경·중심이 그대로 닿는다', () => {
    // 준비·실행 — 무게중심 + 반경 1200m.
    renderShell({ center: { lat: 35.1601, lng: 129.1502 }, radiusM: 1200 });

    // 단언 — 원이 하나 그려지고, 넘긴 값이 네이티브 원 오버레이까지 닿았다.
    const circles = screen.queryAllByTestId('map-circle');
    expect(circles).toHaveLength(1);
    expect(circles[0].props.radius).toBe(1200);
    expect(circles[0].props.latitude).toBe(35.1601);
    expect(circles[0].props.longitude).toBe(129.1502);
  });

  it('🟢 SR2 미전달이면 원이 없다 (기존 셸 소비처 무회귀)', () => {
    renderShell();

    // 도달 앵커 — 지도는 실제로 떴다(원이 없는 이유가 "지도가 없어서"가 아니다).
    expect(screen.getByTestId('map-native')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('map-circle')).toHaveLength(0);
  });
});
