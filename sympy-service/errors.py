"""Typed errors raised by the calculation engine."""

from dataclasses import dataclass


@dataclass
class MathEngineError(Exception):
    """Base class for typed math-engine failures."""

    message: str

    def __str__(self) -> str:
        return self.message


@dataclass
class ParseError(MathEngineError):
    """Raised when an input string cannot be parsed as a math expression."""


@dataclass
class UnsupportedExpressionError(MathEngineError):
    """Raised when SymPy cannot compute the requested operation."""


@dataclass
class ComputationError(MathEngineError):
    """Raised for unexpected failures during computation."""
