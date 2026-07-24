import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import { NicknameScreen, type NicknameScreenProps } from './NicknameScreen';

/**
 * c07-nickname Figma 정합(1295:1208) — 신규 요소·긍정 상태 구조 가드
 * (AC-N1 · AC-N3 · AC-N4 · AC-INV2, TRIP-162).
 *
 * 픽셀(타이포 크기·아이콘 tint)은 [검증] 스크린샷 대조 몫 — 여기서는 존재/부재만 본다.
 * 재생성 press→onRegenerate 계약은 동결 테스트(NicknameScreen.test.tsx)가 이미 고정하므로
 * 여기서 중복 단언하지 않는다(아이콘화 후에도 그 테스트가 무수정 green 이어야 한다).
 *
 * 긍정 상태의 권한 경계(US-ONB-03): availabilityConfirmed 는 컨테이너가
 * "현재 입력값 === 서버가 준/검증한 값" 으로 파생해 내려주는 값이다 — 화면은 판정하지 않고
 * 표시만 한다. 한 글자라도 고치면 컨테이너가 false 로 바꿔 즉시 사라진다(Seed 확정 4).
 */

// availabilityConfirmed 는 게이트① 시점에 아직 없는 prop — 확장 타입으로 계약을 선언한다.
type NicknameScreenPropsNext = NicknameScreenProps & {
  /** 서버 근거가 있는 값이 입력창에 그대로 있을 때만 true — 긍정 메시지 표시 스위치. */
  availabilityConfirmed?: boolean;
};
const NicknameScreenNext: (props: NicknameScreenPropsNext) => ReactElement =
  NicknameScreen;

// 동결 테스트의 픽스처를 복제한다(동결 파일은 export 하지 않으므로 재사용 불가).
function makeProps(
  overrides: Partial<NicknameScreenPropsNext> = {}
): NicknameScreenPropsNext {
  return {
    value: '여행자1234',
    canProceed: true,
    errorReason: null,
    suggestions: [],
    onChange: jest.fn(),
    onRegenerate: jest.fn(),
    onSelectSuggestion: jest.fn(),
    onNext: jest.fn(),
    ...overrides,
  };
}

describe('NicknameScreen — 내비바·부제·필드 라벨 (AC-N4 · AC-N1)', () => {
  it('상단 내비바 타이틀 "닉네임 설정" 을 렌더한다', () => {
    render(<NicknameScreenNext {...makeProps()} />);

    expect(screen.getByText('닉네임 설정')).toBeOnTheScreen();
  });

  it('부제 "2~20자로 입력할 수 있어요" 와 필드 라벨 "닉네임" 을 렌더한다', () => {
    render(<NicknameScreenNext {...makeProps()} />);

    expect(screen.getByText('2~20자로 입력할 수 있어요')).toBeOnTheScreen();
    // 정확 일치 조회 — 내비바 "닉네임 설정" 과 겹치지 않는다.
    expect(screen.getByText('닉네임')).toBeOnTheScreen();
  });
});

describe('NicknameScreen — 사용 가능 긍정 상태 (AC-N3)', () => {
  it('availabilityConfirmed 이면 "사용 가능한 닉네임이에요" 를 보여준다', () => {
    render(<NicknameScreenNext {...makeProps()} availabilityConfirmed />);

    expect(
      screen.getByTestId('onboarding-nickname-available')
    ).toHaveTextContent('사용 가능한 닉네임이에요');
  });

  // 부재 단언은 빈 화면도 통과시키므로 루트 존재와 짝짓는다(동결 테스트와 같은 방어).
  it.each([
    ['미전달', undefined],
    ['false', false],
  ])(
    'availabilityConfirmed 가 %s 이면 긍정 메시지를 그리지 않는다',
    (_label, value) => {
      render(
        <NicknameScreenNext {...makeProps()} availabilityConfirmed={value} />
      );

      expect(screen.getByTestId('onboarding-nickname-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('onboarding-nickname-available')).toBeNull();
    }
  );

  it('오류가 있으면 긍정 메시지를 그리지 않는다 — 오류 우선', () => {
    render(
      <NicknameScreenNext
        {...makeProps({ errorReason: 'TAKEN', canProceed: false })}
        availabilityConfirmed
      />
    );

    // 컨테이너 파생이 정상이면 이 조합은 오지 않지만, 화면은 방어적으로 오류를 우선한다.
    expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-nickname-available')).toBeNull();
  });

  it('긍정 메시지와 기존 helper "나중에 설정에서 바꿀 수 있어요" 는 공존한다 (AC-INV2)', () => {
    render(<NicknameScreenNext {...makeProps()} availabilityConfirmed />);

    expect(
      screen.getByTestId('onboarding-nickname-available')
    ).toBeOnTheScreen();
    // US-ONB-03 필수 문구 — 긍정 상태가 helper 를 밀어내면 안 된다(Seed 확정 4 공존).
    expect(screen.getByTestId('onboarding-nickname-helper')).toHaveTextContent(
      '나중에 설정에서 바꿀 수 있어요'
    );
  });
});
