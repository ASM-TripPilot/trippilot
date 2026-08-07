"""Bazel py_test 안에서 pytest 를 돌리는 진입점.

rules_python 의 py_test 는 unittest 를 전제로 하므로, pytest 로 작성된
기존 테스트를 그대로 쓰려면 이렇게 얇은 러너를 하나 끼워야 한다.
`uv run pytest` 와 같은 테스트를 같은 소스로 돌린다 — 러너만 다르다.
"""

import os
import sys

import pytest


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))

    # hypothesis 는 예제 DB 를 디스크에 쓴다. Bazel 의 runfiles 는 읽기 전용으로
    # 다뤄야 하므로 테스트 임시 디렉토리로 돌린다 — 안 그러면 첫 PBT 에서 죽는다.
    tmp = os.environ.get("TEST_TMPDIR", "/tmp")
    os.environ.setdefault(
        "HYPOTHESIS_STORAGE_DIRECTORY",
        os.path.join(tmp, "hypothesis"),
    )

    args = sys.argv[1:] or [os.path.join(here, "tests")]
    return pytest.main([
        "-q",
        # .pytest_cache 를 runfiles 에 만들려다 실패하는 것을 막는다.
        "-p",
        "no:cacheprovider",
        *args,
    ])


if __name__ == "__main__":
    sys.exit(main())
