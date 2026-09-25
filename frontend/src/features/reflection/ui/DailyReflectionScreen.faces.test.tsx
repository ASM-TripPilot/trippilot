import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
} from './DailyReflectionScreen';

/**
 * TRIP-763 · j03 오늘의 회고 **3얼굴 정합**(data-insufficient · empty · error) — 순수 프레젠테이션.
 *
 * 762가 default 얼굴만 재구성했다. 이 파일은 나머지 3얼굴을 Figma 3프레임(1566:1894·1567:1920·
 * 1568:1946)과 1:1 로 맞추는 **프레젠테이션 정합**만 잠근다(편집 4000·빈저장 같은 편집 계약은
 * 동결 `DailyReflectionScreen.test.tsx`, default 표면은 `.default.test.tsx` 소관 — 여긴 안 다룸).
 *
 * ★ mapNotice 2필드 계약(AC-1) — 구현 전이라 화면 prop 타입은 아직 `string | null` 이다. 테스트만
 *   새 계약으로 컴파일하려 `mapNotice` 를 `{title, body} | null` 로 재정의해 캐스팅한다(선례
 *   `.default.test.tsx` 의 ExtendedProps). 구현자가 화면 타입·렌더를 이 계약으로 채운다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-2: data-insufficient 가 mapNotice.title 과 body 를 **각각 leaf 텍스트**로 그린다(2줄).
 *    null 폴백 시에도 크래시 없이 그린다.
 *  - 🔴 AC-5: 일차 탭이 **3얼굴 전부**에 뜬다(현 `face==='default'` 게이트 제거) — day-tab 3개 +
 *    활성만 selected + press→onSelectDay(day) 1회. day-tab testID 는 reflection 것만(record 것 금지=G2).
 *  - 🔴 AC-6: 바텀 탭바가 **3얼굴 전부**에 뜨고(records 활성) 하단 CTA 와 **공존**한다("택1"→"둘 다") +
 *    탭 press→onPressTab(key) 1회.
 *  - 🔴 AC-7: error 재시도(reflection-daily-retry) 보존 + press→onConfirm 1회(무회귀).
 *
 * (개념) `getByText('문자열')` = host Text 텍스트 완전 일치 → title·body 를 각각 완전 일치로 집으면
 *   impl 이 둘을 한 Text 에 개행으로 합칠 수 없다(2줄 강제) · `.props.accessibilityState?.selected` =
 *   선택을 색 아닌 접근성 플래그로 판독(jest 가 읽는 구조 채널) · `it.each([...])` = 같은 케이스를
 *   여러 입력(3얼굴)에 반복.
 *
 * 지도 목: data-insufficient/empty/error 는 mapCenter 를 안 줘 MapView 를 렌더하지 않는다(mapArea 는
 *   자리표시 박스). 그래서 `@/shared/map` 목이 필요 없다(동결 `DailyReflectionScreen.test.tsx` 가 목
 *   없이 도는 것과 동형 — 배럴 import 는 안전, 렌더만 위험).
 */

// mapNotice 만 2필드로 재정의(나머지 props 는 그대로). 구현 전 화면 타입을 거스르지 않게 캐스팅.
type MapNotice2 = { title: string; body: string } | null;
type FacesProps = Omit<DailyReflectionScreenProps, 'mapNotice'> & {
  mapNotice: MapNotice2;
};
const Screen = DailyReflectionScreen as unknown as (
  props: FacesProps
) => ReactElement;

type Face = 'data-insufficient' | 'empty' | 'error';
const FACES: Face[] = ['data-insufficient', 'empty', 'error'];

const DAY_TABS = [{ day: 1 }, { day: 2, today: true }, { day: 3 }];

/** 얼굴별 하단 CTA 이름표 — data 얼굴="확인"(-confirm), empty/error="직접 회고 작성"(-compose). */
const CTA_TESTID: Record<Face, string> = {
  'data-insufficient': 'reflection-daily-confirm',
  empty: 'reflection-daily-compose',
  error: 'reflection-daily-compose',
};

