"""Configuration is deliberately incapable of enabling live trading."""
from dataclasses import dataclass
import os
import re

@dataclass(frozen=True)
class Settings:
    supabase_url: str = ""
    publishable_key: str = ""
    project_ref: str = ""
    environment: str = "staging"
    cors_origins: tuple[str, ...] = ()

    @property
    def auth_configured(self) -> bool:
        return bool(self.supabase_url and self.publishable_key and self.project_ref)

    @classmethod
    def from_env(cls) -> "Settings":
        if os.getenv("TRADING_EXECUTION_MODE", "paper") != "paper":
            raise RuntimeError("Only paper mode is supported")
        if os.getenv("BROKER_ADAPTER", "paper") != "paper":
            raise RuntimeError("Only the paper adapter is supported")
        for flag in ("BROKER_LIVE_ENABLED", "COPY_EXECUTION_ENABLED"):
            if os.getenv(flag, "false").lower() not in ("false", "0", "off"):
                raise RuntimeError(f"{flag} must remain disabled")
        env = os.getenv("PLATFORM_ENVIRONMENT", "staging")
        if env not in ("local", "test", "staging"):
            raise RuntimeError("Foundation cannot run as production")
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
        ref = os.getenv("SUPABASE_PROJECT_REF", "")
        if any((url, key, ref)):
            if not all((url, key, ref)):
                raise RuntimeError("Configure all three dedicated Supabase settings together")
            if not re.fullmatch(r"[a-z]{20}", ref) or url != f"https://{ref}.supabase.co":
                raise RuntimeError("Supabase URL does not match the dedicated project ref")
            if not key.startswith("sb_publishable_"):
                raise RuntimeError("A modern publishable key is required, never a server secret")
        origins = tuple(x.strip() for x in os.getenv("CORS_ORIGINS", "").split(",") if x.strip())
        if "*" in origins:
            raise RuntimeError("Wildcard CORS is forbidden")
        return cls(url, key, ref, env, origins)
