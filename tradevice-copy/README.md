# Tradevice Copy Foundation (isolated)
This directory is an additive, paper-only prototype. It does not modify Tradevice 2.0's production paths.

## Components
- `api/`: FastAPI, Supabase Auth bearer-token validation, read-only member endpoints; funding and execution fail closed.
- `web/`: Next.js login/signup and transparent research-only dashboard.
- `services/`: in-memory paper broker simulator with idempotency.
- `database/migrations/`: dedicated new Supabase project schema and ownership RLS.
- `railway/`: separate service configs.

## Important restrictions
- Do NOT deploy on the existing Tradevice Railway service.
- Do NOT apply migration to Pentagon, Tradevice research, or any shared database.
- No broker credentials, live orders, real funding, or copy execution supported.
- Do not promote to live until legal, broker and independent security reviews plus extensive forward testing.

## Run API locally
`cd tradevice-copy/api && pip install -r requirements.txt && uvicorn app.main:app --reload`
`PYTHONPATH=. pytest tests`

## Run paper adapter tests
`cd tradevice-copy/services && PYTHONPATH=. pytest test_paper_broker.py`

## Run web locally
`cd tradevice-copy/web && npm install && npm run dev`

Required web vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
API vars: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
Read-only auth-backed API routes require Authorization: Bearer <SUPABASE_ACCESS_TOKEN>.

## Milestones remaining
Dedicated Supabase project; migrations execution; account owner linking; broker adapter; trusted signal intake; durable paper executions; risk service; funding redirects; referral reconciliation; audit and integration tests; Railway stage deployment.
