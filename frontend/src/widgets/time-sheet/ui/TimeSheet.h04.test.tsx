import { fireEvent, render, screen } from '@testing-library/react-native';

import { TimeSheet, type TimeSheetPlaceSummary } from './TimeSheet';

/**
 * TRIP-787 · 공용 시각 시트 `widgets/time-sheet`의 **h04(시간대 조정) opt-in 변형**.
 *
 * 무엇을 보장하나:
 *  - `mode='h04'`이면 헤더 '시간대 조정'+부제·장소 요약 행·시작/종료 2탭 세그·readout·3열 휠·
 *    단일 '적용' CTA(취소 부재)를 낸다(AC-1~AC-6).
 *  - 종료는 **내부 optional 상태**로만 표현 — 미설정이면 readout '설정 안 됨'(seed Q1, onApply 계약 불변).
 *  - INV-3 — h04 분 열/readout 이 bare 숫자, 소요시간 표기 0건(AC-INV3).
 *
 * *(개념)* **opt-in `mode` = 한 컴포넌트 두 렌더 트리(리포 최초)** — 이 파일은 h04 분기만 잠근다.
 *   default(mode 미전달) 무회귀는 형제 `TimeSheet.test.tsx`(CS1~CS8 ×2접두, 무수정)가 진다(AC-R1).
 *
 * *(개념)* **통과형 목** — `@gorhom/bottom-sheet` 는 `__mocks__`가 children 을 무조건 렌더한다(node_modules
 *   수동 목 자동적용, frozen 파일이 `jest.mock` 0회로 green 인 실측). 직접 마운트하면 **항상 열린 상태**라
 *   시트 내용을 조회할 수 있다 — 실개폐·2스냅·딤은 못 잰다(6-b 실기 전용, 02a ★3).
 *
 * *(개념)* **휠 실회전·중앙강조·활성탭이 편집하는 필드**는 jest 원리적 사각(WheelPicker 주석 자인) —
 *   여기선 '3열이 트리에 존재·탭 selected 전환·readout 문자열'까지만(02a ★3). 아침 육안이 유일 그물.
 *
 * 3동작 뼈대: 준비=mode='h04'로 렌더 → 실행=탭/셀 press → 단언=텍스트·selected·testID 존재/부재.
 */

// 소요시간 표기 탐지기 — HH:mm(1:00)은 콜론 뒤 숫자라 안 걸리고, bare 분 셀("00")도 안 걸린다(02a §5-B).
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 렌더된 문자열 전부 — INV-3 부정 스캔의 모집단(frozen CS6 헬퍼 이식, 02a §5-B). */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

const PREFIX = 'itinerary-edit-time';
const id = (suffix: string): string => `${PREFIX}-${suffix}`;

// Q2 region·Q3 badgeLabel 프리뷰 픽스처(Figma context-card 값).
const FIXTURE: TimeSheetPlaceSummary = {
  imageUrl: 'https://example.com/gwangalli.jpg',
  name: '광안리 해변',
  badgeLabel: '필수',
  region: '부산 부산진구',
};

const onApply = jest.fn();
const onCancel = jest.fn();

