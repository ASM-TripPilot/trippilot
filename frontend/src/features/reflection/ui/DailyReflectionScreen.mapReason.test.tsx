import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
} from './DailyReflectionScreen';

/**
 * TRIP-1118 · j03 지도 자리 사유 leaf 계약(화면).
 *
 * 무엇을 보장하나:
 *  - data-insufficient 의 지도 자리 **본문 Text** 에 `reflection-daily-map-notice-reason-{reason}` 이 붙는다 —
 *    "어느 이유인가"와 "그 글자"를 같은 노드에서 본다. 제목은 따로 leaf 로 남는다(TRIP-763 2줄 계약).
 *  - 루트 `reflection-daily-map-notice` 는 그대로 하나이고, 사유 leaf 는 정확히 하나다.
 *
 * 문구는 여기서 가짜 값을 넘긴다 — 확정 카피는 모델 테스트(missingParts.test.ts) 한 곳에서만 잠근다.
 */

type Reason = 'few-visits' | 'permission' | 'no-route';
type MapNotice3 = { reason: Reason; title: string; body: string } | null;
type Props = Omit<DailyReflectionScreenProps, 'mapNotice'> & {
  mapNotice: MapNotice3;
};
// mapNotice 에 reason 이 든 새 계약으로 부른다. 구현 전 화면 타입을 거스르지 않게 캐스팅(구현 후에도 호환).
const Screen = DailyReflectionScreen as unknown as (
  props: Props
) => ReactElement;

const REASON_LEAF = /^reflection-daily-map-notice-reason-/;

function baseProps(over: Partial<Props> = {}): Props {
  return {
    face: 'data-insufficient',
    narrative: '오늘의 기록',
    editableText: '',
    stats: {
      visitCount: 2,
      distanceKm: 3,
      distanceSource: 'VISIT_LINE',
      photoCount: 0,
    },
    distanceDash: false,
    mapNotice: null,
    hidePhotoGrid: true,
    photos: [],
    changeSummary: null,
    onEnterEdit: jest.fn(),
    onConfirm: jest.fn(),
    onSaveEdit: jest.fn(),
    ...over,
  };
}

describe('🔴 TRIP-1118 AC-2~4 · 지도 자리 사유 leaf = 본문 Text', () => {
  it.each<Reason>(['few-visits', 'permission', 'no-route'])(
    '%s: 본문 leaf 에 사유 id 가 붙고 글자는 본문과 완전 일치, 제목은 별도 leaf, 사유 leaf 는 하나뿐',
    (reason) => {
      const title = `제목-${reason}`;
      const body = `본문-${reason}`;

      render(<Screen {...baseProps({ mapNotice: { reason, title, body } })} />);

      // 루트는 그대로 하나(exact 매칭이라 leaf id 와 겹치지 않는다).
      expect(
        screen.getByTestId('reflection-daily-map-notice')
      ).toBeOnTheScreen();
      // 완전 일치 — 제목까지 한 Text 에 합치면 red.
      expect(
        screen.getByTestId(`reflection-daily-map-notice-reason-${reason}`)
      ).toHaveTextContent(body);
      expect(screen.getByText(title)).toBeOnTheScreen();
      expect(screen.queryAllByTestId(REASON_LEAF)).toHaveLength(1);
    }
  );
});
