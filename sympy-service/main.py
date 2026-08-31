"""FastAPI application exposing SymPy-backed math operations."""

from enum import Enum
from typing import assert_never

import engine
from errors import ComputationError, ParseError, UnsupportedExpressionError
from fastapi import FastAPI
from models import (
    ContinuityRequest,
    EngineResult,
    HealthResponse,
    IntegrateRequest,
    LimitRequest,
    MatrixRequest,
)

app = FastAPI(title="NerdCard SymPy Service")


class Operation(Enum):
    INTEGRATE = "integrate"
    LIMIT = "limit"
    CONTINUITY = "continuity_check"
    RREF = "rref"
    RANK = "rank"


def _ok(value: str, operation: str) -> EngineResult:
    return EngineResult(
        ok=True,
        supported=True,
        operation=operation,
        value=value,
    )


def _err(reason: str, operation: str) -> EngineResult:
    return EngineResult(
        ok=False,
        supported=False,
        operation=operation,
        reason=reason,
    )


def _run_operation(operation: Operation, request: object) -> str:
    match operation:
        case Operation.INTEGRATE:
            req = IntegrateRequest.model_validate(request)
            return engine.integrate(req.expr, req.variable)
        case Operation.LIMIT:
            req = LimitRequest.model_validate(request)
            return engine.limit(req.expr, req.variable, req.point, req.direction)
        case Operation.CONTINUITY:
            req = ContinuityRequest.model_validate(request)
            return "true" if engine.continuity_check(req.expr, req.variable, req.point) else "false"
        case Operation.RREF:
            req = MatrixRequest.model_validate(request)
            return engine.rref(req.matrix)
        case Operation.RANK:
            req = MatrixRequest.model_validate(request)
            return str(engine.rank(req.matrix))
        case _:
            assert_never(operation)


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/integrate")
def integrate(request: IntegrateRequest) -> EngineResult:
    return _dispatch(Operation.INTEGRATE, request)


@app.post("/limit")
def limit(request: LimitRequest) -> EngineResult:
    return _dispatch(Operation.LIMIT, request)


@app.post("/continuity")
def continuity(request: ContinuityRequest) -> EngineResult:
    return _dispatch(Operation.CONTINUITY, request)


@app.post("/rref")
def rref(request: MatrixRequest) -> EngineResult:
    return _dispatch(Operation.RREF, request)


@app.post("/rank")
def rank(request: MatrixRequest) -> EngineResult:
    return _dispatch(Operation.RANK, request)


def _dispatch(operation: Operation, request: object) -> EngineResult:
    try:
        value = _run_operation(operation, request)
        return _ok(value, operation.value)
    except ParseError as exc:
        return _err(exc.message, operation.value)
    except UnsupportedExpressionError:
        return _err("unsupported expression", operation.value)
    except ComputationError as exc:
        return _err(exc.message, operation.value)
    except Exception as exc:  # noqa: BROAD_EXCEPT_OK
        return _err("computation error", operation.value)
