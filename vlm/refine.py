#!/usr/bin/env python3
"""
Automated refinement loop: Original image → VLM compare → param update → rebuild → screenshot → repeat.

Closes the loop between visual comparison and parametric model adjustment.
No human in the loop — runs until match_score > threshold or max iterations.

Usage:
  ANTHROPIC_API_KEY=sk-... python vlm/refine.py <original.png> [--max-iter 5] [--threshold 92] [--port 3334]
  ANTHROPIC_API_KEY=sk-... python vlm/refine.py batch <image_dir>   # process all PNGs in a directory
"""

import json
import sys
import os
import time
import base64
from pathlib import Path
from datetime import datetime


class ParamRefiner:
    """Translates VLM suggestions into concrete parameter changes."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def suggest_params(self, current_params: dict, suggestions: list, original_path: str, model_path: str) -> dict:
        """
        Given current params + VLM suggestions, return updated params.
        Uses Claude to translate natural language fixes into param values.
        """
        prompt = f"""You are a parametric CAD model tuner for downhole drilling tools.

You have a parametric 3D model with these current parameters:
```json
{json.dumps(current_params, indent=2)}
```

A visual comparison between the original catalog drawing and the 3D model produced these correction suggestions:
{json.dumps(suggestions, indent=2)}

Your job: Return an updated version of the parameters JSON that applies these corrections.

