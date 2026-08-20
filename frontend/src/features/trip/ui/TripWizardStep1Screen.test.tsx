import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { validateTripDraft } from '../model/tripDraft';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

// TRIP-445 게이트①-2 결정 A — 삭제된 프로덕션 상수 `REGIONS`를 파일 로컬 `{code,name}[]`
// 픽스처로 기계 교체(단언·동작 무변경, 위저드 화면 `regions` 계약과 같은 shape).
const REGIONS: readonly { code: string; name: string }[] = [
  { code: 'busan', name: '부산' },
  { code: 'gyeongju', name: '경주' },
  { code: 'seoul', name: '서울' },
  { code: 'jeju', name: '제주' },
  { code: 'gangneung', name: '강릉' },
  { code: 'yeosu', name: '여수' },
];

/**
 * TRIP-205 g01 여행 만들기 1/2 — **props만 받는 프레젠테이션 화면**.
 *
 * 무엇을 보장하나: 위저드 셸(앱바·진행 표시·하단 고정 CTA)과 입력 블록 5개가 정본 문구대로
 * 그려지고, 모든 상호작용이 **판단하지 않고 그대로 위로 올려보내며**, `[다음]`의 활성 여부가
 * 받은 `canProceed` 하나로만 갈린다. 그리고 **초기 상태에서 오류 문구가 하나도 안 보인다**
 * (AC-10c — 이 파일의 심판 핵심, 아래 `describe('AC-10c …')` 참조).
 *
 * 왜 props만 받는가: 이 화면이 쿼리 훅·라우터·`expo-location`을 **전이 의존으로라도** 물면
 * dev 프리뷰가 터지고 테스트가 네트워크에 묶인다(`RegionPickerScreen` 머리말과 같은 제약).
 * 그 제약 자체는 렌더로 관찰할 수 없어 `src/__tests__/tripWizardStep1Boundary.test.ts`가
 * 소스 층에서 따로 잠근다(AC-14).
 *
 * 커버하지 않는 것: 서버 제출·오류 문구 표시(TRIP-206) · 예산 UI(TRIP-207) · 등록 숙소 날짜
 * 연계(TRIP-208) · '꼭 갈 곳'(TRIP-209) · 날짜 피커 캘린더(Figma 부재 — D4에 따라 진입점만).
 * 픽셀 충실도(간격·그림자·색)는 이 계약이 잠그지 않는다 — [검증] 스크린샷 대조 몫이다.
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press) → 단언=보이는 것 / 불린 콜백.
 */

/** 기준일 2026-06-10에서 `3박 4일` 프리셋이 만드는 범위 — Figma 날짜 카드 실측값과 같다. */
const START = '2026-06-10';
const END = '2026-06-13';

/** 초기(빈) 드래프트 상태. 아무것도 안 고른 사용자가 보는 화면이다. */
function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    destinations: [],
    startDate: undefined,
    endDate: undefined,
    presetCode: undefined,
    party: 1,
    companionType: undefined,
    preferenceChips: [],
    regions: REGIONS,
    canProceed: false,
    onBack: jest.fn(),
    onAddDestination: jest.fn(),
    onRemoveDestination: jest.fn(),
    onSelectPreset: jest.fn(),
    onPressPeriod: jest.fn(),
    onChangeParty: jest.fn(),
    onSelectCompanion: jest.fn(),
    onChangePreference: jest.fn(),
    onNext: jest.fn(),
    ...over,
  };
}

/** 정상적으로 다 채운 드래프트 — 부산 2박 + 경주 1박 = 3박, 기간도 3박이라 통과 상태다. */
function filledProps(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return props({
    destinations: [
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '경주', nights: 1 },
    ],
    startDate: START,
    endDate: END,
    presetCode: '3n4d',
    party: 2,
    companionType: '친구',
    preferenceChips: ['미식', '전시', '야경'],
    canProceed: true,
    ...over,
  });
}

/** 화면 전체 텍스트를 한 덩어리로 훑는 앵커. 깊은 하위 텍스트까지 합쳐 준다. */
function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

