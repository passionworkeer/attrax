"""Windows-only PowerShell Invoke-WebRequest fallback fetcher.

Used by collectors that target sites (e.g. infoleg.gob.ar) where neither the
Python requests session nor curl succeed but PowerShell can.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Mapping


DEFAULT_TIMEOUT = 75
DEFAULT_MAX_REDIRECTS = 5


def fetch_with_powershell(
    url: str,
    dest: Path,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    headers: Mapping[str, str] | None = None,
) -> bool:
    """Invoke ``Invoke-WebRequest`` via powershell.exe. Returns True on success.

    The caller is expected to size-check ``dest`` afterwards (we only confirm
    that the file exists and is non-empty).
    """
    ps_url = url.replace("'", "''")
    ps_path = str(dest).replace("'", "''")
    header_arg = ""
    if headers:
        pairs = ";".join(f"'{k.replace(chr(39), chr(39) * 2)}'='{v.replace(chr(39), chr(39) * 2)}'" for k, v in headers.items())
        header_arg = f" -Headers @{{{pairs}}}"
    script = (
        "$ProgressPreference='SilentlyContinue'; "
        f"Invoke-WebRequest -Uri '{ps_url}' -OutFile '{ps_path}' "
        f"-UseBasicParsing -MaximumRedirection {max_redirects} -TimeoutSec {timeout}"
        f"{header_arg}"
    )
    command = ["powershell.exe", "-NoProfile", "-Command", script]
    try:
        subprocess.run(command, text=True, capture_output=True, check=False)
    except OSError:
        return False
    return dest.exists() and dest.stat().st_size > 0