Rules:
- Only change parameters that are relevant to the suggestions
- Make proportional changes (don't overshoot)
- Keep values physically reasonable (OD > ID, wall > 0, lengths > 0)
- bodyID and lowerID are DERIVED (bodyOD - 2*bodyWall, lowerOD - 2*lowerWall) — adjust wall thickness instead

Return ONLY the updated JSON object, no explanation. Must be valid JSON matching the exact same structure."""

        orig_b64 = self._img_to_base64(original_path)
        model_b64 = self._img_to_base64(model_path)

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": orig_b64}},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": model_b64}},
                ]
            }]
        )

        text = response.content[0].text.strip()
        # Parse JSON from response (handle markdown code blocks)
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())

    def _img_to_base64(self, path):
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")


class RefinementLoop:
    """
    Full refinement pipeline:
      1. Screenshot current model
      2. VLM compares original vs model
      3. If match_score > threshold → done
      4. Translate suggestions → param changes
      5. Write params → rebuild model
      6. Go to 1
    """

    def __init__(self, api_key: str, port: int = 3334, params_path: str = None):
        from compare import VisualCompare, Mode

        self.api_key = api_key
        self.port = port
        self.params_path = params_path or str(
            Path(__file__).parent.parent / "BOTTOM_SUB" / "manifold" / "params.json"
        )
        self.assembly_ts = str(
            Path(__file__).parent.parent / "BOTTOM_SUB" / "manifold" / "assembly.ts"
        )
        self.output_dir = Path(__file__).parent.parent / "training_data" / "bottom_sub" / "images"
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.comparer = VisualCompare(mode=Mode.CLAUDE, claude_api_key=api_key)
        self.refiner = ParamRefiner(api_key=api_key)

        # Load training history for context
        training_path = Path(__file__).parent.parent / "training_data" / "bottom_sub" / "training_index.json"
        if training_path.exists():
            self.comparer.load_history(str(training_path))

    def screenshot(self, name: str) -> str:
        """Take Playwright screenshot of current model."""
        from playwright.sync_api import sync_playwright

        out = self.output_dir / f"{name}.png"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.goto(f"http://localhost:{self.port}/")
            time.sleep(6)
            page.screenshot(path=str(out))
            browser.close()
        return str(out)

    def read_current_params(self) -> dict:
        """Read current params from assembly.ts DEFAULT_PARAMS."""
        import re
        with open(self.assembly_ts) as f:
            content = f.read()

        match = re.search(
            r"export const DEFAULT_PARAMS:\s*AssemblyParams\s*=\s*(\{.*?\});",
            content, re.DOTALL
        )
        if not match:
            raise ValueError("Could not find DEFAULT_PARAMS in assembly.ts")

        ts_obj = match.group(1)
        # Remove // comments
        ts_obj = re.sub(r"//.*$", "", ts_obj, flags=re.MULTILINE)
        # Remove trailing commas before } or ]
        ts_obj = re.sub(r",\s*([}\]])", r"\1", ts_obj)
        # Quote unquoted keys (TypeScript → JSON)
        ts_obj = re.sub(r"(\s)(\w+)\s*:", r'\1"\2":', ts_obj)
        return json.loads(ts_obj)

    def write_params(self, params: dict):
        """Update DEFAULT_PARAMS in assembly.ts with new values."""
        with open(self.assembly_ts) as f:
            content = f.read()

        import re

        def format_params(params, indent=2):
            """Format params as TypeScript object literal."""
            lines = ["  housing: {"]
            for k, v in params["housing"].items():
                lines.append(f"    {k}: {v},")
            lines.append("  },")
            lines.append("  sleeve: {")
            for k, v in params["sleeve"].items():
                lines.append(f"    {k}: {v},")
            lines.append("  },")
            lines.append("  slips: {")
            for k, v in params["slips"].items():
                lines.append(f"    {k}: {v},")
            lines.append("  },")
            return "{\n" + "\n".join(lines) + "\n}"

        new_obj = format_params(params)
        content = re.sub(
            r"export const DEFAULT_PARAMS:\s*AssemblyParams\s*=\s*\{.*?\};",
            f"export const DEFAULT_PARAMS: AssemblyParams = {new_obj};",
            content, flags=re.DOTALL
        )

        with open(self.assembly_ts, "w") as f:
            f.write(content)

        # Wait for Vite hot reload
        time.sleep(2)

    def run(self, original_path: str, max_iter: int = 5, threshold: int = 92) -> dict:
        """Run the full refinement loop."""
        print(f"{'='*60}")
        print(f"AUTOMATED REFINEMENT LOOP")
        print(f"  Original:  {original_path}")
        print(f"  Threshold: {threshold}/100")
        print(f"  Max iter:  {max_iter}")
        print(f"{'='*60}\n")

        history = []

        for i in range(max_iter):
            print(f"--- Iteration {i+1}/{max_iter} ---")

            # 1. Screenshot current state
            shot_name = f"refine_iter_{i+1:02d}"
            model_path = self.screenshot(shot_name)
            print(f"  Screenshot: {model_path}")

            # 2. VLM comparison
            result = self.comparer.compare(original_path, model_path)
            score = result.get("match_score", 0)
            suggestions = result.get("suggestions", [])
            print(f"  Match score: {score}/100")
            print(f"  Suggestions: {len(suggestions)}")
            for s in suggestions:
                print(f"    [{s['category']}] {s.get('issue', '')[:80]}")

            # 3. Check threshold
            if score >= threshold:
                print(f"\n  CONVERGED at {score}/100 (threshold: {threshold})")
                break

            if not suggestions:
                print(f"\n  No suggestions, stopping.")
                break

            # 4. Translate suggestions → param changes
            current_params = self.read_current_params()
            print(f"  Translating suggestions to param changes...")
            try:
                new_params = self.refiner.suggest_params(
                    current_params, suggestions, original_path, model_path
                )
            except Exception as e:
                print(f"  ERROR translating: {e}")
                break

            # Show what changed
            changes = []
            for group in ["housing", "sleeve", "slips"]:
                for k, v in new_params.get(group, {}).items():
                    old = current_params.get(group, {}).get(k)
                    if old is not None and old != v:
                        changes.append(f"    {group}.{k}: {old} → {v}")
            if changes:
                print(f"  Changes:")
                for c in changes:
                    print(c)
            else:
                print(f"  No param changes suggested, stopping.")
                break

            # 5. Apply changes
            self.write_params(new_params)
            print(f"  Params written, waiting for hot reload...\n")
            time.sleep(3)

            # Record
            history.append({
                "iteration": i + 1,
                "timestamp": datetime.now().isoformat(),
                "match_score": score,
                "suggestions": suggestions,
                "params_before": current_params,
                "params_after": new_params,
                "changes": changes,
                "screenshot": model_path,
            })

        # Final screenshot + score
        final_path = self.screenshot("refine_final")
        final_result = self.comparer.compare(original_path, final_path)
        final_score = final_result.get("match_score", 0)
        print(f"\n{'='*60}")
        print(f"FINAL SCORE: {final_score}/100")
        print(f"Screenshots: {self.output_dir}")
        print(f"{'='*60}")

        # Save refinement log
        log = {
            "original": original_path,
            "final_score": final_score,
            "iterations": len(history),
            "history": history,
            "final_params": self.read_current_params(),
        }
        log_path = self.output_dir.parent / "refinement_log.json"
        with open(log_path, "w") as f:
            json.dump(log, f, indent=2)
        print(f"Log: {log_path}")

        return log


def run_batch(image_dir: str, api_key: str, port: int = 3334):
    """Process all PNG images in a directory."""
    images = sorted(Path(image_dir).glob("*.png"))
    print(f"Found {len(images)} images to process\n")

    results = []
    for img in images:
        print(f"\n{'#'*60}")
        print(f"PROCESSING: {img.name}")
        print(f"{'#'*60}")

        loop = RefinementLoop(api_key=api_key, port=port)
        result = loop.run(str(img))
        results.append({"image": str(img), "final_score": result["final_score"]})

    print(f"\n\n{'='*60}")
    print("BATCH RESULTS")
    print(f"{'='*60}")
    for r in results:
        print(f"  {Path(r['image']).name}: {r['final_score']}/100")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Automated VLM refinement loop")
    parser.add_argument("original", help="Path to original catalog image, or 'batch' for batch mode")
    parser.add_argument("--max-iter", type=int, default=5, help="Max refinement iterations")
    parser.add_argument("--threshold", type=int, default=92, help="Target match score")
    parser.add_argument("--port", type=int, default=3334, help="Vite dev server port")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: Set ANTHROPIC_API_KEY environment variable")
        sys.exit(1)

    if args.original == "batch":
        if len(sys.argv) < 3:
            print("Usage: python vlm/refine.py batch <image_dir>")
            sys.exit(1)
        run_batch(sys.argv[2], api_key, args.port)
    else:
        loop = RefinementLoop(api_key=api_key, port=args.port)
        loop.run(args.original, max_iter=args.max_iter, threshold=args.threshold)
