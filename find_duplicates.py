#!/usr/bin/env python3
"""
Scan a folder for duplicate photos (by content hash).
Keeps the first occurrence in place, moves duplicates to the output folder.
"""

import hashlib
import os
import shutil
import sys
from pathlib import Path

# --- Configuration ---
SCAN_FOLDERS = [
    Path.home() / "Desktop",
    Path.home() / "Downloads",
]
OUTPUT_FOLDER = Path("/Users/neerajsethi/duplicate")

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".heic", ".heif", ".tiff", ".tif",
    ".bmp", ".gif", ".webp", ".raw", ".cr2", ".nef", ".arw",
    ".dng", ".orf", ".rw2", ".sr2", ".mov", ".mp4", ".m4v",
}


def file_hash(path, chunk_size=65536):
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".tox",
             "GitHub", ".svelte-kit", "build"}


def find_images(folder):
    """Yield all image/video file paths under folder."""
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if Path(name).suffix.lower() in IMAGE_EXTENSIONS:
                yield Path(root) / name


def main():
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        print("=== DRY RUN — no files will be moved ===\n")

    seen = {}  # hash -> first file path
    duplicates = []

    for folder in SCAN_FOLDERS:
        print(f"Scanning: {folder}")
    print(f"Destination: {OUTPUT_FOLDER}\n")

    file_count = 0
    for folder in SCAN_FOLDERS:
        for path in find_images(folder):
            file_count += 1
            if file_count % 500 == 0:
                print(f"  scanned {file_count} files...")

            try:
                h = file_hash(path)
            except (PermissionError, OSError) as e:
                print(f"  SKIP (error): {path} — {e}")
                continue

            if h in seen:
                duplicates.append((path, seen[h]))
            else:
                seen[h] = path

    print(f"\nTotal image/video files scanned: {file_count}")
    print(f"Unique files: {len(seen)}")
    print(f"Duplicates found: {len(duplicates)}\n")

    if not duplicates:
        print("No duplicates found.")
        return

    moved = 0
    for dup_path, original_path in duplicates:
        dest = OUTPUT_FOLDER / dup_path.name

        # Avoid overwriting — append a number if name already exists
        if dest.exists():
            stem = dest.stem
            suffix = dest.suffix
            counter = 1
            while dest.exists():
                dest = OUTPUT_FOLDER / f"{stem}_{counter}{suffix}"
                counter += 1

        print(f"  DUPLICATE: {dup_path}")
        print(f"    original: {original_path}")
        print(f"    move to:  {dest}")

        if not dry_run:
            try:
                shutil.move(str(dup_path), str(dest))
                moved += 1
            except (PermissionError, OSError) as e:
                print(f"    FAILED: {e}")

    if dry_run:
        print(f"\n{len(duplicates)} duplicates would be moved. Run without --dry-run to move them.")
    else:
        print(f"\nMoved {moved} duplicate files to {OUTPUT_FOLDER}")


if __name__ == "__main__":
    main()