function baseProps(over: Partial<FacesProps> = {}): FacesProps {
  return {
    face: 'data-insufficient',
    narrative: '오늘의 기록',
    editableText: '',
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    distanceDash: false,
    mapNotice: null,
    hidePhotoGrid: true,
    photos: [],
    changeSummary: null,
    dayTabs: DAY_TABS,
    activeDay: 2,
    onSelectDay: jest.fn(),
    onPressTab: jest.fn(),
    onEnterEdit: jest.fn(),
    onConfirm: jest.fn(),
    onSaveEdit: jest.fn(),
    ...over,
  };
}

function renderFace(over: Partial<FacesProps> = {}) {
  const props = baseProps(over);
  render(<Screen {...props} />);
  return props;
}

describe('🔴 AC-2 · 위치 박스 2줄(mapNotice.title / .body 각각 leaf)', () => {
  it('data-insufficient 가 title 과 body 를 각각 leaf 텍스트로 그린다(2줄)', () => {
    renderFace({
      face: 'data-insufficient',
      mapNotice: {
        title: '위치 기록 없음',
        body: 'GPS 미동의로 지도를 만들 수 없어요',
      },
    });

    // 각각 완전 일치 leaf — 둘을 한 Text 에 합치면(한 노드의 텍스트가 둘을 잇는다) 이 단언이 red.
    expect(screen.getByText('위치 기록 없음')).toBeOnTheScreen();
    expect(
      screen.getByText('GPS 미동의로 지도를 만들 수 없어요')
    ).toBeOnTheScreen();
  });

  it('mapNotice 가 null 이어도 크래시 없이 그린다(폴백 · 무회귀 짝)', () => {
    expect(() =>
      renderFace({ face: 'data-insufficient', mapNotice: null })
    ).not.toThrow();
  });
});

describe('🔴 AC-5 · 일차 탭이 3얼굴에 뜬다(default 게이트 제거)', () => {
  it.each(FACES)(
    '%s: 일차 탭 3개가 뜨고 활성(activeDay)만 selected 다',
    (face) => {
      renderFace({ face, activeDay: 2 });

      expect(
        screen.getByTestId('reflection-daily-day-tab-1')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-2')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-3')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-2').props
          .accessibilityState?.selected
      ).toBe(true);
      expect(
        screen.getByTestId('reflection-daily-day-tab-1').props
          .accessibilityState?.selected
      ).toBe(false);
    }
  );

  it.each(FACES)(
    '%s: 탭 press → onSelectDay 를 그 일차로 정확히 1회 부른다',
    (face) => {
      const { onSelectDay } = renderFace({ face });

      fireEvent.press(screen.getByTestId('reflection-daily-day-tab-1'));

      expect(onSelectDay).toHaveBeenCalledTimes(1);
      expect(onSelectDay).toHaveBeenCalledWith(1);
    }
  );
});

describe('🔴 AC-6 · 바텀 탭바가 3얼굴에 뜨고 하단 CTA 와 공존한다', () => {
  it.each(FACES)('%s: 탭바(기록 활성) + 하단 CTA 가 함께 뜬다', (face) => {
    renderFace({ face });

    expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
    expect(
      screen.getByTestId('shell-tabbar-tab-records').props.accessibilityState
        ?.selected
    ).toBe(true);
    // CTA 공존 — 탭바가 CTA 를 지우지 않는다(세로 순서는 6-b 육안).
    expect(screen.getByTestId(CTA_TESTID[face])).toBeOnTheScreen();
  });

  it.each(FACES)(
    '%s: 다른 탭 press → onPressTab 을 그 키로 1회 부른다',
    (face) => {
      const { onPressTab } = renderFace({ face });

      fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));

      expect(onPressTab).toHaveBeenCalledTimes(1);
      expect(onPressTab).toHaveBeenCalledWith('home');
    }
  );
});

describe('🔴 AC-7 · 에러 재시도 보존(무회귀)', () => {
  it('error 얼굴에 reflection-daily-retry 가 있고 press → onConfirm 을 1회 부른다', () => {
    const { onConfirm } = renderFace({ face: 'error' });

    fireEvent.press(screen.getByTestId('reflection-daily-retry'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
