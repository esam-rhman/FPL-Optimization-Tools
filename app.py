import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, render_template, request, Response, stream_with_context

app = Flask(__name__)

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
RUN_DIR = BASE_DIR / "run"
RESULTS_DIR = DATA_DIR / "results"
SETTINGS_FILE = DATA_DIR / "regular_settings.json"
TEAM_FILE = DATA_DIR / "team.json"
REVIEW_FILE = DATA_DIR / "fplreview.csv"

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# In-memory job state
jobs = {}


def load_settings():
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE) as f:
            return json.load(f)
    return {}


def save_settings(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(load_settings())


@app.route("/api/config", methods=["POST"])
def post_config():
    data = request.get_json()
    settings = load_settings()
    # Only update known keys
    for key, value in data.items():
        settings[key] = value
    save_settings(settings)
    return jsonify({"status": "ok"})


@app.route("/api/upload/review", methods=["POST"])
def upload_review():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file provided"}), 400
    f.save(str(REVIEW_FILE))
    return jsonify({"status": "ok", "filename": f.filename})


@app.route("/api/upload/team", methods=["POST"])
def upload_team():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file provided"}), 400
    f.save(str(TEAM_FILE))
    return jsonify({"status": "ok", "filename": f.filename})


@app.route("/api/files/status", methods=["GET"])
def files_status():
    return jsonify({
        "review": REVIEW_FILE.exists(),
        "team": TEAM_FILE.exists(),
    })


@app.route("/api/fetch/team", methods=["POST"])
def fetch_team():
    settings = load_settings()
    team_id = settings.get("team_id")
    if not team_id:
        return jsonify({"error": "No team_id set in settings"}), 400
    try:
        src_dir = str(BASE_DIR / "src")
        if src_dir not in sys.path:
            sys.path.insert(0, src_dir)
        from multi_period_dev import generate_team_json
        my_data = generate_team_json(team_id, settings)
        with open(str(TEAM_FILE), "w") as f:
            json.dump(my_data, f, indent=2)
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/run", methods=["POST"])
def run_solver():
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {"status": "running", "log": [], "result_file": None}

    def target():
        try:
            proc = subprocess.Popen(
                [sys.executable, "solve_regular.py"],
                cwd=str(RUN_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in proc.stdout:
                jobs[job_id]["log"].append(line.rstrip())
            proc.wait()

            # Find latest result file
            csvs = sorted(RESULTS_DIR.glob("*.csv"), key=os.path.getmtime, reverse=True)
            if csvs:
                jobs[job_id]["result_file"] = csvs[0].name

            jobs[job_id]["status"] = "done" if proc.returncode == 0 else "error"
        except Exception as e:
            jobs[job_id]["log"].append(f"ERROR: {e}")
            jobs[job_id]["status"] = "error"

    threading.Thread(target=target, daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/api/job/<job_id>", methods=["GET"])
def job_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    return jsonify(job)


@app.route("/api/results", methods=["GET"])
def get_results():
    filename = request.args.get("file")
    if filename:
        path = RESULTS_DIR / filename
    else:
        csvs = sorted(RESULTS_DIR.glob("*.csv"), key=os.path.getmtime, reverse=True)
        if not csvs:
            # Fall back to sample outputs
            sample_dir = DATA_DIR / "sample_outputs"
            csvs = sorted(sample_dir.glob("*.csv"), key=os.path.getmtime, reverse=True)
        if not csvs:
            return jsonify({"rows": [], "file": None})
        path = csvs[0]

    import csv
    rows = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    return jsonify({"rows": rows, "file": path.name})


@app.route("/api/results/files", methods=["GET"])
def list_result_files():
    csvs = sorted(RESULTS_DIR.glob("*.csv"), key=os.path.getmtime, reverse=True)
    sample_dir = DATA_DIR / "sample_outputs"
    samples = sorted(sample_dir.glob("*.csv"), key=os.path.getmtime, reverse=True) if sample_dir.exists() else []
    return jsonify({
        "results": [f.name for f in csvs],
        "samples": [f.name for f in samples],
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
