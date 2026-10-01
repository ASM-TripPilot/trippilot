import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import { LocationConsentScreen } from './LocationConsentScreen';

/**
 * TRIP-780 · l06 위치정보 동의 — 라이브 Figma(1609·1612:2440) 구조 정합.
 *
 * 무엇을 보장하나:
 *  - AC-3: 용도 3항목이 카드 **하나** 안에 있고, 행 사이에만 구분선이 2개 있다(첫 행 위·끝 행 아래 없음).
 *  - AC-4: permission-denied 는 블록을 반투명(opacity)으로 흐리지 않는다. 용도 카드는 흰 카드 그대로
 *    두고 글자 색만 muted 계열로 바꾸며, "계속 동작해요" 배너는 default 와 똑같다.
 *  - AC-2(렌더 앵커): 화면 토글이 공유 `shared/ui/Toggle` 로 그려진다(손잡이 testID `-thumb`).
 *
 * 철회 게이트·문안(AC-5)은 `LocationConsentScreen.test.tsx`(무수정)가 계속 잠근다.
 * 픽셀(r12·그림자·타일 22×40·분수 폰트·글리프 색)은 jest 사각 — [검증] 스크린샷·6-b 몫.
 */

const IMPACT = {
  stops: ['이동 지연 알림', '실시간 Plan-B 재계획', '현 위치 기반 추천'],
  continues: ['예정 일정 알림', '날씨·휴무 트리거'],
} as const;

const USAGE = [
  ['이동 지연 감지', '현재 위치로 일정 지연을 알아차려요'],
  ['실시간 Plan-B 재계획', '막히면 즉시 대안 동선을 제안해요'],
  ['주변 숙소·일정 추천', '지금 위치 기준으로 추천해요'],
] as const;

function renderScreen(face: 'default' | 'denied') {
  render(
    <LocationConsentScreen
      consentOn={face === 'default'}
      disabled={face === 'denied'}
      impact={IMPACT}
      onGrant={jest.fn()}
      onRevokeConfirmed={jest.fn()}
      onOpenSettings={jest.fn()}
    />
  );
}

/** className 을 공백으로 쪼갠 토큰 배열 — `text-muted` 가 `text-muted-soft` 에 부분 일치하는 것을 막는다. */
function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 노드 자신·자손·조상 어디든 opacity 로 흐린 흔적을 모은다.
 * className 의 `opacity-*` 토큰과 인라인 style 의 opacity < 1 을 둘 다 본다(우회 차단).
 */
function opacityHits(node: ReactTestInstance): string[] {
  const hits: string[] = [];
  const inspect = (n: ReactTestInstance) => {
    tokens(n)
      .filter((t) => t.startsWith('opacity-'))
      .forEach((t) => hits.push(t));
    const flat = StyleSheet.flatten(n.props.style) as
      { opacity?: number } | undefined;
    if (typeof flat?.opacity === 'number' && flat.opacity < 1) {
      hits.push(`style.opacity=${flat.opacity}`);
    }
  };
  node.findAll(() => true).forEach(inspect);
  for (let p = node.parent; p; p = p.parent) inspect(p);
  return hits;
}

/** 서브트리의 className 을 문서 순서대로 — 두 얼굴의 스타일이 같은지 비교하는 서명. */
function classSignature(node: ReactTestInstance): string[] {
  return node
    .findAll((n) => n.props.className !== undefined)
    .map((n) => String(n.props.className));
}

describe('탐지기 자가검사 — opacityHits 가 살아 있어야 AC-4 부정 단언이 의미를 갖는다', () => {
  it('조상 클래스·자손 클래스·자손 인라인 style 을 모두 잡는다', () => {
    render(
      <View className="opacity-40">
        <View testID="target">
          <Text className="opacity-60">x</Text>
          <Text style={{ opacity: 0.5 }}>y</Text>
        </View>
      </View>
    );

    expect(opacityHits(screen.getByTestId('target'))).toEqual(
      expect.arrayContaining(['opacity-40', 'opacity-60', 'style.opacity=0.5'])
    );
  });

  it('짝: opacity 가 없는 트리엔 빈 배열이다', () => {
    render(
      <View className="gap-sm">
        <View testID="clean">
          <Text className="text-muted">y</Text>
        </View>
      </View>
    );

    expect(opacityHits(screen.getByTestId('clean'))).toEqual([]);
  });
});

