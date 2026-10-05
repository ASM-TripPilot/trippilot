import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { MapSheetShell } from './MapSheetShell';

/**
 * 닫힘 스냅이 홈 인디케이터 영역 안에 들어가던 결함 — 핸들(28px)이 화면 맨 아래 하단 안전 영역(≈34px)에
 * 묻혀 위로 쓸면 iOS 홈 제스처가 우선했다. 닫힘 높이를 `28 + 하단 안전 영역`으로 키워 핸들이 그 위에 오게 한다.
 *
 * 무엇을 보장하나(셸이 시트에 넘기는 snapPoints 값까지만):
 *  - 🔴 CS1 하단 안전 영역 34 → 닫힘 칸이 62(= 28 + 34), 나머지 칸은 그대로.
 *  - 🔴 CS5 하단 안전 영역 120 → 148 — 0·34·120 세 값이 짝이라 `34 이면 62` 식 고정값은 여기서 걸린다.
 *  - 🟢 CS2 하단 안전 영역 0(홈 버튼 기종·Provider 의 bottom 0) → 28 그대로.
 *  - 🟢 CS3 Provider 없음(jest 기본) → 28 그대로 — 기존 소비처 무회귀 앵커.
 *  - 🟢 CS4 소비처가 snapPoints 를 직접 주면 셸은 손대지 않는다(그쪽 계약은 소비처 소유).
 * ⚠️ 실제 홈 제스처 충돌 해소는 jest 사각 — 실기(TestFlight)로만 본다.
 *
 * 3동작 뼈대: 준비=Provider(bottom 값) → 실행=셸 렌더 → 단언=시트 목이 받은 snapPoints.
 */

jest.mock('@gorhom/bottom-sheet');

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

function renderShell(bottom: number | null, snapPoints?: (string | number)[]) {
  const shell = (
    <MapSheetShell
      center={{ lat: 35.1587, lng: 129.1604 }}
      pins={[{ number: 1, lat: 35.16, lng: 129.16 }]}
      onBack={jest.fn()}
      header={<Text>헤더</Text>}
      snapPoints={snapPoints}
    >
      <Text>본문</Text>
    </MapSheetShell>
  );
  render(
    bottom === null ? (
      shell
    ) : (
      <SafeAreaInsetsContext.Provider
        value={{ top: 47, bottom, left: 0, right: 0 }}
      >
        {shell}
      </SafeAreaInsetsContext.Provider>
    )
  );
}

/** 셸이 시트 목에 넘긴 snapPoints — 목은 합성·호스트 겹이 여럿이라 첫 노드 값만 본다. */
function sheetSnapPoints(): unknown[] {
  const node = screen.root.findAll((n) =>
    Array.isArray(n.props?.snapPoints)
  )[0];
  return node.props.snapPoints as unknown[];
}

describe('MapSheetShell · 닫힘 스냅이 홈 인디케이터 위에 온다', () => {
  it('CS1 하단 안전 영역 34 → 닫힘 62, 나머지 칸은 그대로', () => {
    renderShell(34);
    expect(sheetSnapPoints()).toEqual([62, '45%', '88%']);
  });

  it('CS5 하단 안전 영역 120 → 닫힘 148 — 34 로 외운 고정값 구현을 막는 짝(0·34·120)', () => {
    renderShell(120);
    expect(sheetSnapPoints()).toEqual([148, '45%', '88%']);
  });

  it('CS2 하단 안전 영역 0 → 닫힘 28 그대로', () => {
    renderShell(0);
    expect(sheetSnapPoints()).toEqual([28, '45%', '88%']);
  });

  it('CS3 Provider 없음 → 닫힘 28 그대로', () => {
    renderShell(null);
    expect(sheetSnapPoints()).toEqual([28, '45%', '88%']);
  });

  it('CS4 소비처가 snapPoints 를 직접 주면 안전 영역이 있어도 손대지 않는다', () => {
    renderShell(34, [100, '50%']);
    expect(sheetSnapPoints()).toEqual([100, '50%']);
  });
});
