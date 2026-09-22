import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-746 · AC-7 — i01 허브 프리뷰 3키(`live-hub-closed`·`-half`·`-expanded`)가 Figma 4251:2448 ·
 * 4251:2640 · 4125:3957 의 **같은 5곳 픽스처**를 스냅 index 0/1/2 로만 달리해 그린다.
 *
 * 무엇을 보장하나:
 *  - 세 키 모두 허브 루트·헤더 한 줄·카드 5장·사진 4장·후기 2개·진행/예정 문구가 같다(Figma 세 프레임은
 *    시트 내용 텍스트가 동일하고 스냅만 다르다 — 브리프 골격 표).
 *  - 시트가 받는 초기 index 가 키마다 0·1·2 다(실제 스냅 모양은 AC-V1 육안 · 6-b).
 *  - 옛 `live-itinerary` 키는 없어지고, `live-itinerary-trigger` 는 새 허브 위에서 계속 칩을 그린다
 *    (정리는 TRIP-756 몫).
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(허브 뷰 api-free — 02a ★12).
 *
 * 3동작: 준비(딥링크 state=키) → 실행(DevPreview 렌더) → 단언(허브 트리·문구·시트 index).
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목(__mocks__/@gorhom/bottom-sheet.tsx) — 동결 devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '허브 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
const { PREVIEW_STATES } = require('@/app/_dev/preview') as {
  PREVIEW_STATES: { key: string }[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  delete mockSearchParams.state;
});

const CARD_ROOT = /^execution-live-slot-2026-06-11#[^#]+$/;

function sheetIndices(): number[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => node.props.index as number);
}

describe('🔴 TRIP-746 · i01 허브 프리뷰 3키 (AC-7)', () => {
  it.each([
    ['live-hub-closed', 0],
    ['live-hub-half', 1],
    ['live-hub-expanded', 2],
  ])('%s 는 Figma 5곳 허브를 시트 index %i 로 그린다', (key, snap) => {
    mockSearchParams.state = key;

    render(<DevPreview />);

    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-live-sheet-header')).toHaveTextContent(
      '부산 여행 · 2일차 · 6월 11일(목) · 5곳'
    );
    // 카드 5장 — Figma 5곳 이름 그대로.
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    [
      '감천문화마을',
      '광안리 해변',
      '부산시립미술관',
      '전포 카페거리',
      '해운대 해변',
    ].forEach((name) => expect(screen.getByText(name)).toBeOnTheScreen());
    // done 2장 × 사진 2 = 4, 후기 2(원문 완전 일치).
    expect(
      screen.getAllByTestId(/^execution-live-slot-photo-\d+-/)
    ).toHaveLength(4);
    expect(
      screen.getByText('골목마다 알록달록한 벽화. 전망대에서 인증샷 남겼다.')
    ).toBeOnTheScreen();
    expect(
      screen.getByText('바람이 좋았다. 백사장 산책하고 커피 한 잔 마셨다.')
    ).toBeOnTheScreen();
    // 진행·예정 상태줄.
    expect(screen.getByText('13:00 도착 · 지금 관람 중')).toBeOnTheScreen();
    expect(
      screen.getByText('15:00 도착 예정 · 11:00–22:00 영업')
    ).toBeOnTheScreen();
    expect(screen.getByText('17:00 도착 예정 · 24시간 개방')).toBeOnTheScreen();
    // 일자 칩 3개, 2일차 선택.
    expect(screen.getByTestId('execution-live-daychip-1')).toBeSelected();
    expect(screen.getByTestId('execution-live-daychip-2')).toBeOnTheScreen();
    // 시트 초기 스냅.
    const indices = sheetIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(snap));
  });
});

describe('🔴 TRIP-746 · 옛 키 정리 (AC-7)', () => {
  it('live-itinerary 키는 없고, live-itinerary-trigger 는 새 허브 위에 트리거 칩을 그린다', () => {
    const keys = PREVIEW_STATES.map((state) => state.key);
    expect(keys).not.toContain('live-itinerary');
    expect(keys).toEqual(
      expect.arrayContaining([
        'live-hub-closed',
        'live-hub-half',
        'live-hub-expanded',
        'live-itinerary-trigger',
      ])
    );

    mockSearchParams.state = 'live-itinerary-trigger';
    render(<DevPreview />);

    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-live-sheet-header')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-live-trigger-chip')).toBeOnTheScreen();
  });
});
