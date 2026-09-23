import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * TRIP-746 · AC-7 — i01 허브 프리뷰 3키(`live-hub-closed`·`-half`·`-expanded`)가 Figma 4251:2448 ·
 * 4251:2640 · 4125:3957 의 **같은 5곳 픽스처**를 스냅 index 0/1/2 로만 달리해 그린다.
 *
 * 무엇을 보장하나:
 *  - 세 키 모두 허브 루트·헤더 한 줄·카드 5장·사진 4장·후기 2개·진행/예정 문구가 같다(Figma 세 프레임은
 *    시트 내용 텍스트가 동일하고 스냅만 다르다 — 브리프 골격 표).
 *  - 시트가 받는 초기 index 가 키마다 0·1·2 다(실제 스냅 모양은 AC-V1 육안 · 6-b).
 *  - 옛 `live-itinerary` 키는 없어진다. TRIP-748: `live-itinerary-trigger` 도 없어지고 i02 3키
 *    (`live-trigger-weather`·`-delay`·`-closure`)가 선다 — 펼침 5곳 위 지도 알약 + 해운대 배지.
 *  - 프리뷰는 네트워크 계층을 로드하지 않는다(허브 뷰 api-free — 02a ★12).
 *  - TRIP-747: `live-hub-edit-pills`(Figma 4055:2427 — 펼침 5곳 + 알약 2개가 처음부터 열림, FAB ×)와
 *    `live-hub-no-records`(Figma 4076:2452 — done 2장이 사진·후기 없이 이름 + "09:30 방문"만)가 band i
 *    키로 선다.
 *
 * 3동작: 준비(딥링크 state=키) → 실행(DevPreview 렌더) → 단언(허브 트리·문구·시트 index).
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목(__mocks__/@gorhom/bottom-sheet.tsx) — 동결 devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '허브 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
const { PREVIEW_STATES } = require('@/app/_dev/preview') as {
  PREVIEW_STATES: { key: string }[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  delete mockSearchParams.state;
});

const CARD_ROOT = /^execution-live-slot-2026-06-11#[^#]+$/;

function sheetIndices(): number[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => node.props.index as number);
}

describe('🔴 TRIP-746 · i01 허브 프리뷰 3키 (AC-7)', () => {
  it.each([
    ['live-hub-closed', 0],
    ['live-hub-half', 1],
    ['live-hub-expanded', 2],
  ])('%s 는 Figma 5곳 허브를 시트 index %i 로 그린다', (key, snap) => {
    mockSearchParams.state = key;

    render(<DevPreview />);

    expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-live-sheet-header')).toHaveTextContent(
      '부산 여행 · 2일차 · 6월 11일(목) · 5곳'
    );
    // 카드 5장 — Figma 5곳 이름 그대로.
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    [
      '감천문화마을',
      '광안리 해변',
      '부산시립미술관',
      '전포 카페거리',
      '해운대 해변',
    ].forEach((name) => expect(screen.getByText(name)).toBeOnTheScreen());
    // done 2장 × 사진 2 = 4, 후기 2(원문 완전 일치).
    expect(
      screen.getAllByTestId(/^execution-live-slot-photo-\d+-/)
    ).toHaveLength(4);
    expect(
      screen.getByText('골목마다 알록달록한 벽화. 전망대에서 인증샷 남겼다.')
    ).toBeOnTheScreen();
    expect(
      screen.getByText('바람이 좋았다. 백사장 산책하고 커피 한 잔 마셨다.')
    ).toBeOnTheScreen();
    // 진행·예정 상태줄.
    expect(screen.getByText('13:00 도착 · 지금 관람 중')).toBeOnTheScreen();
    expect(
      screen.getByText('15:00 도착 예정 · 11:00–22:00 영업')
    ).toBeOnTheScreen();
    expect(screen.getByText('17:00 도착 예정 · 24시간 개방')).toBeOnTheScreen();
    // 일자 칩 3개, 2일차 선택.
    expect(screen.getByTestId('execution-live-daychip-1')).toBeSelected();
    expect(screen.getByTestId('execution-live-daychip-2')).toBeOnTheScreen();
    // 시트 초기 스냅.
    const indices = sheetIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(snap));
  });
});

