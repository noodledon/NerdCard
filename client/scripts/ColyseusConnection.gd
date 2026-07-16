## Colyseus SDK connection path — INACTIVE.
##
## T5 verification (see scripts/colyseus-verify.md) found the official
## colyseus-godot SDK repository unavailable (404) under Godot 4.7. The
## Colyseus class is therefore never declared in this project, and any
## script that references it directly fails to parse.
##
## Per Wave 5 (T18) "must not" rules, the unused branch must not be
## committed as dead/broken code. This file is intentionally stubbed to a
## TODO rather than referencing the undefined `Colyseus` identifier, so it
## parses cleanly while remaining a placeholder for a future SDK revival.
##
## The ACTIVE connection path is scripts/ConnectionManager.gd, which wraps
## scripts/raw-ws-client.gd (RawWsClient) — see colyseus-verify.md for the
## branch decision record.
##
## TODO(sdk-revival): if colyseus/colyseus-godot ever republishes a Godot 4.x
## addon, restore an SDK-backed implementation here and flip
## ConnectionManager's branch selection.

extends Node
class_name ColyseusConnectionStub
