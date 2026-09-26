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

/** 셸 기본 스냅을 쓰는 화면(i06·i07)의 초기 **칸 값** — snapPoints[index]. TRIP-920 이 셸 기본 배열 앞에
 *  닫힘(28)을 끼워 숫자 index 의 뜻이 밀렸다(1 = 펼침 → peek). 허브·i05 는 snapPoints 를 직접 줘서 숫자 뜻이
 *  안 바뀌므로 위 `sheetIndices` 를 그대로 쓴다(02a ★1·★2). */
function sheetSnapValues(): unknown[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map(
      (node) => (node.props.snapPoints as unknown[])[node.props.index as number]
    );
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

// ── TRIP-987 A · Seed Q6 — 허브 프리뷰는 이름 진입을 no-op 으로 받아 '›' 를 유지한다 ──────
// 안 받으면 TRIP-939 규칙대로 '›' 가 사라져 6-b 육안이 Figma i01(세 상태 모두 `이름 ›`)과 어긋난다.

describe('🔴 TRIP-987 · i01 허브 프리뷰의 이름 진입 (Seed Q6)', () => {
  it.each(['live-hub-closed', 'live-hub-half', 'live-hub-expanded'])(
    "%s 는 카드 5장 모두 이름이 누를 수 있는 영역이고 '›' 가 5개다",
    (key) => {
      mockSearchParams.state = key;

      render(<DevPreview />);

      const names = screen.getAllByTestId(
        /^execution-live-slot-name-2026-06-11#/
      );
      expect(names).toHaveLength(5);
      names.forEach((name) =>
        expect(
          typeof name.props.onStartShouldSetResponder === 'function' ||
            typeof name.props.onClick === 'function'
        ).toBe(true)
      );
      expect(
        screen.getAllByTestId(/^execution-live-slot-chevron-2026-06-11#/)
      ).toHaveLength(5);
    }
  );
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
    // TRIP-920 심판 수정 — 펼침은 숫자 1 이 아니라 칸 값 88%.
    const values = sheetSnapValues();
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value).toBe('88%'));

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
    // TRIP-920 심판 수정 — 펼침은 숫자 1 이 아니라 칸 값 88%.
    const values = sheetSnapValues();
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value).toBe('88%'));
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

// ── TRIP-753 · i07 일정 편집 프리뷰 ─────────────────────────────────────────────────────────
//
// Figma 4313:2100 — `planb-manual-normal` 키가 h12 편집기(EditorView, inTrip)로 2일차 5곳을 펼침으로
// 그린다. 옛 폴백·위반 2키는 사라진다. 프리뷰는 뷰를 파일 경로로 import 한다(위 `@/shared/api` 지뢰가
// 배럴 로드를 막는다, 하위 경로 정적 검사는 planbEditUnifyStructure U5). 사진은 jest 에서 uri 가 없어
// 플레이스홀더로 그려지므로 세지 않는다(02a ★17 — 육안 게이트 몫).

function i07Tone(testID: string): string {
  const tokens = String(screen.getByTestId(testID).props.className ?? '').split(
    /\s+/
  );
  if (tokens.includes('bg-success')) return 'success';
  if (tokens.includes('bg-primary')) return 'primary';
  return 'none';
}

