import { usePreventRemove } from '@react-navigation/native';
import { useNavigation, useRouter } from 'expo-router';

/**
 * 직접 짜기 편집기의 ‹ · iOS 스와이프 · Android 하드웨어 뒤로를 모두 일정 탭으로 보낸다
 * (TRIP-1264 · TRIP-1009 01b Q3 "저장 여부와 무관하게 항상 일정 탭"). 반환값이 ‹ 가 부를 함수다.
 *
 * - `gestureEnabled:false` 는 기각 — iOS 스와이프가 무반응이 될 뿐 일정 탭에 닿지 않고, Android 뒤로는 그대로 샌다.
 * - raw `beforeRemove` 리스너는 기각 — iOS 스와이프를 네이티브에서 취소하는 `preventNativeDismiss` 는
 *   `usePreventRemove` 가 채우는 컨텍스트에서만 온다. 리스너만으론 JS 이동만 막히고 스와이프는 빠져나간다.
 * - 뒤로 계열(GO_BACK·POP)만 바꾸고 나머지(‹ 의 POP_TO·확정 REPLACE·로그아웃 POP_TO_TOP)는 받은 액션
 *   객체를 그대로 다시 보낸다 — 이 화면 "물어봤음" 표시가 붙어 있어 두 번째엔 통과한다. 새로 만들면 무한 반복.
 */
export function useItineraryTabBack(): () => void {
  const router = useRouter();
  const navigation = useNavigation();
  const goItineraryTab = () => router.dismissTo('/(tabs)/itinerary');

  usePreventRemove(true, ({ data }) => {
    if (data.action.type === 'GO_BACK' || data.action.type === 'POP') {
      goItineraryTab();
      return;
    }
    navigation.dispatch(data.action);
  });

  return goItineraryTab;
}
