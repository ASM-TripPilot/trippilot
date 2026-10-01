import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import {
  ConceptPickerScreen,
  type ConceptPickerScreenProps,
} from './ConceptPickerScreen';

/**
 * AC-2 (h13 컨셉) — 컨셉 카드를 탭하면 그 라벨이 그대로 배선으로 넘어가고("concept" 문자열),
 * "테마 없이 건너뛰기"는 컨셉 아닌 별도 경로(onSkip)임을 보장한다.
 *
 * 화면은 순수 — 컨셉 목록은 props 로 받고, 탭은 콜백으로만 알린다(선택 상태를 스스로 안 든다).
 * 3동작: 준비=컨셉 목록·스파이 → 실행=카드/스킵 탭 → 단언=콜백 인자.
 *
 * 한 파일로 합친 기록(TRIP-1150): 옛 `.parity`(Figma 정합 표면)·`.icon`(아이콘 틴트)을 바깥 describe 로
 * 붙였다. 옛 `.parity` 의 소요시간 탐지기 자가검사(S0)·"렌더 텍스트에 소요시간 0" it 은 지웠다 — 컨셉
 * 선택 화면엔 시간·거리 재료가 없다(README 판정 4 INV-3 하위 규칙).
 */

const CONCEPTS = [
  { key: 'meal', label: '식사' },
  { key: 'cafe', label: '카페' },
  { key: 'culture', label: '전시·문화' },
  { key: 'outdoor', label: '야외·산책' },
  { key: 'shopping', label: '쇼핑' },
] as const;

function renderScreen(overrides: Record<string, unknown> = {}) {
  const onPickConcept = jest.fn();
  const onSkip = jest.fn();
  render(
    <ConceptPickerScreen
      concepts={CONCEPTS}
      slotContextLabel="오후 일정 · △△ 미술관 다음"
      onPickConcept={onPickConcept}
      onSkip={onSkip}
      onBack={jest.fn()}
      {...overrides}
    />
  );
  return { onPickConcept, onSkip };
}

describe('🔴 ConceptPickerScreen (h13 · AC-2)', () => {
  it('C1 · 5개 컨셉 카드가 렌더된다', () => {
    renderScreen();

    // 준비/실행: 렌더. 단언: 5개 key 카드 모두 존재.
    expect(screen.getByTestId('itinerary-copick-concept-root')).toBeTruthy();
    for (const { key } of CONCEPTS) {
      expect(
        screen.getByTestId(`itinerary-copick-concept-${key}`)
      ).toBeTruthy();
    }
  });

  it('C2 · 컨셉 카드 탭 → 그 라벨이 onPickConcept 인자로 그대로 전달', () => {
    const { onPickConcept } = renderScreen();

    // 실행: "전시·문화" 카드 탭.
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));

    // 단언: 정확한 라벨 fidelity(라벨 = concept 문자열).
    expect(onPickConcept).toHaveBeenCalledWith('전시·문화');
    expect(onPickConcept).toHaveBeenCalledTimes(1);
  });

  it('C3 · "테마 없이 건너뛰기" 탭 → onSkip(컨셉 미전송 경로)', () => {
    const { onPickConcept, onSkip } = renderScreen();

    // 실행: 스킵 탭.
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));

    // 단언: 스킵은 컨셉이 아니다 — onSkip 만, onPickConcept 는 0회.
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onPickConcept).toHaveBeenCalledTimes(0);
  });
});