describe('🔴 TRIP-753 · i07 일정 편집 프리뷰 (AC-12 · AC-10)', () => {
  it('planb-manual-normal 은 2일차 5곳을 완료 2·위반 1·i07 안내로 펼쳐 그리고, 옛 폴백 표면은 없다', () => {
    mockSearchParams.state = 'planb-manual-normal';

    render(<DevPreview />);

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '일정 편집'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('5곳');

    // 일차 칩 3개, 2일차 선택.
    expect(screen.getByTestId('itinerary-edit-day-1')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-day-2')).toBeSelected();
    expect(screen.getByTestId('itinerary-edit-day-3')).toBeOnTheScreen();

    // 카드 5장 — 이름·시각·카테고리를 트리 순서대로.
    const expectTexts = (pattern: RegExp, texts: string[]) => {
      const nodes = screen.getAllByTestId(pattern);
      expect(nodes).toHaveLength(texts.length);
      nodes.forEach((node, index) =>
        expect(node).toHaveTextContent(texts[index])
      );
    };
    expectTexts(/^slot-stopcard-name-/, [
      '감천문화마을',
      '광안리 해변',
      '부산시립미술관',
      '전포 카페거리',
      '해운대 해변',
    ]);
    expectTexts(/^slot-stopcard-time-/, [
      '09:30–10:30',
      '11:00–12:00',
      '13:00–14:30',
      '15:00–16:30',
      '17:00–18:30',
    ]);
    expectTexts(/^slot-stopcard-tags-/, [
      '마을 · 벽화',
      '바다 · 산책',
      '미술 · 실내',
      '카페 · 실내',
      '바다 · 해변',
    ]);

    // 완료 1·2 는 초록 번호 + 잠긴 알약, 예정 3~5 는 빨강 번호 + 누름 칩.
    expect(
      screen
        .getAllByTestId(/^slot-stopcard-number-/)
        .map((node) => i07Tone(node.props.testID as string))
    ).toEqual(['success', 'success', 'primary', 'primary', 'primary']);
    expect(screen.getAllByTestId(/^slot-stopcard-locked-/)).toHaveLength(2);
    expect(screen.getAllByTestId(/^slot-stopcard-timechip-/)).toHaveLength(3);

    // 행 3 위반 배지 하나.
    expectTexts(/^slot-stopcard-violation-/, ['숙소 고정 충돌']);

    // i07 얼굴 — 카드 사이 + 없음, 안내 문구, 펼친 시트, 저장 CTA.
    expect(screen.queryAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(0);
    expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
      '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요'
    );
    // TRIP-920 심판 수정 — 펼침은 숫자 1 이 아니라 칸 값 88%.
    const values = sheetSnapValues();
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value).toBe('88%'));
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '일정 저장하기'
    );

    // 옛 폴백·잠금 표면은 트리에 없다(AC-10).
    expect(screen.queryAllByTestId(/^planb-manual-/)).toHaveLength(0);
    ['이동시간 미상', '변경 불가', '--:--', '방문 완료'].forEach((text) =>
      expect(screen.queryByText(text)).toBeNull()
    );
    expect(screen.queryByText(/^Day \d/)).toBeNull();
  });

  it('planb-manual-normal 은 band i · 라벨 "i07 · 일정 편집" 이고, 옛 폴백·위반 키는 없다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const entry = states.find((state) => state.key === 'planb-manual-normal');
    expect(entry?.band).toBe('i');
    expect(entry?.label).toBe('i07 · 일정 편집');

    const keys = states.map((state) => state.key);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys).not.toContain('planb-manual-fallback');
    expect(keys).not.toContain('planb-manual-violation');
  });
});

// ── TRIP-754 · i08 변경 반영 시트 1키 ───────────────────────────────────────
//
// Figma 4401:1568 — 펼침 허브(5번째 해운대 자리가 F1963 + "변경됨") 위, 허브 밖 형제로 픽스처가 다 찬
// 반영 시트. 옛 i19 전면화면(`ReplanAppliedScreen`)은 같은 키 이름을 물려주고 사라진다.

/** 반복 testID 노드들이 기대 글자와 개수·순서까지 같다(각 노드 완전 일치). */
function expectI08Texts(testID: string, expected: string[]): void {
  const nodes = screen.getAllByTestId(testID);
  expect(nodes).toHaveLength(expected.length);
  nodes.forEach((node, index) =>
    expect(node).toHaveTextContent(expected[index])
  );
}

