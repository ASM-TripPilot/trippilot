import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * 옛 목적지 상세 딥링크(`/explore/destination/{code}`) — TRIP-1105 로 화면은 탐색 탭 d01 의 지역
 * 필터로 합쳐졌다. 옛 주소로 들어와도 빈 화면이 아니라 같은 지역으로 좁힌 d01 에 닿게 넘기기만 한다
 * (조회·마크업 0). 코드를 그대로 싣고, 이름 역인덱스는 도착한 d01 이 한다.
 */
export default function DestinationRoute() {
  const { region } = useLocalSearchParams<{ region?: string }>();
  return <Redirect href={{ pathname: '/explore', params: { region } }} />;
}
