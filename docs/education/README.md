# TripPilot 교육 자료

[상세 강의](terraform-actions-aws-course.html)와 [발표 자료](terraform-actions-aws-course-ppt.html)는 같은 장 순서로 Terraform, GitHub Actions, 로컬에서 AWS DEV·PRD까지의 배포를 다룹니다. [로컬 Kubernetes·관측성 수업](k8s-observability-class.html)은 별도 자료입니다.

PR #645의 실습·해설·확장 설계를 유지하면서 SceneTrip PR #98의 녹색 스타일, 장별 요약, 강사 노트, 구현 출처 형식으로 정리했습니다. AWS 설명은 TripPilot의 NLB, Redis, 선택형 embedding, pgvector, Docker 이미지 빌드에 맞춰져 있습니다. Cloudflare DNS 자동화와 동일 digest 승격은 **확장 학습**으로 구분합니다.

## 읽기와 발표

HTML 파일을 브라우저에서 엽니다. 스타일, 발표 스크립트, 본문 구성도를 각 HTML 안에 포함하므로 인터넷이나 웹 서버 없이 읽을 수 있습니다. 저장소 근거 파일과 별도 구성도 원본 링크까지 열려면 저장소 디렉터리 구조를 유지합니다. 공식 문서 링크는 인터넷 연결이 필요합니다.

- 발표 이동: `←` / `→`, `PageUp` / `PageDown`, `Space` / `Shift+Space`, `Home` / `End`.
- 목차·장 선택으로 이동하고 강사 노트·읽기·전체 화면을 전환할 수 있습니다. 버튼·링크·입력 요소를 조작하는 동안에는 발표 단축키가 개입하지 않습니다.
- 각 장의 링크로 상세 설명과 발표 요약을 오갑니다. 기존 발표의 장 링크도 유지합니다.
- JavaScript를 끄면 모든 장을 표시합니다. 브라우저 인쇄는 전체 내용을 출력하며, 상세 강의의 접힌 해설도 포함합니다. 발표 인쇄에서는 강사 노트를 숨깁니다.

## 수정과 생성

생성한 두 HTML을 직접 수정하지 않고 아래 정본을 수정합니다.

| 파일 | 내용 |
|---|---|
| [assets/course_content.py](assets/course_content.py) | 장 순서·제목·발표 요약·강사 노트·구현 출처·기존 링크 별칭 |
| `assets/chapters/<장 ID>.html` | 상세 강의 본문·코드 예제·실습·해설·공식 문서 링크 |
| [assets/course.css](assets/course.css) | 상세 강의·발표 공통 스타일과 반응형·인쇄 규칙 |
| [assets/course-navigation.js](assets/course-navigation.js) | 발표 탐색과 접근성 동작 |
| [assets/build_course.py](assets/build_course.py) | 정본을 단일 HTML로 생성하고 링크·산출물 차이를 검사 |

저장소 루트에서 실행합니다. 생성기에는 Python 표준 라이브러리만 필요합니다.

```sh
python3 docs/education/assets/build_course.py
python3 docs/education/assets/build_course.py --check
```

`--check`는 파일을 변경하지 않습니다. 정본과 생성물이 다르거나 로컬 문서 링크가 잘못되면 실패합니다. 다른 디렉터리에서 실행할 때는 `--root /path/to/trippilot`로 저장소를 지정할 수 있습니다.

구성도의 원본·생성기·SHA-256 출처는 그대로 [assets/README-diagrams.md](assets/README-diagrams.md)에서 관리합니다. 인프라 변경 후 구성도를 재생성했다면 위 HTML 생성기도 다시 실행해 인라인 구성도에 반영합니다. 교육용 구성도는 실제 AWS 계정을 조회한 운영 기록이 아닙니다.

## 검증

```sh
python3 -m unittest discover -s docs/education/tests -p 'test_build_course.py'
node --experimental-test-coverage --test docs/education/tests/course-navigation.test.cjs
```

Python 생성기 coverage를 확인할 경우 별도 가상 환경에 `coverage`를 설치합니다.

```sh
python3 -m venv /tmp/trippilot-education-venv
/tmp/trippilot-education-venv/bin/pip install coverage
/tmp/trippilot-education-venv/bin/coverage run \
  --data-file=/tmp/trippilot-education.coverage --source=build_course,course_content \
  -m unittest discover -s docs/education/tests -p 'test_build_course.py'
/tmp/trippilot-education-venv/bin/coverage report \
  --data-file=/tmp/trippilot-education.coverage --fail-under=80
```

내용·생성 계약 테스트와 함께 브라우저에서 데스크톱·모바일, 기존 장 링크, 목차·강사 노트·읽기 모드, 인쇄와 JavaScript 비활성 상태를 확인합니다.
