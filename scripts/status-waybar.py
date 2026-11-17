#!/usr/bin/env python3
"""Imprime status JSON compatível com Waybar para o DriveSync."""

from __future__ import annotations

import datetime
import json
import os
import sys
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def format_timestamp(raw: str | None) -> str:
    if not raw:
        return "desconhecido"
    try:
        dt = datetime.datetime.fromisoformat(raw)
        return dt.strftime("%d/%m %H:%M:%S")
    except ValueError:
        return raw


def build_waybar_payload(
    sync_data: dict[str, Any] | None,
    backup_data: dict[str, Any] | None,
) -> dict[str, Any]:
    if sync_data is None:
        tooltip_lines = [
            "DriveSync: nenhuma sincronização registrada ainda.",
        ]
        if backup_data is not None:
            tooltip_lines.append(
                f"Backup Restic: {backup_data.get('status', 'unknown')} ({format_timestamp(backup_data.get('timestamp'))})"
            )
        return {
            "text": "󰅣",
            "alt": "unknown",
            "tooltip": "\n".join(tooltip_lines),
            "class": "unknown",
        }

    raw_status = str(sync_data.get("status", "unknown")).lower()
    errors = int(sync_data.get("errors", 0) or 0)
    ts = format_timestamp(sync_data.get("timestamp"))
    message = str(sync_data.get("message", "")).strip()
    local_dir = sync_data.get("local_dir", "")
    remote = sync_data.get("remote", "")
    dry_run = bool(sync_data.get("dry_run", False))

    status_map = {
        "ok": ("󰅟", "ok", "Sincronizado"),
        "syncing": ("󰓦", "syncing", "Sincronizando"),
        "aborted": ("󰀦", "aborted", "Abortado (trava de segurança)"),
        "error": ("󰅤", "error", "Erro na sincronização"),
    }
    icon, css_class, label = status_map.get(
        raw_status, ("󰅣", "unknown", f"Status desconhecido ({raw_status})")
    )

    text = icon if raw_status == "ok" else f"{icon} {errors}" if errors > 0 and raw_status in {"error", "aborted"} else icon

    tooltip_lines = [f"DriveSync: {label}"]
    if local_dir and remote:
        tooltip_lines.append(f"Par: {local_dir} ↔ {remote}")
    tooltip_lines.append(f"Última execução: {ts}" + (" [dry-run]" if dry_run else ""))
    tooltip_lines.append(f"Erros: {errors}")
    if message:
        tooltip_lines.append(f"Detalhe: {message}")

    if backup_data is not None:
        b_status = str(backup_data.get("status", "unknown"))
        b_ts = format_timestamp(backup_data.get("timestamp"))
        tooltip_lines.append(f"Backup Restic: {b_status} ({b_ts})")

    return {
        "text": text,
        "alt": css_class,
        "tooltip": "\n".join(tooltip_lines),
        "class": css_class,
    }


def main() -> int:
    state_dir = Path(os.environ.get("NUVEM_STATE_DIR") or os.environ.get("XDG_STATE_HOME") or (Path.home() / ".local" / "state"))
    sync_path = Path(os.environ.get("NUVEM_STATUS_FILE") or (state_dir / "nuvem-status.json"))
    backup_path = Path(os.environ.get("NUVEM_BACKUP_STATUS_FILE") or (state_dir / "nuvem-backup-status.json"))

    payload = build_waybar_payload(read_json(sync_path), read_json(backup_path))
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
