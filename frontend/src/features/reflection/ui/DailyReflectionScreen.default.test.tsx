import type { ReactElement } from 'react';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { ReflectionStatsRow } from './ReflectionStatsRow';
import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
} from './DailyReflectionScreen';

// 지도 가지(좌표 있음)를 잠그려면 실제 MapView(네이버 네이티브)가 jest 에서 SDK 를 못 올리므로
// 관찰 목(`map-root` testID + props 통과)으로 갈아끼운다(선례 TripRecordsScreen.test.tsx). 배럴 경유.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-762 · j03 오늘의 회고 **default 얼굴 재구성**(순수 프레젠테이션, VM 주입).
 *
 * 이 파일은 TRIP-571 `DailyReflectionScreen.test.tsx`(★동결 — 편집 모드 무회귀)를 **건드리지
 * 않는** 별 파일이다. 저 파일이 지키는 편집 능력(maxLength 4000·빈저장 차단)은 유지되고, 여기선
 * default 얼굴의 새 표면(일차 탭·기분 3택·통계 재구성·풀폭 지도 가지·서술 카드·메모 입력·저장 CTA·
 * 탭바)만 잠근다.
 *
 * ★ 신규 prop 은 전부 **옵셔널**이다 — 동결 파일·프리뷰의 기존 props 객체가 그대로 컴파일돼야
 *   하므로(신규 required 를 더하면 그 객체들이 tsc 로 깨진다). 구현 전이라 화면을 **확장 prop
 *   타입으로 재대입**해 테스트만 컴파일한다(선례 TripRecordsScreen.test 의 `ScreenWithAttr`).
 *   구현자가 이 계약(dayTabs·activeDay·onSelectDay·onPressTab)을 실제 prop·렌더로 채운다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1: default 얼굴이 새 표면 요소를 **전부** 그린다(빈 화면·부분 재구성 아님).
 *  - 🔴 AC-2: 일차 탭 3개(testID 신설 `reflection-daily-day-tab-{day}`) — press→onSelectDay 1회,
 *    활성만 selected(코랄 pill 은 fill 아니라 `accessibilityState.selected` 로 잠금), 라벨 한글 N일차.
 *  - 🔴 AC-3: 기분 3택 단일선택 — 초기 무선택 → press 한 항목만 selected(fill 아닌 selected 로 잠금),
 *    다른 항목 press 시 이전 선택 해제(단일). 저장 콜백 없음(mood prop·콜백 부재로 구조적 차단).
 *  - 🔴 AC-4(거동): distanceDash 면 이동값 "—"(거리만, INV-3 — 소요시간 문자열 0). 값 22·구분선 제거는
 *    소스 가드(`reflectionDailyStructure.test.ts`)가 맡는다.
 *  - 🔴 AC-5: 좌표 없으면 `reflection-daily-map-notice`(실화면 늘 이 가지, 가짜 기본센터 금지) ·
 *    좌표 있으면 MapView(`map-root`) viewOnly(둘은 상호배타).
 *  - 🔴 AC-7: 서술 **카드**(헤드 "오늘의 기록" + "수정" 링크 + 본문) · "수정" press → 편집 진입
 *    (동결 편집 모드 재사용, 죽은 링크 아님).
 *  - 🔴 AC-8: 메모 **입력** 행이 시스템 변경요약을 **대체**(changeSummary 를 줘도 변경요약 행 부재 +
 *    메모 입력 present) · maxLength 60 · 카운터 "N/60".
 *  - 🔴 AC-9: 저장 CTA testID `-confirm`→`-save` 개명 + 라벨 "저장" + press→콜백 1회(콜백명 onConfirm 유지).
 *  - 🔴 AC-10: 하단 탭바(shared/ui BottomTabBar 재사용) records 활성 + press→onPressTab 1회.
 *  - 🔴 AC-12: 헤더 "편집"(reflection-daily-edit) 유지(공유와 다름) — press→편집 진입.
 *
 * (개념) `accessibilityState.selected` = 선택 상태를 색이 아니라 접근성 플래그로 노출(jest 가 읽는
 *   구조 채널, BottomTabBar·share.test 선례) · `within(node)` = 그 노드 하위로 쿼리 범위 한정 ·
 *   `getByText(정규식)` = 노드 텍스트 부분매칭(구분자 문자 흔들림 회피) · `.props.maxLength` = RN
 *   TextInput 실 prop 판독 · `queryByTestId` = 부재 확인(getBy 는 못 찾으면 throw).
 *
 * INV-3: 이 파일 픽스처에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(G6 소스 스캔 오탐 방지).
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

const NARRATIVE =
  '오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요.';

