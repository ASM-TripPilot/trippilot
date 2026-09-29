import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { TripBucket } from '../model/tripBuckets';
import { ProfileCard } from './ProfileCard';

/**
 * TRIP-1123 · l03 프로필 카드 숫자 3칸(Figma 4755:2930 · 숫자 행 4755:2954) — 누를 수 있는 칸 · 회색 › · 모름 표시.
 *
 * 무엇을 보장하나:
 *  - AC-6(칸 단위) `onPressCount` 를 받으면 세 칸(`my-profile-count-{upcoming|active|ended}`)이 버튼이 되고,
 *    누른 칸의 이름이 콜백에 정확히 1회 넘어간다. 안 받으면 버튼도 › 도 없다(누를 곳 없는 어포던스 0, TRIP-939).
 *  - AC-5(표시) `counts` 가 null(모름)이면 세 칸 숫자 자리가 모두 `–`(U+2013)이고 회색(`text-muted-soft`)이다.
 *    0 을 보여 주지 않는다 — 0 도 "안다"는 주장이다(INV-4).
 *  - AC-11(구조) › 는 라벨과 **따로 된** Text 다(`font-noto text-body text-muted-soft`), 라벨과 한 줄
 *    (`flex-row items-center gap-xs`)에 있다. 칸에 `hitSlop` 이 있어 세로 42 → 44 이상을 채운다. raw hex 0.
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
function hostTexts(cell: ReactTestInstance, text: string): ReactTestInstance[] {
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
    render(<ProfileCard {...BASE} counts={null} onPressCount={onPressCount} />);

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

  it('ProfileCard.tsx 에 raw hex 색이 0건이다(주석 제외)', () => {
    const raw = fs.readFileSync(
      path.resolve('src/features/settings/ui/ProfileCard.tsx'),
      'utf8'
    );
    // 블록 주석 → 줄 주석(콜론 예외) 순서로 걷는다(리포 관례).
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // 조합 자가검사 — 코드 속 hex 는 살아남고, 주석 속 hex 는 걷힌다(5 실검증).
    const probe = "/* #9aa1ab */\n// #222\nconst c = '#6a6a6a';";
    const probeCode = probe
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(probeCode.match(/#[0-9a-fA-F]{3,8}\b/g)).toEqual(['#6a6a6a']);

    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    // 짝 앵커 — 실제 소스를 읽었다.
    expect(code).toContain('export function ProfileCard');
  });
});
