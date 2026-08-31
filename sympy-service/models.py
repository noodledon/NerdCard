"""Pydantic request/response models for the SymPy service."""

from pydantic import BaseModel, ConfigDict, Field


class EngineResult(BaseModel):
    """Response envelope aligned with ``server/src/math/engine.ts`` EngineResult."""

    model_config = ConfigDict(frozen=True)

    ok: bool
    supported: bool
    operation: str
    value: str | None = None
    reason: str | None = None


class IntegrateRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    expr: str = Field(min_length=1)
    variable: str = Field(min_length=1)


class LimitRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    expr: str = Field(min_length=1)
    variable: str = Field(min_length=1)
    point: str | int | float
    direction: str | None = None


class ContinuityRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    expr: str = Field(min_length=1)
    variable: str = Field(min_length=1)
    point: str | int | float


class MatrixRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    matrix: str = Field(min_length=1)


class HealthResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: str = "ok"
