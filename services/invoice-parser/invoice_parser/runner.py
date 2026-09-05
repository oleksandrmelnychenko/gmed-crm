import asyncio
import json
import os
import signal
import subprocess
import sys

import psutil


class ParseFailed(Exception):
    pass


def kill_windows_tree(pid: int) -> None:
    # taskkill /T uses process enumeration that can fail in restricted Windows
    # sessions. psutil uses native APIs and checks process identity before kill.
    try:
        parent = psutil.Process(pid)
        parent.suspend()
        children = parent.children(recursive=True)
        for child in children:
            try:
                child.suspend()
            except psutil.NoSuchProcess:
                pass
        # Include children started just before the first suspension.
        for child in reversed(parent.children(recursive=True)):
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
        parent.kill()
    except psutil.NoSuchProcess:
        pass


async def stop_process(process) -> None:
    if os.name == "nt":
        await asyncio.to_thread(kill_windows_tree, process.pid)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    await process.wait()


async def run_worker(data: bytes, mime: str) -> dict:
    options = {"start_new_session": True} if os.name != "nt" else {
        "creationflags": subprocess.CREATE_NO_WINDOW,
    }
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "invoice_parser.worker", mime,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            **options,
        )
    except OSError as exc:
        raise ParseFailed() from exc
    try:
        output, _ = await process.communicate(data)
    except BaseException:
        await asyncio.shield(stop_process(process))
        raise
    if process.returncode != 0 or len(output) > 4 * 1024 * 1024:
        raise ParseFailed()
    try:
        result = json.loads(output)
        if not isinstance(result, dict) or result.get("requires_review") is not True:
            raise ValueError()
        return result
    except (ValueError, UnicodeDecodeError) as exc:
        raise ParseFailed() from exc
