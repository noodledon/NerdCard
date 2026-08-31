# NerdCard SymPy Service

A small Python/FastAPI microservice that provides symbolic math operations backed by SymPy.

## Endpoints

| Method | Path | Body |
|--------|------|------|
| GET | `/health` | — |
| POST | `/integrate` | `{ "expr": "x^2", "variable": "x" }` |
| POST | `/limit` | `{ "expr": "1/x", "variable": "x", "point": 0, "direction": "+" }` |
| POST | `/continuity` | `{ "expr": "1/x", "variable": "x", "point": 0 }` |
| POST | `/rref` | `{ "matrix": "[[1,2],[2,4]]" }` |
| POST | `/rank` | `{ "matrix": "[[1,2],[2,4]]" }` |

Matrix input may be a JSON array of arrays (`[[1,2],[2,4]]`), a SymPy `Matrix([[...]])` string, or a mathjs-style `matrix([1,2],[3,4])` string.

## Response contract

Success:

```json
{
  "ok": true,
  "supported": true,
  "operation": "integrate",
  "value": "x**3/3"
}
```

Failure:

```json
{
  "ok": false,
  "supported": false,
  "operation": "integrate",
  "reason": "parse error: ..."
}
```

`value` is always a string. `/continuity` returns `"true"`/`"false"`; `/rank` returns the integer as a string; `/rref` returns a JSON object string with `rref` and `pivot_columns`.

## Local run

With a virtual environment:

```bash
cd sympy-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 2569
```

With uv (if available):

```bash
cd sympy-service
uv venv
uv pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 2569
```

## Tests

```bash
pytest test_engine.py -v
```

## Docker

```bash
docker build -t nerdicard-sympy sympy-service/
docker run -p 2569:2569 nerdicard-sympy
```

## Docker Compose

From the repository root:

```bash
docker compose up --build -d
```

This starts the Node server on ports `2567`/`2568` and the SymPy service on port `2569`.
