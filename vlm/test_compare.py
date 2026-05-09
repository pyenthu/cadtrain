#!/usr/bin/env python3
"""
Test the VLM comparison pipeline end-to-end.

Usage:
  ANTHROPIC_API_KEY=sk-... python vlm/test_compare.py          # Claude mode
  python vlm/test_compare.py rules                              # Rules mode (no API needed)
  python vlm/test_compare.py local                              # Ollama mode

Compares the original HAL10408 drawing with the current model screenshot
and prints correction suggestions.
"""

import json
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from vlm.compare import VisualCompare, Mode

ORIGINAL = "training_data/bottom_sub/images/original.png"
MODEL = "training_data/bottom_sub/images/model_current.png"
TRAINING = "training_data/bottom_sub/training_index.json"


def main():
    mode_arg = sys.argv[1] if len(sys.argv) > 1 else None

    if mode_arg == "rules":
        mode = Mode.RULES
    elif mode_arg == "local":
        mode = Mode.LOCAL
    elif mode_arg == "claude" or os.environ.get("ANTHROPIC_API_KEY"):
        mode = Mode.CLAUDE
    else:
        print("No ANTHROPIC_API_KEY set. Running rules mode.")
        print("For Claude: ANTHROPIC_API_KEY=sk-... python vlm/test_compare.py")
        print("For Ollama: python vlm/test_compare.py local\n")
        mode = Mode.RULES

    print(f"Mode: {mode.value}")
    print(f"Original: {ORIGINAL}")
    print(f"Model:    {MODEL}\n")

    comparer = VisualCompare(mode=mode)
    comparer.load_history(TRAINING)

    result = comparer.compare(ORIGINAL, MODEL)

    print(f"Match Score: {result.get('match_score', '?')}/100\n")
    print("Suggestions:")
    for s in result.get("suggestions", []):
        conf = s.get("confidence", "?")
        print(f"  [{s['category']}] (conf: {conf})")
        print(f"    Issue: {s.get('issue', '')}")
        print(f"    Fix:   {s.get('fix', '')}")
        print()

    # Save result
    out = Path("vlm/test_result.json")
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Full result saved to: {out}")


if __name__ == "__main__":
    main()