function baseProps(over: Partial<ExtendedProps> = {}): ExtendedProps {
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
    photos: [{ uri: 'file://p1.jpg' }, { uri: 'file://p2.jpg' }],
    changeSummary: null,
    dayTabs: [{ day: 1 }, { day: 2, today: true }, { day: 3 }],
    activeDay: 2,
    onSelectDay: jest.fn(),
    onPressTab: jest.fn(),
    onEnterEdit: jest.fn(),
    onConfirm: jest.fn(),
    onSaveEdit: jest.fn(),
    ...over,
  };
}

function renderScreen(over: Partial<ExtendedProps> = {}) {
  const props = baseProps(over);
  render(<Screen {...props} />);
  return props;
}

describe('🔴 AC-1 · default 얼굴이 새 표면 요소를 전부 그린다(긍정 앵커)', () => {
  it('일차 탭·기분·통계·서술·사진·메모·저장·탭바가 모두 실재한다', () => {
    renderScreen();

    // 일차 탭 3개
    expect(screen.getByTestId('reflection-daily-day-tab-1')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-day-tab-2')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-day-tab-3')).toBeOnTheScreen();
    // 기분 3택
    expect(screen.getByTestId('reflection-daily-mood-sad')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-mood-soso')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-mood-good')).toBeOnTheScreen();
    // 통계·서술·사진(보존 testID) · 메모·저장(신설)
    expect(screen.getByTestId('reflection-daily-stats')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-narrative')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-photo-grid')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-memo-input')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-save')).toBeOnTheScreen();
    // 탭바
    expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
  });
});

describe('🔴 AC-2 · 일차 탭(record 것 import 금지 — testID 신설)', () => {
  it('탭 라벨은 한글 N일차이고 오늘 탭은 "오늘" 접두가 붙는다(formatDayLabel 재사용)', () => {
    renderScreen();

    // 비오늘 탭 — formatDayLabel(day) 완전일치 leaf.
    expect(
      within(screen.getByTestId('reflection-daily-day-tab-1')).getByText(
        '1일차'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('reflection-daily-day-tab-3')).getByText(
        '3일차'
      )
    ).toBeOnTheScreen();
    // 오늘 탭 — "오늘" 접두 + 2일차(구분자 문자 흔들림을 피해 정규식 부분매칭).
    expect(
      within(screen.getByTestId('reflection-daily-day-tab-2')).getByText(
        /오늘.*2일차/
      )
    ).toBeOnTheScreen();
  });

  it('활성 탭(activeDay)만 selected 이다(코랄 pill — fill 아닌 구조로 잠금)', () => {
    renderScreen({ activeDay: 2 });

    expect(
      screen.getByTestId('reflection-daily-day-tab-2').props.accessibilityState
        ?.selected
    ).toBe(true);
    expect(
      screen.getByTestId('reflection-daily-day-tab-1').props.accessibilityState
        ?.selected
    ).toBe(false);
    expect(
      screen.getByTestId('reflection-daily-day-tab-3').props.accessibilityState
        ?.selected
    ).toBe(false);
  });

  it('탭 press → onSelectDay 를 그 일차로 정확히 1회 부른다', () => {
    const { onSelectDay } = renderScreen();

    fireEvent.press(screen.getByTestId('reflection-daily-day-tab-1'));

    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith(1);
  });
});

describe('🔴 AC-3 · 기분 3택 단일선택(로컬 state · 저장 콜백 없음)', () => {
  it('초기엔 아무 것도 선택되지 않는다(비영속 — 서버 값 없음)', () => {
    renderScreen();

    expect(
      screen.getByTestId('reflection-daily-mood-sad').props.accessibilityState
        ?.selected
    ).toBe(false);
    expect(
      screen.getByTestId('reflection-daily-mood-soso').props.accessibilityState
        ?.selected
    ).toBe(false);
    expect(
      screen.getByTestId('reflection-daily-mood-good').props.accessibilityState
        ?.selected
    ).toBe(false);
  });

  it('하나를 누르면 그 항목만 selected 로 전환된다(fill 아닌 구조로 잠금)', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('reflection-daily-mood-good'));

    expect(
      screen.getByTestId('reflection-daily-mood-good').props.accessibilityState
        ?.selected
    ).toBe(true);
    expect(
      screen.getByTestId('reflection-daily-mood-sad').props.accessibilityState
        ?.selected
    ).toBe(false);
    expect(
      screen.getByTestId('reflection-daily-mood-soso').props.accessibilityState
        ?.selected
    ).toBe(false);
  });

  it('다른 항목을 누르면 이전 선택이 해제된다(단일선택)', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('reflection-daily-mood-good'));
    fireEvent.press(screen.getByTestId('reflection-daily-mood-sad'));

    expect(
      screen.getByTestId('reflection-daily-mood-sad').props.accessibilityState
        ?.selected
    ).toBe(true);
    expect(
      screen.getByTestId('reflection-daily-mood-good').props.accessibilityState
        ?.selected
    ).toBe(false);
  });
});