describe('AC-1 · 위저드 셸 (BR-U1-33)', () => {
  it('앱바 제목과 진행 표시 1 / 2, 하단 고정 CTA "다음"이 있다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    expect(screen.getByText('여행 만들기')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();

    const next = screen.getByTestId('trip-wizard-step1-next');
    // CTA 안의 라벨까지 본다 — testID만 보면 빈 버튼도 통과한다.
    expect(next).toHaveTextContent(/다음/);
  });

  it('뒤로가기를 누르면 콜백이 불린다', () => {
    const onBack = jest.fn();
    render(<TripWizardStep1Screen {...props({ onBack })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-step1-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 · 큰 제목 (01b D1 — 라이브 g01·no-saved-places가 정본)', () => {
  it('제목이 「어디로 갈까요?」다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    expect(screen.getByText('어디로 갈까요?')).toBeTruthy();
  });

  it('짝 — 티켓이 발명했던 문구도, default 변형 문구도 쓰지 않는다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    // "새 여행 만들기"는 Figma에 담은 곳 0 변형이 없던 동안의 임시값이었다(01b D1).
    // "담은 곳으로 여행 만들기"는 담은 곳이 실제로 있을 때의 문구라 TRIP-209 몫이다.
    expect(root()).not.toHaveTextContent(/새 여행 만들기/);
    expect(root()).not.toHaveTextContent(/담은 곳으로 여행 만들기/);
  });
});

describe('AC-4 · 여행지 칩 (BR-U1-34)', () => {
  it('각 칩에 지역명과 박수가 있고 "도시 추가" 칩이 함께 보인다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    const busan = screen.getByTestId('trip-wizard-destination-busan');
    const gyeongju = screen.getByTestId('trip-wizard-destination-gyeongju');

    // ⚠️ 문자열이 아니라 **정규식**으로 본다. `toHaveTextContent('2박')`은 부분 포함이
    // 아니라 완전 일치라 `부산 · 2박`에서 실패한다(02a ★3 실측). 정규식이면 지역명과
    // 박수를 한 Text에 넣든 나눠 넣든 둘 다 통과해 마크업 형태에 안 묶인다.
    expect(busan).toHaveTextContent(/부산/);
    expect(busan).toHaveTextContent(/2박/);
    expect(gyeongju).toHaveTextContent(/경주/);
    expect(gyeongju).toHaveTextContent(/1박/);

    // 칩이 있어도 '도시 추가'는 계속 보인다 — 다중 도시가 기본 흐름이다.
    expect(screen.getByTestId('trip-wizard-destination-add')).toBeTruthy();
  });

  it('칩의 제거 버튼을 누르면 그 지역만 올려보낸다', () => {
    const onRemoveDestination = jest.fn();
    const onAddDestination = jest.fn();
    render(
      <TripWizardStep1Screen
        {...filledProps({ onRemoveDestination, onAddDestination })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-busan'));

    // 서버 계약의 `region`은 한글 이름이다(코드가 아니다 — regions.ts 주석).
    expect(onRemoveDestination).toHaveBeenCalledWith('부산');
    expect(onRemoveDestination).toHaveBeenCalledTimes(1);
    // 짝 — × 버튼을 눌렀는데 칩 본체(또는 '도시 추가')까지 함께 불리지 않는다.
    expect(onAddDestination).not.toHaveBeenCalled();
  });
});

describe('AC-3 · 도시 추가 시트 (REGIONS 6지역 + 박수 지정)', () => {
  it('열기 전에는 시트가 없고, "도시 추가"를 누르면 6지역이 보인다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    // 짝(부정) — 처음부터 열려 있으면 아래 긍정 단언이 무의미해진다.
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    expect(screen.getByTestId('trip-wizard-destination-sheet')).toBeTruthy();
    REGIONS.forEach((region) => {
      expect(
        screen.getByTestId(`trip-wizard-destination-region-${region.code}`)
      ).toBeTruthy();
    });
  });

  it('지역을 고르고 박수를 올린 뒤 확정하면 그 값이 올라가고 시트가 닫힌다', () => {
    const onAddDestination = jest.fn();
    render(<TripWizardStep1Screen {...props({ onAddDestination })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    fireEvent.press(screen.getByTestId('trip-wizard-destination-region-busan'));
    // 박수 기본값 1 → +1 = 2박.
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
    fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));

    expect(onAddDestination).toHaveBeenCalledWith('부산', 2);
    expect(onAddDestination).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();
  });

  it('지역을 안 고르면 확정할 수 없다', () => {
    const onAddDestination = jest.fn();
    render(<TripWizardStep1Screen {...props({ onAddDestination })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    const confirm = screen.getByTestId('trip-wizard-destination-confirm');

    // ⚠️ 두 단언이 **둘 다** 필요하다. `toBeDisabled()`는 접근성 상태만 보므로
    // `accessibilityState`만 회색으로 칠하고 실제로는 눌리는 버튼도 통과한다(02a ★1 실측).
    expect(confirm).toBeDisabled();
    fireEvent.press(confirm);
    expect(onAddDestination).not.toHaveBeenCalled();

    // 짝 — 지역을 고르면 열린다. 이게 없으면 "영원히 비활성"인 구현도 통과한다.
    fireEvent.press(screen.getByTestId('trip-wizard-destination-region-jeju'));
    expect(screen.getByTestId('trip-wizard-destination-confirm')).toBeEnabled();
  });

  it('시트의 박수는 1박 아래로 내려가지 않는다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-dec'));
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-dec'));

    // 0박·음수 박은 서버 계약상 의미가 없다. 시트 안으로 범위를 좁혀 본다 —
    // 화면 다른 곳의 '박' 표기와 섞이지 않게.
    expect(
      screen.getByTestId('trip-wizard-destination-sheet')
    ).toHaveTextContent(/1박/);
  });
});

