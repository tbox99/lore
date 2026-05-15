#!/usr/bin/env bash
# LORE Remote Sync
# Syncs LORE source to a remote server and reinstalls.
#
# Usage: ./sync-remote.sh <user@host> [remote_path]
#
# Prerequisites on remote:
#   - Python 3.10+
#   - LORE installed via install.sh
#
# For Debian/Ubuntu: apt install python3 python3-venv python3-pip
# For Arch: pacman -S python python-virtualenv python-pip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REMOTE="${1:?Usage: sync-remote.sh <user@host> [remote_path]}"
REMOTE_PATH="${2:-.local/share/lore/src}"

echo "=== LORE Remote Sync ==="
echo "Target: ${REMOTE}:${REMOTE_PATH}"
echo ""

# Sync source code (exclude dev/test/local artifacts)
echo "Syncing source files..."
rsync -avz --delete \
    --exclude='.venv/' \
    --exclude='__pycache__/' \
    --exclude='.pytest_cache/' \
    --exclude='.git/' \
    --exclude='*.egg-info/' \
    --exclude='dist/' \
    --exclude='build/' \
    --exclude='deploy_key' \
    --exclude='deploy_key.pub' \
    "${SCRIPT_DIR}/" \
    "${REMOTE}:${REMOTE_PATH}/"

echo ""
echo "Reinstalling on remote..."
ssh "${REMOTE}" "cd ${REMOTE_PATH} && bash install.sh --dev"

echo ""
echo "✅ LORE updated on ${REMOTE}."