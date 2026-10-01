import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-779 · AC-3 — l05 삭제 다이얼로그 프리뷰가 Figma 1608:2440 처럼 "설정 화면 + 딤 + 다이얼로그"다.
 *
 * 무엇을 보장하나:
 *  - `settings-delete-dialog` 키가 빈 배경이 아니라 설정 화면(`settings-default` 와 같은 화면) 위에
 *    `DeleteAccountDialog` 를 형제로 겹쳐 그린다(TRIP-780 l06 합성과 같은 형태).
 *  - 다이얼로그가 화면보다 트리 뒤에 온다 — RN 은 나중 형제를 위에 그린다.
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(traps-shell).
 *
 * ⚠️ 딤이 화면을 실제로 덮는지·다이얼로그가 가운데 오는지는 jest 사각 — 6-b 몫.
 * 배경의 취향 그룹 부재는 `settings-default` 와 같은 사정(TRIP-778 잔여) — Figma 가 아니라 그 키와 비교한다.
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
    'l05 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

const DIALOG_IDS = [
  'settings-delete-cancel',
  'settings-delete-confirm',
  'settings-delete-confirm-final',
];

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

/** 프리뷰 크롬(`dev-preview-*`)·다이얼로그 testID 를 뺀 화면 쪽 testID 순서열. */
function screenIdsOf(stateKey: string): string[] {
  mockSearchParams.state = stateKey;
  const { toJSON, unmount } = render(<DevPreview />);
  const ids = testIdsInOrder(toJSON()).filter(
    (id) => !id.startsWith('dev-preview-') && !DIALOG_IDS.includes(id)
  );
  unmount();
  return ids;
}

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('🔴 TRIP-779 · l05 삭제 다이얼로그 프리뷰 합성 (AC-3)', () => {
  it('settings-delete-dialog 는 설정 화면 위에 삭제 다이얼로그를 겹쳐 그린다', () => {
    mockSearchParams.state = 'settings-delete-dialog';

    render(<DevPreview />);

    // 배경 = 설정 화면.
    expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
    // 전경 = 삭제 다이얼로그 1단.
    expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
  });

  it('다이얼로그가 설정 화면보다 뒤 형제라서 위에 그려진다(순서가 뒤집히면 화면이 가린다)', () => {
    mockSearchParams.state = 'settings-delete-dialog';

    render(<DevPreview />);
    const ids = testIdsInOrder(screen.toJSON());

    const screenAt = ids.indexOf('settings-back');
    const dialogAt = ids.indexOf('settings-delete-confirm');
    expect(screenAt).toBeGreaterThanOrEqual(0);
    expect(dialogAt).toBeGreaterThan(screenAt);
  });

  it('배경 화면은 settings-default 키와 같은 화면이다', () => {
    const base = screenIdsOf('settings-default');
    const composed = screenIdsOf('settings-delete-dialog');

    // 앵커 — 기준 화면이 실제로 그려졌다(빈 배열끼리 같아서 통과하는 것을 막는다).
    expect(base).toContain('settings-back');
    expect(composed).toEqual(base);
  });
});

// TRIP-772 · AC-5 — l05 삭제 다이얼로그 2단(Figma 4531:3018) 전용 키.
// 무엇을 보장하나: `settings-delete-dialog-final` 은 1단 키와 같은 설정 화면 위에 게이트 컴포넌트의
// 2단 얼굴을 겹쳐 그린다. 문구는 코드(30일 유예)를 따른다 — Figma 의 "되돌릴 수 없어요"가 아니다(TRIP-935 Q7).
describe('🔴 TRIP-772 · l05 삭제 다이얼로그 2단 프리뷰 키 (AC-5)', () => {
  it('settings-delete-dialog-final 은 설정 화면 위에 2단 얼굴만 그린다', () => {
    mockSearchParams.state = 'settings-delete-dialog-final';

    render(<DevPreview />);

    // 배경 = 설정 화면.
    expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
    // 전경 = 2단 최종 확인, 1단 [계속]은 없다.
    expect(
      screen.getByTestId('settings-delete-confirm-final')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('settings-delete-confirm')).toBeNull();
  });

  it('2단 다이얼로그가 설정 화면보다 뒤 형제라서 위에 그려진다', () => {
    mockSearchParams.state = 'settings-delete-dialog-final';

    render(<DevPreview />);
    const ids = testIdsInOrder(screen.toJSON());

    const screenAt = ids.indexOf('settings-back');
    const dialogAt = ids.indexOf('settings-delete-confirm-final');
    expect(screenAt).toBeGreaterThanOrEqual(0);
    expect(dialogAt).toBeGreaterThan(screenAt);
  });

  it('배경 화면은 settings-default 키와 같은 화면이다', () => {
    const base = screenIdsOf('settings-default');
    const composed = screenIdsOf('settings-delete-dialog-final');

    // 앵커 — 기준 화면이 실제로 그려졌다.
    expect(base).toContain('settings-back');
    expect(composed).toEqual(base);
  });

  it('2단 문구는 코드의 30일 유예 고지다("되돌릴 수 없" 없음)', () => {
    mockSearchParams.state = 'settings-delete-dialog-final';

    render(<DevPreview />);

    // 앵커 — 2단이 그려졌다.
    expect(
      screen.getByTestId('settings-delete-confirm-final')
    ).toBeOnTheScreen();
    expect(screen.getAllByText(/30일/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText(/되돌릴 수 없/)).toHaveLength(0);
  });
});
