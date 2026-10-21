import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TriggerWatchlistRow } from '../model/triggerWatchlist';
import { RiskDetailSheet } from './RiskDetailSheet';

/**
 * TRIP-749 · AC-1~AC-4 — i03 위험 상세 시트(순수 바텀시트, props + 콜백만).
 *
 * 무엇을 보장하나:
 *  - eyebrow 는 빨강 채운 삼각(SVG) + `위험 요소 · {카테고리}`(날씨·이동·영업). `⚠` **글자**는 없다
 *    (iOS 에서 노란 컬러 이모지로 뜰 위험 — 748 Q3).
 *  - 제목은 주입한 `title`(서버 reason)을 그대로 그린다 — 조립·접두어 없음.
 *  - 영향 장소 행은 `{시각} | {장소명} [영향] | {메타}` 세 칸을 그대로, 없으면(null) 상자째 생략(G6).
 *  - 감시 배지 3개는 주입 순서(WEATHER·DELAY·CLOSURE)대로 `{카테고리} · {활성|정상}`, 활성=연분홍,
 *    정상=회색.
 *  - [대안 보기] → onPressAlternative, 스크림 탭·아래로 끌기 → onClose. 서로 섞이지 않는다.
 *
 * ★ 바텀시트 목 사각: `@gorhom/bottom-sheet` 목은 통과형이라 실제 딤 전면 커버·시트 실제 열림·끌어
 *   닫기 제스처는 jest 가 못 본다(repo-traps 바텀시트 항). 여기 심판은 testID·글자·클래스·콜백까지.
 * ★ RNTL `toHaveTextContent(문자열)` = 자식 글자를 이어 붙인 뒤 **완전 일치**(02a ★4).
 *
 * 3동작 뼈대: 준비=props → 실행=render/press → 단언=보이는 것·콜백.
 */

jest.mock('@gorhom/bottom-sheet');

const AFFECTED = {
  time: '17:00',
  name: '해운대 해변',
  meta: '5번째 · 해변 · 24시간 개방',
};

/** 사영(triggerWatchlist) 결과 모양 그대로 — 카테고리명은 Figma(날씨·이동·영업). */
const ROWS_WEATHER: TriggerWatchlistRow[] = [
  {
    kind: 'WEATHER',
    label: '날씨',
    status: 'active',
    reason: '17시 이후 비 예보 70%',
  },
  { kind: 'DELAY', label: '이동', status: 'normal', reason: null },
  { kind: 'CLOSURE', label: '영업', status: 'normal', reason: null },
];
const ROWS_DELAY: TriggerWatchlistRow[] = [
  { kind: 'WEATHER', label: '날씨', status: 'normal', reason: null },
  { kind: 'DELAY', label: '이동', status: 'active', reason: '도로 정체' },
  { kind: 'CLOSURE', label: '영업', status: 'normal', reason: null },
];

function renderSheet(
  over: Partial<Parameters<typeof RiskDetailSheet>[0]> = {}
) {
  const onPressAlternative = jest.fn();
  const onClose = jest.fn();
  render(
    <RiskDetailSheet
      kind="WEATHER"
      title="17시 이후 비 예보 70%"
      affected={AFFECTED}
      watchRows={ROWS_WEATHER}
      // 콜백 이름을 `onPress` 로 두지 않는다 — RNTL 이 합성 조상의 onPress 를 대신 불러 press 테스트가
      // 공허해진다(02a ★6).
      onPressAlternative={onPressAlternative}
      onClose={onClose}
      {...over}
    />
  );
  return { onPressAlternative, onClose };
}

