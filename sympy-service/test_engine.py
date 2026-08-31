"""Unit tests for the SymPy calculation engine."""

import json

import pytest

from engine import (
    ComputationError,
    ParseError,
    UnsupportedExpressionError,
    continuity_check,
    integrate,
    limit,
    rank,
    rref,
)


def test_integrate_polynomial():
    result = integrate("x^2", "x")
    assert "x**3/3" in result


def test_integrate_sin():
    result = integrate("sin(x)", "x")
    assert "cos(x)" in result


def test_limit_right_infinity():
    result = limit("1/x", "x", 0, "+")
    assert result in {"oo", "inf", "zoo"}


def test_limit_polynomial():
    result = limit("x^2", "x", 2)
    assert result == "4"


def test_limit_left_direction():
    result = limit("1/x", "x", 0, "-")
    assert result in {"-oo", "-inf", "zoo"}


def test_continuity_pole():
    assert continuity_check("1/x", "x", 0) is False


def test_continuity_polynomial():
    assert continuity_check("x^2 + 1", "x", 2) is True


def test_rank_dependent_rows():
    assert rank("[[1,2],[2,4]]") == 1


def test_rank_identity():
    assert rank("[[1,0],[0,1]]") == 2


def test_rref_simple():
    raw = rref("[[1,2],[2,4]]")
    parsed = json.loads(raw)
    assert "rref" in parsed
    assert "pivot_columns" in parsed
    assert parsed["pivot_columns"] == [0]


def test_malformed_parse_error():
    with pytest.raises(ParseError):
        integrate("x^^2", "x")


def test_injection_rejected():
    with pytest.raises(ParseError):
        integrate("__import__('os')", "x")


def test_invalid_matrix_rejected():
    with pytest.raises((ParseError, ComputationError)):
        rank("[[1,2],[3]]")


def test_limit_without_direction():
    result = limit("x^2 + 1", "x", 2)
    assert result == "5"


def test_rank_mathjs_matrix():
    assert rank("matrix([1,2],[2,4])") == 1
