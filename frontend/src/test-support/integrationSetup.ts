import { configure } from '@testing-library/react-native';

/**
 * 통합 버킷(MSW) 전 파일 공통 — 비동기 대기(`findBy*`·`waitFor`) 기본 상한을 1초에서 5초로 올린다(TRIP-1365).
 *
 * 왜: 이 버킷의 파일은 **첫 테스트**가 첫 렌더·첫 요청 때 늦게 읽히는 모듈을 그때 처음 변환·로드한다
 * (inlineRequires). 변환 캐시가 식었을 때(`--no-cache`) 한 화면의 409→안내 얼굴이 52ms → 553ms, 렌더가 55 → 379ms 로
 * 불어나고, 전체 버킷의 CPU 경합(워커 18+)이 겹치면 1초를 넘긴다. 실측: `GeneratingPage.integration` G1(안내 대신 일반
 * 생성 얼굴이 그려진 채 시간 초과), 같은 날 냉캐시 전체 실행에서 `MyTripsListPage` 첫 테스트·`StayRegisterPage` I-1 도
 * "Unable to find testID" 로 같은 모양이었다. 단독 재실행(데운 캐시)은 통과한다.
 *
 * 기다림은 나타나는 즉시 끝나므로 상한을 올려도 green 은 느려지지 않는다 — red 일 때의 대기만 길어진다. 파일이 상한을
 * 따로 정해야 하면 호출마다 `{ timeout }` 을 주거나 그 파일에서 `configure` 로 덮는다(`AssistantSheetPage.test` 선례).
 */
configure({ asyncUtilTimeout: 5000 });
