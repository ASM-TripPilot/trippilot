/**
 * 큰 글자 판정(TRIP-1270). `fontScale` 은 iOS [손쉬운 사용 > 더 큰 텍스트] 단계를 RN 이 바꾼 배율이다 —
 * 기본 1.0, 일반 최대 1.353, 접근성 단계 진입 1.786, 최대 3.571. 1.5 는 일반 단계와 접근성 단계를 가르는
 * 자리라, 화면이 각자 숫자를 박지 않고 이 경계 하나를 쓴다(경계값 포함).
 */
export function isLargeText(fontScale: number): boolean {
  return fontScale >= 1.5;
}