function renderH04(placeSummary: TimeSheetPlaceSummary = FIXTURE): void {
  render(
    <TimeSheet
      mode="h04"
      testIDPrefix={PREFIX}
      labels={{ start: '시작', end: '종료' }}
      startAt="13:00:00"
      endAt="14:30:00"
      placeSummary={placeSummary}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

beforeEach(() => {
  onApply.mockClear();
  onCancel.mockClear();
});

describe('🔴 widgets/time-sheet · mode=h04 — 시간대 조정 변형', () => {
  it('CH1 · 헤더 "시간대 조정" + 부제를 그린다 (AC-1)', () => {
    renderH04();

    // 완전일치 — default 제목은 '시각 조정'('시간대'≠'시각')이라 h04 분기 전엔 red(02a §5-A).
    expect(screen.getByText('시간대 조정')).toBeOnTheScreen();
    expect(screen.getByText('시작·종료를 돌려서 맞춰요')).toBeOnTheScreen();
  });

  it('CH2 · 장소 요약 행 — 썸네일·이름·배지·"{region} · 꼭 갈 곳" (AC-2)', () => {
    renderH04();

    expect(screen.getByTestId(id('place-summary'))).toBeOnTheScreen();
    // 이미지 있음 → 썸네일 이미지 렌더.
    expect(screen.getByTestId(id('place-thumb-image'))).toBeOnTheScreen();
    // 이름·배지 라벨(파생 아님, 문자열 그대로)·지역 합성 줄.
    expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
    expect(screen.getByText('필수')).toBeOnTheScreen();
    expect(screen.getByText('부산 부산진구 · 꼭 갈 곳')).toBeOnTheScreen();
  });

  it('CH2b · imageUrl null 이면 이름·지역은 남고 썸네일 이미지만 빠진다 (AC-2)', () => {
    renderH04({ ...FIXTURE, imageUrl: null });

    // 행 자체와 텍스트는 그대로.
    expect(screen.getByTestId(id('place-summary'))).toBeOnTheScreen();
    expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
    expect(screen.getByText('부산 부산진구 · 꼭 갈 곳')).toBeOnTheScreen();
    // 이미지만 미렌더(자리 컨테이너만) — 부재는 queryBy* 로.
    expect(screen.queryByTestId(id('place-thumb-image'))).toBeNull();
  });

  it('CH3 · 시작/종료 2탭 세그 — 하나만 selected, 종료 press 로 전환 (AC-3)', () => {
    renderH04();

    // 초기 = 시작 탭 활성(하나만 selected).
    expect(screen.getByTestId(id('seg-start'))).toBeSelected();
    expect(screen.getByTestId(id('seg-end'))).not.toBeSelected();

    // 종료 탭 press → 활성 전환.
    fireEvent.press(screen.getByTestId(id('seg-end')));

    expect(screen.getByTestId(id('seg-end'))).toBeSelected();
    expect(screen.getByTestId(id('seg-start'))).not.toBeSelected();
  });

  it('CH3r · readout 이 "시작 …"과 종료 "설정 안 됨"을 반영한다 (AC-3·AC-6)', () => {
    renderH04();

    // 다중 Text 이어붙임 → 부분 포함은 정규식(02a §5-A). 종료는 내부 optional 미설정(seed Q1).
    const readout = screen.getByTestId(id('readout'));
    expect(readout).toHaveTextContent(/시작/);
    expect(readout).toHaveTextContent(/설정 안 됨/);
    // ▸ 값 심판(5-b 경고-1 봉합) — seed startAt "13:00" 이 12시간제로 "오후 1:00" 으로 변환돼
    //   보이는가. 이 줄이 decompose12→timeLabel12(오전/오후·시 접기) 출력을 잠근다. 없으면
    //   오전/오후 스왑·시 오프셋 뮤턴트가 readout 라벨만 보는 위 두 줄을 통과한다.
    expect(readout).toHaveTextContent(/오후 1:00/);
  });

  it('CH4 · 3열 휠 — 오전/오후·1~12·00~59 세 열이 트리에 실재한다 (AC-4)', () => {
    renderH04();

    // WheelPicker 3벌 — 각 열의 대표 셀이 존재하면 세 열이 렌더된 것(02a ★3).
    expect(screen.getByTestId(id('wheel-ap-오전'))).toBeOnTheScreen();
    expect(screen.getByTestId(id('wheel-h-12'))).toBeOnTheScreen();
    expect(screen.getByTestId(id('wheel-m-00'))).toBeOnTheScreen();
  });

  it('CH4b · 12↔24시간 변환 왕복 — seed 는 오후로 선택돼 있고, 오전을 누르면 readout 이 바뀐다 (AC-4·5-b 경고-1)', () => {
    renderH04();

    // 준비/단언 — seed "13:00" 은 오후 1시. decompose12 가 오후 셀을 selected 로 표시한다.
    expect(screen.getByTestId(id('wheel-ap-오후'))).toBeSelected();
    expect(screen.getByTestId(id('wheel-ap-오전'))).not.toBeSelected();

    // 실행 — 오전 셀 press → onSelect('오전') → compose24('오전','1')="01" → 상태 되씀.
    fireEvent.press(screen.getByTestId(id('wheel-ap-오전')));

    // 단언 — readout 시작이 "오전 1:00" 으로 바뀐다. compose24 왕복까지 잠근다(+12/-12 뮤턴트 검출).
    expect(screen.getByTestId(id('readout'))).toHaveTextContent(/오전 1:00/);
  });

  it('CH5 · 단일 "적용" CTA — h04 는 취소 버튼이 없다 (AC-5)', () => {
    renderH04();

    expect(screen.getByTestId(id('apply'))).toBeOnTheScreen();
    // default 는 취소를 렌더한다 → h04 분기 전엔 present 라 red.
    expect(screen.queryByTestId(id('cancel'))).toBeNull();
  });

  it('CH6 · INV-3 — 분 열은 bare 숫자, 소요시간 표기 0건 (AC-INV3)', () => {
    renderH04();

    // 양성 앵커 — h04 분 휠 셀이 실재(h04 분기 전엔 부재라 이 줄이 red 를 만든다, 02a ★5).
    expect(screen.getByTestId(id('wheel-m-00'))).toBeOnTheScreen();

    // 음성 — 렌더 텍스트 어디에도 소요시간 표기 0건(분 셀을 "0분"으로 그리면 여기서 걸린다).
    const texts = renderedTexts();
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
  });
});
