#!/usr/bin/env python3
"""
3D Tool Modeling Pipeline with Training Data Capture.

Architecture:
  1. Original drawing (from PDF extraction)
  2. 3D model (Three.js HTML)
  3. Playwright screenshots both
  4. VLM compares (local Ollama or Claude)
  5. User reviews & provides feedback
  6. Corrections are chunked and applied
  7. Training record saved for VLM fine-tuning

For now: Claude Code acts as both VLM and code generator.
Future: Local VLM (Ollama) handles step 4, Claude API handles step 6.
"""

import json
import os
import time
import shutil
from datetime import datetime
from pathlib import Path

# --- Configuration ---
BASE_DIR = Path("/Users/neerajsethi/duplicate")
TRAINING_DIR = BASE_DIR / "training_data"
TRAINING_DIR.mkdir(exist_ok=True)

# Feedback categories
CATEGORIES = {
    "GEOMETRY": "Proportions, dimensions, scale, height, diameter, length",
    "MATERIAL": "Color, opacity, metalness, roughness, transparency",
    "COMPONENT": "Add, remove, modify parts, features, details",
    "PROPORTION": "Relative sizing between components",
    "VIEW": "Camera, angle, clipping, section cut, projection",
    "LAYOUT": "UI, panels, labels, arrangement",
}


class TrainingRecord:
    """One iteration of the comparison-feedback-correction loop."""

    def __init__(self, project_name, iteration, original_path):
        self.project = project_name
        self.iteration = iteration
        self.timestamp = datetime.now().isoformat()
        self.original_path = str(original_path)
        self.model_screenshot = None
        self.result_screenshot = None
        self.user_feedback_raw = ""
        self.corrections = []
        self.code_changes = []
        self.vlm_suggestions = []

    def add_feedback(self, raw_text):
        """Store raw user feedback."""
        self.user_feedback_raw = raw_text

    def add_correction(self, category, target, prop, from_val, to_val, reason=""):
        """Add a structured correction chunk."""
        self.corrections.append({
            "category": category,
            "target": target,
            "property": prop,
            "from": from_val,
            "to": to_val,
            "reason": reason,
        })

    def add_code_change(self, file_path, old_code, new_code):
        """Track the actual code diff."""
        self.code_changes.append({
            "file": str(file_path),
            "old": old_code,
            "new": new_code,
        })

    def add_vlm_suggestion(self, suggestion):
        """Store what the VLM suggested (for training comparison)."""
        self.vlm_suggestions.append(suggestion)

    def to_dict(self):
        return {
            "project": self.project,
            "iteration": self.iteration,
            "timestamp": self.timestamp,
            "original_image": self.original_path,
            "model_screenshot": self.model_screenshot,
            "result_screenshot": self.result_screenshot,
            "user_feedback_raw": self.user_feedback_raw,
            "corrections": self.corrections,
            "code_changes": self.code_changes,
            "vlm_suggestions": self.vlm_suggestions,
        }