describe('🔴 TRIP-754 · i08 변경 반영 시트 프리뷰 (AC-11)', () => {
  it('planb-applied 는 펼침 허브(5번째 F1963 · 변경됨) 위에, 허브 밖 형제로 Figma 픽스처 시트를 그린다', () => {
    mockSearchParams.state = 'planb-applied';

    render(<DevPreview />);

    // 배경 — 펼침 허브(index 2) 5곳, 5번째 카드가 F1963 으로 바뀌고 "변경됨" 배지.
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
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(5);
    const names = within(liveScreen).getAllByTestId(
      /^execution-live-slot-name-2026-06-11#/
    );
    expect(names).toHaveLength(5);
    expect(names[4]).toHaveTextContent('F1963 복합문화공간');
    const changedKey = String(names[4].props.testID).replace(
      'execution-live-slot-name-',
      ''
    );
    expect(
      screen.getByTestId(`execution-live-slot-status-${changedKey}`)
    ).toHaveTextContent('변경됨');
    expect(within(liveScreen).queryByText('해운대 해변')).toBeNull();

    // 시트 — 허브 밖(형제), Figma 문구 전부.
    const sheet = screen.getByTestId('planb-applied-sheet');
    expect(sheet).toBeOnTheScreen();
    expect(within(liveScreen).queryByTestId('planb-applied-sheet')).toBeNull();
    expect(screen.getByTestId('planb-applied-scrim')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-eyebrow')).toHaveTextContent(
      '변경 반영됨'
    );
    expect(screen.getByTestId('planb-applied-title')).toHaveTextContent(
      '새 일정이 반영됐어요'
    );
    expectI08Texts('planb-applied-subtitle-line', [
      '비 예보를 반영했어요',
      '방문한 곳은 그대로 두고 17시 이후만 바뀌었어요',
    ]);
    expectI08Texts('planb-applied-badge', [
      '바뀐 곳 1',
      '방문지 5→5',
      '이동 −6.9km',
    ]);

    const rows = within(sheet).getAllByTestId('planb-applied-diff-row');
    expect(rows).toHaveLength(2);
    const expected = [
      [
        '추가',
        'bg-success',
        'F1963 복합문화공간',
        '17:00–18:30 · 비 예보로 실내 대안',
      ],
      [
        '삭제',
        'bg-primary',
        '해운대 해변',
        '17:00–18:30 · 비 예보 · 17시 이후',
      ],
    ];
    rows.forEach((row, index) => {
      const [kind, dot, name, meta] = expected[index];
      expect(
        within(row).getByTestId('planb-applied-diff-kind')
      ).toHaveTextContent(kind);
      expect(
        String(
          within(row).getByTestId('planb-applied-diff-dot').props.className ??
            ''
        ).split(/\s+/)
      ).toContain(dot);
      expect(
        within(row).getByTestId('planb-applied-diff-name')
      ).toHaveTextContent(name);
      expect(
        within(row).getByTestId('planb-applied-diff-meta')
      ).toHaveTextContent(meta);
    });

    expect(screen.getByTestId('planb-applied-revert')).toHaveTextContent(
      '되돌리기'
    );
    expect(screen.getByTestId('planb-applied-confirm')).toHaveTextContent(
      '확인'
    );
    expect(screen.queryByTestId('planb-applied-revert-notice')).toBeNull();
  });

  it('planb-applied 는 band i · 라벨 "i08 · 변경 반영 시트" 다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const entry = states.find((state) => state.key === 'planb-applied');
    expect(entry).toBeDefined();
    expect(entry?.band).toBe('i');
    expect(entry?.label).toBe('i08 · 변경 반영 시트');

    // 짝 앵커 — 목록이 비지 않았다.
    expect(states.length).toBeGreaterThan(100);
  });
});

// ── TRIP-755 · i10 현재 장소 상세 1키 ────────────────────────────────────────
//
// Figma 4159:2673 — 옛 `live-place-default`·`-unknown` 2키를 `live-place` 1키로 합친다(결측 얼굴은
// Figma 에 없어 키 삭제, 결측 처리는 model·화면 테스트가 잠근다). 라벨은 옛 "i05 · …"가 새 i05
// (`planb-solving` "i05 · 다시 짜는 중")와 겹쳐 "i10 · …"으로 바로잡는다.
//
// ⚠️ 사진(갤러리·"이곳의 사진"·"+39")은 여기서 단언하지 않는다 — jest 에서 `Image.resolveAssetSource(
// require(jpg))` 는 `{ testUri }` 를 돌려줘 `.uri` 가 undefined, 픽스처 사진이 전부 null 이 된다(02a ★5).
// 어떤 올바른 구현도 jest 에선 사진 섹션을 못 그리므로, 사진은 6-b 육안 몫이다. "1 / 42"는 숫자
// 필드(photoTotal)라 잰다.

