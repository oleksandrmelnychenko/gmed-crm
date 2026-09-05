from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    api_key: str
    max_file_bytes: int = 25 * 1024 * 1024
    timeout_seconds: float = 180
    max_concurrency: int = 2

    def __post_init__(self) -> None:
        if len(self.api_key) < 32:
            raise ValueError("INVOICE_PARSER_API_KEY must contain at least 32 characters")
        if not 1 <= self.max_file_bytes <= 25 * 1024 * 1024:
            raise ValueError("INVOICE_PARSER_MAX_FILE_BYTES must be between 1 and 26214400")
        if not 0 < self.timeout_seconds <= 300:
            raise ValueError("INVOICE_PARSER_TIMEOUT_SECONDS must be between 0 and 300")
        if not 1 <= self.max_concurrency <= 4:
            raise ValueError("INVOICE_PARSER_MAX_CONCURRENCY must be between 1 and 4")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            api_key=os.environ.get("INVOICE_PARSER_API_KEY", ""),
            max_file_bytes=int(os.environ.get("INVOICE_PARSER_MAX_FILE_BYTES", 25 * 1024 * 1024)),
            timeout_seconds=float(os.environ.get("INVOICE_PARSER_TIMEOUT_SECONDS", 180)),
            max_concurrency=int(os.environ.get("INVOICE_PARSER_MAX_CONCURRENCY", 2)),
        )
