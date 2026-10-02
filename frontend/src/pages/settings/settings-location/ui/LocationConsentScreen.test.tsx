import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { LocationConsentScreen } from './LocationConsentScreen';
import type { ReactTestInstance } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

/**
 * l06 위치정보 동의 화면 단위 테스트(철회 게이트 UI · Figma 구조).
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `LocationConsentScreen{,.l06parity}.test.tsx` 2개를 각자의 바깥 describe 로 옮겼다.
 */

// TRIP-609
describe('토글·철회 게이트 (옛 .test)', () => {
  /**
   * TRIP-609 · l06 위치정보 동의 화면(프레젠테이션 + 철회 게이트 UI 로직).
   *
   * 무엇을 보장하나:
   *  - AC-6: default 에 용도 3항목(이동 지연 감지·실시간 Plan-B 재계획·주변 숙소·일정 추천)이 뜬다.
   *  - AC-7: "동의를 꺼도 계속 동작해요" 배너가 계속 2항목(예정 일정 알림·날씨/휴무 트리거)을 보인다.
   *  - AC-9: OS 권한 DENIED 면 토글이 **real disabled**(눌러도 안 먹음), 부제 "OS 권한 거부로 사용
   *    불가"(침묵 금지) + [설정 이동] 배너가 뜬다. 짝: 허용이면 비활성·denied 배너가 없다.
   *  - AC-1(UI 절반) + AC-8: 동의 ON 에서 토글을 끄면 **즉시 콜백을 안 부르고** 철회 다이얼로그가 먼저
   *    뜬다(중단3·계속2 문안). [동의 철회] 뒤에만 onRevokeConfirmed. 취소하면 콜백 미발화.
   *  - 승낙 경로: 동의 OFF 에서 토글을 켜면 다이얼로그 없이 곧장 onGrant.
   *
   * 왜 화면 층인가: 게이트의 **UI 로직**(토글 press → 다이얼로그냐 승낙이냐, 확정 콜백은 언제)은
   * 프레젠테이션의 성질이라 콜백 jest.fn() 만으로 잰다. 실제 서버 mutate 시퀀스·payload 는 배선이라
   * `LocationConsentPage.test.tsx` 가 잠근다(02a §4 T4).
   *
   * ⚠️ jest 사각(6-b 실기 전용): 다이얼로그 딤이 화면을 실제로 덮나·모달이 실제로 열리나 —
   *    608·바텀시트와 동형으로 원리적 사각이다. 여기선 조건부 렌더의 testID 존재/부재 + 콜백 발화로만
   *    잠근다(repo-traps). permission-denied 전체 dimmed 픽셀·글리프 SVG 도 6-b.
   *
   * (개념) 매처 — `getByText('완전문자열')` 완전일치 / `within(node)` 로 스코프해 같은 문자열이 트리에
   *  여러 번 있어도(예: '실시간 Plan-B 재계획' 은 용도항목이자 다이얼로그 중단항목) 다중 매치 throw 를
   *  피한다 / `toBeDisabled()` 는 real `disabled` prop 을 본다(02a §5-A·§5-B).
   */

  /** revokeImpact() 가 공급할 문안과 동형(화면은 impact prop 만 소비 — 순수함수 결합 없음). */
  const IMPACT = {
    stops: ['이동 지연 알림', '실시간 Plan-B 재계획', '현 위치 기반 추천'],
    continues: ['예정 일정 알림', '날씨·휴무 트리거'],
  } as const;

  function renderScreen(
    overrides: Partial<React.ComponentProps<typeof LocationConsentScreen>> = {}
  ) {
    const props = {
      consentOn: true,
      disabled: false,
      impact: IMPACT,
      onGrant: jest.fn(),
      onRevokeConfirmed: jest.fn(),
      onOpenSettings: jest.fn(),
      ...overrides,
    };
    render(<LocationConsentScreen {...props} />);
    return props;
  }

  describe('TRIP-609 · LocationConsentScreen — 용도·배너(AC-6 · AC-7)', () => {
    it('AC-6: default 에 용도 3항목과 ON 부제를 보인다', () => {
      renderScreen({ consentOn: true, disabled: false });

      expect(screen.getByText('이동 지연 감지')).toBeOnTheScreen();
      expect(screen.getByText('실시간 Plan-B 재계획')).toBeOnTheScreen();
      expect(screen.getByText('주변 숙소·일정 추천')).toBeOnTheScreen();
      // 부제(완전일치): 동의 ON 상태.
      expect(screen.getByText('동의함 · 정확한 위치 사용')).toBeOnTheScreen();
    });

    it('AC-7: "꺼도 계속 동작해요" 배너가 계속 2항목을 보인다', () => {
      renderScreen();

      const banner = screen.getByTestId('settings-location-continue-banner');
      // 배너 스코프 안에서 — 같은 문자열이 (다이얼로그 열릴 때) 다른 곳에도 있으므로 within 으로 좁힌다.
      expect(within(banner).getByText('예정 일정 알림')).toBeOnTheScreen();
      expect(within(banner).getByText('날씨·휴무 트리거')).toBeOnTheScreen();
    });
  });

  describe('TRIP-609 · LocationConsentScreen — permission-denied(AC-9)', () => {
    it('DENIED 면 토글 real disabled + "사용 불가" 부제 + [설정 이동] 배너, 이동 시 onOpenSettings', () => {
      const props = renderScreen({ disabled: true, consentOn: false });

      // 급소: accessibilityState 만이 아니라 real disabled — press 실차단은 아래 짝(Page)에서 확인.
      expect(screen.getByTestId('settings-location-toggle')).toBeDisabled();
      // 부제(완전일치): 왜 못 쓰는지 명시(INV-4 침묵 금지).
      expect(screen.getByText('OS 권한 거부로 사용 불가')).toBeOnTheScreen();
      expect(
        screen.getByTestId('settings-location-denied-banner')
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('settings-location-open-settings'));
      expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('짝: 허용이면 토글이 비활성이 아니고 denied 배너가 없다', () => {
      renderScreen({ disabled: false, consentOn: true });

      expect(screen.getByTestId('settings-location-toggle')).not.toBeDisabled();
      expect(
        screen.queryByTestId('settings-location-denied-banner')
      ).toBeNull();
    });
  });

  describe('TRIP-609 · LocationConsentScreen — 철회 게이트 UI + 문안(AC-1 UI · AC-8)', () => {
    it('동의 ON 에서 토글을 끄면 즉시 콜백 없이 다이얼로그가 먼저 뜨고 중단3·계속2 를 고지한다', () => {
      const props = renderScreen({ consentOn: true, disabled: false });

      // 준비 확인: 초기엔 다이얼로그가 없다.
      expect(
        screen.queryByTestId('settings-location-revoke-confirm')
      ).toBeNull();

      // 실행: 토글 끄기(ON→OFF 시도).
      fireEvent.press(screen.getByTestId('settings-location-toggle'));

      // 급소: 즉시 철회 콜백이 나가지 않는다(다이얼로그 없이 PUT 금지의 UI 절반).
      expect(props.onRevokeConfirmed).not.toHaveBeenCalled();
      expect(props.onGrant).not.toHaveBeenCalled();

      // 단언: 다이얼로그가 뜨고, 중단3·계속2 를 구조화 리스트로 고지한다(Q1 확정).
      const dialog = screen.getByTestId('settings-location-revoke-confirm');
      expect(within(dialog).getByText('이동 지연 알림')).toBeOnTheScreen();
      expect(
        within(dialog).getByText('실시간 Plan-B 재계획')
      ).toBeOnTheScreen();
      expect(within(dialog).getByText('현 위치 기반 추천')).toBeOnTheScreen();
      expect(within(dialog).getByText('예정 일정 알림')).toBeOnTheScreen();
      expect(within(dialog).getByText('날씨·휴무 트리거')).toBeOnTheScreen();
    });

    it('[동의 철회] 를 눌러야 onRevokeConfirmed 가 정확히 1회 나간다', () => {
      const props = renderScreen({ consentOn: true, disabled: false });

      fireEvent.press(screen.getByTestId('settings-location-toggle'));
      fireEvent.press(
        screen.getByTestId('settings-location-revoke-confirm-button')
      );

      expect(props.onRevokeConfirmed).toHaveBeenCalledTimes(1);
    });

    it('짝: 다이얼로그에서 취소하면 철회 콜백 없이 다이얼로그만 닫힌다', () => {
      const props = renderScreen({ consentOn: true, disabled: false });

      fireEvent.press(screen.getByTestId('settings-location-toggle'));
      fireEvent.press(screen.getByTestId('settings-location-revoke-cancel'));

      expect(props.onRevokeConfirmed).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId('settings-location-revoke-confirm')
      ).toBeNull();
    });
  });

  describe('TRIP-609 · LocationConsentScreen — 승낙 경로(게이트 없음)', () => {
    it('동의 OFF 에서 토글을 켜면 다이얼로그 없이 곧장 onGrant 를 1회 부른다', () => {
      const props = renderScreen({ consentOn: false, disabled: false });

      fireEvent.press(screen.getByTestId('settings-location-toggle'));

      // 승낙엔 재확인 게이트가 없다(철회만 법적 재확인 대상).
      expect(props.onGrant).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId('settings-location-revoke-confirm')
      ).toBeNull();
    });
  });

  describe('🔴 TRIP-991 · 위치정보 스위치 이름 (AC-3)', () => {
    it('토글은 "위치정보 수집" 스위치로 읽히고, 켜짐은 이름이 아니라 checked 상태로 전달된다', () => {
      renderScreen({ consentOn: true });

      const toggle = screen.getByRole('switch', { name: '위치정보 수집' });
      expect(toggle).toHaveProp('testID', 'settings-location-toggle');
      expect(toggle).toBeChecked();
    });
  });
});

// TRIP-780
describe('Figma 구조 (옛 .l06parity)', () => {
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
        expect.arrayContaining([
          'opacity-40',
          'opacity-60',
          'style.opacity=0.5',
        ])
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

      expect(
        screen.getAllByTestId('settings-location-usage-card')
      ).toHaveLength(1);
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

      expect(tokens(screen.getByText('이렇게 사용해요'))).toContain(
        'text-muted'
      );
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
});