describe('🔴 AC-4(거동) · 통계는 거리만(INV-3)', () => {
  it('distanceDash 면 이동값이 "—" 이고 소요시간은 없다', () => {
    render(
      <ReflectionStatsRow
        stats={{
          visitCount: 1,
          distanceKm: 0,
          distanceSource: 'VISIT_LINE',
          photoCount: 3,
        }}
        distanceDash
      />
    );

    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.getByText('방문')).toBeOnTheScreen();
    expect(screen.getByText('이동')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · 지도 가지(가짜 기본센터 금지)', () => {
  it('좌표가 없으면 자리표시(map-notice)만 뜨고 지도는 없다', () => {
    renderScreen();

    expect(screen.getByTestId('reflection-daily-map-notice')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
  });

  it('좌표가 있으면 MapView(viewOnly)가 뜨고 자리표시는 없다', () => {
    renderScreen({
      mapCenter: { lat: 35.1532, lng: 129.1187 },
      mapPins: [{ number: 1, lat: 35.1532, lng: 129.1187 }],
    });

    const map = screen.getByTestId('map-root');
    expect(map).toBeOnTheScreen();
    expect(map.props.viewOnly).toBe(true);
    expect(screen.queryByTestId('reflection-daily-map-notice')).toBeNull();
  });
});

describe('🔴 AC-6 · 사진 그리드 보존', () => {
  it('default 얼굴에서 reflection-daily-photo-grid 가 실재한다', () => {
    renderScreen();
    expect(screen.getByTestId('reflection-daily-photo-grid')).toBeOnTheScreen();
  });
});

describe('🔴 AC-7 · 서술 카드(헤드 "오늘의 기록" + "수정" + 본문)', () => {
  it('카드 헤드·수정 링크·본문이 모두 뜨고 testID 는 보존된다', () => {
    renderScreen();

    expect(screen.getByTestId('reflection-daily-narrative')).toBeOnTheScreen();
    expect(screen.getByText('오늘의 기록')).toBeOnTheScreen();
    expect(screen.getByText('수정')).toBeOnTheScreen();
    expect(screen.getByText(NARRATIVE)).toBeOnTheScreen();
  });

  it('"수정" press → 편집 진입(동결 편집 모드 재사용 — 죽은 링크 아님)', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));

    // 편집 진입 = 상한 4000 입력이 열린다(동결 AC-6 능력 재사용).
    expect(
      screen.getByTestId('reflection-daily-edit-input').props.maxLength
    ).toBe(4000);
  });
});

describe('🔴 AC-8 · 메모 입력 행이 시스템 변경요약을 대체한다', () => {
  it('changeSummary 를 줘도 변경요약 행은 없고 메모 입력이 뜬다(교체)', () => {
    renderScreen({ changeSummary: '이날 휴무로 1곳을 변경했어요' });

    expect(screen.getByTestId('reflection-daily-memo-input')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-daily-change-summary')).toBeNull();
  });

  it('메모 상한은 60 이고 카운터가 입력 길이를 "N/60" 로 센다', () => {
    renderScreen();

    const memo = screen.getByTestId('reflection-daily-memo-input');
    expect(memo.props.maxLength).toBe(60);
    expect(screen.getByText('0/60')).toBeOnTheScreen();

    fireEvent.changeText(memo, '좋은 하루였다');

    expect(screen.getByText('7/60')).toBeOnTheScreen();
  });
});

describe('🔴 AC-9 · 저장 CTA(-confirm→-save 개명 · 라벨 "저장")', () => {
  it('저장 버튼이 실재하고 옛 -confirm 은 사라진다', () => {
    renderScreen();

    const save = screen.getByTestId('reflection-daily-save');
    expect(within(save).getByText('저장')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-daily-confirm')).toBeNull();
  });

  it('저장 press → 콜백을 정확히 1회 부른다', () => {
    const { onConfirm } = renderScreen();

    fireEvent.press(screen.getByTestId('reflection-daily-save'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC-10 · 하단 탭바(BottomTabBar 재사용 · records 활성)', () => {
  it('탭바가 뜨고 기록 탭이 활성이다', () => {
    renderScreen();

    expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
    expect(
      screen.getByTestId('shell-tabbar-tab-records').props.accessibilityState
        ?.selected
    ).toBe(true);
  });

  it('다른 탭 press → onPressTab 을 그 키로 1회 부른다', () => {
    const { onPressTab } = renderScreen();

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));

    expect(onPressTab).toHaveBeenCalledTimes(1);
    expect(onPressTab).toHaveBeenCalledWith('home');
  });
});

describe('🔴 AC-12 · 헤더 "편집" 유지(공유와 다름)', () => {
  it('헤더 편집 진입점이 실재하고 press → 편집 진입한다', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(
      screen.getByTestId('reflection-daily-edit-input').props.maxLength
    ).toBe(4000);
  });
});
