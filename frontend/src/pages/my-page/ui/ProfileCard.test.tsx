import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ProfileCard } from './ProfileCard';
import type { ReactTestInstance } from 'react-test-renderer';
import type { TripBucket } from '../model/tripBuckets';
import { PencilGlyph } from '@/features/settings/ui/SettingsGlyphs';

/**
 * l03 프로필 카드 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `ProfileCard{,.counts,.l03parity}.test.tsx` 3개를 각자의 바깥 describe 로 옮겼다.
 * 이름이 같고 값이 다른 픽스처(`BASE` — 닉네임·숫자가 다르다)는 describe 안에 갇혀 그대로다.
 * 옛 `.counts` 의 "ProfileCard.tsx raw hex 0건" 소스 스캔 it 은 지웠다(README 판정 3 — 회귀 감시).
 */

// TRIP-939
describe('[편집] 노출 조건 (옛 .test)', () => {
  /**
   * TRIP-939 B-3 — 마이 탭 프로필 카드의 [편집]은 목적지(`onPressEdit`)가 있을 때만 그린다(심사 2.1).
   *
   * 왜: `MyPage` 가 `onPressEdit` 을 주입하지 않아 [편집]이 눌러도 반응 없는 버튼이었다(role=button 까지
   * 달려 있었다). 프로필 편집 화면이 생기면 페이지가 콜백을 넘기는 순간 되살아난다(짝 테스트).
   *
   * 3동작 뼈대: 준비=props → 실행=render/press → 단언=[편집] 존재/부재·콜백 횟수.
   */

  const BASE = {
    nickname: '테스터',
    email: 'a@b.c',
    counts: { upcoming: 1, active: 0, ended: 2 },
  };

  describe('🔴 TRIP-939 B-3 · ProfileCard [편집]', () => {
    it('onPressEdit 미주입 → [편집]이 없다(카드는 그대로)', () => {
      // 준비·실행
      render(<ProfileCard {...BASE} />);

      // 단언: [편집] 부재 + 짝 앵커(카드·닉네임).
      expect(screen.queryByTestId('my-profile-edit')).toBeNull();
      expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
      expect(screen.getByText('테스터')).toBeOnTheScreen();
    });

    it('onPressEdit 주입 → [편집]이 있고 press 시 1회(짝)', () => {
      const onPressEdit = jest.fn();
      render(<ProfileCard {...BASE} onPressEdit={onPressEdit} />);

      fireEvent.press(screen.getByTestId('my-profile-edit'));

      expect(onPressEdit).toHaveBeenCalledTimes(1);
    });
  });
});

