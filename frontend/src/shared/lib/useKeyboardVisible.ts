import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * 소프트 키보드가 떠 있나. iOS 는 Will* 이 먼저, Android 는 Did* 만 오므로 4종을 모두 듣는다.
 * (TRIP-1514 인라인 구독을 승격 — 시트도 같은 감지가 필요하다.)
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = (): void => setVisible(true);
    const hide = (): void => setVisible(false);
    const subs = [
      Keyboard.addListener('keyboardWillShow', show),
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardWillHide', hide),
      Keyboard.addListener('keyboardDidHide', hide),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);
  return visible;
}
