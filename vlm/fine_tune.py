#!/usr/bin/env python3
"""
Fine-tuning script for the local VLM.

Takes training data from training_data/ and fine-tunes the VLM
to be better at comparing engineering drawings with 3D models.

Methods:
  1. OLLAMA_MODELFILE - Create a custom Ollama model with learned system prompt
     (Quick, no GPU training, uses accumulated knowledge as context)

  2. LORA - LoRA fine-tuning via LLaMA Factory or Unsloth
     (Needs 16GB+ RAM on M4, best results, takes ~1hr)

  3. GGUF_MERGE - Merge LoRA adapter and create GGUF for Ollama
     (After LoRA training, deploy back to Ollama)

Usage:
  python fine_tune.py status              # Check readiness
  python fine_tune.py prepare             # Prepare training data
  python fine_tune.py train [method]      # Run fine-tuning
  python fine_tune.py deploy              # Deploy to Ollama
"""

import json
import sys
from pathlib import Path
from datetime import datetime

TRAINING_DIR = Path(__file__).parent.parent / "training_data"
VLM_DIR = Path(__file__).parent
OUTPUT_DIR = VLM_DIR / "fine_tuned"


def check_readiness():
    """Check if we have enough training data."""
    projects = [p for p in TRAINING_DIR.iterdir() if p.is_dir()] if TRAINING_DIR.exists() else []

    total_records = 0
    total_corrections = 0
    categories = {}
    all_records = []

    for proj in projects:
        idx = proj / "training_index.json"
        if idx.exists():
            with open(idx) as f:
                records = json.load(f)
                total_records += len(records)
                all_records.extend(records)
                for r in records:
                    for c in r.get("corrections", []):
                        cat = c.get("category", "UNKNOWN")
                        categories[cat] = categories.get(cat, 0) + 1
                        total_corrections += 1

    print("=" * 50)
    print("Fine-Tuning Readiness Check")
    print("=" * 50)
    print(f"  Projects: {len(projects)}")
    print(f"  Total iterations: {total_records}")
    print(f"  Total corrections: {total_corrections}")
    print(f"  Categories covered:")
    for cat, count in sorted(categories.items()):
        bar = "█" * min(count, 20)
        print(f"    {cat:15s} {count:3d} {bar}")

    print()

    # Readiness assessment
    ready_for = []
    if total_records >= 5:
        ready_for.append("OLLAMA_MODELFILE (system prompt with examples)")
    if total_records >= 20:
        ready_for.append("LORA (lightweight fine-tuning)")
    if total_records >= 50:
        ready_for.append("FULL (comprehensive fine-tuning)")

    if ready_for:
        print(f"  Ready for:")
        for r in ready_for:
            print(f"    ✓ {r}")
    else:
        print(f"  Need at least 5 iterations to start. Keep building tools!")

    not_ready = []
    if total_records < 20:
        not_ready.append(f"LORA: need {20 - total_records} more iterations")
    if total_records < 50:
        not_ready.append(f"FULL: need {50 - total_records} more iterations")
    if len(categories) < 4:
        not_ready.append(f"Need more category coverage ({len(categories)}/6)")

    if not_ready:
        print(f"  Not yet ready:")
        for n in not_ready:
            print(f"    ✗ {n}")

    print("=" * 50)
    return total_records, categories


def prepare_training_data():
    """Prepare training data in formats needed for fine-tuning."""
    OUTPUT_DIR.mkdir(exist_ok=True)

    all_records = []
    for proj in TRAINING_DIR.iterdir():
        idx = proj / "training_index.json"
        if idx.exists():
            with open(idx) as f:
                all_records.extend(json.load(f))

    if not all_records:
        print("No training data found!")
        return

    # --- Format 1: System prompt with examples (for Ollama Modelfile) ---
    examples = []
    for r in all_records:
        if r.get("user_feedback_raw") and r.get("corrections"):
            examples.append({
                "feedback": r["user_feedback_raw"],
                "corrections": r["corrections"],
            })

    system_prompt = _build_system_prompt(examples)
    with open(OUTPUT_DIR / "system_prompt.txt", "w") as f:
        f.write(system_prompt)

    # --- Format 2: Conversation pairs (for LoRA / LLaMA Factory) ---
    conversations = []
    for r in all_records:
        if not r.get("user_feedback_raw"):
            continue

        conv = {
            "id": f"{r.get('project', 'unknown')}_{r.get('iteration', 0)}",
            "conversations": [
                {
                    "from": "human",
                    "value": f"<image>\n<image>\nCompare these two images. The first is the original engineering drawing of a downhole tool, the second is a 3D model attempt. What corrections are needed?"
                },
                {
                    "from": "gpt",
                    "value": json.dumps({
                        "feedback": r["user_feedback_raw"],
                        "corrections": r["corrections"]
                    }, indent=2)
                }
            ],
            "images": [
                r.get("original_image", ""),
                r.get("model_screenshot", ""),
            ]
        }
        conversations.append(conv)

    with open(OUTPUT_DIR / "conversations.json", "w") as f:
        json.dump(conversations, f, indent=2)

    # --- Format 3: JSONL for generic VLM training ---
    with open(OUTPUT_DIR / "train.jsonl", "w") as f:
        for conv in conversations:
            f.write(json.dumps(conv) + "\n")

    # --- Format 4: Correction patterns (for rule engine improvement) ---
    patterns = _extract_patterns(all_records)
    with open(OUTPUT_DIR / "learned_patterns.json", "w") as f:
        json.dump(patterns, f, indent=2)

    print(f"Training data prepared:")
    print(f"  System prompt: {OUTPUT_DIR / 'system_prompt.txt'}")
    print(f"  Conversations: {OUTPUT_DIR / 'conversations.json'} ({len(conversations)} pairs)")
    print(f"  JSONL:         {OUTPUT_DIR / 'train.jsonl'}")
    print(f"  Patterns:      {OUTPUT_DIR / 'learned_patterns.json'} ({len(patterns)} patterns)")


