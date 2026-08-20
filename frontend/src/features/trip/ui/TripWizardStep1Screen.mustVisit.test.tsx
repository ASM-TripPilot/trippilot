import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  MustVisitSectionView,
  MustVisitSeedItem,
} from '../model/mustVisitSeed';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

// TRIP-445 게이트①-2 결정 A — 삭제된 프로덕션 상수 `REGIONS`를 파일 로컬 `{code,name}[]`
// 픽스처로 기계 교체(단언·동작 무변경, 위저드 화면 `regions` 계약과 같은 shape).
const REGIONS: readonly { code: string; name: string }[] = [
  { code: 'busan', name: '부산' },
  { code: 'gyeongju', name: '경주' },
  { code: 'seoul', name: '서울' },
  { code: 'jeju', name: '제주' },
  { code: 'gangneung', name: '강릉' },
  { code: 'yeosu', name: '여수' },
];

/**
 * TRIP-209 g01 '꼭 갈 곳' 섹션 — **화면이 그리는 표면**(Figma `1737:1083` default ·
 * `2226:1770` no-saved-places).
 *
 * 무엇을 보장하나: 이 섹션이 여행지 블록 아래에 서고, **완성된 얼굴 prop 하나로만** 네 모습
 * (자리표시 · 시드됨 · 0곳 · 조회실패)이 갈리며, 조회 실패 표시가 **얼굴을 덮지 않고 덧붙기만**
 * 하고(01b D5 · 문제로그 `2026-08-04`), 등록 실패 배너가 **여행 생성 실패 배너와 따로** 뜬다
 * (01b D2 — 둘이 섞이면 사용자가 [다시 시도]로 여행을 하나 더 만든다).
 * 화면은 담은 장소 목록도 조회 상태도 모른다 — 판정·문구 조립은 전부 `TripNewStep1Page` 몫이다.
 *
 * 왜 새 파일인가: `TripWizardStep1Screen.test.tsx`·`…errors.test.tsx`·`…budget.test.tsx`·
 * `…stayImport.test.tsx` 는 게이트①로 승인·동결된 파일이다. 이 사이클이 손대는 것은 첫 파일의
 * AC-13 **한 줄뿐**이고(02a §6-1), 나머지는 한 줄도 건드리지 않는다.
 *
 * 커버하지 않는 것: **언제** 어느 얼굴이 서는지(= 판정 규칙)는 `mustVisitSeed.test.ts`,
 * 조회·제거·등록 배선은 `TripNewStep1Page.mustVisit.test.tsx`·`…integration.test.tsx` 몫이다.
 * 색·점선·radius 10·아이콘 path 같은 픽셀 충실도는 [검증] 스크린샷 대조 몫이다.
 *
 * ⚠️ 매처 함정(02a ★9 · §5-1 실측): `toHaveTextContent('문자열')` 은 **완전 일치**다 —
 * `담은 곳 7곳` + `외 2곳` 이 든 컨테이너에 `toHaveTextContent('담은 곳 7곳')` 은 실패한다.
 * 부분 확인은 정규식, 정확한 문구는 `within(x).getByText('…')` 로 한다.
 *
 * 3동작 뼈대: 준비=props 조립(얼굴 prop 포함) → 실행=render(+press) → 단언=보이는 것 / 콜백.
 */

/**
 * 이 칸이 `TripWizardStep1ScreenProps` 에 더할 것(02a §2-3). **전부 optional 이어야 한다** —
 * 승인된 네 파일의 props 팩토리가 전 필드 전수 리터럴이라, 하나라도 필수로 만들면 그 승인
 * 파일들이 tsc 에서 깨진다(02a ★5 — TRIP-206·207·208 이 각각 밟은 함정).
 */
interface TripWizardStep1MustVisitProps {
  /** 이 섹션이 그릴 얼굴(완성형). **없으면 글자 없는 자리표시**. */
  mustVisitSection?: MustVisitSectionView;
  /** 담은 장소 조회가 실패했나. 얼굴은 그대로 두고 재시도 행만 덧붙인다(01b D5). */
  mustVisitSeedFailed?: boolean;
  /** 여행지 칩 아래 `담은 곳 N곳` 의 N — **서버 담은 장소 개수**다(01b D8). */
  savedPlaceCount?: number;
  /** must-visit 등록 실패 배너 본문(완성형). 없으면 배너 없음. */
  mustVisitError?: string;
  onRemoveMustVisit?(sourcePoiId: string): void;
  onPressMoreMustVisits?(): void;
  onRetryMustVisitSeeds?(): void;
  onRetryMustVisits?(): void;
}

type Props = TripWizardStep1ScreenProps & TripWizardStep1MustVisitProps;

