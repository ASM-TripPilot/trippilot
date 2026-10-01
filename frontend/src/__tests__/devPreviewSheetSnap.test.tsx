import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-920 · AC-9 — h08 지도+시트 셸 프리뷰 두 키가 셸 기본 3스냅(닫힘 28 · peek 45% · 펼침 88%) 위에서
 * 여전히 **접힘은 peek, 펼침은 펼침** 칸으로 열린다. 키 이름·위치·개수는 `devPreviewBandNav`·
 * `devPreviewBandSort` 가 이미 잠근다 — 이 파일은 "어느 칸으로 여는가"만 본다(지금까지 아무 테스트도 안 봤다).
 *
 * ★ 숫자 index 가 아니라 **받은 snapPoints 배열에서 그 index 가 가리키는 값**을 단언한다(02a ★1). 셸 배열
 *   앞에 닫힘이 끼면 `initialIndex={1}` 은 green 인 채로 "펼침 → peek" 로 뜻이 바뀐다.
 * ⚠️ 통과형 시트 목이라 실제로 그 칸까지 열리는지는 못 본다 — 넘긴 값까지만(6-b 실기).
 *
 * 3동작 뼈대: 준비=딥링크 state → 실행=DevPreview 렌더 → 단언=시트 칸 값.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목(__mocks__/@gorhom/bottom-sheet.tsx) — devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  delete mockSearchParams.state;
});

/** 시트가 받은 snapPoints 배열에서 index 가 가리키는 칸 값들(합성·호스트 3겹 — 개수는 안 센다). */
function sheetSnapValues(): unknown[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map(
      (node) => (node.props.snapPoints as unknown[])[node.props.index as number]
    );
}

describe('TRIP-920 · h08 프리뷰는 새 3스냅 위에서도 같은 칸으로 연다 (AC-9)', () => {
  it.each([
    ['h08-draft-collapsed', '45%'],
    ['h08-draft-expanded', '88%'],
  ])(
    'PS · %s 는 시트를 %s 칸으로 연다 (선제 green · 셸만 바뀌고 프리뷰가 안 바뀌면 red)',
    (key, expected) => {
      // 준비 — 딥링크 키.
      mockSearchParams.state = key;

      // 실행
      render(<DevPreview />);

      // 단언 — 칸 값.
      const values = sheetSnapValues();
      expect(values.length).toBeGreaterThan(0);
      values.forEach((value) => expect(value).toBe(expected));
    }
  );
});
