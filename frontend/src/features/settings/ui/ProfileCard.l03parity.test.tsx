import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ProfileCard } from './ProfileCard';
import { PencilGlyph } from './SettingsGlyphs';

/**
 * TRIP-775 · l03 프로필 카드 ↔ Figma 1602:2388 — 태그 줄 · [편집] 모양 · 카운트 세로 구분선.
 *
 * 무엇을 보장하나:
 *  - AC-1 `tags` 로 받은 문자열만 칩으로 그린다(서버가 `#` 를 붙여 주므로 그대로 — `##` 없음).
 *    안 받으면 태그 줄이 없다.
 *  - AC-2 [편집]은 아이콘 없이 "편집" 글자 하나다.
 *  - AC-3 카운트 3칸 사이에 세로 구분선 2개가 있다(예정 | 진행 중 | 종료).
 *
 * 모서리·그림자·Inter 숫자 같은 픽셀은 jest 가 못 본다 — [검증] 스크린샷 대조 몫.
 */

const BASE = {
  nickname: '여행자123',
  email: 'trippilot@email.com',
  counts: { upcoming: 2, active: 0, ended: 3 },
};

const DIVIDER = 'my-profile-count-divider';
const LABELS = ['예정', '진행 중', '종료'];

/** 카드 안 호스트 노드를 위→아래 순서로 훑어 라벨 글자와 구분선('|')만 뽑는다. */
function labelAndDividerOrder(card: ReactTestInstance): string[] {
  return card
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props.testID === DIVIDER ||
          ((node.type as string) === 'Text' &&
            LABELS.includes(node.props.children)))
    )
    .map((node) =>
      node.props.testID === DIVIDER ? '|' : String(node.props.children)
    );
}

describe('AC-1 · 프로필 태그 줄', () => {
  it('tags 3개를 받은 순서대로, 글자 그대로(# 하나) 칩으로 그린다', () => {
    // 준비·실행
    render(<ProfileCard {...BASE} tags={['#바다', '#미식', '#느긋']} />);

    // 단언: 카드 안 태그 칩 3개, 글자 완전 일치(## 로 두 번 붙이면 red).
    const card = screen.getByTestId('my-profile-card');
    const tags = within(card).getAllByTestId('my-profile-tag');
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent('#바다');
    expect(tags[1]).toHaveTextContent('#미식');
    expect(tags[2]).toHaveTextContent('#느긋');
  });

  it.each([
    ['미주입', undefined],
    ['빈 배열', [] as string[]],
  ])('tags %s → 태그 칩이 하나도 없다(카드는 그대로)', (_label, tags) => {
    render(<ProfileCard {...BASE} tags={tags} />);

    expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
    // 짝 앵커 — 카드가 안 그려져서 0인 것이 아니다.
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByText('여행자123')).toBeOnTheScreen();
  });
});

describe('AC-2 · [편집] 버튼 모양', () => {
  it('연필 아이콘 없이 "편집" 글자 하나만 있다', () => {
    render(<ProfileCard {...BASE} onPressEdit={jest.fn()} />);

    const edit = screen.getByTestId('my-profile-edit');
    expect(edit.findAllByType(PencilGlyph)).toHaveLength(0);
    // 완전 일치 — 버튼 안 글자 전체가 "편집"이다.
    expect(edit).toHaveTextContent('편집');
  });
});

describe('AC-3 · 카운트 세로 구분선', () => {
  it('세 칸 사이에 구분선이 하나씩, 모두 2개 있다(예정 | 진행 중 | 종료)', () => {
    render(<ProfileCard {...BASE} />);

    const card = screen.getByTestId('my-profile-card');
    expect(within(card).getAllByTestId(DIVIDER)).toHaveLength(2);
    expect(labelAndDividerOrder(card)).toEqual([
      '예정',
      '|',
      '진행 중',
      '|',
      '종료',
    ]);
  });
});