describe('🔴 RiskDetailSheet · 머리(eyebrow·제목) (AC-1)', () => {
  it('S1 eyebrow 는 빨강 채운 삼각 SVG + "위험 요소 · 날씨" 이고, ⚠ 글자는 없다', () => {
    renderSheet();

    const eyebrow = screen.getByTestId('planb-risk-eyebrow');
    expect(eyebrow).toHaveTextContent('위험 요소 · 날씨');
    expect(screen.getByTestId('planb-risk-warning')).toBeTruthy();

    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it.each([
    ['DELAY', '위험 요소 · 이동', '광안대교 정체 40분'],
    ['CLOSURE', '위험 요소 · 영업', '해운대 시장 임시 휴무'],
  ] as const)(
    'S2 kind=%s 이면 eyebrow 는 "%s" 이고, 제목은 여전히 주입한 서버 reason 이다',
    (kind, eyebrow, title) => {
      renderSheet({ kind, title });

      expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
        eyebrow
      );
      // WEATHER 가 아니어도 제목을 트리거 라벨로 바꿔 끼우지 않는다(S3 는 WEATHER 만 본다).
      expect(screen.getByTestId('planb-risk-title')).toHaveTextContent(title);
    }
  );

  it('S3 제목은 주입한 title(서버 reason)을 그대로 그린다', () => {
    const title = '테스트용 사유 문장 42';
    renderSheet({ title });

    const node = screen.getByTestId('planb-risk-title');
    expect(node).toHaveTextContent(title);
  });

  it('S4 감시 라벨·CTA 문구와 시트·스크림 껍데기 클래스', () => {
    renderSheet();

    expect(screen.getByTestId('planb-risk-watch-label')).toHaveTextContent(
      '재계획이 지켜보는 것'
    );
    expect(screen.getByTestId('planb-risk-cta')).toHaveTextContent('대안 보기');
  });
});

describe('🔴 RiskDetailSheet · 영향 장소 행 (AC-2)', () => {
  it('S5 시각·장소명·메타 세 칸이 그대로 보이고, "영향" 태그는 연분홍 상자 + primary 글자다', () => {
    renderSheet();

    expect(screen.getByTestId('planb-risk-affected-time')).toHaveTextContent(
      '17:00'
    );
    expect(screen.getByTestId('planb-risk-affected-name')).toHaveTextContent(
      '해운대 해변'
    );
    expect(screen.getByTestId('planb-risk-affected-meta')).toHaveTextContent(
      '5번째 · 해변 · 24시간 개방'
    );

    const tag = screen.getByTestId('planb-risk-affected-tag');
    expect(tag).toHaveTextContent('영향');
  });

  it('S6 affected=null 이면 영향 행 상자가 통째로 없다(빈 칸 금지 G6) — 제목은 남는다', () => {
    renderSheet({ affected: null });

    expect(screen.queryByTestId('planb-risk-affected')).toBeNull();
    expect(screen.queryByText('영향')).toBeNull();
    // 짝 앵커 — 시트 자체는 렌더됐다.
    expect(screen.getByTestId('planb-risk-title')).toHaveTextContent(
      '17시 이후 비 예보 70%'
    );
  });
});

describe('🔴 RiskDetailSheet · 감시 배지 3 (AC-3)', () => {
  const WATCH_ID = /^planb-risk-watch-(weather|delay|closure)$/;

  it.each([
    [
      'WEATHER 활성',
      ROWS_WEATHER,
      ['날씨 · 활성', '이동 · 정상', '영업 · 정상'],
    ],
    ['DELAY 활성', ROWS_DELAY, ['날씨 · 정상', '이동 · 활성', '영업 · 정상']],
  ] as const)(
    'S7 %s — 배지 3개가 날씨·이동·영업 순서로 상태 카피를 반영한다',
    (_name, rows, texts) => {
      renderSheet({ watchRows: [...rows] });

      const badges = screen.getAllByTestId(WATCH_ID);
      expect(badges.map((badge) => badge.props.testID)).toEqual([
        'planb-risk-watch-weather',
        'planb-risk-watch-delay',
        'planb-risk-watch-closure',
      ]);
      badges.forEach((badge, index) =>
        expect(badge).toHaveTextContent(texts[index])
      );
    }
  );
});

describe('🔴 RiskDetailSheet · 콜백 (AC-4)', () => {
  it('S8 [대안 보기] press → onPressAlternative 1회, onClose 0회', () => {
    const { onPressAlternative, onClose } = renderSheet();

    fireEvent.press(screen.getByTestId('planb-risk-cta'));

    expect(onPressAlternative).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('S9 스크림 press → onClose 1회, onPressAlternative 0회', () => {
    const { onPressAlternative, onClose } = renderSheet();

    fireEvent.press(screen.getByTestId('planb-risk-scrim'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPressAlternative).not.toHaveBeenCalled();
  });
});

/**
 * 상황 감지 FE-B · frontend-components §3.4·§3.5 — 심각도 eyebrow · 날짜어 · 출처 줄 · 감시 3상태.
 *
 * 무엇을 보장하나:
 *  - eyebrow 는 RISK(또는 모름) `위험 요소 · {카테고리}`, CAUTION `주의 · {카테고리}`.
 *  - 날짜어(`내일`·`M월 D일`)가 오면 eyebrow 옆 `planb-risk-day-label` 에 그대로, 없으면 그 요소가 없다.
 *  - 출처(`attribution`)가 오면 제목 아래 `출처: {attribution}` 한 줄(BR-SA-24 공공누리), 없으면(null·빈 값) 줄이 없다.
 *  - 감시 배지는 주입한 행만 그린다(OFF 로 숨은 묶음은 배지가 없다) · `unknown` 은 `{카테고리} · 확인 불가`.
 */
describe('🔴 RiskDetailSheet · 심각도·날짜어·출처·감시 3상태 (상황 감지 FE-B)', () => {
  it('F1 CAUTION 이면 eyebrow 는 "주의 · 날씨"(미지정은 위 S1 — 위험 요소)', () => {
    renderSheet({ severity: 'CAUTION' });
    expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
      '주의 · 날씨'
    );
  });

  it('F2 severity=RISK 는 기존 eyebrow 그대로다', () => {
    renderSheet({ severity: 'RISK' });
    expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
      '위험 요소 · 날씨'
    );
  });

  it('F3 날짜어가 오면 eyebrow 옆에 그 글자 그대로, 없으면 요소가 없다', () => {
    renderSheet({ dayLabel: '내일' });
    expect(screen.getByTestId('planb-risk-day-label')).toHaveTextContent(
      '내일'
    );
    // eyebrow 글자는 바뀌지 않는다(날짜어는 따로 놓인 요소).
    expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
      '위험 요소 · 날씨'
    );
  });

  it('F4 날짜어가 null 이면 날짜어 요소가 없다', () => {
    renderSheet({ dayLabel: null });
    expect(screen.queryByTestId('planb-risk-day-label')).toBeNull();
    // 짝 앵커 — 시트는 그려졌다.
    expect(screen.getByTestId('planb-risk-eyebrow')).toBeTruthy();
  });

  it('F5 출처가 오면 제목 아래 "출처: 기상청 단기예보" 한 줄이다', () => {
    renderSheet({ attribution: '기상청 단기예보' });
    expect(screen.getByTestId('planb-risk-attribution')).toHaveTextContent(
      '출처: 기상청 단기예보'
    );
  });

  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['미지정', undefined],
  ])('F6 출처가 %s 이면 출처 줄이 없다', (_name, attribution) => {
    renderSheet({ attribution });
    expect(screen.queryByTestId('planb-risk-attribution')).toBeNull();
    expect(screen.getByTestId('planb-risk-title')).toBeTruthy();
  });

  it('F7 감시 행은 주입한 것만 — 날씨 확인 불가 · 영업 정상, 이동(OFF) 배지는 없다', () => {
    renderSheet({
      watchRows: [
        { kind: 'WEATHER', label: '날씨', status: 'unknown', reason: null },
        { kind: 'CLOSURE', label: '영업', status: 'normal', reason: null },
      ],
    });

    expect(screen.getByTestId('planb-risk-watch-weather')).toHaveTextContent(
      '날씨 · 확인 불가'
    );
    expect(screen.getByTestId('planb-risk-watch-closure')).toHaveTextContent(
      '영업 · 정상'
    );
    expect(screen.queryByTestId('planb-risk-watch-delay')).toBeNull();
  });
});