describe('AC-닫기 · 도시 추가 시트 닫기 어포던스 (TRIP-386)', () => {
  // 이 시트는 gorhom 바텀시트가 아니라 절대배치 View라, 자매 TripDateSheet와 달리
  // jest가 press·언마운트를 실제로 관측한다(바텀시트 목 사각 밖).

  it('시트를 열면 눈에 보이는 "닫기" 컨트롤이 있다', () => {
    render(<TripWizardStep1Screen {...props()} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    // 준비→실행(오픈)→단언: 닫기 컨트롤이 존재하고 라벨이 '닫기'다.
    const close = screen.getByTestId('trip-wizard-destination-close');
    expect(close).toBeTruthy();
    expect(close).toHaveTextContent(/닫기/);
  });

  it('"닫기"를 누르면 시트가 닫히고 아무것도 추가되지 않는다', () => {
    const onAddDestination = jest.fn();
    render(<TripWizardStep1Screen {...props({ onAddDestination })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    fireEvent.press(screen.getByTestId('trip-wizard-destination-close'));

    // 사라짐은 queryBy+toBeNull로만 잴 수 있다(getBy는 부재 시 throw).
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();
    // 화면은 목록을 props로 받으므로, 목록 불변을 "추가 콜백 미호출"로 대리 증명한다.
    expect(onAddDestination).not.toHaveBeenCalled();
  });

  it('회귀 — 배경(딤)을 누르면 지금처럼 닫히고 아무것도 추가되지 않는다', () => {
    const onAddDestination = jest.fn();
    render(<TripWizardStep1Screen {...props({ onAddDestination })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    fireEvent.press(
      screen.getByTestId('trip-wizard-destination-sheet-backdrop')
    );

    // 백드롭이 화면을 실제로 덮는지(픽셀)는 jest가 못 본다 —
    // 여기서 잠그는 것은 "press → 언마운트" 상태 전이뿐이며 그것으로 충분하다.
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();
    expect(onAddDestination).not.toHaveBeenCalled();
  });
});

describe('AC-5 · 기간 프리셋과 날짜 카드 (BR-U1-36)', () => {
  it('선택된 프리셋만 선택 상태이고 날짜 카드에 범위가 보인다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    // *(개념)* `toBeSelected()` = 그 요소의 접근성 상태가 "선택됨"인지 보는 matcher.
    // 색만 바꾸면 눈에는 보여도 이 단언은 통과하지 않는다(PrefStep1Screen 선례).
    expect(screen.getByTestId('trip-wizard-period-preset-3n4d')).toBeSelected();
    ['this-weekend', 'next-weekend', '1n2d'].forEach((code) => {
      expect(
        screen.getByTestId(`trip-wizard-period-preset-${code}`)
      ).not.toBeSelected();
    });

    // 구분자는 en dash(–, U+2013)다. 하이픈으로 쓰면 조용히 어긋난다(02a ★7).
    expect(screen.getByTestId('trip-wizard-date-field')).toHaveTextContent(
      /6월 10일 – 6월 13일/
    );
  });

  it('프리셋을 누르면 코드만 올려보낸다 — 날짜는 화면이 계산하지 않는다', () => {
    const onSelectPreset = jest.fn();
    render(<TripWizardStep1Screen {...props({ onSelectPreset })} />);

    fireEvent.press(
      screen.getByTestId('trip-wizard-period-preset-this-weekend')
    );

    // 기준일이 화면 밖에 있으므로(01b D5) 화면은 어느 날짜인지 알 수 없고, 알 필요도 없다.
    expect(onSelectPreset).toHaveBeenCalledWith('this-weekend');
    expect(onSelectPreset).toHaveBeenCalledTimes(1);
  });
});

describe('AC-6 · 날짜 직접 수정 진입점 (01b D4)', () => {
  it('날짜 카드를 누르면 onPressPeriod가 불린다', () => {
    const onPressPeriod = jest.fn();
    render(<TripWizardStep1Screen {...filledProps({ onPressPeriod })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-date-field'));

    // 실제 캘린더 UI는 Figma에 프레임이 없어 이 칸 밖이다 — 진입점만 잠근다.
    expect(onPressPeriod).toHaveBeenCalledTimes(1);
  });
});

describe('AC-7 · 인원 스테퍼 (BR-U1-39 · 하한 1)', () => {
  it('기본 1명이고, 1에서 −는 눌리지 않는다', () => {
    const onChangeParty = jest.fn();
    render(<TripWizardStep1Screen {...props({ party: 1, onChangeParty })} />);

    expect(screen.getByTestId('trip-wizard-party-stepper')).toHaveTextContent(
      /1명/
    );

    const dec = screen.getByTestId('trip-wizard-party-stepper-dec');
    // ★1과 같은 이유로 두 단언을 함께 건다.
    expect(dec).toBeDisabled();
    fireEvent.press(dec);
    expect(onChangeParty).not.toHaveBeenCalled();
  });

  it('짝 — +는 다음 값을 올려보내고, 2명부터는 −가 열린다', () => {
    const onChangeParty = jest.fn();
    const { rerender } = render(
      <TripWizardStep1Screen {...props({ party: 1, onChangeParty })} />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-party-stepper-inc'));
    expect(onChangeParty).toHaveBeenCalledWith(2);

    rerender(<TripWizardStep1Screen {...props({ party: 2, onChangeParty })} />);
    expect(screen.getByTestId('trip-wizard-party-stepper')).toHaveTextContent(
      /2명/
    );
    expect(screen.getByTestId('trip-wizard-party-stepper-dec')).toBeEnabled();
  });
});

describe('AC-8 · 동반 유형 칩 (BR-U1-39 · 단일 선택)', () => {
  it('고른 칩 하나만 선택 상태다', () => {
    render(
      <TripWizardStep1Screen {...filledProps({ companionType: '친구' })} />
    );

    expect(screen.getByTestId('trip-wizard-companion-friend')).toBeSelected();
    ['alone', 'partner', 'family'].forEach((code) => {
      expect(
        screen.getByTestId(`trip-wizard-companion-${code}`)
      ).not.toBeSelected();
    });
  });

  it('칩을 누르면 ASCII 코드가 아니라 서버 enum을 올려보낸다', () => {
    const onSelectCompanion = jest.fn();
    render(<TripWizardStep1Screen {...props({ onSelectCompanion })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-companion-partner'));

    // testID의 `partner`는 셀렉터용 ASCII고(01b D7), 스토어·서버가 받는 값은 enum '연인'이다.
    // 둘을 섞으면 서버가 거부한다.
    expect(onSelectCompanion).toHaveBeenCalledWith('연인');
  });
});

describe('AC-9 · 취향 프리필 카드 (BR-U1-38)', () => {
  it('취향이 있으면 문구와 칩과 [바꾸기]가 보인다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    expect(screen.getByText('당신 취향으로 맞췄어요')).toBeTruthy();
    ['미식', '전시', '야경'].forEach((chip) => {
      expect(screen.getByText(chip)).toBeTruthy();
    });
    expect(
      screen.getByText('온보딩에서 고른 취향을 그대로 반영했어요')
    ).toBeTruthy();
    expect(screen.getByTestId('trip-wizard-pref-change')).toBeTruthy();
  });

  it('[바꾸기]를 누르면 콜백이 불린다', () => {
    const onChangePreference = jest.fn();
    render(<TripWizardStep1Screen {...filledProps({ onChangePreference })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-pref-change'));

    expect(onChangePreference).toHaveBeenCalledTimes(1);
  });

  it('취향이 비어도 화면이 죽지 않는다 — 카드는 있고 칩만 없다', () => {
    // 취향 조회가 아직 안 끝났거나 계정에 취향이 없는 경계. Figma에 그 변형이 없어
    // "카드는 유지하고 값만 생략한다"는 리포 확립 규칙(US-EXPL-02 예외항)을 따른다.
    render(<TripWizardStep1Screen {...filledProps({ preferenceChips: [] })} />);

    const card = screen.getByTestId('trip-wizard-pref-card');
    expect(card).toHaveTextContent(/당신 취향으로 맞췄어요/);
    ['미식', '전시', '야경'].forEach((chip) => {
      expect(within(card).queryByText(chip)).toBeNull();
    });
  });
});

describe('AC-10a · AC-10b · [다음] 게이트', () => {
  it('canProceed가 참이면 눌리고 콜백이 불린다', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...filledProps({ onNext })} />);

    const next = screen.getByTestId('trip-wizard-step1-next');
    expect(next).toBeEnabled();

    fireEvent.press(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('canProceed가 거짓이면 회색이기만 한 게 아니라 실제로 눌리지 않는다', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...props({ canProceed: false, onNext })} />);

    const next = screen.getByTestId('trip-wizard-step1-next');

    // ⚠️ 이 두 줄이 이 파일에서 가장 자주 반쪽만 쓰이는 짝이다. `toBeDisabled()`는
    // `accessibilityState.disabled`만 읽으므로, 접근성 상태만 켜고 `disabled` prop을
    // 빠뜨린 버튼은 **매처를 통과하면서 그대로 눌린다**(02a ★1 실측).
    expect(next).toBeDisabled();
    fireEvent.press(next);
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('AC-10c · 초기 상태에 오류 문구가 하나도 없다 (이 사이클의 심판)', () => {
  it('검증은 빈 드래프트에 위반 3개를 내지만, 화면에는 그 흔적이 없다', () => {
    // ① 먼저 **현실을 기록한다**. `validateTripDraft`는 페일클로즈라(TRIP-204) 날짜가
    //    비어 있으면 읽을 수 없는 값으로 보고 위반으로 잡는다. 옳은 판정이다.
    const violations = validateTripDraft({
      destinations: [],
      startDate: '',
      endDate: '',
      party: 1,
    });
    expect([...violations].sort()).toEqual(
      ['END_BEFORE_START', 'NIGHTS_EXCEED_PERIOD', 'NO_DESTINATION'].sort()
    );

    // ② 그런데 아무것도 안 고른 사용자가 보는 화면에는 그 셋이 하나도 없어야 한다.
    render(<TripWizardStep1Screen {...props()} />);

    // 위반 코드가 그대로 새어 나온 경우.
    expect(root()).not.toHaveTextContent(
      /NO_DESTINATION|END_BEFORE_START|NIGHTS_EXCEED_PERIOD|PARTY_BELOW_ONE/
    );
    // 코드를 사람 말로 옮겨 그린 경우 — Figma `g01 · error`(2226:1929)가 확정해 둔 문구다.
    expect(root()).not.toHaveTextContent(/빨라요|많아요|다시 확인해주세요/);

    // ③ 짝(긍정) — **이게 없으면 아무것도 안 그리는 화면이 ②를 공짜로 통과한다**(02a ★2 실측:
    //    빈 루트에 부정 단언을 걸면 PASS가 난다). 화면이 실제로 그려졌음을 먼저 못박는다.
    expect(root()).toHaveTextContent(/어디로 갈까요\?/);
    expect(root()).toHaveTextContent(/다음/);
    // 그리고 게이트는 닫혀 있다 — "문구가 없다"가 "검사를 안 한다"는 뜻이 아니다.
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeDisabled();
  });

  it('위반이 실재하는 상태에서도 이 칸은 문구를 그리지 않는다 (01b D3)', () => {
    // 부산 5박인데 기간은 3박 — `NIGHTS_EXCEED_PERIOD`가 실제로 서는 상태다.
    render(
      <TripWizardStep1Screen
        {...filledProps({
          destinations: [{ seq: 1, region: '부산', nights: 5 }],
          canProceed: false,
        })}
      />
    );

    // 이 칸의 계약은 "판정만 하고 표시는 TRIP-206"이다. 문구를 미리 그려 넣으면
    // 그 티켓의 AC와 섞여 TRIP-81 종료 판정에서 구분되지 않는다.
    expect(root()).not.toHaveTextContent(
      /NO_DESTINATION|END_BEFORE_START|NIGHTS_EXCEED_PERIOD|PARTY_BELOW_ONE/
    );
    expect(root()).not.toHaveTextContent(/빨라요|많아요|다시 확인해주세요/);

    // 짝 — 대신 게이트가 닫힌다. 이것이 이 칸이 지는 몫이다.
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeDisabled();
    expect(root()).toHaveTextContent(/부산/);
  });
});

describe('AC-12 · INV-3 — 소요 시간 미표시 (BR-U1-54)', () => {
  it('어떤 상태에서도 소요 시간 문자열이 나타나지 않는다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    expect(root()).not.toHaveTextContent(/소요/);
    expect(root()).not.toHaveTextContent(/\d+\s*분/);
    expect(root()).not.toHaveTextContent(/\d+\s*시간/);

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤다는 증거이자, 위 정규식이 이 화면의 정상
    // 표기(박·일·명)를 오탐하지 않는다는 확인이다(02a ★6 실측).
    expect(root()).toHaveTextContent(/3박 4일/);
    expect(root()).toHaveTextContent(/2명/);
  });
});

describe('AC-13 · 범위 — 다음 칸 것들을 미리 그리지 않는다 (01b D2)', () => {
  it('예산·등록 숙소·꼭 갈 곳 블록이 각자 자리에 있다', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    // 라이브 Figma에는 셋 다 그려져 있지만 각자 티켓이 있다(TRIP-207 · 208 · 209).
    // 이 칸이 삼키면 티켓별 AC 충족 여부가 섞여 구분되지 않는다.
    //
    // ⚠️ **TRIP-207에서 예산 두 줄(`/예산/`·`/₩/`)을, TRIP-208에서 `/가져오기/` 한 줄을,
    // TRIP-209에서 마지막 한 줄(`/꼭 갈 곳/`)을 걷어냈다**(각 사이클 02a §6). 걷어낸 줄들은
    // "그 티켓이 올 때까지 미리 그리지 마라"는 칸막이였고 해당 티켓이 도착해 임무가 끝났다.
    // 이제 이 it은 "세 블록이 각자 자리에 있다"는 앵커만 진다.
    //
    // 칸막이를 걷은 자리를 반대 방향으로 다시 잠근다 — 안 그러면 "그 블록이 있어도 없어도
    // 통과"가 된다. 각 블록의 내용은 `…budget.test.tsx`·`…stayImport.test.tsx`·
    // `…mustVisit.test.tsx`가 본다.
    expect(screen.getByTestId('trip-wizard-budget-block')).toBeTruthy();
    expect(screen.getByTestId('trip-wizard-stayimport-block')).toBeTruthy();
    expect(screen.getByTestId('trip-wizard-mustvisit-block')).toBeTruthy();

    // 짝(긍정) — 이 칸 소관 블록은 그대로 있다. 없으면 위 부정 단언이 공허해진다.
    expect(root()).toHaveTextContent(/여행지/);
    expect(root()).toHaveTextContent(/언제 가세요\?/);
    expect(root()).toHaveTextContent(/누구랑 가세요\?/);
    expect(root()).toHaveTextContent(/당신 취향으로 맞췄어요/);
  });

  it('몰입 화면이라 하단 탭바를 그리지 않는다 (BR-U0-29)', () => {
    render(<TripWizardStep1Screen {...filledProps()} />);

    // 라우트가 (tabs) 밖이라 구조적으로 충족되지만, 화면이 스스로 탭바를 끌어오는
    // 회귀를 막는다.
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
  });
});

describe('TRIP-387 · 시트 안 지역 검색 (슬라이스 1)', () => {
  // 이 시트의 지역 목록은 두 갈래로 온다:
  //  · sheetRegions(신규 optional) — 페이지가 filterRegions(query)로 이미 좁혀 내린 목록
  //  · 미제공이면 regions(full 6개)로 폴백 — 기존 27케이스가 이 폴백에 얹혀 무손상이다
  // 화면은 검색을 스스로 하지 않는다(features 간 import 금지) — 좁힌 결과만 받아 그린다.

  /** 페이지가 '부'로 좁혀 부산 하나만 내려보낸 상태. */
  const busanOnly = [{ code: 'busan', name: '부산' }];
  const OTHER_CODES = ['gyeongju', 'seoul', 'jeju', 'gangneung', 'yeosu'];

  it('AC-1 · sheetRegions로 좁힌 목록만 칩으로 그린다', () => {
    render(
      <TripWizardStep1Screen
        {...props({ sheetRegions: busanOnly, destinationQuery: '부' })}
      />
    );

    // 실행: 시트를 연다(칩·검색·문구는 sheetOpen일 때만 렌더된다, 02a ★6).
    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    // 단언: 부산 칩만 있고 나머지 5개 지역 칩은 없다.
    expect(
      screen.getByTestId('trip-wizard-destination-region-busan')
    ).toBeTruthy();
    OTHER_CODES.forEach((code) => {
      expect(
        screen.queryByTestId(`trip-wizard-destination-region-${code}`)
      ).toBeNull();
    });
    // 칩 총수 1 — 정규식 testID 쿼리는 매칭 전부를 돌려준다(02a §5 실측).
    expect(
      screen.queryAllByTestId(/^trip-wizard-destination-region-/)
    ).toHaveLength(1);
  });

  it('시트 안에 검색 입력이 있고, 제어 입력이라 친 문자열을 그대로 위로 올린다', () => {
    // *(개념)* 제어 입력(controlled input): 화면에 보이는 값은 내부 상태가 아니라
    // prop(destinationQuery)이 정한다. 사용자가 쳐도 화면은 스스로 안 바꾸고, 바뀐
    // 문자열을 onChangeText로 위로 보고만 한다 — 예산 입력과 같은 규율이다.
    const onChangeDestinationQuery = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ destinationQuery: '부', onChangeDestinationQuery })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    const input = screen.getByTestId('trip-wizard-destination-search');

    // 받은 값을 그대로 보여준다(제어 입력).
    expect(input).toHaveDisplayValue('부');

    // 실행: '경'으로 바꿔 친다.
    fireEvent.changeText(input, '경');

    // 단언: 가공 없이 그대로 올라간다. fireEvent.changeText는 editable !== false인
    // 입력에만 흐르므로, 이 호출이 곧 "편집 가능"의 증거이기도 하다(budget 선례, 02a ★4).
    expect(onChangeDestinationQuery).toHaveBeenCalledWith('경');
    expect(onChangeDestinationQuery).toHaveBeenCalledTimes(1);
  });

  it('AC-2 · 불일치면 칩 0개 + "일치하는 지역이 없어요", 전체로 되돌아가지 않는다', () => {
    // ⚠️ 이 사이클의 핵심 함정(02a ★1). 페이지가 불일치 검색어로 좁히면 sheetRegions는
    // **빈 배열**이다. 화면은 (sheetRegions ?? regions)로 폴백하는데, nullish ??는
    // null·undefined에만 폴백한다 — [] ?? regions === [](02a §5 실측). truthy 검사
    // (sheetRegions?.length ? … : regions)를 쓰면 빈 배열이 full로 되돌아가 조용히 깨진다.
    render(
      <TripWizardStep1Screen
        {...props({ sheetRegions: [], destinationQuery: '없는지역' })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    // 칩이 하나도 없다 — 빈 배열이 full로 되돌아가지 않았다는 증거다.
    expect(
      screen.queryAllByTestId(/^trip-wizard-destination-region-/)
    ).toHaveLength(0);

    // 그리고 "없다"고 말한다(정규식 — 문자열이면 완전 일치라 마크업에 취약, 02a ★3).
    const empty = screen.getByTestId('trip-wizard-destination-search-empty');
    expect(empty).toHaveTextContent(/일치하는 지역이 없어요/);
  });

  it('AC-2 짝 · 검색어가 비어 있으면(전체 표시) "없어요" 문구를 그리지 않는다', () => {
    // "입력 안 함"과 "일치 없음"은 다르다 — 빈 검색어에서 empty 문구가 뜨면 처음 시트를
    // 연 사용자가 "지역이 없다"는 거짓말을 본다. 조건은 길이 0 && 검색어 !== '' 둘 다여야 한다.
    render(
      <TripWizardStep1Screen
        {...props({ sheetRegions: REGIONS, destinationQuery: '' })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    // 6개가 다 보이고, empty 문구는 없다.
    expect(
      screen.queryAllByTestId(/^trip-wizard-destination-region-/)
    ).toHaveLength(REGIONS.length);
    expect(
      screen.queryByTestId('trip-wizard-destination-search-empty')
    ).toBeNull();
  });

  it('AC-4 폴백 · sheetRegions 미제공이면 기존처럼 6개 전부 + empty 문구 없음', () => {
    // 하위호환: 신규 prop을 하나도 안 주면 옛 경로 그대로다. 기존 props() 헬퍼가 이 상태라,
    // 이 파일의 다른 27케이스가 통째로 이 폴백에 얹혀 있다(회귀 그물, 02a ★7).
    render(<TripWizardStep1Screen {...props()} />);

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    REGIONS.forEach((region) => {
      expect(
        screen.getByTestId(`trip-wizard-destination-region-${region.code}`)
      ).toBeTruthy();
    });
    expect(
      screen.queryByTestId('trip-wizard-destination-search-empty')
    ).toBeNull();
  });

  it('★확정은 full regions로 지역을 되찾는다 — 고른 뒤 검색어가 바뀌어 그 지역이 시트에서 사라져도 담긴다', () => {
    // 함정(code-critic 경고-1, 도달 가능): '부'로 부산을 고른 뒤 검색어를 '제주'로 바꾸면
    // 부산은 좁힌 목록(sheetRegions)에서 사라지지만, 사용자가 이미 고른 선택(sheetRegionCode)은
    // 리셋되지 않는다. 이때 확정하면 부산이 담겨야 한다 — 확정 resolution이 좁힌 목록이 아니라
    // **full `regions`**를 봐야만 성립한다(01b 함정 ③). 이 성질을 잠그는 심판이 없어 신설한다.
    const onAddDestination = jest.fn();
    const { rerender } = render(
      <TripWizardStep1Screen
        {...props({
          onAddDestination,
          sheetRegions: [{ code: 'busan', name: '부산' }],
          destinationQuery: '부',
        })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
    // 준비: 좁힌 목록에 있는 부산을 고른다(내부 sheetRegionCode='busan').
    fireEvent.press(screen.getByTestId('trip-wizard-destination-region-busan'));

    // 실행: 검색어가 '제주'로 바뀌어 페이지가 부산을 제외한 목록을 다시 내려보낸다.
    // (rerender는 같은 컴포넌트 인스턴스라 내부 상태 sheetRegionCode='busan'이 유지된다.)
    rerender(
      <TripWizardStep1Screen
        {...props({
          onAddDestination,
          sheetRegions: [{ code: 'jeju', name: '제주' }],
          destinationQuery: '제주',
        })}
      />
    );
    // 부산 칩은 이제 시트에서 사라졌다(짝 — 이 전제가 있어야 함정이 성립).
    expect(
      screen.queryByTestId('trip-wizard-destination-region-busan')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));

    // 단언: 좁힌 목록에 없어도 full regions로 부산을 되찾아 담는다.
    expect(onAddDestination).toHaveBeenCalledWith('부산', 1);
    expect(onAddDestination).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-455 · 여행지 추가 시트 스크롤 (버그1)', () => {
  // 버그1: 서버 카탈로그(GET /regions)가 화면보다 길어지면 칩 격자가 위로 밀려 상단 광역시
  // (서울·부산)가 화면 밖으로 나가 선택 불가였다. 근본 원인은 칩 격자가 맨 <View>(flex-wrap,
  // 높이 상한·스크롤 없음)라는 것. 수정은 칩 격자를 스크롤 컨테이너로 감싸는 것이다.
  //
  // jest가 못 보는 것: 실제 스크롤·클리핑·상단 칩 도달 가능성(RN 테스트 렌더러는 레이아웃을
  // 계산 안 한다, 02a ★S). 그래서 이 심판은 **스크롤 컨테이너 존재**라는 구조만 잠근다 —
  // 실제 도달성은 [검증] 6-b 실기(카탈로그 긴 상태로 시트 열어 서울·부산까지 스크롤) 몫이다.

  it('🔴 시트를 열면 칩 목록을 감싸는 스크롤 컨테이너가 있다', () => {
    // (준비) 기본 드래프트로 렌더.
    render(<TripWizardStep1Screen {...props()} />);

    // (실행) 시트를 연다 — 칩·스크롤 컨테이너는 sheetOpen일 때만 렌더된다(★6).
    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    // (단언) 앵커 — 시트가 실제로 열렸고 칩이 그려진다(스크롤 단언이 렌더 통째 죽음이나
    // "스크롤 컨테이너가 칩을 삼켜 0개"로 공허 통과하지 않게).
    expect(
      screen.getByTestId('trip-wizard-destination-sheet')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-destination-region-busan')
    ).toBeOnTheScreen();

    // 핵심 — 오늘은 이 컨테이너 testID가 없어 RED. 있으면 상단 칩이 화면 밖으로 영영
    // 밀리지 않을 자리가 생긴다(실제 스크롤은 6-b).
    expect(
      screen.getByTestId('trip-wizard-destination-sheet-scroll')
    ).toBeOnTheScreen();
  });
});
