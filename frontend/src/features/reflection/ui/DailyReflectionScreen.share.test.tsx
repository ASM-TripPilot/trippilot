import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
} from './DailyReflectionScreen';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-762 · AC-11 — j03 오늘의 회고 **헤더 공유 제거**(구 TRIP-574 additive 공유 아이콘 폐기).
 *
 * 라이브 j03 4프레임에 공유가 0 이고 공유는 j04/j06 소관이라, 화면 `canShare`/`onShare` prop 과
 * `reflection-daily-share` 아이콘을 **제거**한다(페이지의 status==='ENDED' 게이트도 함께 —
 * `DailyReflectionPage.share.test.tsx`). 이 파일은 TRIP-574 시절 공유 거동 테스트를 **제거 반영**으로
 * 갱신한 것이다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 재구성된 default 얼굴에 공유 아이콘(`reflection-daily-share`) 표면이 없다(재도입 방지 렌더 가드).
 *
 * ★ red/선제green 판정: 이 렌더 가드는 **선제-green** 이다 — 화면이 onShare 를 안 받으면 예전에도
 *   아이콘을 안 그렸다. 제거의 **red 잠금**은 소스 스캔(`shareCardStructure.test.ts` G4 —
 *   DailyReflectionScreen.tsx 에 `reflection-daily-share` **부재**)과 페이지 배선 테스트
 *   (`DailyReflectionPage.share.test.tsx` — onShare/canShare prop 부재)가 진다. 이 파일은 화면
 *   렌더 층에 "공유 표면 재도입 금지" 그물을 영구히 남긴다.
 *
 * (개념) `queryByTestId` = 없으면 null(getBy 는 throw) → `.toBeNull()` 로 부재를 단언.
 */

type ReflectionDayTab = { day: number; today?: boolean };
type ExtendedProps = DailyReflectionScreenProps & {
  dayTabs?: ReflectionDayTab[];
  activeDay?: number;
  onSelectDay?: (day: number) => void;
  onPressTab?: (key: string) => void;
};
const Screen = DailyReflectionScreen as unknown as (
  props: ExtendedProps
) => ReactElement;

const NARRATIVE = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

function baseProps(): ExtendedProps {
  return {
    face: 'default',
    narrative: NARRATIVE,
    editableText: NARRATIVE,
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    distanceDash: false,
    mapNotice: null,
    hidePhotoGrid: false,
    photos: [{ uri: 'file://p1.jpg' }],
    changeSummary: null,
    dayTabs: [{ day: 1, today: true }],
    activeDay: 1,
    onSelectDay: jest.fn(),
    onPressTab: jest.fn(),
    onEnterEdit: jest.fn(),
    onConfirm: jest.fn(),
    onSaveEdit: jest.fn(),
  };
}

describe('🔴 AC-11 · 헤더 공유 아이콘 제거(렌더 가드)', () => {
  it('재구성된 default 얼굴에 reflection-daily-share 가 없다(편집 진입점은 유지)', () => {
    render(<Screen {...baseProps()} />);

    // 부정 — 공유 표면 부재.
    expect(screen.queryByTestId('reflection-daily-share')).toBeNull();
    // 긍정 짝 — 헤더 편집 진입점(공유와 다름, AC-12)은 그대로 남는다.
    expect(screen.getByTestId('reflection-daily-edit')).toBeOnTheScreen();
  });
});
