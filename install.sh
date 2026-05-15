#!/usr/bin/env bash
# LORE Install Script
# Distro-independent installer for Linux, macOS, and Windows (Git Bash/WSL)
#
# Usage: ./install.sh [--dev] [--uninstall] [--update]
#
# --dev:       Editable install (changes to source are live immediately)
# --uninstall: Remove LORE installation
# --update:    Pull latest from git and reinstall
#
# Creates a virtual environment at ~/.local/share/lore/venv
# Installs a 'lore' wrapper script at ~/.local/bin/lore

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect OS
case "$(uname -s)" in
    Linux*)   PLATFORM="linux";;
    Darwin*)  PLATFORM="macos";;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows";;
    *)        PLATFORM="unknown";;
esac

# Paths differ per platform
if [[ "$PLATFORM" == "windows" ]]; then
    INSTALL_DIR="$(cygpath -u "${APPDATA}")/lore"
    BIN_DIR="$(cygpath -u "${APPDATA}")/Python/Scripts"
else
    INSTALL_DIR="${HOME}/.local/share/lore"
    BIN_DIR="${HOME}/.local/bin"
fi

VENV_DIR="${INSTALL_DIR}/venv"
DEV_MODE=false
UNINSTALL=false
UPDATE=false

for arg in "$@"; do
    case "$arg" in
        --dev)       DEV_MODE=true;;
        --uninstall) UNINSTALL=true;;
        --update)    UPDATE=true;;
    esac
done

# --- Uninstall ---
if $UNINSTALL; then
    echo "=== Uninstalling LORE ==="
    rm -rf "${INSTALL_DIR}"
    rm -f "${BIN_DIR}/lore"
    echo "✅ LORE uninstalled."
    echo "   Removed: ${INSTALL_DIR}"
    echo "   Removed: ${BIN_DIR}/lore"
    exit 0
fi

# --- Update ---
if $UPDATE; then
    echo "=== Updating LORE ==="
    if [[ ! -d "${SCRIPT_DIR}/.git" ]]; then
        echo "Error: --update requires a git repository."
        echo "Clone first: git clone git@github.com:tbox99/lore.git"
        exit 1
    fi
    echo "Pulling latest changes..."
    git -C "${SCRIPT_DIR}" pull
    echo ""
    # Fall through to reinstall
fi

echo "=== LORE Install Script ==="
echo "Platform: ${PLATFORM}"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "Error: python3 not found. Install Python 3.10+ first."
    exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
PYTHON_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")
echo "Python: ${PYTHON_VERSION}"

# Check Python version
if [[ "$PYTHON_MAJOR" -lt 3 ]] || [[ "$PYTHON_MAJOR" -eq 3 && "$PYTHON_MINOR" -lt 10 ]]; then
    echo "Error: Python 3.10+ required, found ${PYTHON_VERSION}"
    exit 1
fi

# Check venv availability
VENV_AVAILABLE=true
python3 -c "import venv" 2>/dev/null || VENV_AVAILABLE=false

if $VENV_AVAILABLE; then
    TEST_VENV=$(mktemp -d)
    if ! python3 -m venv "$TEST_VENV/test_venv" &>/dev/null; then
        VENV_AVAILABLE=false
    fi
    rm -rf "$TEST_VENV/test_venv" "$TEST_VENV"
fi

if ! $VENV_AVAILABLE; then
    echo ""
    echo "Error: Python venv module is not available."
    echo ""
    echo "Install it first:"
    echo ""
    if [[ "$PLATFORM" == "linux" ]]; then
        echo "  Debian/Ubuntu:  sudo apt install python3-venv"
        echo "  Arch:           sudo pacman -S python-virtualenv"
        echo "  Fedora:         sudo dnf install python3-virtualenv"
    elif [[ "$PLATFORM" == "macos" ]]; then
        echo "  macOS:  python3 -m pip install virtualenv"
    else
        echo "  Windows:  Reinstall Python with 'py -m pip' option enabled"
    fi
    exit 1
fi

# Create venv
if [[ ! -d "${VENV_DIR}" ]]; then
    echo "Creating virtual environment..."
    python3 -m venv "${VENV_DIR}"
else
    echo "Using existing virtual environment"
fi

# Activate
source "${VENV_DIR}/bin/activate"

# Install
if $DEV_MODE; then
    echo "Installing LORE (editable/development mode)..."
    pip install --upgrade pip
    pip install -e "${SCRIPT_DIR}[dev]"
else
    echo "Installing LORE..."
    pip install --upgrade pip
    pip install -e "${SCRIPT_DIR}"
fi

# Verify pip install succeeded
if ! command -v lore &>/dev/null; then
    echo ""
    echo "Error: 'lore' command not found after installation."
    exit 1
fi

# Create wrapper script (Unix)
mkdir -p "${BIN_DIR}"

if [[ "$PLATFORM" == "windows" ]]; then
    echo "Windows detected: lore command available via Python Scripts"
else
    cat > "${BIN_DIR}/lore" << 'WRAPPER'
#!/usr/bin/env bash
# LORE wrapper - activates venv and runs lore
source "${HOME}/.local/share/lore/venv/bin/activate" 2>/dev/null
exec lore "$@"
WRAPPER
    chmod +x "${BIN_DIR}/lore"
fi

# PATH check (Unix only)
if [[ "$PLATFORM" != "windows" ]]; then
    if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
        echo ""
        echo "⚠️  ${BIN_DIR} is not in your PATH."
        echo "   Add this to your shell config (~/.bashrc or ~/.zshrc):"
        echo ""
        echo '   export PATH="${HOME}/.local/bin:${PATH}"'
    fi
fi

# Verify
echo ""
echo "Verifying..."
VERSION=$(lore --version 2>/dev/null | head -1 || echo "unknown")
echo "✅ LORE ${VERSION} installed"
echo "   Command:  lore"
echo "   Venv:     ${VENV_DIR}"
if $DEV_MODE; then
    echo "   Mode:     development (editable)"
    echo "   Source:   ${SCRIPT_DIR}"
else
    echo "   Mode:     production"
fi
echo ""
echo "Update:  ./install.sh --update"
echo "   or:   git pull && ./install.sh"