// TRIP-794 · 옛 ConceptPickerScreen.parity.test.tsx
describe('Figma 정합 표면', () => {
  /**
   * TRIP-794 · h09 컨셉 고르기 Figma 정합(3845:2227) — 프레젠테이션만 바뀐다(행위 계약 불변).
   *
   * 동결 앵커는 같은 파일의 최상위 C1~C3(행위)·「컨셉 아이콘 틴트」 describe(U2)가 지킨다 — **무변경**으로
   * green 유지가 계약(AC-8). 이 describe 는 새로 붙는 표면만 잠근다.
   *
   * 무엇을 보장하나:
   *  - 🔴 AC-1 진행줄(일차/날짜 좌 · `N번째 / M` 우 · 4분할 진행바) — props 로 받아 **Figma 그대로** 그린다
   *       (3번째/4인데 bar 1칸인 모순도 화면이 안 고침, 브리프 §B). TRIP-1043: 우측 작은 「슬롯」 캡션
   *       제거 — 진행줄 어디에도 「슬롯」이 없다(QA #041).
   *  - 🔴 AC-3 헤드라인('다음, 뭘 할까요?'+부제) 제거.
   *  - 🔴 AC-4 컨셉 설명 5종을 config 값으로 렌더(TRIP-1043 중립 문구).
   *  - 🔴 AC-5 배지(AI 추천/컨셉 매칭)·N곳 **렌더 0**(BE 계약 대기 — 픽스처 억지주입 금지).
   *  - 🔴 AC-6 (TRIP-1043 뒤집음) 다섯 카드 모두 같은 hairline 테두리 — 고르지 않았는데 고른 것처럼 보이던
   *       첫 카드 정적 강조를 없앤다(Figma F4).
   *  - 🔴 AC-7 건너뛰기 회색 full pill 한 줄('테마 없이 건너뛰기 · AI가 알아서 추천'), 점선 제거.
   *  - 🔴 AC-2 배선 stepperSlot(ReactNode) 를 그린다 — CoPickStepper 위젯 자체는 별 파일(층 경계상
   *       features 는 widgets 를 import 못 해 SlotFillPage 가 노드로 내린다).
   *  - AC-8 행위 보존 — 새 표면 공존 하에서도 카드 탭·스킵 콜백 그대로.
   *
   * *(개념)* `queryBy*`===null = 부재 단언(`getBy*`는 못 찾으면 throw 라 부정에 못 씀). `toHaveTextContent`
   *  문자열은 완전일치(RNTL v13 exact, 02a §5-1). `className` 색·테두리 토큰은 공백 쪼갠 정확 토큰으로 본다.
   */

  const CONCEPTS = [
    { key: 'meal', label: '식사' },
    { key: 'cafe', label: '카페·디저트' },
    { key: 'culture', label: '전시·문화' },
    { key: 'outdoor', label: '야외·산책' },
    { key: 'shopping', label: '쇼핑' },
  ] as const;

  // 설명 문구 — TRIP-1043 중립 문구(config `CONCEPT_DESCRIPTIONS` 와 값 일치, conceptCards.test G1 이 config 를 잠근다).
  const DESC: Record<string, string> = {
    meal: '근처 식당',
    cafe: '쉬어 가기',
    culture: '전시·박물관',
    outdoor: '공원·산책로',
    shopping: '상점·시장',
  };

  const PROGRESS = {
    dayLabel: '1일차 / 4 · 6월 10일(수)',
    slotCurrent: 3,
    slotTotal: 4,
    barFilled: 1, // Figma 모순: 슬롯 3/4 인데 bar 1칸 — 화면은 안 고침(브리프 §B).
    barTotal: 4,
  };

  function classSet(testID: string): Set<string> {
    const node = screen.getByTestId(testID);
    return new Set(String(node.props.className ?? '').split(/\s+/));
  }

  // 새 표면 prop 을 다 준 상태로 렌더한다(파리티 테스트의 기본형).
  function renderParity(overrides: Record<string, unknown> = {}): {
    onPickConcept: jest.Mock;
    onSkip: jest.Mock;
  } {
    const onPickConcept = jest.fn();
    const onSkip = jest.fn();
    render(
      <ConceptPickerScreen
        concepts={CONCEPTS}
        progress={PROGRESS}
        stepperSlot={<View testID="fake-stepper" />}
        onPickConcept={onPickConcept}
        onSkip={onSkip}
        onBack={jest.fn()}
        {...(overrides as Record<string, never>)}
      />
    );
    return { onPickConcept, onSkip };
  }

  describe('🔴 AC-1 · 진행줄 (일차/날짜 · N번째 / M · 4분할 바)', () => {
    it('progress prop 을 Figma 그대로 렌더한다(모순 포함, 화면은 안 고침)', () => {
      renderParity();

      // 진행줄 루트 + 좌 라벨(verbatim) + 우 슬롯 수.
      expect(
        screen.getByTestId('itinerary-copick-concept-progress')
      ).toBeTruthy();
      expect(
        screen.getByTestId('itinerary-copick-concept-progress-day')
      ).toHaveTextContent('1일차 / 4 · 6월 10일(수)');
      expect(
        screen.getByTestId('itinerary-copick-concept-progress-count')
      ).toHaveTextContent('3번째 / 4');

      // 4분할 진행바 — 채운 1칸 + 빈 3칸(색이 아니라 개수 계약).
      expect(
        screen.getAllByTestId('itinerary-copick-concept-progress-cell-filled')
      ).toHaveLength(1);
      expect(
        screen.getAllByTestId('itinerary-copick-concept-progress-cell-track')
      ).toHaveLength(3);
    });
  });

  describe('🔴 TRIP-1043 · 화면에 내부 용어 「슬롯」이 없다 (QA #041)', () => {
    it('진행줄·문맥 줄이 떠 있는 상태에서 「슬롯」을 품은 글자가 0개다', () => {
      renderParity({ slotContextLabel: '점심 일정 · 경복궁 다음' });

      // 긍정 짝 — 진행줄 카운트와 문맥 줄이 실제로 떠 있다(없어서 0개인 공허 통과 차단).
      expect(
        screen.getByTestId('itinerary-copick-concept-progress-count')
      ).toBeTruthy();
      expect(screen.getByText('점심 일정 · 경복궁 다음')).toBeTruthy();

      // 부정 — 우측 「슬롯」 캡션을 포함해 어떤 Text 에도 「슬롯」이 없다.
      expect(
        screen.queryAllByText(/슬롯/).map((node) => node.props.children)
      ).toEqual([]);
    });
  });

  describe('🔴 AC-3 · 헤드라인 제거', () => {
    it("'다음, 뭘 할까요?'·부제가 사라진다(카드는 남는다)", () => {
      renderParity();

      // 부정 — 헤드라인·부제 부재.
      expect(screen.queryByText('다음, 뭘 할까요?')).toBeNull();
      expect(
        screen.queryByText('여행 컨셉에 맞춰 추천 순서로 정렬했어요')
      ).toBeNull();

      // 긍정 짝 — 카드 5장은 여전히 있다(공허 통과 방지).
      for (const { key } of CONCEPTS) {
        expect(
          screen.getByTestId(`itinerary-copick-concept-${key}`)
        ).toBeTruthy();
      }
    });
  });

  describe('🔴 AC-4 · 컨셉 설명(config 값)', () => {
    it('5개 컨셉이 각자의 설명 문구를 렌더한다', () => {
      renderParity();

      for (const { key } of CONCEPTS) {
        expect(
          screen.getByTestId(`itinerary-copick-concept-desc-${key}`)
        ).toHaveTextContent(DESC[key]);
      }
    });
  });

  describe('🔴 AC-5 · 배지·N곳 렌더 0 (BE 대기, 억지주입 금지)', () => {
    it('AI 추천/컨셉 매칭 배지·N곳 문구가 하나도 없다(카드는 있다)', () => {
      renderParity();

      // 부정 — 배지·카운트 문구 0.
      expect(screen.queryByText('AI 추천')).toBeNull();
      expect(screen.queryByText('컨셉 매칭')).toBeNull();
      expect(screen.queryByText(/\d+\s*곳/)).toBeNull();

      // 긍정 짝 — 카드 자체는 렌더(부정이 "카드가 통째로 없어서" 참인 공허 통과 차단).
      expect(screen.getByTestId('itinerary-copick-concept-meal')).toBeTruthy();
    });
  });

  describe('🔴 AC-6 · 다섯 카드 모두 같은 hairline 테두리 (TRIP-1043 — 첫 카드 강조 제거)', () => {
    it('첫 카드(meal)를 포함해 어느 카드도 primary·1.5px 테두리가 아니고 모두 hairline 이다', () => {
      renderParity();

      const faces = CONCEPTS.map(({ key }) => {
        const classes = classSet(`itinerary-copick-concept-${key}`);
        return {
          key,
          primary: classes.has('border-primary'),
          thick: classes.has('border-[1.5px]'),
          hairline: classes.has('border-hairline'),
        };
      });
      expect(faces).toEqual(
        CONCEPTS.map(({ key }) => ({
          key,
          primary: false,
          thick: false,
          hairline: true,
        }))
      );
    });
  });

  describe('🔴 AC-7 · 건너뛰기 회색 full pill(한 줄)', () => {
    it('한 줄 문구 · 점선 제거 · testID 불변', () => {
      renderParity();

      // testID 불변(행위 계약).
      const skip = screen.getByTestId('itinerary-copick-concept-skip');
      expect(skip).toBeTruthy();

      // 한 줄 문구(구 2줄 SKIP_LABEL/SKIP_HINT → 한 Text 로 병합).
      expect(
        screen.getByText('테마 없이 건너뛰기 · AI가 알아서 추천')
      ).toBeTruthy();

      // 점선 테두리 제거(구 border-dashed) — 회색 채움 pill 로 교체(색 토큰은 6-b).
      expect(
        classSet('itinerary-copick-concept-skip').has('border-dashed')
      ).toBe(false);
    });
  });

  describe('🔴 AC-2 · stepperSlot 배선', () => {
    it('내려준 stepper 노드를 그린다(위젯 본체는 CoPickStepper.test.tsx)', () => {
      renderParity();
      expect(screen.getByTestId('fake-stepper')).toBeTruthy();
    });
  });

  describe('AC-8 · 행위 계약 보존(새 표면 공존)', () => {
    it('카드 탭 → onPickConcept(label) · 스킵 → onSkip', () => {
      const { onPickConcept, onSkip } = renderParity();

      fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));
      expect(onPickConcept).toHaveBeenCalledWith('전시·문화');

      fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));
      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });
});

