# Paper Broker

Local, single-host SQLite journal used for testing only. No live broker connectivity and no fabricated fills. Replay collisions are rejected, and a file-backed journal survives a restart.

Do not connect this module to the public member API until trusted signals, per-account ownership checks, server-side portfolio risk controls, and a transactional Postgres inbox/outbox are implemented and verified.

Run: cd tradevice-copy/services && PYTHONPATH=. python -m pytest -q test_paper_broker.py

There is no live execution.
