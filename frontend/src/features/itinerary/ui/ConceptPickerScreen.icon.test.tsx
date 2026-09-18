import { render, screen } from '@testing-library/react-native';

import {
  ConceptPickerScreen,
  type ConceptPickerScreenProps,
} from './ConceptPickerScreen';

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
