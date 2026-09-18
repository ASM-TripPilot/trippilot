"""자유형 dict(payload/params/slots/expected) generator — 직렬화 가능 원시값만."""

from __future__ import annotations

from hypothesis import strategies as st


def json_scalars() -> st.SearchStrategy:
    return st.one_of(
        st.none(),
        st.booleans(),
        st.integers(min_value=-1000, max_value=1000),
        st.floats(allow_nan=False, allow_infinity=False),
        st.text(max_size=15),
    )


def json_dicts() -> st.SearchStrategy[dict]:
    return st.dictionaries(
        keys=st.text(min_size=1, max_size=8), values=json_scalars(), max_size=4
    )
