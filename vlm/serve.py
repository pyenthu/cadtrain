#!/usr/bin/env python3
"""
Local VLM server — wraps Ollama for the comparison pipeline.

Handles:
  - Model management (pull, check status)
  - Health checks
  - Switching between base and fine-tuned models
  - Serving the comparison endpoint

Usage:
  python serve.py status          # Check Ollama & model status
  python serve.py pull            # Pull the default VLM
  python serve.py test <img1> <img2>  # Quick test comparison
"""

import json
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_MODEL = "qwen2.5-vl:7b"
FINE_TUNED_MODEL = "tool-compare:latest"  # After fine-tuning


def check_ollama():
    """Check if Ollama is installed and running."""
    # Check installed
    result = subprocess.run(["which", "ollama"], capture_output=True, text=True)
    if result.returncode != 0:
        return {"installed": False, "running": False, "models": []}

    # Check running
    try:
        import requests
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        models = [m["name"] for m in resp.json().get("models", [])]
        return {"installed": True, "running": True, "models": models}
    except Exception:
        return {"installed": True, "running": False, "models": []}


def pull_model(model_name=DEFAULT_MODEL):
    """Pull a VLM model via Ollama."""
    print(f"Pulling {model_name}...")
    result = subprocess.run(
        ["ollama", "pull", model_name],
        capture_output=False,
    )
    return result.returncode == 0


def start_ollama():
    """Start Ollama server if not running."""
    status = check_ollama()
    if not status["installed"]:
        print("Ollama not installed. Install from https://ollama.com")
        return False
    if status["running"]:
        print("Ollama already running")
        return True

    print("Starting Ollama...")
    subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)

    status = check_ollama()
    if status["running"]:
        print("Ollama started successfully")
        return True
    else:
        print("Failed to start Ollama")
        return False


def get_best_model():
    """Return the best available model (fine-tuned > base)."""
    status = check_ollama()
    if not status["running"]:
        return None

    if FINE_TUNED_MODEL in status["models"]:
        return FINE_TUNED_MODEL
    elif DEFAULT_MODEL in status["models"]:
        return DEFAULT_MODEL
    else:
        # Check for any vision model
        vision_models = [m for m in status["models"] if any(v in m for v in ["llava", "qwen", "vl", "vision"])]
        return vision_models[0] if vision_models else None


def create_modelfile(base_model, system_prompt, output_path):
    """
    Create an Ollama Modelfile for a custom model.
    Used after fine-tuning to create the tool-compare model.
    """
    modelfile = f"""FROM {base_model}

SYSTEM \"\"\"{system_prompt}\"\"\"

PARAMETER temperature 0.1
PARAMETER top_p 0.9
"""
    with open(output_path, "w") as f:
        f.write(modelfile)

    return output_path


def print_status():
    """Print full status report."""
    status = check_ollama()
    print("=" * 50)
    print("VLM Server Status")
    print("=" * 50)
    print(f"  Ollama installed: {status['installed']}")
    print(f"  Ollama running:   {status['running']}")

    if status["models"]:
        print(f"  Models available:")
        for m in status["models"]:
            marker = " ← active" if m == get_best_model() else ""
            print(f"    - {m}{marker}")
    else:
        print(f"  Models: none (run: python serve.py pull)")

    # Check training data
    training_dir = Path(__file__).parent.parent / "training_data"
    if training_dir.exists():
        projects = list(training_dir.iterdir())
        total_records = 0
        for p in projects:
            idx = p / "training_index.json"
            if idx.exists():
                with open(idx) as f:
                    total_records += len(json.load(f))
        print(f"\n  Training data:")
        print(f"    Projects: {len(projects)}")
        print(f"    Total records: {total_records}")

        if total_records < 20:
            print(f"    Status: Collecting data ({total_records}/50 for fine-tuning)")
        elif total_records < 50:
            print(f"    Status: Almost ready for fine-tuning ({total_records}/50)")
        else:
            print(f"    Status: Ready for fine-tuning!")
    print("=" * 50)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python serve.py <status|pull|start|test>")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "status":
        print_status()
    elif cmd == "pull":
        model = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL
        pull_model(model)
    elif cmd == "start":
        start_ollama()
    elif cmd == "test":
        if len(sys.argv) < 4:
            print("Usage: python serve.py test <original.png> <model.png>")
            sys.exit(1)
        from compare import VisualCompare, Mode
        model = get_best_model()
        if model:
            comparer = VisualCompare(mode=Mode.LOCAL, ollama_model=model)
            result = comparer.compare(sys.argv[2], sys.argv[3])
            print(json.dumps(result, indent=2))
        else:
            print("No VLM model available. Run: python serve.py pull")
    else:
        print(f"Unknown command: {cmd}")
