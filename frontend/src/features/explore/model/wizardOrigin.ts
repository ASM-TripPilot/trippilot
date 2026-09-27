/**
 * 위저드 → d04(장소 탐색) "진입 출처" 파라미터 철자의 단일 출처 (TRIP-1026).
 *
 * 보내는 쪽(1/4 '더 담기'·d02 select '더 담기'/'둘러보기')은 `wizardOriginParams()`를 push params 에
 * 펼치고, 받는 쪽(d04 페이지)은 `isWizardOrigin(params)`로 판정한다 — 양쪽이 철자를 각자 적으면
 * 오타가 조용히 통과한다(`regionPickerPurpose` 선례). `region`은 신호가 아니다(d03·피커도 싣는다).
 */
export type WizardOriginParams = { from: 'wizard' };

export function wizardOriginParams(): WizardOriginParams {
  return { from: 'wizard' };
}

/** expo-router 는 같은 키가 반복되면 배열로 준다 — 배열 안에 있어도 위저드 출처로 본다. */
export function isWizardOrigin(
  params: Readonly<Record<string, string | string[] | undefined>>
): boolean {
  const from = params.from;
  return Array.isArray(from) ? from.includes('wizard') : from === 'wizard';
}
