import asyncio
import sys
import json
import time

import pytest
import psutil

from invoice_parser.runner import run_worker


def test_timeout_terminates_real_worker_and_descendants(monkeypatch, tmp_path):
    original = asyncio.create_subprocess_exec
    children = []
    pid_file = tmp_path / "child.pid"
    child_code = (
        "import subprocess,sys,time; from pathlib import Path; "
        "child=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
        f"Path({json.dumps(str(pid_file))}).write_text(str(child.pid)); time.sleep(60)"
    )

    async def spawn(*args, **kwargs):
        if args[0] == sys.executable:
            child = await original(sys.executable, "-c", child_code, **kwargs)
            children.append(child)
            return child
        return await original(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)

    async def run():
        start = time.monotonic()
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(1):
                await run_worker(b"%PDF-test", "application/pdf")
        assert time.monotonic() - start < 5
        assert len(children) == 1
        assert children[0].returncode is not None
        pid = int(pid_file.read_text())
        assert not psutil.pid_exists(pid) or psutil.Process(pid).status() == psutil.STATUS_ZOMBIE

    asyncio.run(run())