class TrainingDataStore:
    """Manages the training dataset for VLM fine-tuning."""

    def __init__(self, project_name):
        self.project = project_name
        self.project_dir = TRAINING_DIR / project_name
        self.project_dir.mkdir(exist_ok=True)
        (self.project_dir / "images").mkdir(exist_ok=True)
        self.index_path = self.project_dir / "training_index.json"
        self.records = self._load()

    def _load(self):
        if self.index_path.exists():
            with open(self.index_path) as f:
                return json.load(f)
        return []

    def save_record(self, record: TrainingRecord, model_img_path=None, result_img_path=None):
        """Save a training record with its images."""
        img_dir = self.project_dir / "images"
        prefix = f"iter_{record.iteration:03d}"

        # Copy images to training data
        if model_img_path and Path(model_img_path).exists():
            dest = img_dir / f"{prefix}_model.png"
            shutil.copy2(model_img_path, dest)
            record.model_screenshot = str(dest)

        if result_img_path and Path(result_img_path).exists():
            dest = img_dir / f"{prefix}_result.png"
            shutil.copy2(result_img_path, dest)
            record.result_screenshot = str(dest)

        # Copy original if not already there
        orig_dest = img_dir / f"original.png"
        if not orig_dest.exists() and Path(record.original_path).exists():
            shutil.copy2(record.original_path, orig_dest)

        self.records.append(record.to_dict())
        self._save()

        return record

    def _save(self):
        with open(self.index_path, "w") as f:
            json.dump(self.records, f, indent=2)

    def get_stats(self):
        """Get training data statistics."""
        total = len(self.records)
        cats = {}
        for r in self.records:
            for c in r.get("corrections", []):
                cat = c.get("category", "UNKNOWN")
                cats[cat] = cats.get(cat, 0) + 1
        return {"total_iterations": total, "corrections_by_category": cats}

    def export_for_vlm(self, output_path=None):
        """Export training data in VLM fine-tuning format (conversation pairs)."""
        output_path = output_path or (self.project_dir / "vlm_training.jsonl")
        pairs = []

        for r in self.records:
            if not r.get("model_screenshot") or not r.get("user_feedback_raw"):
                continue

            # Format: given these two images, what corrections are needed?
            pair = {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Compare these two images. The first is the original engineering drawing, the second is a 3D model attempt. What specific corrections are needed to make the 3D model match the original?"},
                            {"type": "image", "path": str(self.project_dir / "images" / "original.png")},
                            {"type": "image", "path": r["model_screenshot"]},
                        ]
                    },
                    {
                        "role": "assistant",
                        "content": json.dumps({
                            "feedback": r["user_feedback_raw"],
                            "corrections": r["corrections"],
                        })
                    }
                ]
            }
            pairs.append(pair)

        with open(output_path, "w") as f:
            for p in pairs:
                f.write(json.dumps(p) + "\n")

        return len(pairs)


def chunk_feedback(raw_feedback):
    """
    Parse raw user feedback into structured correction chunks.
    This is the function the local VLM will eventually replace.
    """
    chunks = []
    text = raw_feedback.lower()

    # Geometry/Proportion patterns
    if any(w in text for w in ["too tall", "reduce height", "shorter"]):
        chunks.append({"category": "PROPORTION", "action": "decrease_height"})
    if any(w in text for w in ["too short", "increase height", "taller"]):
        chunks.append({"category": "PROPORTION", "action": "increase_height"})
    if any(w in text for w in ["increase dia", "wider", "thicker"]):
        chunks.append({"category": "PROPORTION", "action": "increase_diameter"})
    if any(w in text for w in ["too wide", "thinner", "reduce dia"]):
        chunks.append({"category": "PROPORTION", "action": "decrease_diameter"})

    # Material patterns
    if any(w in text for w in ["transparent", "opacity", "see through"]):
        chunks.append({"category": "MATERIAL", "action": "fix_transparency"})
    if any(w in text for w in ["red", "color"]):
        chunks.append({"category": "MATERIAL", "action": "change_color", "detail": "red"})
    if any(w in text for w in ["grey", "gray", "metallic"]):
        chunks.append({"category": "MATERIAL", "action": "change_color", "detail": "grey_metallic"})
    if any(w in text for w in ["white background"]):
        chunks.append({"category": "MATERIAL", "action": "white_background"})

    # View patterns
    if any(w in text for w in ["cross section", "quad cut", "section cut", "cut"]):
        chunks.append({"category": "VIEW", "action": "add_section_cut"})
    if any(w in text for w in ["orthogonal", "ortho", "2d"]):
        chunks.append({"category": "VIEW", "action": "orthographic_camera"})

    # Layout patterns
    if any(w in text for w in ["panel", "split", "side by side"]):
        chunks.append({"category": "LAYOUT", "action": "multi_panel"})
    if any(w in text for w in ["label", "title"]):
        chunks.append({"category": "LAYOUT", "action": "add_labels"})

    return chunks


