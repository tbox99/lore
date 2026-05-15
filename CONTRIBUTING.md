# Contributing to LORE

Thanks for your interest! Here's how to get started.

## Development Setup

1. **Clone and install**

   ```bash
   git clone https://github.com/user/lore.git
   cd lore
   python -m venv .venv
   source .venv/bin/activate  # or .venv\Scripts\activate on Windows
   pip install -e ".[dev]"
   ```

2. **Run tests**

   ```bash
   pytest tests/ -v
   ```

3. **Try it out**

   ```bash
   lore lookup PF4SQLH9
   lore drivers PF4SQLH9 --category "BIOS/UEFI"
   ```

## Making Changes

- Keep changes small and focused.
- Add or update tests for any new behavior.
- Run the full test suite before submitting — all tests must pass.
- Follow the existing code style (Black formatting, type hints).

## Submitting PRs

1. Fork the repository.
2. Create a feature branch: `git checkout -b my-feature`.
3. Commit your changes with clear messages.
4. Push and open a pull request against `main`.
5. Describe what changed and why.

## Reporting Issues

Open an issue with:
- What you expected
- What actually happened
- Steps to reproduce (including serial/MTM if relevant)
- LORE version (`lore --version`)