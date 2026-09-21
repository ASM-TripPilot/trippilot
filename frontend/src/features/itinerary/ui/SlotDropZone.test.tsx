import { render, screen } from '@testing-library/react-native';

import { SlotDropZone } from './SlotDropZone';

/**
 * TRIP-797 · AC-9 — h12 편집기 드래그 삭제 드롭존(신규 컴포넌트).
 *
 * 드래그 중 하단 CTA 자리를 대체하는 "여기에 놓으면 삭제돼요" 표면. **실제 드롭 삭제·빨강 점선 색은
 * jest 원리적 사각**(드래그 제스처·색 className은 목이 못 봄, 02a ★7) — 이 파일은 **정적 얼굴**만
 * 잠근다: 문구·testID 존재와 `isActive`(끌기 대상이 드롭존 위) 표식 전환.
 *
 * 3동작 뼈대: 준비=isActive 유무 → 실행=렌더 → 단언=testID·문구·활성 표식 존재/부재.
 */

describe('🔴 SlotDropZone · B2-1 — 문구·testID 존재', () => {
  it('드롭존 컨테이너와 삭제 안내 문구를 그린다', () => {
    render(<SlotDropZone />);
    expect(screen.getByTestId('itinerary-edit-dropzone')).toBeOnTheScreen();
    expect(screen.getByText('여기에 놓으면 삭제돼요')).toBeOnTheScreen();
  });
});

describe('🔴 SlotDropZone · B2-2/3 — isActive 표식 전환(색은 사각, 표식으로 계약)', () => {
  it('isActive 면 활성 표식이 뜬다', () => {
    render(<SlotDropZone isActive />);
    expect(
      screen.getByTestId('itinerary-edit-dropzone-active')
    ).toBeOnTheScreen();
  });

  it('isActive 미전달이면 활성 표식이 없다(부정 짝)', () => {
    render(<SlotDropZone />);
    expect(screen.queryByTestId('itinerary-edit-dropzone-active')).toBeNull();
  });
});