const LIVE_PLACE_OLD_KEYS = ['live-place-default', 'live-place-unknown'];

describe('🔴 TRIP-755 · i10 현재 장소 상세 프리뷰 (AC-11)', () => {
  it('live-place 는 Figma 픽스처(부산시립미술관)를 추천 카피·태그 4·정보 3행 원문·"1 / 42"로 그린다', () => {
    // 준비 — 딥링크 state=live-place.
    mockSearchParams.state = 'live-place';

    // 실행
    render(<DevPreview />);

    // 단언 ① — 히어로: 장소명·핀 부제(category 원문).
    expect(screen.getByTestId('execution-place-title')).toHaveTextContent(
      '부산시립미술관'
    );
    expect(screen.getByText('미술관 · 전시')).toBeOnTheScreen();
    expect(screen.getByTestId('execution-place-photo-count')).toHaveTextContent(
      '1 / 42'
    );
    // 원형 버튼 — 프리뷰는 빈 핸들러로 뒤로·공유를 켠다. 하트는 없다(2026-09-25 결정, Figma 와 차이).
    expect(screen.getByTestId('execution-place-back')).toBeTruthy();
    expect(screen.getByTestId('execution-place-share')).toBeTruthy();
    expect(screen.queryByTestId('execution-place-save')).toBeNull();

    // 단언 ② — 추천 카피: 제목은 Figma 레이어명 = 내용이라 완전일치, 본문은 원문 미확인이라 비어 있지
    //   않음만(02a D-i).
    expect(screen.getByTestId('execution-place-pitch-title')).toHaveTextContent(
      '비 오는 날에도 반나절이 아깝지 않은 곳'
    );
    const pitchBody = String(
      screen.getByTestId('execution-place-pitch-body').props.children
    );
    expect(pitchBody.trim().length).toBeGreaterThan(0);

    // 단언 ③ — 해시태그 4칩(Figma 4159:2708·2710·2712·2714).
    ['#미술', '#실내', '#취향매칭', '#비와도좋음'].forEach((tag) =>
      expect(
        within(screen.getByTestId('execution-place-tags')).getByText(tag)
      ).toBeOnTheScreen()
    );

    // 단언 ④ — 정보 카드 원문(Figma 4159:2718·2722·2726) 3행뿐 — "다음 일정까지" 없음(2026-09-25 결정).
    expect(screen.getByTestId('execution-place-openhours')).toHaveTextContent(
      '10:00~18:00 (월 휴관)'
    );
    expect(screen.getByTestId('execution-place-address')).toHaveTextContent(
      '부산 부산진구 ○○로 12'
    );
    expect(screen.getByTestId('execution-place-fee')).toHaveTextContent(
      '성인 12,000원'
    );
    expect(screen.queryByTestId('execution-place-slack')).toBeNull();

    // 단언 ⑤ — 옛 표면은 없다.
    expect(screen.queryByTestId('execution-place-cta-itinerary')).toBeNull();
    expect(screen.queryByTestId('execution-place-here')).toBeNull();
  });

  it('live-place 는 band i · 라벨 "i10 · 현재 장소 상세" 이고, 옛 default·unknown 키는 없다', () => {
    const states = PREVIEW_STATES as {
      key: string;
      band: string;
      label: string;
    }[];
    const entry = states.find((state) => state.key === 'live-place');
    expect(entry).toBeDefined();
    expect(entry?.band).toBe('i');
    expect(entry?.label).toBe('i10 · 현재 장소 상세');

    const keys = states.map((state) => state.key);
    expect(keys.length).toBeGreaterThan(100);
    LIVE_PLACE_OLD_KEYS.forEach((key) => expect(keys).not.toContain(key));
  });
});
