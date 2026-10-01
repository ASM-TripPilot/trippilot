import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
  type ReflectionFace,
} from './DailyReflectionScreen';

/**
 * TRIP-1119 · j03 오늘의 회고 헤더 ‹ — 순수 프레젠테이션(prop 주입).
 *
 * 무엇을 보장하나:
 *  - AC3: 5얼굴 전부 ‹(`reflection-daily-back`)가 button 역할·"뒤로" 이름을 갖고, 누르면 `onBack` 1회.
 *  - AC5: `onBack` 을 안 넘기는 호출자(프리뷰·기존 테스트)에서도 ‹ 는 그려지고 눌러도 깨지지 않는다.
 *  - AC7(결정 2 b): 편집 중 ‹ 는 화면을 떠나지 않고 편집만 닫는다(`onBack`·`onSaveEdit` 0회).
 *    편집이 닫힌 뒤의 ‹ 는 다시 `onBack` 을 부른다.
 *
 * `onBack` 은 구현 전이라 화면 prop 타입에 없다 — 테스트 안에서만 넓힌 타입으로 캐스팅한다
 * (선례 `.faces.test.tsx` 의 FacesProps).
 */

type BackProps = DailyReflectionScreenProps & { onBack?: () => void };
const Screen = DailyReflectionScreen as unknown as (
  props: BackProps
) => ReactElement;

const FACES: ReflectionFace[] = [
  'default',
  'data-insufficient',
  'empty',
  'error',
  'pending',
];

function baseProps(
  face: ReflectionFace,
  over: Partial<BackProps> = {}
): BackProps {
  return {
    face,
    narrative: '바다를 보며 걸은 하루',
    editableText: '바다를 보며 걸은 하루',
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
    onEnterEdit: jest.fn(),
    onConfirm: jest.fn(),
    onSaveEdit: jest.fn(),
    ...over,
  };
}

describe('AC3 · 5얼굴 전부 헤더 ‹ 가 누를 수 있는 "뒤로" 버튼이다', () => {
  it.each(FACES)('%s: ‹ 는 button 역할이고 이름이 "뒤로"다', (face) => {
    render(<Screen {...baseProps(face, { onBack: jest.fn() })} />);

    const back = screen.getByTestId('reflection-daily-back');
    expect(back).toHaveProp('accessibilityRole', 'button');
    expect(back).toHaveProp('accessibilityLabel', '뒤로');
  });

  it.each(FACES)('%s: ‹ 를 누르면 onBack 을 1회 부른다', (face) => {
    const onBack = jest.fn();
    render(<Screen {...baseProps(face, { onBack })} />);

    fireEvent.press(screen.getByTestId('reflection-daily-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AC5 · onBack 을 안 넘기는 호출자도 그대로 그려진다 (옵셔널 prop)', () => {
  it.each(FACES)(
    '%s: onBack 없이도 ‹ 가 있고, 눌러도 예외가 나지 않는다',
    (face) => {
      render(<Screen {...baseProps(face)} />);

      const back = screen.getByTestId('reflection-daily-back');
      expect(() => fireEvent.press(back)).not.toThrow();
    }
  );
});

describe('AC7 · 편집 중 ‹ 는 편집만 닫는다 (결정 2 b)', () => {
  it.each<ReflectionFace>(['default', 'empty'])(
    '%s: 편집 중 ‹ → onBack·onSaveEdit 0회, 입력칸이 닫히고 헤더 "편집"이 돌아온다',
    (face) => {
      const onBack = jest.fn();
      const onSaveEdit = jest.fn();
      render(<Screen {...baseProps(face, { onBack, onSaveEdit })} />);
      fireEvent.press(screen.getByTestId('reflection-daily-edit'));
      fireEvent.changeText(
        screen.getByTestId('reflection-daily-edit-input'),
        '저장 안 한 글'
      );
      // 앵커 — 편집이 실제로 열렸고, 편집 중에도 ‹ 는 보인다.
      expect(
        screen.getByTestId('reflection-daily-edit-input')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-edit')).toBeNull();

      fireEvent.press(screen.getByTestId('reflection-daily-back'));

      expect(onBack).not.toHaveBeenCalled();
      expect(onSaveEdit).not.toHaveBeenCalled();
      expect(screen.queryByTestId('reflection-daily-edit-input')).toBeNull();
      expect(screen.getByTestId('reflection-daily-edit')).toBeOnTheScreen();
    }
  );

  it('편집을 ‹ 로 닫은 뒤 ‹ 를 다시 누르면 그때는 onBack 을 1회 부른다', () => {
    const onBack = jest.fn();
    render(<Screen {...baseProps('default', { onBack })} />);
    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.press(screen.getByTestId('reflection-daily-back'));
    // 앵커 — 첫 ‹ 는 편집만 닫았다.
    expect(screen.queryByTestId('reflection-daily-edit-input')).toBeNull();
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('reflection-daily-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