// TRIP-1123
describe('숫자 3칸 (옛 .counts)', () => {
  /**
   * TRIP-1123 · l03 프로필 카드 숫자 3칸(Figma 4755:2930 · 숫자 행 4755:2954) — 누를 수 있는 칸 · 회색 › · 모름 표시.
   *
   * 무엇을 보장하나:
   *  - AC-6(칸 단위) `onPressCount` 를 받으면 세 칸(`my-profile-count-{upcoming|active|ended}`)이 버튼이 되고,
   *    누른 칸의 이름이 콜백에 정확히 1회 넘어간다. 안 받으면 버튼도 › 도 없다(누를 곳 없는 어포던스 0, TRIP-939).
   *  - AC-5(표시) `counts` 가 null(모름)이면 세 칸 숫자 자리가 모두 `–`(U+2013)이고 회색(`text-muted-soft`)이다.
   *    0 을 보여 주지 않는다 — 0 도 "안다"는 주장이다(INV-4).
   *  - AC-11(구조) › 는 라벨과 **따로 된** Text 다(`font-noto text-body text-muted-soft`), 라벨과 한 줄
   *    (`flex-row items-center gap-xs`)에 있다. 칸에 `hitSlop` 이 있어 세로 42 → 44 이상을 채운다.
   *
   * 픽셀(› 1.55px 끌어올림 QA L1, 라벨 좌편향 L3)과 hitSlop 의 실제 터치 효과는 jest 가 못 본다 — [검증]·6-b 몫.
   *
   * *(개념 — hitSlop)* 눈에 보이는 크기는 그대로 두고, 손가락이 닿는 범위만 넓히는 RN prop.
   * 3동작: 준비(props) → 실행(render·press) → 단언.
   */

  const BUCKETS: readonly TripBucket[] = ['upcoming', 'active', 'ended'];
  const LABEL: Record<TripBucket, string> = {
    upcoming: '예정',
    active: '진행 중',
    ended: '종료',
  };
  const EN_DASH = '–';

  const BASE = {
    nickname: '여행자123',
    email: 'trippilot@email.com',
    counts: { upcoming: 2, active: 0, ended: 3 },
  };

  function tokens(node: ReactTestInstance): string[] {
    const cls = node.props.className;
    return typeof cls === 'string' ? cls.split(/\s+/) : [];
  }

  /** host Text 에서 위로 올라가 처음 만나는 **host View**(합성 Text 는 건너뛴다 — 5 실검증). */
  function hostViewAbove(node: ReactTestInstance): ReactTestInstance | null {
    let cur = node.parent;
    while (cur && !((cur.type as string) === 'View')) {
      cur = cur.parent;
    }
    return cur;
  }

  /** 칸 안 host Text 중 글자가 정확히 `text` 인 것들. */
  function hostTexts(
    cell: ReactTestInstance,
    text: string
  ): ReactTestInstance[] {
    return cell.findAll(
      (n) => (n.type as string) === 'Text' && n.props.children === text
    );
  }

  /** hitSlop(숫자 또는 {top,bottom,…})의 세로 합. */
  function verticalSlop(hitSlop: unknown): number {
    if (typeof hitSlop === 'number') return hitSlop * 2;
    if (hitSlop && typeof hitSlop === 'object') {
      const { top = 0, bottom = 0 } = hitSlop as {
        top?: number;
        bottom?: number;
      };
      return top + bottom;
    }
    return 0;
  }

  describe('🔴 AC-6 · 숫자 칸 누름 (onPressCount)', () => {
    it.each(BUCKETS)(
      '%s 칸은 버튼이고, 누르면 그 칸 이름으로 콜백이 정확히 1회 불린다',
      (bucket) => {
        // 준비
        const onPressCount = jest.fn();
        render(<ProfileCard {...BASE} onPressCount={onPressCount} />);
        const cell = screen.getByTestId(`my-profile-count-${bucket}`);

        // 단언(모양) — 버튼 역할.
        expect(cell.props.accessibilityRole).toBe('button');

        // 실행
        fireEvent.press(cell);

        // 단언(동작) — 딱 그 칸 하나.
        expect(onPressCount).toHaveBeenCalledTimes(1);
        expect(onPressCount).toHaveBeenCalledWith(bucket);
      }
    );

    it('0 인 칸도 누를 수 있다(목적지가 탭이라 숫자와 상관없다 — 열린 질문 3 권고)', () => {
      const onPressCount = jest.fn();
      render(<ProfileCard {...BASE} onPressCount={onPressCount} />);

      // BASE 의 진행 중 = 0.
      fireEvent.press(screen.getByTestId('my-profile-count-active'));

      expect(onPressCount).toHaveBeenCalledWith('active');
    });

    it('onPressCount 가 없으면 세 칸 모두 버튼이 아니고 › 도 없다(누를 곳 없는 어포던스 0)', () => {
      render(<ProfileCard {...BASE} />);

      BUCKETS.forEach((bucket) => {
        const cell = screen.getByTestId(`my-profile-count-${bucket}`);
        expect(cell.props.accessibilityRole).not.toBe('button');
        expect(hostTexts(cell, '›')).toHaveLength(0);
        // 짝 앵커 — 라벨은 그대로 있다(칸째 사라져 공짜 통과하는 것을 막는다).
        expect(hostTexts(cell, LABEL[bucket])).toHaveLength(1);
      });
    });
  });

  describe('🔴 AC-5 · 숫자 표시 — 앎(숫자) / 모름(–)', () => {
    it('counts 가 있으면 숫자 자리는 그 수이고 진한 글자(text-ink)다', () => {
      render(<ProfileCard {...BASE} />);

      (
        [
          ['upcoming', '2'],
          ['active', '0'],
          ['ended', '3'],
        ] as const
      ).forEach(([bucket, value]) => {
        const node = screen.getByTestId(`my-profile-count-${bucket}-value`);
        expect(node).toHaveTextContent(value);
        expect(tokens(node)).toContain('text-ink');
      });
    });

    it('counts 가 null 이면 세 칸 모두 – (U+2013) 이고, 숫자와 같은 크기의 회색이다', () => {
      // 준비·실행
      render(<ProfileCard {...BASE} counts={null} onPressCount={jest.fn()} />);

      BUCKETS.forEach((bucket) => {
        const node = screen.getByTestId(`my-profile-count-${bucket}-value`);
        // 단언 — 완전 일치(하이픈 '-'·'0' 이면 red).
        expect(node).toHaveTextContent(EN_DASH);
        const cls = tokens(node);
        expect(cls).toContain('text-muted-soft');
        expect(cls).not.toContain('text-ink');
        expect(cls).toContain('font-inter-bold');
        expect(cls).toContain('text-[20px]');
      });
      // 숫자 글자는 카드 어디에도 없다(0 을 몰래 그리지 않는다).
      const digits = screen
        .getByTestId('my-profile-card')
        .findAll(
          (n) =>
            (n.type as string) === 'Text' &&
            /^\d+$/.test(String(n.props.children))
        );
      expect(digits).toHaveLength(0);
    });

    it('모름이어도 라벨·›·누름은 그대로다', () => {
      const onPressCount = jest.fn();
      render(
        <ProfileCard {...BASE} counts={null} onPressCount={onPressCount} />
      );

      const cell = screen.getByTestId('my-profile-count-ended');
      expect(hostTexts(cell, '종료')).toHaveLength(1);
      expect(hostTexts(cell, '›')).toHaveLength(1);

      fireEvent.press(cell);
      expect(onPressCount).toHaveBeenCalledWith('ended');
    });
  });

  describe('🔴 AC-11 · 구조 — › 는 라벨과 따로, 한 줄에, 회색 body', () => {
    it.each(BUCKETS)(
      '%s 칸: 라벨 Text 와 › Text 가 따로 있고 같은 가로줄에 있다',
      (bucket) => {
        render(<ProfileCard {...BASE} onPressCount={jest.fn()} />);
        const cell = screen.getByTestId(`my-profile-count-${bucket}`);

        // 라벨은 글자 그대로 한 Text(› 를 붙이면 '예정 ›' 이 되어 0개).
        const labels = hostTexts(cell, LABEL[bucket]);
        const chevrons = hostTexts(cell, '›');
        expect(labels).toHaveLength(1);
        expect(chevrons).toHaveLength(1);

        // › 모양 — 토큰 배열 원소 완전 일치(부분 문자열 오탐 차단, 1121 ★5).
        const chevronCls = tokens(chevrons[0]);
        expect(chevronCls).toEqual(
          expect.arrayContaining(['font-noto', 'text-body', 'text-muted-soft'])
        );

        // 같은 줄 — 라벨과 › 의 가장 가까운 host View 가 같고, 그 줄이 가로·가운데·gap 4.
        const row = hostViewAbove(chevrons[0]);
        expect(row).not.toBeNull();
        expect(hostViewAbove(labels[0])).toBe(row);
        expect(tokens(row as ReactTestInstance)).toEqual(
          expect.arrayContaining(['flex-row', 'items-center', 'gap-xs'])
        );
      }
    );

    it('세 칸 모두 hitSlop 세로 합이 2 이상이다(셀 42 → 44, Figma QA L2)', () => {
      render(<ProfileCard {...BASE} onPressCount={jest.fn()} />);

      BUCKETS.forEach((bucket) => {
        const cell = screen.getByTestId(`my-profile-count-${bucket}`);
        expect(verticalSlop(cell.props.hitSlop)).toBeGreaterThanOrEqual(2);
      });
    });
  });
});

// TRIP-775
describe('Figma 정합 (옛 .l03parity)', () => {
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
});
