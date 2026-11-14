#!/usr/bin/env python3
"""Serve the static BioGlow demo and its fixed station API proxy."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
BIOGLOW_API_BASE = os.environ.get(
    "BIOGLOW_API_BASE", "http://glow.ultraviolet.nirtech.org"
).rstrip("/")
USER_AGENT = "Mozilla/5.0 BioGlow-dashboard/1.0"
INATURALIST_OBSERVATIONS_URL = "https://api.inaturalist.org/v1/observations"
INATURALIST_TAXA_URL = "https://api.inaturalist.org/v1/taxa"
HISTORY_PATH = "/v1/history?source=microphone&range=24h"
STATION_MODE_PATH = "/v1/station-mode"
DIRECTION_PATH = "/v1/direction"
USER_AIM_PATH = "/v1/user-aim"
UPSTREAM_PATHS = {
    "latest": "/v1/latest",
}
MIGRATION_FIELDS = (
    "status",
    "region",
    "source",
    "retrieved_at",
    "selected_night",
    "live_feed",
    "migration_level",
    "metrics",
    "warnings",
)
MIGRATION_METRIC_FIELDS = (
    "birds_in_flight",
    "total_birds_crossed",
    "direction",
    "speed_mph",
    "altitude_ft",
    "recorded_at",
    "updated_at",
)
_taxon_image_cache = {}
_taxon_name_cache = {}
_taxon_image_lock = threading.Lock()
_last_taxon_lookup = 0.0
_recent_wildlife_species = set()
_recent_wildlife_lock = threading.Lock()
_aim_control_lock = threading.Lock()
_aim_original_mode = None
_direction_control_lock = threading.Lock()
_direction_control_original_mode = None
_direction_control_config = None


def fetch_json(path):
    request = urllib.request.Request(
        BIOGLOW_API_BASE + path,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return {"http_status": response.status, "data": json.load(response)}
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = None
        return {"http_status": error.code, "data": body, "error": "upstream_error"}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return {"http_status": None, "data": None, "error": "upstream_unavailable"}


def post_json(path, payload):
    request = urllib.request.Request(
        BIOGLOW_API_BASE + path,
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return {"http_status": response.status, "data": json.load(response)}
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = None
        return {"http_status": error.code, "data": body or {"error": {"message": "Station rejected the request."}}}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return {"http_status": 502, "data": {"error": {"message": "Station is unavailable."}}}


def direction_control_state():
    mode_response = fetch_json(STATION_MODE_PATH)
    direction_response = fetch_json(DIRECTION_PATH)
    mode_data = mode_response.get("data") or {}
    direction_data = direction_response.get("data") or {}
    status = "ok" if mode_response.get("http_status") == 200 and direction_response.get("http_status") == 200 else "error"
    return {
        "status": status,
        "mode": mode_data.get("mode"),
        "modes": mode_data.get("modes", []),
        "angle_degrees": direction_data.get("angle_degrees"),
        "alignment": direction_data.get("alignment"),
        "beam_width": direction_data.get("beam_width"),
        "max_beam_width": direction_data.get("max_beam_width"),
    }


def control_user_aim(angle=None, stop=False):
    global _aim_original_mode
    with _aim_control_lock:
        current = fetch_json(STATION_MODE_PATH)
        if current.get("http_status") != 200 or not isinstance(current.get("data"), dict):
            return 502, {"status": "error", "message": "Could not read the station mode."}
        mode = current["data"].get("mode")
        if stop:
            if mode != "user_aim":
                _aim_original_mode = None
                return 200, {"status": "ok", "mode": mode, "stopped": False}
            stopped = post_json(USER_AIM_PATH, {"action": "stop"})
            if stopped.get("http_status") != 200:
                return stopped.get("http_status") or 502, stopped.get("data") or {"status": "error"}
            restored_mode = _aim_original_mode
            _aim_original_mode = None
            if restored_mode == "direction_config":
                restored = post_json(STATION_MODE_PATH, {"mode": restored_mode})
                if restored.get("http_status") != 200:
                    return restored.get("http_status") or 502, restored.get("data") or {"status": "error"}
                return 200, {"status": "ok", "mode": restored_mode, "stopped": True}
            return 200, {"status": "ok", "mode": "normal", "stopped": True}

        if mode not in ("normal", "direction_config", "user_aim"):
            return 409, {"status": "error", "message": f"Station is in {mode or 'an unknown'} mode; directional aiming is unavailable."}
        started = False
        if mode != "user_aim":
            start = post_json(USER_AIM_PATH, {"action": "start", "expected_mode": mode})
            if start.get("http_status") != 200:
                return start.get("http_status") or 502, start.get("data") or {"status": "error"}
            _aim_original_mode = mode
            started = True
        result = post_json(USER_AIM_PATH, {"action": "direction", "angle": angle})
        if result.get("http_status") != 200:
            return result.get("http_status") or 502, result.get("data") or {"status": "error"}
        data = result.get("data") or {}
        return 200, {
            "status": "ok",
            "mode": data.get("mode", "user_aim"),
            "angle_degrees": data.get("angle_degrees", angle),
            "started": started,
        }


def control_direction_beam(angle=None, beam_width=None, stop=False, restore_mode=None):
    global _direction_control_original_mode, _direction_control_config
    with _direction_control_lock:
        if stop:
            original_mode = _direction_control_original_mode or restore_mode
            if original_mode is None:
                return 200, {"status": "ok", "stopped": False}
            current = fetch_json(STATION_MODE_PATH)
            mode = (current.get("data") or {}).get("mode")
            if mode == "direction_config" and original_mode != "direction_config":
                restored = post_json(STATION_MODE_PATH, {"mode": original_mode})
                if restored.get("http_status") != 200:
                    return restored.get("http_status") or 502, restored.get("data") or {"status": "error"}
            _direction_control_original_mode = None
            _direction_control_config = None
            return 200, {"status": "ok", "mode": original_mode, "stopped": True}

        if _direction_control_original_mode is None:
            current = fetch_json(STATION_MODE_PATH)
            if current.get("http_status") != 200 or not isinstance(current.get("data"), dict):
                return 502, {"status": "error", "message": "Could not read the station mode."}
            mode = current["data"].get("mode")
            if mode == "user_aim" and _aim_original_mode == "direction_config":
                stopped_status, stopped = control_user_aim(stop=True)
                if stopped_status != 200:
                    return stopped_status, stopped
                mode = stopped.get("mode", "direction_config")
            if mode not in ("normal", "direction_config"):
                return 409, {"status": "error", "message": f"Station is in {mode or 'an unknown'} mode; beam steering is unavailable."}
            _direction_control_original_mode = mode
            if mode == "normal":
                changed = post_json(STATION_MODE_PATH, {"mode": "direction_config"})
                if changed.get("http_status") != 200:
                    _direction_control_original_mode = None
                    return changed.get("http_status") or 502, changed.get("data") or {"status": "error"}

        if _direction_control_config is None:
            direction = fetch_json(DIRECTION_PATH)
            if direction.get("http_status") != 200 or not isinstance(direction.get("data"), dict):
                return 502, {"status": "error", "message": "Could not read the station beam settings."}
            _direction_control_config = direction["data"]
        config = _direction_control_config
        alignment = config.get("alignment")
        max_beam_width = config.get("max_beam_width")
        if not isinstance(alignment, int) or alignment < 1 or not isinstance(max_beam_width, int):
            return 502, {"status": "error", "message": "The station returned invalid beam settings."}
        if beam_width < 1 or beam_width > max_beam_width or beam_width % 2 != 1:
            return 400, {"status": "error", "message": f"Beam width must be an odd number from 1 to {max_beam_width}."}
        offset = int((angle * alignment / 360.0) + 0.5) % alignment
        result = post_json(DIRECTION_PATH, {
            "alignment": alignment,
            "beam_width": beam_width,
            "offset": offset,
        })
        if result.get("http_status") != 200:
            if result.get("http_status") == 409:
                _direction_control_original_mode = None
                _direction_control_config = None
            return result.get("http_status") or 502, result.get("data") or {"status": "error"}
        data = result.get("data") or {}
        _direction_control_config = data
        return 200, {
            "status": "ok",
            "mode": "direction_config",
            "angle_degrees": data.get("angle_degrees", offset * 360.0 / alignment),
            "beam_width": data.get("beam_width", beam_width),
        "max_beam_width": data.get("max_beam_width", max_beam_width),
            "started": _direction_control_original_mode != "direction_config",
            "original_mode": _direction_control_original_mode if _direction_control_original_mode != "direction_config" else None,
        }


def dashboard_data():
    latest = fetch_json(UPSTREAM_PATHS["latest"])
    data = latest.get("data")
    if isinstance(data, dict):
        source = (data.get("sources") or {}).get("birdcast") or {}
        latest["data"] = {
            "sources": {
                "birdcast": {
                    "http_status": source.get("http_status"),
                    "result": project_migration(source.get("result")),
                    "last_success": project_migration(source.get("last_success")),
                }
            }
        }
    return {"latest": latest}


def live_light_data():
    latest = fetch_json(UPSTREAM_PATHS["latest"])
    data = latest.get("data") or {}
    lighting = data.get("lighting") if isinstance(data, dict) else None
    if latest.get("http_status") != 200 or not isinstance(lighting, dict):
        return {"status": "error", "on": None, "color": None}
    color = lighting.get("color")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        color = None
    return {
        "status": "ok" if lighting.get("status") in ("ok", "pending") else "error",
        "on": lighting.get("on") if isinstance(lighting.get("on"), bool) else None,
        "color": color,
        "brightness": lighting.get("brightness") if isinstance(lighting.get("brightness"), (int, float)) else None,
        "mode": lighting.get("mode") if isinstance(lighting.get("mode"), str) else None,
    }


def project_migration(value):
    if not isinstance(value, dict):
        return None
    result = {key: value[key] for key in MIGRATION_FIELDS if key in value}
    region = result.get("region")
    if isinstance(region, dict):
        result["region"] = {key: region[key] for key in ("code", "name") if key in region}
    source = result.get("source")
    if isinstance(source, dict):
        result["source"] = {"url": source["url"]} if "url" in source else {}
    metrics = result.get("metrics")
    if isinstance(metrics, dict):
        result["metrics"] = {key: metrics[key] for key in MIGRATION_METRIC_FIELDS if key in metrics}
    if isinstance(result.get("warnings"), list):
        result["warnings"] = [warning for warning in result["warnings"] if isinstance(warning, str)]
    return result


def inaturalist_photo(scientific_name):
    global _last_taxon_lookup
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,90}", scientific_name):
        return {}
    now = time.monotonic()
    with _taxon_image_lock:
        cached = _taxon_image_cache.get(scientific_name)
        if cached and cached[0] > now:
            return cached[1]
        wait = 1.0 - (now - _last_taxon_lookup)
        if wait > 0:
            time.sleep(wait)
        query = urlencode({
            "taxon_name": scientific_name,
            "photo_license": "CC-BY",
            "per_page": 10,
            "order_by": "votes",
            "order": "desc",
            "quality_grade": "research",
        })
        request = urllib.request.Request(
            f"{INATURALIST_OBSERVATIONS_URL}?{query}",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            method="GET",
        )
        _last_taxon_lookup = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                observations = json.load(response).get("results", [])
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            observations = []
        common_name = scientific_name
        taxon_url = "https://www.inaturalist.org/"
        for observation in observations:
            taxon = observation.get("taxon") or {}
            matched_name = taxon.get("name") or ""
            if matched_name != scientific_name and not matched_name.startswith(scientific_name + " "):
                continue
            common_name = taxon.get("preferred_common_name") or common_name
            if taxon.get("id"):
                taxon_url = f"https://www.inaturalist.org/taxa/{taxon['id']}"
            photo = next((
                candidate for candidate in observation.get("photos", [])
                if candidate.get("license_code", "").lower() == "cc-by"
            ), {})
            image_url = photo.get("url")
            if image_url and image_url.startswith((
                "https://static.inaturalist.org/",
                "https://inaturalist-open-data.s3.amazonaws.com/",
            )):
                result = {
                    "common_name": common_name,
                    "image_url": image_url,
                    "image_attribution": photo.get("attribution") or "Photo via iNaturalist",
                    "taxon_url": f"https://www.inaturalist.org/observations/{observation['id']}",
                }
                _taxon_image_cache[scientific_name] = (time.monotonic() + 86400, result)
                return result

        wait = 1.0 - (time.monotonic() - _last_taxon_lookup)
        if wait > 0:
            time.sleep(wait)
        taxon_query = urlencode({"q": scientific_name, "per_page": 10})
        taxon_request = urllib.request.Request(
            f"{INATURALIST_TAXA_URL}?{taxon_query}",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            method="GET",
        )
        _last_taxon_lookup = time.monotonic()
        try:
            with urllib.request.urlopen(taxon_request, timeout=8) as response:
                taxa = json.load(response).get("results", [])
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            taxa = []
        for taxon in taxa:
            if taxon.get("name") != scientific_name:
                continue
            common_name = taxon.get("preferred_common_name") or common_name
            taxon_url = f"https://www.inaturalist.org/taxa/{taxon['id']}" if taxon.get("id") else taxon_url
            photo = taxon.get("default_photo") or {}
            image_url = photo.get("medium_url") or photo.get("url")
            if photo.get("license_code", "").lower() == "cc-by" and image_url and image_url.startswith((
                "https://static.inaturalist.org/",
                "https://inaturalist-open-data.s3.amazonaws.com/",
            )):
                result = {
                    "common_name": common_name,
                    "image_url": image_url,
                    "image_attribution": photo.get("attribution") or "Photo via iNaturalist",
                    "taxon_url": taxon_url,
                }
                _taxon_image_cache[scientific_name] = (time.monotonic() + 86400, result)
                return result
            break
        result = {"common_name": common_name, "taxon_url": taxon_url}
        _taxon_image_cache[scientific_name] = (time.monotonic() + (86400 if common_name != scientific_name else 3600), result)
        return result


def inaturalist_common_name(scientific_name):
    global _last_taxon_lookup
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,90}", scientific_name):
        return scientific_name
    with _taxon_image_lock:
        cached = _taxon_name_cache.get(scientific_name)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        wait = 1.0 - (time.monotonic() - _last_taxon_lookup)
        if wait > 0:
            time.sleep(wait)
        query = urlencode({"q": scientific_name, "per_page": 10})
        request = urllib.request.Request(
            f"{INATURALIST_TAXA_URL}?{query}",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            method="GET",
        )
        _last_taxon_lookup = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                taxa = json.load(response).get("results", [])
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            taxa = []
        common_name = next((
            taxon.get("preferred_common_name")
            for taxon in taxa
            if taxon.get("name") == scientific_name and taxon.get("preferred_common_name")
        ), scientific_name)
        lifetime = 86400 if common_name != scientific_name else 3600
        _taxon_name_cache[scientific_name] = (time.monotonic() + lifetime, common_name)
        return common_name


def wildlife_detections():
    global _recent_wildlife_species
    response = fetch_json(HISTORY_PATH)
    data = response.get("data") or {}
    counts = {}
    seen_recordings = set()
    cutoff = time.time() - 24 * 60 * 60
    for entry in data.get("entries", []):
        result = entry.get("result") or {}
        predictions = result.get("animals") or []
        if entry.get("http_status") != 200 or result.get("state") != "completed" or not predictions:
            continue
        recording_id = result.get("recording_id") or result.get("timestamp")
        if recording_id in seen_recordings:
            continue
        seen_recordings.add(recording_id)
        timestamp = result.get("timestamp") or entry.get("read_at") or ""
        try:
            parsed_timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if parsed_timestamp.tzinfo is None:
                parsed_timestamp = parsed_timestamp.replace(tzinfo=timezone.utc)
            detected_at = parsed_timestamp.timestamp()
        except (AttributeError, TypeError, ValueError):
            continue
        if detected_at < cutoff:
            continue
        top_prediction = max(
            predictions,
            key=lambda item: item.get("score", 0) if isinstance(item.get("score", 0), (int, float)) else 0,
        )
        name = top_prediction.get("scientific_name")
        if not isinstance(name, str):
            continue
        item = counts.setdefault(name, {"count": 0, "last_detected": ""})
        item["count"] += 1
        item["last_detected"] = max(item["last_detected"], timestamp)

    with _recent_wildlife_lock:
        _recent_wildlife_species = set(counts) if response.get("http_status") == 200 else set()
    animals = [
        {
            "scientific_name": scientific_name,
            "detection_count": detection["count"],
            "last_detected": detection["last_detected"],
        }
        for scientific_name, detection in sorted(counts.items(), key=lambda item: (-item[1]["count"], item[0]))[:12]
    ]
    return {
        "status": "ok" if response.get("http_status") == 200 else "error",
        "range": "24h",
        "recordings_analyzed": sum(item["count"] for item in counts.values()),
        "species_detected": len(counts),
        "animals": animals,
    }


def wildlife_image(scientific_name):
    with _recent_wildlife_lock:
        if scientific_name not in _recent_wildlife_species:
            return None
    return inaturalist_photo(scientific_name)


def wildlife_common_name(scientific_name):
    with _recent_wildlife_lock:
        if scientific_name not in _recent_wildlife_species:
            return None
    return inaturalist_common_name(scientific_name)


class BioGlowHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def do_GET(self):
        if self.path == "/api/bioglow/dashboard":
            payload = json.dumps(dashboard_data(), separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/api/bioglow/light":
            result = live_light_data()
            payload = json.dumps(result, separators=(",", ":")).encode()
            self.send_response(200 if result["status"] == "ok" else 502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/api/bioglow/direction":
            result = direction_control_state()
            payload = json.dumps(result, separators=(",", ":")).encode()
            self.send_response(200 if result["status"] == "ok" else 502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/api/wildlife/detections":
            payload = json.dumps(wildlife_detections(), separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path.startswith("/api/wildlife/name"):
            request = urlsplit(self.path)
            parameters = parse_qs(request.query, keep_blank_values=True)
            if request.path != "/api/wildlife/name" or set(parameters) != {"species"} or len(parameters["species"]) != 1:
                self.send_error(400, "Provide one recently detected species")
                return
            common_name = wildlife_common_name(parameters["species"][0])
            if common_name is None:
                self.send_error(404, "Species is not in recent station detections")
                return
            payload = json.dumps({"common_name": common_name}, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path.startswith("/api/wildlife/image"):
            request = urlsplit(self.path)
            parameters = parse_qs(request.query, keep_blank_values=True)
            if request.path != "/api/wildlife/image" or set(parameters) != {"species"} or len(parameters["species"]) != 1:
                self.send_error(400, "Provide one recently detected species")
                return
            image = wildlife_image(parameters["species"][0])
            if image is None:
                self.send_error(404, "Species is not in recent station detections")
                return
            payload = json.dumps(image, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path.startswith("/api/bioglow/"):
            self.send_error(404, "Unknown BioGlow API route")
            return
        if self.path.startswith("/api/wildlife/"):
            self.send_error(404, "Unknown wildlife API route")
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/bioglow/direction":
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if content_type != "application/json" or length < 2 or length > 1024:
                self.send_error(400, "Send a small JSON direction request")
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                self.send_error(400, "Invalid JSON request")
                return
            if not isinstance(body, dict):
                self.send_error(400, "Invalid direction request")
                return
            if set(body) == {"angle", "beam_width"} and all(
                isinstance(body[key], int) and not isinstance(body[key], bool)
                for key in ("angle", "beam_width")
            ) and 0 <= body["angle"] <= 359:
                status, result = control_direction_beam(angle=body["angle"], beam_width=body["beam_width"])
            elif body.get("action") == "stop" and set(body).issubset({"action", "restore_mode"}) and body.get("restore_mode") in (None, "normal", "direction_config"):
                status, result = control_direction_beam(stop=True, restore_mode=body.get("restore_mode"))
            else:
                self.send_error(400, "Provide an angle from 0 to 359 and an odd beam width")
                return
            payload = json.dumps(result, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/api/bioglow/user-aim":
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if content_type != "application/json" or length < 2 or length > 1024:
                self.send_error(400, "Send a small JSON direction request")
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                self.send_error(400, "Invalid JSON request")
                return
            if not isinstance(body, dict):
                self.send_error(400, "Invalid direction request")
                return
            if set(body) == {"angle"} and isinstance(body["angle"], int) and not isinstance(body["angle"], bool) and 0 <= body["angle"] <= 359:
                status, result = control_user_aim(angle=body["angle"])
            elif body == {"action": "stop"}:
                status, result = control_user_aim(stop=True)
            else:
                self.send_error(400, "Provide an integer angle from 0 to 359")
                return
            payload = json.dumps(result, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path.startswith(("/api/bioglow/", "/api/wildlife/")):
            self.send_error(405, "Unsupported API method")
            return
        self.send_error(405, "Method not allowed")

    def do_PUT(self):
        self.do_POST()

    def do_PATCH(self):
        self.do_POST()

    def do_DELETE(self):
        self.do_POST()


if __name__ == "__main__":
    host = os.environ.get("BIOGLOW_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    print(f"BioGlow demo listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), BioGlowHandler).serve_forever()
