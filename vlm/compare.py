#!/usr/bin/env python3
"""
Visual comparison engine.

Takes an original drawing and a 3D model screenshot,
returns structured correction suggestions.

Modes:
  1. RULES   - Pattern-based (no model needed, works now)
  2. LOCAL   - Ollama VLM (runs on your Mac M4)
  3. CLAUDE  - Claude API (highest quality, costs tokens)

As training data grows, LOCAL mode gets fine-tuned and improves.
"""

import json
import base64
import subprocess
from pathlib import Path
from enum import Enum


class Mode(Enum):
    RULES = "rules"
    LOCAL = "local"
    CLAUDE = "claude"


class VisualCompare:
    """Compare original drawing with 3D model screenshot."""

    def __init__(self, mode=Mode.RULES, ollama_model="qwen2.5-vl:7b", claude_api_key=None):
        self.mode = mode
        self.ollama_model = ollama_model
        self.claude_api_key = claude_api_key
        self.history = []  # past corrections for context

    def compare(self, original_path, model_path):
        """
        Compare two images and return correction suggestions.

        Returns:
            {
                "match_score": 0-100,
                "suggestions": [
                    {"category": "PROPORTION", "issue": "...", "fix": "..."},
                    ...
                ]
            }
        """
        if self.mode == Mode.RULES:
            return self._compare_rules(original_path, model_path)
        elif self.mode == Mode.LOCAL:
            return self._compare_local(original_path, model_path)
        elif self.mode == Mode.CLAUDE:
            return self._compare_claude(original_path, model_path)

    # ----- Mode 1: Rule-based (works now, no model needed) -----

    def _compare_rules(self, original_path, model_path):
        """
        Rule-based comparison using image dimensions and past feedback patterns.
        This is the baseline — the VLM will replace this.
        """
        from PIL import Image

        orig = Image.open(original_path)
        model = Image.open(model_path)

        suggestions = []

        # Analyze aspect ratios
        orig_ratio = orig.height / orig.width
        model_ratio = model.height / model.width

        if model_ratio > orig_ratio * 1.2:
            suggestions.append({
                "category": "PROPORTION",
                "issue": f"3D model is too tall (aspect {model_ratio:.2f} vs original {orig_ratio:.2f})",
                "fix": "Reduce Y scale or increase X/Z scale",
                "confidence": 0.7,
            })
        elif model_ratio < orig_ratio * 0.8:
            suggestions.append({
                "category": "PROPORTION",
                "issue": f"3D model is too wide (aspect {model_ratio:.2f} vs original {orig_ratio:.2f})",
                "fix": "Increase Y scale or reduce X/Z scale",
                "confidence": 0.7,
            })

        # Analyze color distribution
        orig_colors = self._dominant_colors(orig)
        model_colors = self._dominant_colors(model)

        if orig_colors.get("red", 0) > 0.2 and model_colors.get("red", 0) < 0.1:
            suggestions.append({
                "category": "MATERIAL",
                "issue": "Original has significant red, 3D model lacks red",
                "fix": "Change body material color to red (#cc2222)",
                "confidence": 0.8,
            })

        if model_colors.get("transparent", 0) > 0.3:
            suggestions.append({
                "category": "MATERIAL",
                "issue": "3D model appears to have transparent sections",
                "fix": "Set opacity to 1.0 on all body components",
                "confidence": 0.6,
            })

        # Apply learnings from past corrections
        for past in self.history[-10:]:
            for corr in past.get("corrections", []):
                if corr["category"] == "PROPORTION" and "height" in corr.get("property", ""):
                    suggestions.append({
                        "category": "PROPORTION",
                        "issue": f"Past feedback: height was adjusted ({corr['from']} → {corr['to']})",
                        "fix": "Check if height proportion matches original",
                        "confidence": 0.5,
                    })

        match_score = max(0, 100 - len(suggestions) * 15)

        return {
            "match_score": match_score,
            "suggestions": suggestions,
            "mode": "rules",
        }

    def _dominant_colors(self, img, sample_size=1000):
        """Quick color analysis of an image."""
        img = img.convert("RGB").resize((100, 100))
        pixels = list(img.getdata())

        red_count = sum(1 for r, g, b in pixels if r > 150 and g < 100 and b < 100)
        grey_count = sum(1 for r, g, b in pixels if abs(r - g) < 30 and abs(g - b) < 30 and 80 < r < 200)
        dark_count = sum(1 for r, g, b in pixels if r < 50 and g < 50 and b < 50)
        white_count = sum(1 for r, g, b in pixels if r > 230 and g > 230 and b > 230)
        total = len(pixels)

        return {
            "red": red_count / total,
            "grey": grey_count / total,
            "dark": dark_count / total,
            "white": white_count / total,
            "transparent": dark_count / total if dark_count / total > 0.4 else 0,
        }

    # ----- Mode 2: Local VLM via Ollama -----

    def _compare_local(self, original_path, model_path):
        """Use local Ollama VLM for visual comparison."""
        prompt = self._build_prompt()

        # Ollama multimodal API call
        orig_b64 = self._img_to_base64(original_path)
        model_b64 = self._img_to_base64(model_path)

        payload = {
            "model": self.ollama_model,
            "prompt": prompt,
            "images": [orig_b64, model_b64],
            "stream": False,
            "options": {"temperature": 0.1},
        }

        try:
            import requests
            resp = requests.post(
                "http://localhost:11434/api/generate",
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            result = resp.json()
            return self._parse_vlm_response(result.get("response", ""))
        except Exception as e:
            print(f"  Local VLM error: {e}")
            print("  Falling back to rules mode...")
            return self._compare_rules(original_path, model_path)

    # ----- Mode 3: Claude API -----

    def _compare_claude(self, original_path, model_path):
        """Use Claude API for visual comparison."""
        try:
            import anthropic
        except ImportError:
            print("  anthropic package not installed. pip install anthropic")
            return self._compare_rules(original_path, model_path)

        client = anthropic.Anthropic(api_key=self.claude_api_key)
        prompt = self._build_prompt()

        orig_b64 = self._img_to_base64(original_path)
        model_b64 = self._img_to_base64(model_path)

        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
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
            return self._parse_vlm_response(response.content[0].text)
        except Exception as e:
            print(f"  Claude API error: {e}")
            return self._compare_rules(original_path, model_path)

    # ----- Shared helpers -----

    def _build_prompt(self):
        """Build the comparison prompt with learned context."""
        prompt = """You are a downhole tool engineering visual comparison assistant.

You are given two images:
1. FIRST IMAGE: Original engineering drawing from a catalog
2. SECOND IMAGE: A 3D model attempt of the same tool

Compare them and return a JSON object with:
{
  "match_score": <0-100, how well the 3D matches the original>,
  "suggestions": [
    {
      "category": "<GEOMETRY|MATERIAL|PROPORTION|COMPONENT|VIEW>",
      "issue": "<what's wrong>",
      "fix": "<specific fix with values>",
      "confidence": <0.0-1.0>
    }
  ]
}

Focus on:
- Overall proportions (height vs diameter ratio)
- Color accuracy (the original tool color scheme)
- Component shapes and relative sizes
- Whether the body is solid or incorrectly transparent
- Whether slips, elements, seals are correctly positioned and sized

Return ONLY valid JSON, no other text."""

        # Add context from past corrections
        if self.history:
            prompt += "\n\nPast corrections that were accepted by the user:\n"
            for h in self.history[-5:]:
                prompt += f"- {h.get('user_feedback_raw', '')}\n"

        return prompt

    def _parse_vlm_response(self, text):
        """Parse VLM response into structured corrections."""
        # Try to extract JSON from response
        try:
            # Handle markdown code blocks
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text.strip())
        except json.JSONDecodeError:
            # Fallback: treat as free-text suggestions
            return {
                "match_score": 50,
                "suggestions": [{"category": "UNKNOWN", "issue": text, "fix": "", "confidence": 0.5}],
                "mode": "parsed_freetext",
            }

    def _img_to_base64(self, path):
        """Convert image file to base64 string."""
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    def load_history(self, training_index_path):
        """Load past training records as context for comparison."""
        if Path(training_index_path).exists():
            with open(training_index_path) as f:
                self.history = json.load(f)
            print(f"  Loaded {len(self.history)} past records as context")


# ----- CLI for quick testing -----

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python compare.py <original.png> <model.png> [mode]")
        print("Modes: rules, local, claude")
        sys.exit(1)

    original = sys.argv[1]
    model = sys.argv[2]
    mode = Mode(sys.argv[3]) if len(sys.argv) > 3 else Mode.RULES

    comparer = VisualCompare(mode=mode)

    # Load past training data if available
    training_path = Path(__file__).parent.parent / "training_data" / "perma_lach_pls" / "training_index.json"
    comparer.load_history(str(training_path))

    result = comparer.compare(original, model)
    print(json.dumps(result, indent=2))
