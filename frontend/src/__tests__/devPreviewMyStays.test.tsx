import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * TRIP-777 · AC-6 — l04 등록 숙소 프리뷰가 라이브 Figma 와 같은 얼굴이다.
 *
 * 무엇을 보장하나:
 *  - `my-stays-default` 는 Figma 1604:2440 의 카드 2장(등록 1 · 미등록 1)을 주소·날짜까지 채워 그린다.
 *    좌표 미확정 행은 Figma 에 없어 프리뷰에서만 빠진다(코드의 disabled 분기는 유지 — G5).
 *  - 신규 `my-stays-dialog` 는 Figma 1606:2440 처럼 같은 화면 위에 출발점 다이얼로그를 형제로 겹친다
 *    (화면이 열림을 로컬 state 로 쥐어 prop 으로 못 연다 — l05·l06 합성과 같은 형태).
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(traps-shell).
 *
 * ⚠️ 딤이 화면을 실제로 덮는지·다이얼로그가 가운데 오는지는 jest 사각 — 6-b 몫.
 * 배경 동일성은 testID 순서열만 비교한다(표시값은 위 default 케이스가 박제한다).
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
    'l04 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

const DIALOG_IDS = [
  'my-stays-base-dialog',
  'my-stays-base-cancel',
  'my-stays-base-confirm',
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

describe('🔴 TRIP-777 · l04 default 프리뷰 = Figma 1604 카드 2장 (AC-6)', () => {
  it('등록 카드(부산 그랜드 호텔)와 미등록 카드(○○ 게스트하우스)를 주소·날짜까지 그리고, 좌표 미확정 행은 없다', () => {
    mockSearchParams.state = 'my-stays-default';

    render(<DevPreview />);

    const rows = screen.getAllByTestId(/^my-stays-row-/);
    expect(rows).toHaveLength(2);
    const [first, second] = rows as [
      (typeof rows)[number],
      (typeof rows)[number],
    ];

    // 1번째 — 등록됨(출발점 배지), 메모 칩 없음.
    for (const text of [
      '부산 그랜드 호텔',
      '출발점',
      '부산 해운대구 우동',
      '6.10 ~ 6.13',
      'OTA 예약',
      '연결 여행 · 부산 여행',
    ]) {
      expect(within(first).getByText(text)).toBeOnTheScreen();
    }
    expect(within(first).queryByText('예약번호 미입력')).toBeNull();

    // 2번째 — 미등록(점선 "출발점 지정").
    for (const text of [
      '○○ 게스트하우스',
      '출발점 지정',
      '부산 중구 남포동',
      '6.14 ~ 6.15',
      '앱 저장',
      '예약번호 미입력',
      '연결된 여행 없음',
    ]) {
      expect(within(second).getByText(text)).toBeOnTheScreen();
    }

    // 좌표 미확정 행 없음 — 토글 2개 모두 눌린다.
    expect(screen.queryByText('좌표 미확정 숙소')).toBeNull();
    const toggles = screen.getAllByTestId(/^my-stays-base-toggle-/);
    expect(toggles).toHaveLength(2);
    toggles.forEach((toggle) => expect(toggle).not.toBeDisabled());
  });
});

describe('🔴 TRIP-777 · l04 다이얼로그 프리뷰 합성 (AC-6)', () => {
  it('my-stays-dialog 는 등록 숙소 화면 위에 출발점 다이얼로그를 겹쳐 그린다', () => {
    mockSearchParams.state = 'my-stays-dialog';

    render(<DevPreview />);

    // 배경 = 등록 숙소 화면(카드 2장).
    expect(screen.getByTestId('my-stays-root')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^my-stays-row-/)).toHaveLength(2);
    // 전경 = 출발점 다이얼로그.
    expect(screen.getByTestId('my-stays-base-dialog')).toBeOnTheScreen();
    expect(screen.getByText('출발점을 바꿀까요?')).toBeOnTheScreen();
  });

  it('다이얼로그가 화면보다 뒤 형제라서 위에 그려진다(순서가 뒤집히면 화면이 가린다)', () => {
    mockSearchParams.state = 'my-stays-dialog';

    render(<DevPreview />);
    const ids = testIdsInOrder(screen.toJSON());

    const screenAt = ids.indexOf('my-stays-root');
    const dialogAt = ids.indexOf('my-stays-base-dialog');
    expect(screenAt).toBeGreaterThanOrEqual(0);
    expect(dialogAt).toBeGreaterThan(screenAt);
  });

  it('배경 화면은 my-stays-default 키와 같은 화면이다', () => {
    const base = screenIdsOf('my-stays-default');
    const composed = screenIdsOf('my-stays-dialog');

    // 앵커 — 기준 화면이 실제로 그려졌다(빈 배열끼리 같아서 통과하는 것을 막는다).
    expect(base).toContain('my-stays-root');
    expect(composed).toEqual(base);
  });
});