/** Figma `1737:1084` 실측 문구. */
const SECTION_TITLE = '꼭 갈 곳';
const SEEDED_NOTE = '탐색에서 담은 곳을 그대로 가져왔어요';

/** Figma `2226:1770`(no-saved-places) 실측 문구. */
const EMPTY_NOTE = '지금 담지 않아도 AI가 추천해줘요';
const EMPTY_ACTION = '가고 싶은 곳 담기';

/** Figma `1740:1109` 실측 문구. */
const MORE_ACTION = '더 담기';

/** 조회 실패 부제 — Figma 에 프레임이 없는 **발명 문구**다(01b §4 · 게이트① 확정 대상). */
const SEED_FAILED_NOTE = '담은 곳을 불러오지 못했어요';
const RETRY_ACTION = '다시 시도';

function seed(
  sourcePoiId: string,
  name: string,
  imageUrl: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl };
}

const THREE_SEEDS = [
  seed('poi-1', '감천마을'),
  seed('poi-2', '광안리'),
  seed('poi-3', '전포'),
];

function seededView(
  thumbnails: MustVisitSeedItem[],
  overflowCount = 0
): MustVisitSectionView {
  return { kind: 'seeded', thumbnails, overflowCount };
}

/** 초기(빈) 드래프트 — '꼭 갈 곳' prop 은 하나도 없다(= 자리표시). */
function props(over: Partial<Props> = {}): Props {
  return {
    destinations: [],
    startDate: undefined,
    endDate: undefined,
    presetCode: undefined,
    party: 1,
    companionType: undefined,
    preferenceChips: [],
    regions: REGIONS,
    canProceed: false,
    onBack: jest.fn(),
    onAddDestination: jest.fn(),
    onRemoveDestination: jest.fn(),
    onSelectPreset: jest.fn(),
    onPressPeriod: jest.fn(),
    onChangeParty: jest.fn(),
    onSelectCompanion: jest.fn(),
    onChangePreference: jest.fn(),
    onNext: jest.fn(),
    ...over,
  };
}

function block() {
  return screen.getByTestId('trip-wizard-mustvisit-block');
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

describe('N3 · 시드 얼굴 — 담은 곳이 있을 때 (AC-1 · AC-2 · BR-U1-37)', () => {
  it('N3-1 제목·부제와 썸네일이 담은 곳 수만큼 보인다', () => {
    render(
      <TripWizardStep1Screen
        {...props({ mustVisitSection: seededView(THREE_SEEDS) })}
      />
    );

    expect(within(block()).getByText(SECTION_TITLE)).toBeOnTheScreen();
    expect(within(block()).getByText(SEEDED_NOTE)).toBeOnTheScreen();

    THREE_SEEDS.forEach((item) => {
      const thumb = screen.getByTestId(
        `trip-wizard-mustvisit-${item.sourcePoiId}`
      );
      // 이름표가 썸네일 **안에** 있다 — 화면 어딘가에 있기만 한 것과 다르다.
      expect(within(thumb).getByText(item.name)).toBeOnTheScreen();
    });
  });

  it('N3-2 상한을 넘은 만큼은 +N 하나로 접는다 (Figma 실측 · D9)', () => {
    // 준비 — 판정은 이미 끝나 있다(썸네일 3 + 접힌 2). 화면은 세지 않고 그리기만 한다.
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView(THREE_SEEDS, 2),
          savedPlaceCount: 5,
        })}
      />
    );

    const overflow = screen.getByTestId('trip-wizard-mustvisit-overflow');
    expect(within(overflow).getByText('+2')).toBeOnTheScreen();
    expect(within(overflow).getByText('외 2곳')).toBeOnTheScreen();

    // 부정 짝 — 접힌 항목이 썸네일로 새어 나오지 않는다. 긍정 짝은 바로 위 두 줄이 진다.
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-4')).toBeNull();
    expect(screen.getAllByTestId(/^trip-wizard-mustvisit-poi-/)).toHaveLength(
      3
    );
  });

  it('N3-3 사진이 있으면 그리고, 없으면 자리만 둔다 (AC-3 — 기본 이미지를 지어내지 않는다)', () => {
    // 두 항목이 서로의 긍정 짝이다 — 하나만 두면 "이미지를 아예 안 그리는" 구현도 통과한다.
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView([
            seed('poi-1', '감천마을', 'https://cdn.example.com/a.jpg'),
            seed('poi-2', '광안리', null),
          ]),
        })}
      />
    );

    expect(
      screen.getByTestId('trip-wizard-mustvisit-image-poi-1')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-mustvisit-image-poi-2')
    ).toBeNull();
    // 사진이 없어도 항목 자체는 남는다(이름표까지).
    expect(
      within(screen.getByTestId('trip-wizard-mustvisit-poi-2')).getByText(
        '광안리'
      )
    ).toBeOnTheScreen();
  });

  it('N3-4 x 를 누르면 그 항목의 식별자로만 콜백이 오른다 (AC-5)', () => {
    const onRemoveMustVisit = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView(THREE_SEEDS),
          onRemoveMustVisit,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-remove-poi-2'));

    // 화면은 무엇을 지울지 판단하지 않는다 — 누가 눌렸는지만 정확히 올린다.
    expect(onRemoveMustVisit).toHaveBeenCalledTimes(1);
    expect(onRemoveMustVisit).toHaveBeenCalledWith('poi-2');
  });

  it('N3-5 점선 「더 담기」를 누르면 콜백이 오른다 (AC-6)', () => {
    const onPressMoreMustVisits = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView(THREE_SEEDS),
          onPressMoreMustVisits,
        })}
      />
    );

    const more = screen.getByTestId('trip-wizard-mustvisit-more');
    expect(within(more).getByText(MORE_ACTION)).toBeOnTheScreen();

    fireEvent.press(more);

    expect(onPressMoreMustVisits).toHaveBeenCalledTimes(1);
  });
});