def _build_system_prompt(examples):
    """Build a system prompt that encodes learned knowledge."""
    prompt = """You are a specialized visual comparison assistant for downhole oil & gas tools (packers, logging tools, completion equipment).

Your job: Compare an original engineering catalog drawing with a 3D model screenshot and suggest specific corrections.

You return JSON with match_score (0-100) and corrections array.

## What you've learned from past comparisons:

### Common issues:
1. PROPORTION: 3D models are often too tall and too narrow. Real tools have a wider diameter-to-length ratio than initial models.
2. MATERIAL: Bodies should be SOLID, not transparent. Typical colors: red/crimson for body, dark grey for slips, grey metallic for internal bore.
3. COMPONENT: Element packages have gradual tapers, not abrupt diameter changes. Slips should be thin dark bands, not thick sections.
4. VIEW: Engineering drawings are typically orthographic (flat). Use orthographic camera for comparison snapshots.

### Correction patterns from accepted feedback:
"""

    for i, ex in enumerate(examples):
        prompt += f"\nExample {i+1}:\n"
        prompt += f"  User said: \"{ex['feedback']}\"\n"
        prompt += f"  Corrections applied:\n"
        for c in ex["corrections"]:
            prompt += f"    - [{c['category']}] {c['target']}.{c['property']}: {c['from']} → {c['to']}"
            if c.get("reason"):
                prompt += f" (reason: {c['reason']})"
            prompt += "\n"

    prompt += """
### Response format:
{
  "match_score": <0-100>,
  "suggestions": [
    {
      "category": "PROPORTION|MATERIAL|COMPONENT|GEOMETRY|VIEW|LAYOUT",
      "issue": "<specific problem>",
      "fix": "<specific fix with values where possible>",
      "confidence": <0.0-1.0>
    }
  ]
}

Return ONLY valid JSON."""

    return prompt


def _extract_patterns(records):
    """Extract reusable patterns from training data."""
    patterns = []
    seen = set()

    for r in records:
        for c in r.get("corrections", []):
            key = f"{c['category']}:{c['target']}:{c['property']}"
            if key not in seen:
                seen.add(key)
                patterns.append({
                    "category": c["category"],
                    "target": c["target"],
                    "property": c["property"],
                    "typical_from": c["from"],
                    "typical_to": c["to"],
                    "reason": c.get("reason", ""),
                    "occurrences": sum(
                        1 for r2 in records
                        for c2 in r2.get("corrections", [])
                        if f"{c2['category']}:{c2['target']}:{c2['property']}" == key
                    ),
                })

    patterns.sort(key=lambda p: p["occurrences"], reverse=True)
    return patterns


def train_modelfile():
    """Create an Ollama model with learned system prompt (Method 1)."""
    prepare_training_data()

    system_prompt_path = OUTPUT_DIR / "system_prompt.txt"
    if not system_prompt_path.exists():
        print("No system prompt generated!")
        return

    with open(system_prompt_path) as f:
        system_prompt = f.read()

    modelfile_path = OUTPUT_DIR / "Modelfile"
    from serve import create_modelfile
    create_modelfile("qwen2.5-vl:7b", system_prompt, str(modelfile_path))

    print(f"\nModelfile created: {modelfile_path}")
    print(f"\nTo deploy to Ollama:")
    print(f"  ollama create tool-compare -f {modelfile_path}")
    print(f"\nThen the pipeline will automatically use the fine-tuned model.")


def train_lora():
    """LoRA fine-tuning instructions (Method 2)."""
    prepare_training_data()

    print("""
╔══════════════════════════════════════════════════╗
║           LoRA Fine-Tuning Guide                 ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  1. Install LLaMA Factory:                       ║
║     git clone https://github.com/                ║
║       hiyouga/LLaMA-Factory                      ║
║     cd LLaMA-Factory && pip install -e .         ║
║                                                  ║
║  2. Training data is ready at:                   ║
║     vlm/fine_tuned/conversations.json            ║
║     vlm/fine_tuned/train.jsonl                   ║
║                                                  ║
║  3. Configure dataset in LLaMA Factory:          ║
║     Add entry to data/dataset_info.json          ║
║                                                  ║
║  4. Run training:                                ║
║     llamafactory-cli train \\                     ║
║       --model_name qwen2.5-vl-7b \\              ║
║       --dataset tool_compare \\                   ║
║       --finetuning_type lora \\                   ║
║       --output_dir vlm/fine_tuned/lora_adapter   ║
║                                                  ║
║  5. Export to GGUF for Ollama:                   ║
║     llamafactory-cli export \\                    ║
║       --model_name qwen2.5-vl-7b \\              ║
║       --adapter_name vlm/fine_tuned/lora_adapter ║
║       --export_dir vlm/fine_tuned/merged         ║
║                                                  ║
║  Apple M4 16GB: ~1hr for 50 training pairs       ║
╚══════════════════════════════════════════════════╝
""")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python fine_tune.py <status|prepare|train> [method]")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "status":
        check_readiness()
    elif cmd == "prepare":
        prepare_training_data()
    elif cmd == "train":
        method = sys.argv[2] if len(sys.argv) > 2 else "modelfile"
        if method == "modelfile":
            train_modelfile()
        elif method == "lora":
            train_lora()
        else:
            print(f"Unknown method: {method}. Use: modelfile, lora")
    elif cmd == "deploy":
        print("Run: ollama create tool-compare -f vlm/fine_tuned/Modelfile")
    else:
        print(f"Unknown command: {cmd}")
