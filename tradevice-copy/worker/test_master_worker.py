import unittest
from master_worker import enforce_safety, cycle_state

SAFE={"PLATFORM_ENVIRONMENT":"staging","SUPABASE_PROJECT_REF":"scqzlcivherovlwqypeu",
"TRADING_EXECUTION_MODE":"paper","BROKER_ADAPTER":"paper","BROKER_LIVE_ENABLED":"false",
"COPY_EXECUTION_ENABLED":"false","MASTER_QUOTE_SOURCE":"none","MASTER_DATABASE_URL":"postgresql://tradevice_master_worker:test-secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"}

class SafetyTests(unittest.TestCase):
    def test_safe(self): enforce_safety(SAFE)
    def test_live_flags(self):
        for key,value in [("BROKER_LIVE_ENABLED","true"),("COPY_EXECUTION_ENABLED","true"),
          ("TRADING_EXECUTION_MODE","live"),("BROKER_ADAPTER","mt5"),
          ("PLATFORM_ENVIRONMENT","production"),("MASTER_QUOTE_SOURCE","primary"),
          ("SUPABASE_PROJECT_REF","wrong"),("MASTER_DATABASE_URL",""),
          ("MASTER_DATABASE_URL","postgresql://postgres:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"),
          ("MASTER_DATABASE_URL","postgresql://tradevice_master_worker:x@db.evil.supabase.co:5432/postgres?sslmode=require"),
          ("MASTER_DATABASE_URL","postgresql://tradevice_master_worker:x@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=disable")]:
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                enforce_safety({**SAFE,key:value})
    def test_url_validation_reports_only_safe_field_names(self):
        cases={
          "missing":"",
          "username":"postgresql://postgres:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require",
          "host":"postgresql://tradevice_master_worker:secret@db.other.supabase.co:5432/postgres?sslmode=require",
          "port":"postgresql://tradevice_master_worker:secret@db.scqzlcivherovlwqypeu.supabase.co:5433/postgres?sslmode=require",
          "database":"postgresql://tradevice_master_worker:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/elsewhere?sslmode=require",
          "sslmode":"postgresql://tradevice_master_worker:secret@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=disable",
          "no_fragment":SAFE["MASTER_DATABASE_URL"]+"#fragment",
          "no_surrounding_whitespace":" "+SAFE["MASTER_DATABASE_URL"],
        }
        for expected,dsn in cases.items():
            with self.subTest(expected=expected),self.assertRaises(RuntimeError) as ctx:
                enforce_safety({**SAFE,"MASTER_DATABASE_URL":dsn})
            self.assertIn(expected,str(ctx.exception))
            self.assertNotIn("secret",str(ctx.exception))
            self.assertNotIn("db.scqzlcivherovlwqypeu",str(ctx.exception))

    def test_url_encoded_reserved_password_is_accepted(self):
        enforce_safety({**SAFE,"MASTER_DATABASE_URL":
            "postgresql://tradevice_master_worker:%40%23%3F%2F%25@db.scqzlcivherovlwqypeu.supabase.co:5432/postgres?sslmode=require"})

    def test_fails_closed_when_quotes_not_configured(self):
        self.assertEqual(cycle_state(False),("DEGRADED","MISSING_TRUSTED_QUOTE"))
        self.assertEqual(cycle_state(True),("HALTED","MANUAL_KILL"))

if __name__=="__main__": unittest.main()
