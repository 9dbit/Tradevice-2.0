#!/usr/bin/env python3
"""Tradevice Supertrend M1 evidence uploader. NO BROKER OR TRADING API.

Local MQL5/Files -> authenticated Tradevice research endpoints ONLY.
Network writes are DISABLED by default. Explicit --send and environment
credentials are required. No account balances, identifiers or order data.
"""
import argparse
import json
import os
import pathlib
import sys
import tempfile
import urllib.error
import urllib.request


def event_items(files_root):
    folder = files_root / "TradeviceST"
    for category in ("candles", "events", "outcomes"):
        for path in sorted((folder / category).glob("*.json")):
            yield category, path


def state_load(path):
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as f:
        contents = json.load(f)
    if not isinstance(contents, dict):
        raise ValueError("State file must be an object")
    return contents


def state_save(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                     delete=False, suffix=".tmp") as f:
        json.dump(records, f, sort_keys=True)
        tmp = pathlib.Path(f.name)
    os.replace(tmp, path)


def file_key(path):
    st = path.stat()
    return str(path.resolve()) + ":" + str(st.st_size) + ":" + str(st.st_mtime_ns)


def validated_png_path(files_root, event):
    supplied = event.get("snapshot_file")
    if not isinstance(supplied, str) or not supplied:
        return None
    candidate = (files_root / pathlib.Path(supplied.replace("\\", "/"))).resolve()
    if not candidate.is_relative_to(files_root.resolve()):
        return None
    if not candidate.is_file() or candidate.suffix.lower() != ".png":
        return None
    if candidate.stat().st_size > 2200000:
        return None
    return candidate


def upload(url, key, body, mime):
    data = body if isinstance(body, bytes) else json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, method="POST", data=data, headers={
        "Authorization": "Bearer " + key, "Content-Type": mime,
        "Accept": "application/json",
        "User-Agent": "Tradevice-ST-M1-Research/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            result = json.loads(response.read(5000).decode("utf-8"))
            if response.status != 200 or result.get("stored") is not True:
                raise ValueError("Unexpected response")
            return result
    except urllib.error.HTTPError as e:
        raise RuntimeError("Server refused research upload: HTTP " + str(e.code)) from e


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--files-root", required=True,
                        help=r"MT5 terminal's MQL5\Files directory")
    parser.add_argument("--state", required=True,
                        help="Separate local state JSON path, outside original evidence")
    parser.add_argument("--api-base", default=os.environ.get("TRADEVICE_RESEARCH_API_BASE", ""))
    parser.add_argument("--send", action="store_true",
                        help="Explicitly enable HTTPS upload (off by default)")
    args = parser.parse_args(argv)
    root = pathlib.Path(args.files_root).resolve()
    state_path = pathlib.Path(args.state).resolve()
    if not root.is_dir():
        print("Local evidence directory not created yet: " + str(root))
        return 0
    items = list(event_items(root))
    if not args.send:
        print("DRY RUN ONLY: " + str(len(items)) + " local records, zero network calls.")
        return 0
    key = os.environ.get("TRADEVICE_RESEARCH_API_KEY", "").strip()
    base = args.api_base.rstrip("/")
    if not base.startswith("https://") or not key:
        print("Upload blocked: require HTTPS --api-base and TRADEVICE_RESEARCH_API_KEY environment variable.")
        return 2
    if not state_path.is_relative_to(root) and state_path.suffix.lower() == ".json":
        state = state_load(state_path)
    else:
        print("Upload blocked: state must be JSON outside immutable evidence root.")
        return 2
    uploaded = 0
    errors = 0
    prefix = base + "/api/v1/research/supertrend/"
    for category, path in items:
        try:
            item = json.loads(path.read_text(encoding="utf-8"))
            record_type = {"candles": "CANDLE", "events": "SIGNAL",
                           "outcomes": "OUTCOME"}[category]
            if item.get("record_type") != record_type:
                continue
            marker = "record:" + file_key(path)
            if marker not in state:
                endpoint = "events" if category == "events" else category
                upload(prefix + endpoint, key, item, "application/json")
                state[marker] = True
                state_save(state_path, state)
                uploaded += 1
            if category == "events":
                png = validated_png_path(root, item)
                if png is not None:
                    image_marker = "image:" + file_key(png)
                    if image_marker not in state:
                        from urllib.parse import quote
                        event_id = quote(str(item["event_id"]), safe="")
                        upload(prefix + "images/" + event_id, key, png.read_bytes(), "image/png")
                        state[image_marker] = True
                        state_save(state_path, state)
                        uploaded += 1
        except (OSError, ValueError, KeyError, RuntimeError, urllib.error.URLError) as e:
            # Keep local evidence untouched, retry next launch.
            errors += 1
            print("WARN " + category + " " + path.name + ": " + str(e))
    print("Uploaded " + str(uploaded) + " records/images; " + str(errors) + " not yet synced.")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
