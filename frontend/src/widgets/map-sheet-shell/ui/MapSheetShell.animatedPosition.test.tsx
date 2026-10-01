import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { makeMutable, type SharedValue } from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

import { MapSheetShell } from './MapSheetShell';

/**
 * TRIP-1083 · AC-3 — 셸이 시트 위치 상자(`animatedPosition`, reanimated SharedValue)를 gorhom
 * `<BottomSheet animatedPosition>` 로 그대로 흘린다(옵셔널 additive). 값은 소비처(i01 허브)가 만들어
 * 쥐고, 셸은 상태·계산 없이 통과만 한다(Seed 1 — 셸 useState 수는 widgetsStructure 가 잠근다).
 *
 * 무엇을 보장하나:
 *  - 🔴 SA1 주면 시트가 **같은 상자**를 받는다(gorhom 이 매 프레임 시트 윗변 y 를 이 상자에 쓴다).
 *  - 🟢 SA2 안 주면 시트에 상자가 없다 — 다른 셸 소비처 10곳 무회귀.
 *
 * 통과형 시트 목(`__mocks__/@gorhom/bottom-sheet.tsx`)이 `...props` 를 host View 에 펼치므로
 * snapPoints 를 가진 host 노드의 props 로 관측한다. 실제로 gorhom 이 값을 쓰는지는 6-b(AC-V1).
 *
 * 3동작 뼈대: 준비=상자(makeMutable) → 실행=셸 렌더(prop 유무) → 단언=시트 host 의 animatedPosition.
 */

jest.mock('@gorhom/bottom-sheet');

function renderShell(extra: { animatedPosition?: SharedValue<number> } = {}) {
  render(
    <MapSheetShell
      center={{ lat: 35.1532, lng: 129.1186 }}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      {...extra}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
}

/** snapPoints 를 가진 host(문자열 타입) 노드 — 시트 본체. */
function sheetHost(): ReactTestInstance {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}

describe('TRIP-1083 · 셸 시트 위치 상자 통과 (AC-3)', () => {
  it('🔴 SA1 animatedPosition 을 주면 시트(BottomSheet)가 같은 상자를 받는다', () => {
    // makeMutable = 컴포넌트 밖에서 SharedValue 상자를 만드는 reanimated 함수(useSharedValue 의 훅 아닌 판).
    const position = makeMutable(0);

    renderShell({ animatedPosition: position });

    expect(sheetHost().props.animatedPosition).toBe(position);
  });

  it('🟢 SA2 안 주면 시트에 상자가 없다 — 시트는 그대로 3스냅으로 선다(회귀 앵커)', () => {
    renderShell();

    const host = sheetHost();
    // 짝 앵커 — 시트가 실제로 렌더됐다(부재 단언이 빈 렌더에서 공허 통과하지 않게).
    expect(host.props.snapPoints).toHaveLength(3);
    expect(host.props.animatedPosition).toBeUndefined();
  });
});