describe('🔴 TRIP-746·748 · 옛 키 정리 (AC-7 · 748 AC-10)', () => {
  it('live-itinerary·live-itinerary-trigger 키는 없고, 허브 3키와 i02 3키가 있다', () => {
    const keys = PREVIEW_STATES.map((state) => state.key);
    expect(keys).not.toContain('live-itinerary');
    expect(keys).not.toContain('live-itinerary-trigger');
    expect(keys).toEqual(
      expect.arrayContaining([
        'live-hub-closed',
        'live-hub-half',
        'live-hub-expanded',
        'live-trigger-weather',
        'live-trigger-delay',
        'live-trigger-closure',
      ])
    );
  });
});

// ── TRIP-747 · 수정 알약 열림 / 기록 없음 ─────────────────────────────────────

const PILL_ANY = /^execution-live-edit-pill-(ai|manual)$/;

/** 두 키 공통 — 헤더 한 줄·카드 5장·진행/예정 상태줄·시트 펼침(index 2). */
function expectExpandedHubBase(): void {
  expect(screen.getByTestId('execution-live-screen')).toBeOnTheScreen();
  expect(screen.getByTestId('execution-live-sheet-header')).toHaveTextContent(
    '부산 여행 · 2일차 · 6월 11일(목) · 5곳'
  );
  expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
  expect(screen.getByText('13:00 도착 · 지금 관람 중')).toBeOnTheScreen();
  expect(
    screen.getByText('15:00 도착 예정 · 11:00–22:00 영업')
  ).toBeOnTheScreen();
  expect(screen.getByText('17:00 도착 예정 · 24시간 개방')).toBeOnTheScreen();
  const indices = sheetIndices();
  expect(indices.length).toBeGreaterThan(0);
  indices.forEach((index) => expect(index).toBe(2));
}

describe('🔴 TRIP-747 · i01 수정 알약 열림 프리뷰 (AC-5)', () => {
  it('live-hub-edit-pills 는 펼침 5곳(사진 4·후기 2) 위에 알약 2개를 처음부터 연 채로 그리고 FAB 는 × 다', () => {
    mockSearchParams.state = 'live-hub-edit-pills';

    render(<DevPreview />);

    expectExpandedHubBase();
    // 배경은 펼침 프레임과 같다 — 사진·후기 포함.
    expect(
      screen.getAllByTestId(/^execution-live-slot-photo-\d+-/)
    ).toHaveLength(4);
    expect(screen.getAllByTestId(/^execution-live-slot-memo-/)).toHaveLength(2);
    // 누르지 않아도 열려 있다(initialEditMenuOpen 입구).
    expect(screen.getAllByTestId(PILL_ANY).map((n) => n.props.testID)).toEqual([
      'execution-live-edit-pill-ai',
      'execution-live-edit-pill-manual',
    ]);
    expect(
      screen.getByTestId('execution-live-replan-fab')
    ).toHaveAccessibleName('닫기');
  });
});

describe('🔴 TRIP-747 · i01 기록 없음 프리뷰 (AC-4)', () => {
  it('live-hub-no-records 는 done 2장을 사진·후기 없이 이름 + "09:30 방문"/"11:00 방문"만 그리고 알약은 닫혀 있다', () => {
    mockSearchParams.state = 'live-hub-no-records';

    render(<DevPreview />);

    // 짝 앵커 — 카드 5장·헤더가 실제로 있다(아래 부재 단언의 공허 통과 차단).
    expectExpandedHubBase();
    // 사진 행·사진 셀·후기 박스 0.
    expect(
      screen.queryAllByTestId(/^execution-live-slot-photos-/)
    ).toHaveLength(0);
    expect(
      screen.queryAllByTestId(/^execution-live-slot-photo-\d+-/)
    ).toHaveLength(0);
    expect(screen.queryAllByTestId(/^execution-live-slot-memo-/)).toHaveLength(
      0
    );
    // done 2장 — 시각 leaf + "방문" leaf(형제, 02a ★13).
    [
      ['gamcheon', '09:30'],
      ['gwangalli', '11:00'],
    ].forEach(([poiId, hhmm]) => {
      const key = `2026-06-11#${poiId}`;
      expect(
        screen.getByTestId(`execution-live-slot-visit-time-${key}`)
      ).toHaveTextContent(hhmm);
      expect(
        screen.getByTestId(`execution-live-slot-visit-label-${key}`)
      ).toHaveTextContent('방문');
    });
    // 수정 알약은 닫힘 — 연필 FAB.
    expect(screen.queryAllByTestId(PILL_ANY)).toHaveLength(0);
    expect(
      screen.getByTestId('execution-live-replan-fab')
    ).toHaveAccessibleName('일정 수정');
  });
});