describe('N3 · 0곳 얼굴 — 섹션을 감추지 않는다 (AC-4 · Figma no-saved-places)', () => {
  it('N3-6 부제와 점선 하나만 남고 썸네일·더담기·재시도는 없다', () => {
    const onPressMoreMustVisits = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: { kind: 'empty' },
          onPressMoreMustVisits,
        })}
      />
    );

    // 긍정 — 섹션은 **그대로 서 있다**(감추면 담은 곳이 0인 사용자가 이 기능을 영영 모른다).
    expect(within(block()).getByText(SECTION_TITLE)).toBeOnTheScreen();
    expect(within(block()).getByText(EMPTY_NOTE)).toBeOnTheScreen();
    const empty = screen.getByTestId('trip-wizard-mustvisit-empty');
    expect(within(empty).getByText(EMPTY_ACTION)).toBeOnTheScreen();

    // 부정 — 시드 얼굴의 부품이 하나도 새어 나오지 않는다.
    expect(screen.queryByTestId('trip-wizard-mustvisit-more')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-mustvisit-overflow')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-mustvisit-retry')).toBeNull();
    expect(block()).not.toHaveTextContent(new RegExp(SEEDED_NOTE));

    // 같은 곳으로 간다 — 0곳 얼굴의 점선도 d04 로 보낸다(AC-6).
    fireEvent.press(empty);
    expect(onPressMoreMustVisits).toHaveBeenCalledTimes(1);
  });

  it('N3-12 시드가 0곳이어도 [다음]을 막지 않는다 (AC-4)', () => {
    // 선제 green(회귀 앵커) — `[다음]` 은 받은 `canProceed` 하나로만 갈린다. 이 섹션이
    // 게이트에 끼어드는 구현이 나중에 들어오면 여기서 걸린다.
    render(
      <TripWizardStep1Screen
        {...props({ mustVisitSection: { kind: 'empty' }, canProceed: true })}
      />
    );

    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();
  });
});

describe('🔴 N3 · 조회 실패 얼굴 — 0곳과 반드시 구분된다 (01b D5 · INV-4)', () => {
  it('N3-7 실패 부제와 재시도가 뜨고, 0곳 얼굴의 점선은 없다', () => {
    const onRetryMustVisitSeeds = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: { kind: 'failed' },
          mustVisitSeedFailed: true,
          onRetryMustVisitSeeds,
        })}
      />
    );

    // 제목은 유지된다 — 섹션이 통째로 사라지면 사용자는 무엇이 실패했는지도 모른다.
    expect(within(block()).getByText(SECTION_TITLE)).toBeOnTheScreen();
    expect(within(block()).getByText(SEED_FAILED_NOTE)).toBeOnTheScreen();

    const retry = screen.getByTestId('trip-wizard-mustvisit-retry');
    expect(within(retry).getByText(RETRY_ACTION)).toBeOnTheScreen();

    // ★ 이 두 줄이 D5 의 전부다 — 0곳 얼굴로 떨어뜨리면 담아 둔 게 있는 사용자에게
    // "담은 게 없다"는 거짓말을 한다(실제로는 못 불러온 것이다).
    expect(screen.queryByTestId('trip-wizard-mustvisit-empty')).toBeNull();
    expect(block()).not.toHaveTextContent(new RegExp(EMPTY_NOTE));

    fireEvent.press(retry);
    expect(onRetryMustVisitSeeds).toHaveBeenCalledTimes(1);
  });

  it('N3-8 이미 받아 둔 썸네일이 있으면 그것을 지우지 않고 재시도만 덧붙인다', () => {
    // ⚠️ 미해결 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`(TRIP-222·223 2회
    // 반복)의 재발 방지 심판이다. 실패했다고 얼굴을 갈아 끼우면 방금까지 보이던 목록이 사라진다.
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView(THREE_SEEDS),
          mustVisitSeedFailed: true,
        })}
      />
    );

    THREE_SEEDS.forEach((item) => {
      expect(
        screen.getByTestId(`trip-wizard-mustvisit-${item.sourcePoiId}`)
      ).toBeOnTheScreen();
    });
    expect(screen.getByTestId('trip-wizard-mustvisit-retry')).toBeOnTheScreen();
    // 실패를 숨기지도 않고(BR-U1-55 침묵 실패 금지), 얼굴을 갈아 끼우지도 않았다.
    expect(screen.queryByTestId('trip-wizard-mustvisit-empty')).toBeNull();
  });
});

