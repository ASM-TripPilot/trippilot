import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-781 · AC-13 — l07 제휴 고지 프리뷰 2키가 Figma 1615:2440(default)·1616:2440(error)처럼
 * "숙소 상세 화면 + 시트" 합성이다(e03 `stay-detail-affiliate-sheet` 와 같은 형태).
 *
 * 무엇을 보장하나:
 *  - 두 키가 빈 배경이 아니라 상세 화면(`stay-detail-root`) 위에 시트를 형제로 겹쳐 그린다.
 *  - default 는 l07 본문·체크박스, error 는 error 제목·[다시 시도]이고 체크박스가 없다.
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(traps-shell).
 *
 * 키 개수·l 밴드 정렬은 `devPreviewBandNav`·`devPreviewBandSort` 가 지킨다. RN 은 나중 형제를 위에
 * 그리므로 시트가 화면보다 트리 뒤에 와야 보인다. ⚠️ 딤·시트 실제 열림·픽셀은 jest 사각 — 6-b 몫.
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
    'l07 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

const BODY =
  '외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.';
const ERROR_TITLE = '링크를 열 수 없습니다';

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

function expectSheetAboveScreen(): void {
  const ids = testIdsInOrder(screen.toJSON());
  const screenAt = ids.indexOf('stay-detail-root');
  const sheetAt = ids.indexOf('stay-ota-sheet');
  expect(screenAt).toBeGreaterThanOrEqual(0);
  expect(sheetAt).toBeGreaterThan(screenAt);
}

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('TRIP-781 · l07 제휴 고지 프리뷰 합성 (AC-13)', () => {
  it('l07-affiliate-default 는 상세 화면 위에 default 시트(본문·체크박스)를 겹쳐 그린다', () => {
    mockSearchParams.state = 'l07-affiliate-default';

    render(<DevPreview />);

    expect(screen.getByTestId('stay-detail-root')).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.getByTestId('stay-ota-dont-show')).toBeOnTheScreen();
    expectSheetAboveScreen();
  });

  it('l07-affiliate-error 는 상세 화면 위에 error 시트(제목·다시 시도, 체크박스 없음)를 겹쳐 그린다', () => {
    mockSearchParams.state = 'l07-affiliate-error';

    render(<DevPreview />);

    expect(screen.getByTestId('stay-detail-root')).toBeOnTheScreen();
    expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen();
    expect(screen.getByTestId('stay-ota-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
    expectSheetAboveScreen();
  });
});
