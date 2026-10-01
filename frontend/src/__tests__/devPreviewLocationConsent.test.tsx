import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-780 · AC-6 — l06 철회 다이얼로그 프리뷰가 Figma 1610:2440 처럼 "default 화면 + 딤 + 다이얼로그"다.
 *
 * 무엇을 보장하나:
 *  - `l06-location-revoke-dialog` 키가 빈 배경이 아니라 동의 ON 화면(`LocationConsentScreen`) 위에
 *    `RevokeConfirmDialog` 를 형제로 겹쳐 그린다 — 토글·ON 부제·다이얼로그가 한 트리에 함께 있다.
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(traps-shell).
 *
 * 키 이름·개수 불변은 `devPreviewBandNav`·`devPreviewBandSort`(무수정)가 지킨다.
 * 겹치는 순서는 본다 — RN 은 나중 형제를 위에 그리므로, 다이얼로그가 화면보다 트리 뒤에 와야 보인다.
 * ⚠️ 딤이 화면을 실제로 덮는지·다이얼로그가 가운데 오는지는 jest 사각 — 6-b 몫.
 *
 * 3동작: 준비(딥링크 state=키) → 실행(DevPreview 렌더) → 단언(화면·다이얼로그 공존).
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목 — 다른 devPreview 테스트와 같은 장치(프리뷰 모듈 전체를 로드하므로 필요).
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    'l06 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

/** 렌더 트리를 위→아래(앞 형제 먼저)로 훑어 testID 를 나온 순서대로 모은다. */
type JsonNode = { props?: { testID?: unknown }; children?: unknown[] | null };
function testIdsInOrder(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => testIdsInOrder(child, out));
  } else if (node && typeof node === 'object') {
    const { props, children } = node as JsonNode;
    if (typeof props?.testID === 'string') out.push(props.testID);
    if (children) testIdsInOrder(children, out);
  }
  return out;
}

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('TRIP-780 · l06 철회 다이얼로그 프리뷰 합성 (AC-6)', () => {
  it('l06-location-revoke-dialog 는 동의 ON 화면 위에 철회 다이얼로그를 겹쳐 그린다', () => {
    mockSearchParams.state = 'l06-location-revoke-dialog';

    render(<DevPreview />);

    // 배경 = default 화면(동의 ON, 활성 토글).
    const toggle = screen.getByTestId('settings-location-toggle');
    expect(toggle).toBeOnTheScreen();
    expect(toggle).not.toBeDisabled();
    expect(screen.getByText('동의함 · 정확한 위치 사용')).toBeOnTheScreen();

    // 전경 = 철회 다이얼로그(하나).
    expect(
      screen.getByTestId('settings-location-revoke-confirm')
    ).toBeOnTheScreen();
  });

  it('다이얼로그가 배경 화면보다 뒤 형제라서 위에 그려진다(순서가 뒤집히면 화면이 가린다)', () => {
    mockSearchParams.state = 'l06-location-revoke-dialog';

    render(<DevPreview />);
    const ids = testIdsInOrder(screen.toJSON());

    // 화면 쪽 testID(토글)가 다이얼로그 루트보다 먼저 나와야 한다.
    const screenAt = ids.indexOf('settings-location-toggle');
    const dialogAt = ids.indexOf('settings-location-revoke-confirm');
    expect(screenAt).toBeGreaterThanOrEqual(0);
    expect(dialogAt).toBeGreaterThan(screenAt);
  });
});
