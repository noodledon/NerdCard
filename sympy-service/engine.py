"""Pure SymPy wrappers for the five supported math operations."""

import json
import re
from typing import Any, Final

import sympy as sp

from errors import ComputationError, ParseError, UnsupportedExpressionError

_FORBIDDEN_RE: Final = re.compile(
    r"\b(import|os|eval|exec)\b|__|\.\s*[A-Za-z_]",
)

_SAFE_LOCALS: Final[dict[str, Any]] = {
    name: getattr(sp, name)
    for name in (
        "sin",
        "cos",
        "tan",
        "exp",
        "log",
        "sqrt",
        "pi",
        "E",
        "oo",
        "Rational",
        "Integer",
        "Float",
        "Matrix",
    )
}


def _validate_math_string(value: str) -> str:
    """Reject empty or obviously non-math input."""
    if not value or not value.strip():
        raise ParseError("expression is empty")
    if _FORBIDDEN_RE.search(value):
        raise ParseError("disallowed token in expression")
    return value.strip()


def _sympify_expression(expr: str, variable: str) -> sp.Expr:
    """Parse a math expression with a restricted local namespace."""
    cleaned = _validate_math_string(expr)
    locals_dict = {
        variable: sp.Symbol(variable),
        **_SAFE_LOCALS,
    }
    try:
        return sp.sympify(cleaned, locals=locals_dict, evaluate=False)
    except sp.SympifyError as exc:
        raise ParseError(f"parse error: could not parse '{expr}'") from exc
    except (TypeError, ValueError) as exc:
        raise ParseError(f"parse error: {exc}") from exc


def _split_top_level(value: str) -> list[str]:
    """Split ``value`` by commas that are not inside brackets or parentheses."""
    parts: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(value):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(value[start:i])
            start = i + 1
    trailing = value[start:]
    if trailing.strip():
        parts.append(trailing)
    return parts


def _parse_mathjs_matrix(value: str) -> sp.Matrix | None:
    """Parse mathjs-style ``matrix([1,2],[3,4])`` into a SymPy Matrix."""
    cleaned = value.strip()
    if not (cleaned.lower().startswith("matrix(") and cleaned.endswith(")")):
        return None
    inner = cleaned[7:-1].strip()
    rows = _split_top_level(inner)
    if not rows or not all(row.strip().startswith("[") for row in rows):
        return None
    try:
        data = [json.loads(row.strip()) for row in rows]
        return sp.Matrix(data)
    except (json.JSONDecodeError, ValueError):
        return None


def _parse_matrix(matrix_str: str) -> sp.Matrix:
    """Parse a JSON array of arrays or a SymPy-compatible matrix string."""
    cleaned = _validate_math_string(matrix_str)

    mathjs_matrix = _parse_mathjs_matrix(cleaned)
    if mathjs_matrix is not None:
        return mathjs_matrix

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return sp.Matrix(parsed)
    except json.JSONDecodeError:
        pass
    except ValueError as exc:
        raise ParseError(f"parse error: {exc}") from exc

    try:
        value = sp.sympify(cleaned, locals=_SAFE_LOCALS, evaluate=False)
        if isinstance(value, sp.Matrix):
            return value
    except sp.SympifyError as exc:
        raise ParseError(f"parse error: could not parse matrix '{matrix_str}'") from exc
    except (TypeError, ValueError) as exc:
        raise ParseError(f"parse error: {exc}") from exc

    raise ParseError("parse error: expected a matrix")


def _parse_point(point: str | int | float) -> sp.Basic:
    """Parse a numeric point into a SymPy number."""
    try:
        return sp.sympify(str(point), rational=True)
    except sp.SympifyError as exc:
        raise ParseError(f"parse error: could not parse point '{point}'") from exc
    except (TypeError, ValueError) as exc:
        raise ParseError(f"parse error: {exc}") from exc


def integrate(expr: str, variable: str) -> str:
    """Symbolically integrate ``expr`` with respect to ``variable``."""
    parsed = _sympify_expression(expr, variable)
    var = sp.Symbol(variable)
    try:
        result = sp.integrate(parsed, var)
    except NotImplementedError as exc:
        raise UnsupportedExpressionError("unsupported expression") from exc
    except Exception as exc:
        raise ComputationError(f"computation error: {exc}") from exc
    return str(result)


def limit(
    expr: str,
    variable: str,
    point: str | int | float,
    direction: str | None = None,
) -> str:
    """Evaluate the limit of ``expr`` as ``variable`` approaches ``point``."""
    parsed = _sympify_expression(expr, variable)
    var = sp.Symbol(variable)
    parsed_point = _parse_point(point)

    kwargs: dict[str, str] = {}
    if direction in {"+", "-"}:
        kwargs["dir"] = direction

    try:
        result = sp.limit(parsed, var, parsed_point, **kwargs)
    except NotImplementedError as exc:
        raise UnsupportedExpressionError("unsupported expression") from exc
    except Exception as exc:
        raise ComputationError(f"computation error: {exc}") from exc
    return str(result)


def continuity_check(expr: str, variable: str, point: str | int | float) -> bool:
    """Return whether ``expr`` is continuous at ``point``."""
    parsed = _sympify_expression(expr, variable)
    var = sp.Symbol(variable)
    parsed_point = _parse_point(point)

    try:
        value_at_point = parsed.subs(var, parsed_point)
        if not value_at_point.is_finite:
            return False
        lim = sp.limit(parsed, var, parsed_point)
        return bool(lim == value_at_point)
    except NotImplementedError as exc:
        raise UnsupportedExpressionError("unsupported expression") from exc
    except Exception as exc:
        raise ComputationError(f"computation error: {exc}") from exc


def rref(matrix_str: str) -> str:
    """Return the reduced row echelon form of ``matrix_str`` as JSON."""
    matrix = _parse_matrix(matrix_str)
    try:
        reduced, pivots = matrix.rref()
    except NotImplementedError as exc:
        raise UnsupportedExpressionError("unsupported expression") from exc
    except Exception as exc:
        raise ComputationError(f"computation error: {exc}") from exc

    payload = {
        "rref": str(reduced),
        "pivot_columns": list(pivots),
    }
    return json.dumps(payload, separators=(",", ":"))


def rank(matrix_str: str) -> int:
    """Return the rank of ``matrix_str``."""
    matrix = _parse_matrix(matrix_str)
    try:
        return int(matrix.rank())
    except NotImplementedError as exc:
        raise UnsupportedExpressionError("unsupported expression") from exc
    except Exception as exc:
        raise ComputationError(f"computation error: {exc}") from exc