def screenshot_comparison(html_path, output_path, viewport=(1600, 1000), wait=5):
    """Take a Playwright screenshot of an HTML file."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
        page.goto(f"file://{html_path}")
        time.sleep(wait)
        page.screenshot(path=str(output_path))
        browser.close()

    return output_path


# --- Retroactively capture our session's training data ---

def capture_session_history():
    """Capture the iterations we already did in this session."""

    store = TrainingDataStore("perma_lach_pls")
    project_dir = BASE_DIR / "HAL_PACKERS"
    original = project_dir / "original_p39.png"

    iterations = [
        {
            "iteration": 1,
            "screenshot": "3d_screenshot.png",
            "feedback": "body seems transparent, should be red outside grey metallic inside, background should be white",
            "corrections": [
                {"category": "MATERIAL", "target": "body", "property": "opacity", "from": "0.3-0.45", "to": "1.0", "reason": "housing looked see-through"},
                {"category": "MATERIAL", "target": "body", "property": "color", "from": "#8899aa", "to": "#cc2222", "reason": "should match red catalog drawing"},
                {"category": "MATERIAL", "target": "bore", "property": "color", "from": "#0a0a0a", "to": "#999999", "reason": "inner bore should be grey metallic"},
                {"category": "MATERIAL", "target": "background", "property": "color", "from": "#1a1a2e", "to": "#ffffff", "reason": "white background for comparison"},
            ],
        },
        {
            "iteration": 2,
            "screenshot": "3d_screenshot_v2.png",
            "feedback": "proportions wrong, tool should be taller and thinner, more like the original slim shape",
            "corrections": [
                {"category": "PROPORTION", "target": "all_components", "property": "rOuter", "from": "0.25-0.6", "to": "0.1-0.22", "reason": "too wide compared to original"},
                {"category": "PROPORTION", "target": "mandrels", "property": "height", "from": "0.8", "to": "2.5", "reason": "mandrels should be longer"},
                {"category": "GEOMETRY", "target": "element_package", "property": "taper", "from": "abrupt", "to": "gradual_cone", "reason": "original shows gradual taper"},
            ],
        },
        {
            "iteration": 3,
            "screenshot": "compare_v5.png",
            "feedback": "90 deg quad cut view needed, orthogonal camera, remove UI text, match aspect ratio",
            "corrections": [
                {"category": "VIEW", "target": "camera", "property": "type", "from": "perspective", "to": "orthographic", "reason": "flat 2D-like view for comparison"},
                {"category": "VIEW", "target": "clipping", "property": "planes", "from": "none", "to": "quad_cut_90deg", "reason": "show internal bore structure"},
                {"category": "LAYOUT", "target": "ui", "property": "visible", "from": "true", "to": "false", "reason": "clean view for comparison"},
            ],
        },
        {
            "iteration": 4,
            "screenshot": "compare_v7.png",
            "feedback": "too tall, reduce height and increase diameter a bit",
            "corrections": [
                {"category": "PROPORTION", "target": "packer_group", "property": "scale_y", "from": "1.0", "to": "0.5", "reason": "too tall compared to original"},
                {"category": "PROPORTION", "target": "packer_group", "property": "scale_xz", "from": "3.0", "to": "6.0", "reason": "diameter needs to be wider"},
            ],
        },
        {
            "iteration": 5,
            "screenshot": "compare_check.png",
            "feedback": "4 panels needed: original, cross-section, 3D, and labels panel. Labels on top.",
            "corrections": [
                {"category": "LAYOUT", "target": "compare_page", "property": "panels", "from": "3", "to": "4", "reason": "separate panel for component details"},
                {"category": "LAYOUT", "target": "labels", "property": "position", "from": "overlay", "to": "top_bar", "reason": "cleaner label placement"},
            ],
        },
    ]

    for it in iterations:
        record = TrainingRecord("perma_lach_pls", it["iteration"], original)
        record.add_feedback(it["feedback"])
        for c in it["corrections"]:
            record.add_correction(c["category"], c["target"], c["property"], c["from"], c["to"], c.get("reason", ""))

        img_path = project_dir / it["screenshot"]
        if img_path.exists():
            store.save_record(record, model_img_path=str(img_path))
        else:
            store.save_record(record)

    stats = store.get_stats()
    exported = store.export_for_vlm()

    print(f"Training data captured:")
    print(f"  Records: {stats['total_iterations']}")
    print(f"  Corrections by category: {json.dumps(stats['corrections_by_category'], indent=4)}")
    print(f"  VLM training pairs exported: {exported}")
    print(f"  Output: {store.project_dir}")


if __name__ == "__main__":
    capture_session_history()