describe('🔴 TRIP-747 · 새 키 등록 (AC-6)', () => {
  it('두 키가 band i 이고 라벨이 "i01 · " 로 시작한다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    ['live-hub-edit-pills', 'live-hub-no-records'].forEach((key) => {
      const entry = states.find((state) => state.key === key);
      expect(entry).toBeDefined();
      expect(entry?.band).toBe('i');
      expect(entry?.label.startsWith('i01 · ')).toBe(true);
    });
  });
});

// ── TRIP-748 · i02 변수 감지 3키 ────────────────────────────────────────────
//
// Figma 4041:2427 · 4078:2477 · 4081:2502 — i01 펼침 5곳 그대로 + 지도 위 알약 한 줄 + 해운대 카드 배지.
// 알약 카피는 D2 템플릿대로 슬롯명 전체("해운대 해변")를 쓴다 — Figma "해운대"와의 차이는 허용 차이(Seed).

const HAEUNDAE_STATUS = 'execution-live-slot-status-2026-06-11#haeundae';
const JEONPO_STATUS = 'execution-live-slot-status-2026-06-11#jeonpo';

describe('🔴 TRIP-748 · i02 변수 감지 프리뷰 3키 (AC-10)', () => {
  it.each([
    ['live-trigger-weather', '비 예보 · 해운대 해변 17시', '비 예보'],
    ['live-trigger-delay', '이동 지연 · 해운대 해변 방면', '이동 지연'],
    ['live-trigger-closure', '휴무 · 해운대 해변 주변 시설', '휴무'],
  ])(
    '%s 는 펼침 5곳 위에 알약 "%s" 와 해운대 배지 "%s" 를 그린다',
    (key, copy, badge) => {
      mockSearchParams.state = key;

      render(<DevPreview />);

      expectExpandedHubBase();
      expect(
        screen.getByTestId('execution-live-trigger-chip')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('execution-live-trigger-label')
      ).toHaveTextContent(copy);
      expect(screen.getByTestId(HAEUNDAE_STATUS)).toHaveTextContent(badge);
      expect(screen.getByTestId(JEONPO_STATUS)).toHaveTextContent('예정');
      expect(screen.queryByTestId('execution-live-trigger-banner')).toBeNull();
      expect(screen.queryByTestId('execution-live-trigger-dismiss')).toBeNull();
    }
  );

  it('세 키가 band i 이고 라벨이 "i02 · " 로 시작한다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    [
      'live-trigger-weather',
      'live-trigger-delay',
      'live-trigger-closure',
    ].forEach((key) => {
      const entry = states.find((state) => state.key === key);
      expect(entry).toBeDefined();
      expect(entry?.band).toBe('i');
      expect(entry?.label.startsWith('i02 · ')).toBe(true);
    });
  });
});

// ── TRIP-749 · i03 위험 상세 시트 1키 ───────────────────────────────────────
//
// Figma 4052:2427 — i02 배경(허브 **중간** 스냅 + 지도 알약 + 해운대 배지) 위에 딤 + 위험 상세 시트.
// 배경 시트 노드 이름은 `sheet-펼침` 이지만 위치가 중간(y=380)이라 index 1 을 정본으로 삼았다(브리프 드리프트).
// 옛 i09 감시 목록 2키는 사라진다 — 키 접두어는 조립 문자열로 찾는다(리터럴이면 riskSheetStructure R3 이
// 이 파일을 잡는다, 02a ★8).

const OLD_WATCHLIST_PREFIX = ['planb', 'triggers'].join('-');

