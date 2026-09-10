import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CompanionType } from '@/shared/api/generated/schemas';

import { CompanionEditSheet } from './CompanionEditSheet';

/**
 * TRIP-668 g01 동행 편집 바텀시트 — **props-only 무상태 프레젠테이션**(01b D4).
 *
 * 무엇을 보장하나: 시트가 넘겨받은 `party`·`companionType`(드래프트, 배선 소유)로 ① 인원 스테퍼
 * (−·"N명"·+)와 유형 칩 4종을 그리고 ② 선택 칩만 **서로 다른 활성 표식 testID**로 구분하며
 * ③ 스테퍼/칩/적용 press 를 받은 콜백으로 정확히 올린다. 이 시트는 **상태를 안 가진다** —
 * 드래프트는 배선(TripNewStep1Page)이 소유하고, 시트는 완성형 props 를 받아 그릴 뿐이다.
 *
 * 왜 활성 표식을 색 fill 이 아니라 서로 다른 testID 로 잠그나: 칩 글리프의 `selected` prop 은
 * stroke 색만 바꿔 jest 렌더 트리에서 관찰되지 않는다(repo-traps "글리프 fill 무심판"). 선택 칩만
 * `-chip-active-{code}` 마커를 렌더해야 뒤바뀜·교차가 red 로 잡힌다(S3 cell-start 선례).
 *
 * 왜 disabled 는 3단(매처+press+콜백0)인가: 진짜 `disabled` prop 은 press 를 막지만 accessibilityState
 * 만 세운 가짜는 press 가 그대로 발화한다(실측 02a §5-1 — [[disabled prop과 accessibilityState]]).
 *
 * 무엇을 **못** 보나(6-b 실기 전용): `__mocks__/@gorhom/bottom-sheet.tsx`가 통과형 목이라(마운트하면
 * children 무조건 렌더) 실제 개폐·딤 전면 커버·터치 차단은 jest 원리적 사각이다(AC-5).
 *
 * 왜 store 실반영을 여기서 안 잠그나: 시트는 props-only 라 store 를 모른다. "적용→setParty·selectCompanion
 * 각 1회"의 실반영은 배선 통합 테스트(`TripNewStep1Page.companion.integration`)가 store 상태로 증명한다 —
 * 여기선 "적용 press → onApply 1회"(배선 신호)까지만 잠근다.
 */

interface SheetPropsForTest {
  party: number;
  companionType?: CompanionType;
  onChangeParty: (next: number) => void;
  onSelectCompanion: (type: CompanionType) => void;
  onApply: () => void;
  onClose: () => void;
}

function renderSheet(overrides: Partial<SheetPropsForTest> = {}) {
  const spies = {
    onChangeParty: jest.fn(),
    onSelectCompanion: jest.fn(),
    onApply: jest.fn(),
    onClose: jest.fn(), // TRIP-683: 딤 바깥 탭 닫힘 콜백(필수 prop 화)
  };
  const props: SheetPropsForTest = {
    party: 2,
    companionType: undefined,
    ...spies,
    ...overrides,
  };
  render(<CompanionEditSheet {...props} />);
  return spies;
}

describe('AC-1 · 스테퍼·유형 칩 4종 렌더', () => {
  it('시트 컨테이너·인원 스테퍼(−·"N명"·+)·칩 4종·적용 버튼을 그린다', () => {
    renderSheet({ party: 2 });

    expect(screen.getByTestId('trip-wizard-companion-sheet')).toBeOnTheScreen();

    // 인원 스테퍼
    expect(
      screen.getByTestId('trip-wizard-companion-party-dec')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-companion-party-inc')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-companion-party-value')
    ).toBeOnTheScreen();
    // 값은 getByText 완전일치(부분포함 오검출 없음, 02a §5-1).
    expect(screen.getByText('2명')).toBeOnTheScreen();

    // 유형 칩 4종(COMPANION_OPTIONS 순서·code)
    for (const code of ['alone', 'friend', 'partner', 'family']) {
      expect(
        screen.getByTestId(`trip-wizard-companion-chip-${code}`)
      ).toBeOnTheScreen();
    }

    // 적용
    expect(screen.getByTestId('trip-wizard-companion-apply')).toBeOnTheScreen();
  });
});

describe('AC-2 · 스테퍼 증감 → onChangeParty(절대값)', () => {
  it('+/− 가 현재±1 의 절대 인원으로 콜백한다 (비-혼자, party>1)', () => {
    const spies = renderSheet({ party: 2, companionType: '친구' });

    fireEvent.press(screen.getByTestId('trip-wizard-companion-party-inc'));
    expect(spies.onChangeParty).toHaveBeenLastCalledWith(3);

    fireEvent.press(screen.getByTestId('trip-wizard-companion-party-dec'));
    expect(spies.onChangeParty).toHaveBeenLastCalledWith(1);
  });
});

