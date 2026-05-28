from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Optional

from app.importers.eml import import_eml


def _check_readpst() -> bool:
    try:
        subprocess.run(["readpst", "--version"], capture_output=True, timeout=10)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def import_pst(
    filepath: str | Path,
    account_id: int = 0,
    readpst_path: str = "readpst",
    progress_cb: Callable[[int, int, str], None] | None = None,
) -> tuple[int, list[str]]:
    return _import_with_readpst(filepath, account_id, readpst_path, progress_cb)


def import_ost(
    filepath: str | Path,
    account_id: int = 0,
    readpst_path: str = "readpst",
    progress_cb: Callable[[int, int, str], None] | None = None,
) -> tuple[int, list[str]]:
    return _import_with_readpst(filepath, account_id, readpst_path, progress_cb)


def _import_with_readpst(
    filepath: str | Path,
    account_id: int = 0,
    readpst_path: str = "readpst",
    progress_cb: Callable[[int, int, str], None] | None = None,
) -> tuple[int, list[str]]:
    src = Path(filepath)
    if not src.exists():
        raise FileNotFoundError(f"File not found: {src}")

    if progress_cb:
        progress_cb(0, 0, "Extrayendo correos con readpst...")

    with tempfile.TemporaryDirectory() as tmpdir:
        cmd = [
            readpst_path,
            "-r",
            "-e",
            "-o", tmpdir,
            "-D",
            str(src.resolve()),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            raise RuntimeError(
                f"readpst failed (rc={result.returncode}): {result.stderr}"
            )

        eml_files = sorted(Path(tmpdir).rglob("*.eml"))
        total_files = len(eml_files)

        if progress_cb:
            progress_cb(0, total_files, "Importando correos extraídos...")

        imported = 0
        errors = []
        for i, eml_path in enumerate(eml_files, 1):
            try:
                imported += import_eml(eml_path, account_id=account_id)
            except Exception as e:
                errors.append(f"{eml_path.name}: {e}")
            if progress_cb and (i % 5 == 0 or i == total_files):
                progress_cb(i, total_files, f"Importando correo {i}/{total_files}")

    return imported, errors


def _check_dependencies() -> list[str]:
    missing = []
    if not _check_readpst():
        missing.append(
            "readpst (install: apt install pst-utils / brew install libpst)"
        )
    return missing