describe('🔴 TRIP-749 · i03 위험 상세 시트 프리뷰 (AC-9)', () => {
  it('live-risk-sheet 는 중간 스냅 허브 + 알약 + 해운대 배지 위에, 허브 밖 형제로 위험 상세 시트를 그린다', () => {
    mockSearchParams.state = 'live-risk-sheet';

    render(<DevPreview />);

    // 배경 — 허브, 그리고 허브의 시트는 전부 중간 스냅(index 1).
    const liveScreen = screen.getByTestId('execution-live-screen');
    const hubIndices = liveScreen
      .findAll(
        (node) =>
          typeof node.props?.index === 'number' &&
          Array.isArray(node.props?.snapPoints)
      )
      .map((node) => node.props.index as number);
    expect(hubIndices.length).toBeGreaterThan(0);
    hubIndices.forEach((index) => expect(index).toBe(1));
    expect(
      screen.getByTestId('execution-live-trigger-label')
    ).toHaveTextContent('비 예보 · 해운대 해변 17시');
    expect(screen.getByTestId(HAEUNDAE_STATUS)).toHaveTextContent('비 예보');

    // 시트 — 허브 밖(형제)에 있다(Figma: 딤이 FAB 까지 전면을 덮는다).
    expect(screen.getByTestId('planb-risk-sheet')).toBeOnTheScreen();
    expect(within(liveScreen).queryByTestId('planb-risk-sheet')).toBeNull();
    expect(screen.getByTestId('planb-risk-eyebrow')).toHaveTextContent(
      '위험 요소 · 날씨'
    );
    expect(screen.getByTestId('planb-risk-title')).toHaveTextContent(
      '17시 이후 비 예보 70%'
    );
    expect(screen.getByTestId('planb-risk-affected-time')).toHaveTextContent(
      '17:00'
    );
    expect(screen.getByTestId('planb-risk-affected-name')).toHaveTextContent(
      '해운대 해변'
    );
    expect(screen.getByTestId('planb-risk-affected-meta')).toHaveTextContent(
      '5번째 · 해변 · 24시간 개방'
    );
    expect(screen.getByTestId('planb-risk-watch-weather')).toHaveTextContent(
      '날씨 · 활성'
    );
    expect(screen.getByTestId('planb-risk-watch-delay')).toHaveTextContent(
      '이동 · 정상'
    );
    expect(screen.getByTestId('planb-risk-watch-closure')).toHaveTextContent(
      '영업 · 정상'
    );
    expect(screen.getByTestId('planb-risk-cta')).toHaveTextContent('대안 보기');
  });

  it('band i · 라벨 "i03 · 위험 상세 시트" 이고, 옛 i09 감시 목록 키는 없다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const entry = states.find((state) => state.key === 'live-risk-sheet');
    expect(entry).toBeDefined();
    expect(entry?.band).toBe('i');
    expect(entry?.label).toBe('i03 · 위험 상세 시트');

    // 짝 앵커 — 목록이 비지 않았다.
    expect(states.length).toBeGreaterThan(100);
    expect(
      states
        .map((state) => state.key)
        .filter((key) => key.startsWith(OLD_WATCHLIST_PREFIX))
    ).toEqual([]);
  });
});

// ── TRIP-750 · i04 재계획 요청 시트 1키 ───────────────────────────────────────
//
// Figma 4067:2427 — i02 펼침(비 예보 알약 + 해운대 배지) 위에 스크림 + 요청 시트. 옛 감지 배너·범위 밖
// 2키는 사라진다. 그 키 문자열은 삭제 testID 와 같아서 조립한다(planbRequestSheetStructure R3, 02a ★3).

const OLD_REQUEST_KEYS = ['detected', 'out-of-scope'].map((suffix) =>
  ['planb', 'request', suffix].join('-')
);

describe('🔴 TRIP-750 · i04 재계획 요청 시트 프리뷰 (AC-10)', () => {
  it('planb-request 는 펼침 허브 + 알약 위에, 허브 밖 형제로 감지 칩이 켜진 요청 시트를 그린다', () => {
    mockSearchParams.state = 'planb-request';

    render(<DevPreview />);

    // 배경 — i02 펼침 허브(시트 index 2) + 지도 알약.
    const liveScreen = screen.getByTestId('execution-live-screen');
    const hubIndices = liveScreen
      .findAll(
        (node) =>
          typeof node.props?.index === 'number' &&
          Array.isArray(node.props?.snapPoints)
      )
      .map((node) => node.props.index as number);
    expect(hubIndices.length).toBeGreaterThan(0);
    hubIndices.forEach((index) => expect(index).toBe(2));
    expect(
      screen.getByTestId('execution-live-trigger-label')
    ).toHaveTextContent('비 예보 · 해운대 해변 17시');

    // 시트·스크림 — 허브 밖(형제).
    expect(screen.getByTestId('planb-request-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-request-scrim')).toBeOnTheScreen();
    expect(within(liveScreen).queryByTestId('planb-request-sheet')).toBeNull();

    // Figma 선택 상태 — 감지 칩 · 지금 이후 · 숙소 근처에서 끝내기만.
    const chip = screen.getByTestId('planb-request-trigger-chip');
    expect(chip).toHaveTextContent('비 예보 · 해운대 해변 17시');
    expect(chip).toBeSelected();
    expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toBeSelected();
    expect(
      screen.getByTestId('planb-request-directive-END_NEAR_STAY')
    ).toBeSelected();
    expect(
      screen.getByTestId('planb-request-directive-INDOOR')
    ).not.toBeSelected();
  });

  it('band i · 라벨 "i04 · 재계획 요청 시트" 이고, 옛 감지 배너·범위 밖 키는 없다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const entry = states.find((state) => state.key === 'planb-request');
    expect(entry).toBeDefined();
    expect(entry?.band).toBe('i');
    expect(entry?.label).toBe('i04 · 재계획 요청 시트');

    const keys = states.map((state) => state.key);
    expect(keys.length).toBeGreaterThan(100);
    OLD_REQUEST_KEYS.forEach((key) => expect(keys).not.toContain(key));
  });
});