describe('N3 · 자리표시 — 판정 전에는 글자를 그리지 않는다', () => {
  it('N3-9 블록은 서 있고 한글이 한 자도 없다', () => {
    // 컨테이너가 아직 판정을 안 내려준 상태. 여기서 "담은 곳이 없어요" 를 그리면 담아 둔
    // 사용자에게 한 순간 거짓말을 하게 되고, 승인 동결 파일들의 텍스트 단언 모집단도
    // 넓어진다(02a ★11 — 그 파일들은 이 훅을 로딩으로 목킹해 살린다).
    render(<TripWizardStep1Screen {...props()} />);

    expect(block()).toBeOnTheScreen();
    expect(block()).not.toHaveTextContent(/[가-힣]/);

    // 짝(긍정) — 화면 나머지는 정상이다. 없으면 아무것도 안 그리는 구현이 공짜로 통과한다.
    expect(root()).toHaveTextContent(/언제 가세요\?/);
  });
});

describe('N3 · 담은 곳 N곳 캡션 (01b D8)', () => {
  it('N3-10 개수가 있으면 캡션이 보이고, 0이면 캡션 자체가 없다', () => {
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView(THREE_SEEDS),
          savedPlaceCount: 3,
        })}
      />
    );

    // ⚠️ 완전 일치 매처를 쓰지 않는다 — 캡션은 여행지 블록 안의 합성 텍스트 위에 있다(★9).
    expect(
      within(screen.getByTestId('trip-wizard-saved-place-count')).getByText(
        '담은 곳 3곳'
      )
    ).toBeOnTheScreen();

    screen.rerender(
      <TripWizardStep1Screen
        {...props({ mustVisitSection: { kind: 'empty' }, savedPlaceCount: 0 })}
      />
    );

    // 0곳에는 캡션을 그리지 않는다(Figma no-saved-places 에 그 노드가 아예 없다).
    expect(screen.queryByTestId('trip-wizard-saved-place-count')).toBeNull();
  });
});

describe('🔴 N3 · 등록 실패 배너 — 여행 생성 실패 배너와 섞이지 않는다 (01b D2·D4)', () => {
  it('N3-11 등록 배너만 뜨고 제출 배너는 없으며, 재시도는 등록 쪽 콜백을 부른다', () => {
    // ⚠️ 문제로그 `2026-08-02 성공 후 부작용을 try가 감싸면 성공이 실패로 둔갑한다`.
    // 두 배너가 하나로 합쳐지면 [다시 시도]가 `submit` 을 다시 타서 **여행이 하나 더 만들어진다**
    // (되돌릴 수 없다). 화면 층에서 둘을 갈라 두는 것이 그 방어의 절반이다.
    const onRetryMustVisits = jest.fn();
    const onRetrySubmit = jest.fn();
    const NOTICE = '꼭 갈 곳 3곳 중 1곳을 등록하지 못했어요';

    render(
      <TripWizardStep1Screen
        {...props({
          mustVisitSection: seededView(THREE_SEEDS),
          mustVisitError: NOTICE,
          onRetryMustVisits,
          onRetrySubmit,
        })}
      />
    );

    const banner = screen.getByTestId('trip-wizard-mustvisit-banner');
    expect(within(banner).getByText(NOTICE)).toBeOnTheScreen();

    // 부정 — 여행 생성 실패 배너는 뜨지 않는다(그쪽 재시도는 여행을 다시 만든다).
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-banner-retry'));

    expect(onRetryMustVisits).toHaveBeenCalledTimes(1);
    expect(onRetrySubmit).not.toHaveBeenCalled();
  });

  it('N3-11b 등록 실패 문구가 없으면 배너도 없다 (짝)', () => {
    render(
      <TripWizardStep1Screen
        {...props({ mustVisitSection: seededView(THREE_SEEDS) })}
      />
    );

    expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull();
    // 짝(긍정) — 섹션 자체는 정상적으로 그려졌다.
    expect(screen.getByTestId('trip-wizard-mustvisit-poi-1')).toBeOnTheScreen();
  });
});
