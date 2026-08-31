import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
} from './DailyReflectionScreen';

/**
 * TRIP-571 · AC-5(BR-U5-36)·AC-6(§7 폼검증) — j03 회고 화면(순수 프레젠테이션, VM 주입).
 * 조회·표시본 조립은 페이지 몫이라 여기선 완성 VM 을 props 로 넣고 렌더·편집 계약만 잠근다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-5: error·empty 얼굴 CTA "직접 회고 작성" press → **편집 진입 콜백 1회**(생성 없이 편집 진입).
 *  - 🔴 AC-6: 회고 수정 입력 상한 = **4000**(2000 아님, 서버 권위) · **빈/공백 문자열 → 저장 비활성 +
 *    저장 콜백 0회**(초안 보존 — 덮어쓰기 불가).
 *  - 렌더 스모크(긍정 앵커): default 얼굴이 표시본·통계·사진 그리드를 실제로 그린다(빈 화면 아님).
 *
 * 왜 이렇게 테스트하나(02a ★6·★7·★8·★9):
 *  - CTA 상태 분기 — default/data-insufficient="확인", empty/error="직접 회고 작성". 편집 진입 컨트롤은
 *    얼굴당 1개라 `reflection-daily-edit` 단일 testID 로 충돌 없이 재사용.
 *  - 4000 = `EditReflectionRequest.maxLength`(서버 권위) — 티켓 "2000"은 visit_memo 오전이(맹점⑤).
 *  - 빈 문자열은 `toBeDisabled()` + 콜백 0회 짝으로 잠근다(`fireEvent.press`는 disabled 를 안 막으므로).
 *  - 화면은 `source` 로 UI 를 분기하지 않는다(VM 에 source 자리 없음 — 구조적 차단, 맹점②).
 *
 * (개념) `getByText('문자열')`=leaf 완전일치 · `getByTestId(id).props.maxLength`=RN TextInput 실 prop 판독 ·
 *   `toBeDisabled()`=실제 disabled 판독(단순 flag 아님) — 02a §5 실검증(MyStaysScreen 선례 인용).
 *
 * INV-3: 이 파일 fixture 에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(소스 스캔 오탐 방지, ★10).
 */

const NARRATIVE = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

function baseProps(
  over: Partial<DailyReflectionScreenProps> = {}
): DailyReflectionScreenProps {
  const onEnterEdit = jest.fn();
  const onConfirm = jest.fn();
  const onSaveEdit = jest.fn();
  return {
    face: 'default',
    narrative: NARRATIVE,
    editableText: NARRATIVE,
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    distanceDash: false,
    mapNotice: null,
    hidePhotoGrid: false,
    photos: [{ uri: 'file://p1.jpg' }, { uri: 'file://p2.jpg' }],
    changeSummary: null,
    onEnterEdit,
    onConfirm,
    onSaveEdit,
    ...over,
  };
}

function renderScreen(over: Partial<DailyReflectionScreenProps> = {}) {
  const props = baseProps(over);
  render(<DailyReflectionScreen {...props} />);
  return props;
}

describe('렌더 스모크 · default 얼굴이 빈 화면이 아니다(긍정 앵커)', () => {
  it('표시본·통계·사진 그리드를 그린다', () => {
    renderScreen({ face: 'default' });

    expect(screen.getByText(NARRATIVE)).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-stats')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-photo-grid')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · 직접 회고 작성 진입(BR-U5-36)', () => {
  it('empty 얼굴 CTA press 는 편집 진입 콜백을 정확히 1회 부른다', () => {
    const { onEnterEdit } = renderScreen({
      face: 'empty',
      narrative: '오늘 기록된 활동이 없습니다.',
      editableText: '',
      photos: [],
      hidePhotoGrid: true,
    });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(onEnterEdit).toHaveBeenCalledTimes(1);
  });

  it('error 얼굴 CTA press 도 편집 진입 콜백을 1회 부른다', () => {
    const { onEnterEdit } = renderScreen({
      face: 'error',
      narrative: '회고를 불러오지 못했어요.',
      editableText: '',
      photos: [],
      hidePhotoGrid: true,
    });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(onEnterEdit).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC-6 · 회고 수정 폼검증(§7 · 상한 4000)', () => {
  it('편집을 열면 입력 상한이 4000 이다(2000 아님 — 서버 권위)', () => {
    renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    const input = screen.getByTestId('reflection-daily-edit-input');
    expect(input.props.maxLength).toBe(4000);
  });

  it('빈 문자열이면 저장 버튼이 비활성이고 press 해도 저장 콜백이 0회다(초안 보존)', () => {
    const { onSaveEdit } = renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(screen.getByTestId('reflection-daily-edit-input'), '');

    const save = screen.getByTestId('reflection-daily-edit-save');
    expect(save).toBeDisabled();

    fireEvent.press(save);
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it('공백만 입력도 비활성 + 저장 0회다(trim)', () => {
    const { onSaveEdit } = renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      '   '
    );

    expect(screen.getByTestId('reflection-daily-edit-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it('내용이 있으면 저장이 활성이고 press 시 그 텍스트로 1회 저장한다(짝)', () => {
    const { onSaveEdit } = renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      '오늘은 정말 좋은 하루였어요.'
    );

    const save = screen.getByTestId('reflection-daily-edit-save');
    expect(save).not.toBeDisabled();

    fireEvent.press(save);
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).toHaveBeenCalledWith('오늘은 정말 좋은 하루였어요.');
  });
});