// ── TRIP-751 · i06 재계획안 2키 ─────────────────────────────────────────────
//
// Figma 4314:1923(펼침) · 4335:1923(대안 없음) — 같은 5곳 픽스처를 지도+시트 셸 위에 펼침(index 1)으로.
// 옛 빈 슬롯 키(`planb-replan-draft-empty`)는 사라진다. 프리뷰는 뷰를 파일 경로로 import 한다 —
// 위 `@/shared/api` 지뢰가 배럴 로드를 막는다(하위 경로 정적 검사는 planbReplanDraftStructure G8).

function i06Texts(pattern: RegExp): string[] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.children));
}

function i06Classes(pattern: RegExp): string[][] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.className ?? '').split(/\s+/));
}

const I06_DIMMED = /^opacity-(45|\[0\.45\])$/;

describe('🔴 TRIP-751 · i06 재계획안 펼침 프리뷰 (AC-12)', () => {
  it('planb-replan-draft 는 Figma 5곳을 헤더·번호 톤·거리 커넥터·사진·[직접 수정]/[적용하기]로 펼쳐 그린다', () => {
    mockSearchParams.state = 'planb-replan-draft';

    render(<DevPreview />);

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '5곳 · 6.3km'
    );

    expect(i06Texts(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
      '부산시립미술관',
      '전포 카페거리',
      'F1963 복합문화공간',
    ]);
    [
      '09:30 방문',
      '11:00 방문',
      '13:00 도착 · 관람 중',
      '15:00–16:30',
      '17:00–18:30',
      '마을 · 벽화',
      '바다 · 산책',
      '미술 · 실내',
      '카페 · 실내',
      '전시 · 실내',
    ].forEach((text) => expect(screen.getByText(text)).toBeOnTheScreen());
    expect(i06Texts(/^sheet-connector-distance-/)).toEqual([
      '1.4km',
      '3.2km',
      '600m',
      '1.1km',
    ]);
    expect(screen.getAllByTestId(/^planb-draft-slot-photo-/)).toHaveLength(5);
    expect(
      i06Classes(/^planb-draft-slot-number-/).map((tokens) =>
        tokens.includes('bg-success') ? 'success' : 'primary'
      )
    ).toEqual(['success', 'success', 'success', 'primary', 'primary']);
    expect(screen.getAllByTestId(/^planb-draft-candidates-/)).toHaveLength(2);

    expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();
    expect(screen.getByTestId('sheet-daychip-2')).toBeOnTheScreen();
    const indices = sheetIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(1));

    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '적용하기'
    );
    expect(screen.queryByTestId('planb-draft-notice')).toBeNull();
  });
});