describe('AC-2 · 하한 1 — party===1 이면 − 진짜 disabled (비-혼자)', () => {
  it('disabled 매처 + press 무반응 + 콜백 0회 3단, + 는 여전히 활성(짝)', () => {
    const spies = renderSheet({ party: 1, companionType: '친구' });

    const dec = screen.getByTestId('trip-wizard-companion-party-dec');
    expect(dec).toBeDisabled();
    // 진짜 disabled prop 이면 press 가 안 먹는다(accessibilityState 만 세운 가짜는 여기서 red).
    fireEvent.press(dec);
    expect(spies.onChangeParty).not.toHaveBeenCalled();

    // 짝(긍정) — + 는 활성이라 눌린다(1 → 2).
    const inc = screen.getByTestId('trip-wizard-companion-party-inc');
    expect(inc).not.toBeDisabled();
    fireEvent.press(inc);
    expect(spies.onChangeParty).toHaveBeenCalledWith(2);
  });
});

describe('AC-2 · ★ 혼자 → party 1 고정 + 스테퍼(−·+) 둘 다 진짜 disabled (D2)', () => {
  it('혼자 = 값 "1명" + dec·inc 각각 disabled 매처 + press 무반응 + 콜백 0회 (3단×2)', () => {
    const spies = renderSheet({ party: 1, companionType: '혼자' });

    expect(screen.getByText('1명')).toBeOnTheScreen();

    const dec = screen.getByTestId('trip-wizard-companion-party-dec');
    const inc = screen.getByTestId('trip-wizard-companion-party-inc');
    expect(dec).toBeDisabled();
    expect(inc).toBeDisabled();

    fireEvent.press(dec);
    fireEvent.press(inc);
    // 혼자-고정 제거 뮤턴트(disabled 를 party===1 하나로만)면 inc 가 활성으로 남아 여기서 red.
    expect(spies.onChangeParty).not.toHaveBeenCalled();
  });

  it('짝(재활성) — 혼자가 아니면(친구) −·+ 둘 다 활성이라 눌린다', () => {
    const spies = renderSheet({ party: 2, companionType: '친구' });

    const dec = screen.getByTestId('trip-wizard-companion-party-dec');
    const inc = screen.getByTestId('trip-wizard-companion-party-inc');
    expect(dec).not.toBeDisabled();
    expect(inc).not.toBeDisabled();

    fireEvent.press(inc);
    fireEvent.press(dec);
    expect(spies.onChangeParty).toHaveBeenCalledTimes(2);
  });
});

describe('AC-3 · ★ 유형 칩 단일 선택 — 선택 칩만 활성 표식(교차)', () => {
  it('친구 선택 = 친구 활성 표식만, 나머지 3종 활성 표식 부재 + 칩 press → onSelectCompanion(type)', () => {
    const spies = renderSheet({ companionType: '친구' });

    // 활성 표식은 선택 칩에만(색 fill 아님 — 서로 다른 testID).
    expect(
      screen.getByTestId('trip-wizard-companion-chip-active-friend')
    ).toBeOnTheScreen();
    // 교차 부재 — 나머지 3종엔 활성 표식이 없다(교차 뮤턴트가 여기서 red).
    expect(
      screen.queryByTestId('trip-wizard-companion-chip-active-alone')
    ).toBeNull();
    expect(
      screen.queryByTestId('trip-wizard-companion-chip-active-partner')
    ).toBeNull();
    expect(
      screen.queryByTestId('trip-wizard-companion-chip-active-family')
    ).toBeNull();

    // 칩 press → 해당 type 으로 콜백(code=alone → type='혼자').
    fireEvent.press(screen.getByTestId('trip-wizard-companion-chip-alone'));
    expect(spies.onSelectCompanion).toHaveBeenCalledWith('혼자');
  });

  it('미선택(undefined) = 활성 표식 4개 전부 부재', () => {
    renderSheet({ companionType: undefined });

    for (const code of ['alone', 'friend', 'partner', 'family']) {
      expect(
        screen.queryByTestId(`trip-wizard-companion-chip-active-${code}`)
      ).toBeNull();
    }
  });
});

describe('AC-4 · 적용 → onApply 만 (편집 콜백 없음)', () => {
  it('"적용" press 가 onApply 를 한 번 부르고 편집 콜백은 안 부른다 (커밋은 배선 몫)', () => {
    const spies = renderSheet({ party: 2, companionType: '친구' });

    fireEvent.press(screen.getByTestId('trip-wizard-companion-apply'));

    expect(spies.onApply).toHaveBeenCalledTimes(1);
    // 적용은 커밋 신호일 뿐 — 시트가 편집 콜백을 다시 부르지 않는다.
    expect(spies.onChangeParty).not.toHaveBeenCalled();
    expect(spies.onSelectCompanion).not.toHaveBeenCalled();
  });
});
