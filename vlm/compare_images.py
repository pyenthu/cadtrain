#!/usr/bin/env python3
"""
Compare two PNG images and output similarity scores as JSON.

Usage:
    python compare_images.py <original.png> <rendered.png>

Outputs to stdout:
{
  "ssim": 0.78,            # structural similarity (0-1)
  "pixel_diff_pct": 12.3,  # % of pixels that differ
  "edge_diff_pct": 8.7,    # % of edge pixels that differ
  "shape_match": 0.85      # contour Hu moments similarity (0-1)
}
"""

import sys
import json
import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim


def compare(orig_path: str, rend_path: str) -> dict:
    # Load and resize to common size
    orig = cv2.imread(orig_path)
    rend = cv2.imread(rend_path)

    if orig is None or rend is None:
        return {"error": f"Could not load images: {orig_path} or {rend_path}"}

    # Resize to common size (use rendered as the target)
    h, w = rend.shape[:2]
    orig_resized = cv2.resize(orig, (w, h))

    # Convert to grayscale for SSIM and edge comparison
    orig_gray = cv2.cvtColor(orig_resized, cv2.COLOR_BGR2GRAY)
    rend_gray = cv2.cvtColor(rend, cv2.COLOR_BGR2GRAY)

    # SSIM
    ssim_score = float(ssim(orig_gray, rend_gray, data_range=255))

    # Pixel diff
    diff = cv2.absdiff(orig_gray, rend_gray)
    threshold = 30  # pixel difference threshold
    diff_mask = diff > threshold
    pixel_diff_pct = float(np.sum(diff_mask) / diff_mask.size * 100)

    # Edge comparison (Canny edges)
    orig_edges = cv2.Canny(orig_gray, 50, 150)
    rend_edges = cv2.Canny(rend_gray, 50, 150)
    edge_diff = cv2.absdiff(orig_edges, rend_edges)
    edge_diff_pct = float(np.sum(edge_diff > 0) / edge_diff.size * 100)

    # Contour shape matching via Hu moments
    shape_match = 0.0
    try:
        # Threshold to binary for contour detection
        _, orig_bin = cv2.threshold(orig_gray, 240, 255, cv2.THRESH_BINARY_INV)
        _, rend_bin = cv2.threshold(rend_gray, 240, 255, cv2.THRESH_BINARY_INV)

        orig_contours, _ = cv2.findContours(orig_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        rend_contours, _ = cv2.findContours(rend_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if orig_contours and rend_contours:
            # Use the largest contour from each
            orig_main = max(orig_contours, key=cv2.contourArea)
            rend_main = max(rend_contours, key=cv2.contourArea)
            # cv2.matchShapes returns 0 = identical, larger = different
            match = cv2.matchShapes(orig_main, rend_main, cv2.CONTOURS_MATCH_I1, 0)
            # Convert to 0-1 similarity
            shape_match = float(max(0.0, 1.0 - min(match, 1.0)))
    except Exception:
        pass

    return {
        "ssim": round(ssim_score, 4),
        "pixel_diff_pct": round(pixel_diff_pct, 2),
        "edge_diff_pct": round(edge_diff_pct, 2),
        "shape_match": round(shape_match, 4),
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: compare_images.py <orig> <rend>"}))
        sys.exit(1)

    result = compare(sys.argv[1], sys.argv[2])
    print(json.dumps(result))