// U2 소급 백필 · 옛 ConceptPickerScreen.icon.test.tsx
describe('컨셉 아이콘 틴트', () => {
  /**
   * U2 소급 백필(20260824) · h13 컨셉 카드 아이콘/틴트 매핑 회귀 심판.
   *
   * 무엇을 보장하나: 커밋 7cda1f5(발표용 domo, 사이클 없이 들어옴)가 첫 글자 텍스트 →
   * 카테고리 아이콘으로 바꾸며 `CONCEPT_VISUALS[key] ?? FALLBACK_VISUAL` 매핑을 새로 넣었는데
   * 심판이 0이었다. 여기서 잠그는 것은 "알려진 5키는 각자의 틴트로, 알려지지 않은 키는 폴백
   * 틴트(bg-surface-soft)로 그려진다"이다.
   *
   * (한계) 어느 **아이콘 글리프**가 그려지는지는 testID가 없어 jest 사각(SlotPhotoPlaceholder의
   * ICON_BY_KEY와 동형 — repo-traps). 관측 가능한 계약은 아이콘 컨테이너 View 의 틴트 className
   * 뿐이라 그것을 잠근다. 픽셀·아이콘 모양은 6-b 실기 전용.
   *
   * (개념) 아이콘 컨테이너엔 testID 가 없어 카드(testID `itinerary-copick-concept-{key}`)에서
   * `rounded-thumb` className 을 가진 자손 View 를 트리 탐색(`.findAll`)으로 찾아 그 틴트를 읽는다.
   */

  function baseProps(
    overrides: Partial<ConceptPickerScreenProps> = {}
  ): ConceptPickerScreenProps {
    return {
      concepts: [],
      onPickConcept: jest.fn(),
      onSkip: jest.fn(),
      onBack: jest.fn(),
      ...overrides,
    };
  }

  // 카드에서 아이콘 컨테이너(rounded-thumb + 틴트)를 찾아 className 을 돌려준다.
  function iconTint(key: string): string {
    const card = screen.getByTestId(`itinerary-copick-concept-${key}`);
    const box = card.findAll(
      (node) =>
        typeof node.props.className === 'string' &&
        node.props.className.includes('rounded-thumb')
    )[0];
    return String(box.props.className);
  }

  describe('U2-1 · 알려진 컨셉 키는 각자의 틴트로 그려진다', () => {
    const CASES: readonly [key: string, tint: string][] = [
      ['meal', 'bg-primary-pale'],
      ['cafe', 'bg-surface-strong'],
      ['culture', 'bg-info-bg'],
      ['outdoor', 'bg-success-bg'],
      ['shopping', 'bg-primary-pale'],
    ];

    it.each(CASES)('%s → %s', (key, tint) => {
      render(
        <ConceptPickerScreen
          {...baseProps({ concepts: [{ key, label: `라벨-${key}` }] })}
        />
      );
      expect(iconTint(key)).toContain(tint);
    });
  });

  describe('U2-2 · 알려지지 않은 키는 폴백 틴트로 접히고 크래시하지 않는다', () => {
    it('unknown → bg-surface-soft(폴백), 렌더는 throw 하지 않는다', () => {
      expect(() =>
        render(
          <ConceptPickerScreen
            {...baseProps({ concepts: [{ key: 'unknown', label: '미지' }] })}
          />
        )
      ).not.toThrow();

      // 폴백 틴트여야 하고, 알려진 키의 틴트가 섞여 들어오면 안 된다.
      const tint = iconTint('unknown');
      expect(tint).toContain('bg-surface-soft');
      expect(tint).not.toContain('bg-primary-pale');
    });
  });
});