describe('TRIP-780 · AC-3 — 용도 카드 한 장 · 3행 · 행 사이 구분선 2개', () => {
  it('default 에서 카드 하나 안에 행·구분선이 [행, 선, 행, 선, 행] 순서로 있다', () => {
    renderScreen('default');

    expect(screen.getAllByTestId('settings-location-usage-card')).toHaveLength(
      1
    );
    const card = screen.getByTestId('settings-location-usage-card');

    // 순서가 곧 "첫 행 위·끝 행 아래에는 구분선이 없다"의 증거다.
    const order = within(card)
      .getAllByTestId(/^settings-location-usage-(row|divider)$/)
      .map((n) => n.props.testID);
    expect(order).toEqual([
      'settings-location-usage-row',
      'settings-location-usage-divider',
      'settings-location-usage-row',
      'settings-location-usage-divider',
      'settings-location-usage-row',
    ]);
  });

  it('각 행이 제목·설명 한 쌍을 순서대로 갖고, 구분선은 hairline 색이다', () => {
    renderScreen('default');

    const card = screen.getByTestId('settings-location-usage-card');
    const rows = within(card).getAllByTestId('settings-location-usage-row');
    USAGE.forEach(([title, desc], i) => {
      expect(within(rows[i]).getByText(title)).toBeOnTheScreen();
      expect(within(rows[i]).getByText(desc)).toBeOnTheScreen();
    });

    within(card)
      .getAllByTestId('settings-location-usage-divider')
      .forEach((divider) => expect(tokens(divider)).toContain('bg-hairline'));
  });
});

describe('TRIP-780 · AC-4 — denied 는 opacity 로 흐리지 않고 색만 바꾼다', () => {
  it('denied 에서 용도 섹션과 계속 배너의 자신·조상·자손 어디에도 opacity 가 없다', () => {
    renderScreen('denied');

    expect(
      opacityHits(screen.getByTestId('settings-location-usage-section'))
    ).toEqual([]);
    expect(
      opacityHits(screen.getByTestId('settings-location-continue-banner'))
    ).toEqual([]);
  });

  it('계속 배너의 스타일은 default 와 denied 에서 똑같다', () => {
    renderScreen('default');
    const defaultSig = classSignature(
      screen.getByTestId('settings-location-continue-banner')
    );
    screen.unmount();

    renderScreen('denied');
    const deniedSig = classSignature(
      screen.getByTestId('settings-location-continue-banner')
    );

    expect(defaultSig.length).toBeGreaterThan(0);
    expect(deniedSig).toEqual(defaultSig);
  });

  it('default: 라벨 muted · 제목 ink · 설명 muted, muted-soft 는 섹션에 없다', () => {
    renderScreen('default');

    expect(tokens(screen.getByText('이렇게 사용해요'))).toContain('text-muted');
    USAGE.forEach(([title, desc]) => {
      expect(tokens(screen.getByText(title))).toContain('text-ink');
      expect(tokens(screen.getByText(desc))).toContain('text-muted');
    });

    // 짝 — default 에는 흐린 톤이 붙지 않는다(denied 단언이 공짜로 통과하지 않게).
    const sectionTokens = screen
      .getByTestId('settings-location-usage-section')
      .findAll(() => true)
      .flatMap(tokens);
    expect(sectionTokens).not.toContain('text-muted-soft');
  });

  it('denied: 라벨 muted-soft · 제목 muted · 설명 muted-soft', () => {
    renderScreen('denied');

    const label = tokens(screen.getByText('이렇게 사용해요'));
    expect(label).toContain('text-muted-soft');
    expect(label).not.toContain('text-muted');

    USAGE.forEach(([title, desc]) => {
      const t = tokens(screen.getByText(title));
      expect(t).toContain('text-muted');
      expect(t).not.toContain('text-ink');

      const d = tokens(screen.getByText(desc));
      expect(d).toContain('text-muted-soft');
      expect(d).not.toContain('text-muted');
    });
  });
});

describe('TRIP-780 · AC-2 — 화면 토글이 공유 Toggle 로 그려진다', () => {
  it('default(동의 ON): 손잡이가 있고 트랙이 primary 다', () => {
    renderScreen('default');

    expect(
      screen.getByTestId('settings-location-toggle-thumb')
    ).toBeOnTheScreen();
    expect(tokens(screen.getByTestId('settings-location-toggle'))).toContain(
      'bg-primary'
    );
  });

  it('denied: 화면이 disabled 를 넘겨 트랙이 disabled 색(#ECECEC)이다', () => {
    renderScreen('denied');

    expect(
      screen.getByTestId('settings-location-toggle-thumb')
    ).toBeOnTheScreen();
    expect(tokens(screen.getByTestId('settings-location-toggle'))).toContain(
      'bg-[#ECECEC]'
    );
  });
});