describe('🔴 TRIP-751 · i06 재계획안 대안 없음 프리뷰 (AC-12)', () => {
  it('planb-noalt 는 곳 수 없이 안내 2줄 + 예정 두 행 흐림 + [조건 바꿔 다시 짜기]로 그린다', () => {
    mockSearchParams.state = 'planb-noalt';

    render(<DevPreview />);

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(/km/);
    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '대안을 찾지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '17시 이후 실내 후보가 근처에 없어요 · 조건을 줄이거나 직접 고쳐 주세요'
    );

    expect(i06Texts(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
      '부산시립미술관',
      '전포 카페거리',
      '해운대 해변',
    ]);
    expect(screen.getByText('바다 · 해변')).toBeOnTheScreen();
    expect(i06Texts(/^sheet-connector-distance-/)).toEqual([
      '1.4km',
      '3.2km',
      '600m',
      '8km',
    ]);

    const dimmedRows = screen
      .getAllByTestId(/^planb-draft-slot-/)
      .filter((node) =>
        String(node.props.className ?? '')
          .split(/\s+/)
          .some((token) => I06_DIMMED.test(token))
      );
    expect(
      dimmedRows.map((row) =>
        String(
          within(row).getByTestId(/^planb-draft-slot-name-/).props.children
        )
      )
    ).toEqual(['전포 카페거리', '해운대 해변']);
    expect(screen.queryAllByTestId(/^planb-draft-candidates-/)).toHaveLength(0);

    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '조건 바꿔 다시 짜기'
    );
    const indices = sheetIndices();
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((index) => expect(index).toBe(1));
  });
});

describe('🔴 TRIP-751 · i06 키 정리 (AC-12)', () => {
  it('두 키가 band i · 라벨 "i06 · 재계획안 · 펼침/대안 없음" 이고, 빈 슬롯 키는 없다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const draft = states.find((state) => state.key === 'planb-replan-draft');
    const noalt = states.find((state) => state.key === 'planb-noalt');
    expect(draft?.band).toBe('i');
    expect(draft?.label).toBe('i06 · 재계획안 · 펼침');
    expect(noalt?.band).toBe('i');
    expect(noalt?.label).toBe('i06 · 재계획안 · 대안 없음');

    const keys = states.map((state) => state.key);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys).not.toContain('planb-replan-draft-empty');
  });
});

// ── TRIP-752 · i05 다시 짜는 중 ─────────────────────────────────────────────
//
// Figma 4341:1957 — 전면 지도 + 좌상단 진행 카드 + peek 시트(40%). 행은 i06 픽스처 앞 2곳(방문 완료).
// 옛 i12 전용 화면(부제·체크리스트·안심 노트·[백그라운드로])은 사라진다. 프리뷰는 뷰를 파일 경로로
// import 한다(위 `@/shared/api` 지뢰가 배럴 로드를 막는다, 하위 경로 정적 검사는 planbSolvingStructure G6).

describe('🔴 TRIP-752 · i05 다시 짜는 중 프리뷰 (AC-13)', () => {
  it('planb-solving 은 진행 카드·헤더·방문 완료 2곳·거리 커넥터를 peek 시트로 그리고, CTA·옛 표면은 없다', () => {
    mockSearchParams.state = 'planb-solving';

    render(<DevPreview />);

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(screen.getByText('AI가 일정을 다시 짜고 있어요')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-progress-cancel')).toHaveTextContent(
      '취소'
    );
    expect(
      screen.getByTestId('generation-gauge-cell-1-done')
    ).toHaveTextContent('방문한 곳 그대로');
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('17시 이후 다시 짜는 중');

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '방문한 3곳 그대로'
    );

    expect(i06Texts(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
    ]);
    ['09:30 방문', '11:00 방문', '마을 · 벽화', '바다 · 산책'].forEach((text) =>
      expect(screen.getByText(text)).toBeOnTheScreen()
    );
    expect(screen.getAllByTestId(/^planb-draft-slot-photo-/)).toHaveLength(2);
    expect(
      i06Classes(/^planb-draft-slot-number-/).map((tokens) =>
        tokens.includes('bg-success') ? 'success' : 'other'
      )
    ).toEqual(['success', 'success']);
    expect(screen.queryAllByTestId(/^planb-draft-candidates-/)).toHaveLength(0);
    expect(i06Texts(/^sheet-connector-distance-/)).toEqual(['1.4km']);

    const sheets = screen.root.findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    );
    expect(sheets.length).toBeGreaterThan(0);
    sheets.forEach((node) => {
      expect(node.props.index).toBe(0);
      expect(node.props.snapPoints).toEqual(['40%', '88%']);
    });

    expect(screen.queryAllByTestId(/^sheet-cta/)).toHaveLength(0);
    for (const id of [
      'planb-solving-background',
      'planb-solving-progress',
      'planb-solving-cancel',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByText('백그라운드로')).toBeNull();
  });

  it('planb-solving 키는 band i · 라벨 "i05 · 다시 짜는 중" 이다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const entry = states.find((state) => state.key === 'planb-solving');
    expect(entry?.band).toBe('i');
    expect(entry?.label).toBe('i05 · 다시 짜는 중');
  });
});
