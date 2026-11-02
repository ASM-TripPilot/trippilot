import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ProfileCard } from './ProfileCard';
import type { ReactTestInstance } from 'react-test-renderer';
import type { TripBucket } from '../model/tripBuckets';

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
   *  - AC-5(표시) `counts` 가 null(모름)이면 세 칸 숫자 자리가 모두 `–`(U+2013)이다.
   *    0 을 보여 주지 않는다 — 0 도 "안다"는 주장이다(INV-4).
   *  - AC-11 › 는 라벨과 **따로 된** Text 다(색·한 줄 배치·hitSlop 은 TRIP-1367 로 지웠다 — 실화면 몫).
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

  /** 칸 안 host Text 중 글자가 정확히 `text` 인 것들. */
  function hostTexts(
    cell: ReactTestInstance,
    text: string
  ): ReactTestInstance[] {
    return cell.findAll(
      (n) => (n.type as string) === 'Text' && n.props.children === text
    );
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
    it('counts 가 있으면 숫자 자리는 그 수다', () => {
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
      });
    });

    it('counts 가 null 이면 세 칸 모두 – (U+2013) 이다', () => {
      // 준비·실행
      render(<ProfileCard {...BASE} counts={null} onPressCount={jest.fn()} />);

      BUCKETS.forEach((bucket) => {
        const node = screen.getByTestId(`my-profile-count-${bucket}-value`);
        // 단언 — 완전 일치(하이픈 '-'·'0' 이면 red).
        expect(node).toHaveTextContent(EN_DASH);
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
});

// TRIP-775
describe('Figma 정합 (옛 .l03parity)', () => {
  /**
   * TRIP-775 · l03 프로필 카드 ↔ Figma 1602:2388 — 태그 줄 · [편집] 모양 · 카운트 세로 구분선.
   *
   * 무엇을 보장하나:
   *  - AC-1 `tags` 로 받은 문자열만 칩으로 그린다(서버가 `#` 를 붙여 주므로 그대로 — `##` 없음).
   *    안 받으면 태그 줄이 없다.
   *  (AC-3 카운트 세로 구분선 수·순서는 TRIP-1367 로 지웠다 — 실화면 몫.)
   *
   * 모서리·그림자·Inter 숫자 같은 픽셀은 jest 가 못 본다 — [검증] 스크린샷 대조 몫.
   */

  const BASE = {
    nickname: '여행자123',
    email: 'trippilot@email.com',
    counts: { upcoming: 2, active: 0, ended: 3 },
  };

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
});
