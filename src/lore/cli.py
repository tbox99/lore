"""LORE CLI — Lenovo Online Research & Equipment."""

from __future__ import annotations

import click

from . import __version__
from .output import FormatMode
from .support_client import SupportClient


def _make_client(no_cache: bool = False, refresh: bool = False) -> SupportClient:
    if refresh:
        no_cache = True
    return SupportClient(no_cache=no_cache)


def _resolve_format(json_output: bool, plain: bool) -> str:
    if json_output:
        return FormatMode.JSON
    if plain:
        return FormatMode.PLAIN
    return FormatMode.RICH


@click.group()
@click.version_option(version=__version__, prog_name="lore")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.option("--plain", is_flag=True, help="Plain text output (no color, no emoji)")
@click.option("--no-color", is_flag=True, help="Disable colors")
@click.option("--no-emoji", is_flag=True, help="Disable emoji")
@click.option("--no-cache", is_flag=True, help="Bypass cache")
@click.option("--refresh", is_flag=True, help="Force fresh API calls (implies --no-cache)")
@click.pass_context
def main(
    ctx: click.Context,
    json_output: bool,
    plain: bool,
    no_color: bool,
    no_emoji: bool,
    no_cache: bool,
    refresh: bool,
) -> None:
    """LORE — Lenovo Online Research & Equipment.

    Query Lenovo Support APIs for device info, drivers, and warranty status.
    """
    ctx.ensure_object(dict)
    ctx.obj["json_output"] = json_output
    ctx.obj["plain"] = plain
    ctx.obj["no_color"] = no_color
    ctx.obj["no_emoji"] = no_emoji or plain
    ctx.obj["no_cache"] = no_cache
    ctx.obj["refresh"] = refresh
    ctx.obj["fmt"] = _resolve_format(json_output, plain)


@main.command()
@click.argument("serial")
@click.pass_context
def lookup(ctx: click.Context, serial: str) -> None:
    """Look up a device by serial number or MTM prefix."""
    client = _make_client(no_cache=ctx.obj["no_cache"], refresh=ctx.obj["refresh"])
    with client:
        products = client.lookup_product(serial)
        from .output import format_product
        output = format_product(products, fmt=ctx.obj["fmt"], no_emoji=ctx.obj["no_emoji"])
        click.echo(output)


@main.command()
@click.argument("serial")
@click.option("--os", "os_filter", default=None, help="Filter by operating system")
@click.option("--category", "category_filter", default=None, help="Filter by category")
@click.option("--priority", "priority_filter", default=None, help="Filter by priority (Critical/Recommended)")
@click.option("--active-only", is_flag=True, help="Exclude login-required items")
@click.option("--full-urls", is_flag=True, help="Show full URLs and titles (no truncation)")
@click.pass_context
def drivers(
    ctx: click.Context,
    serial: str,
    os_filter: str | None,
    category_filter: str | None,
    priority_filter: str | None,
    active_only: bool,
    full_urls: bool,
) -> None:
    """List available drivers for a device."""
    client = _make_client(no_cache=ctx.obj["no_cache"], refresh=ctx.obj["refresh"])
    with client:
        products = client.lookup_product(serial)
        if not products:
            click.echo("No products found for serial.", err=True)
            raise SystemExit(1)

        product_path = products[0].get("Id", "")
        if not product_path:
            click.echo("Product has no ID path.", err=True)
            raise SystemExit(1)

        driver_data = client.get_drivers(product_path)
        from .output import format_drivers
        output = format_drivers(
            driver_data,
            fmt=ctx.obj["fmt"],
            os_filter=os_filter,
            category_filter=category_filter,
            priority_filter=priority_filter,
            active_only=active_only,
            full_urls=full_urls,
            no_emoji=ctx.obj["no_emoji"],
        )
        click.echo(output)


@main.command()
@click.argument("serial")
@click.option("--country", default="us", help="Country code (default: us)")
@click.option("--language", default="en", help="Language code (default: en)")
@click.pass_context
def warranty(ctx: click.Context, serial: str, country: str, language: str) -> None:
    """Show warranty status for a device."""
    client = _make_client(no_cache=ctx.obj["no_cache"], refresh=ctx.obj["refresh"])
    with client:
        products = client.lookup_product(serial)
        if not products:
            click.echo("No products found for serial.", err=True)
            raise SystemExit(1)

        machine_type = SupportClient.extract_machine_type(products[0])
        if not machine_type:
            click.echo("Could not determine machine type from product.", err=True)
            raise SystemExit(1)

        warranty_data = client.get_warranty(serial, machine_type, country=country, language=language)
        from .output import format_warranty
        output = format_warranty(warranty_data, fmt=ctx.obj["fmt"], no_emoji=ctx.obj["no_emoji"])
        click.echo(output)


@main.command()
@click.argument("serial")
@click.option("--os", "os_filter", default=None, help="Filter drivers by operating system")
@click.option("--category", "category_filter", default=None, help="Filter drivers by category")
@click.option("--full-urls", is_flag=True, help="Show full URLs and titles (no truncation)")
@click.option("--country", default="us", help="Country code for warranty lookup")
@click.option("--language", default="en", help="Language code for warranty lookup")
@click.pass_context
def report(
    ctx: click.Context,
    serial: str,
    os_filter: str | None,
    category_filter: str | None,
    full_urls: bool,
    country: str,
    language: str,
) -> None:
    """Full device report: product info, drivers, and warranty."""
    client = _make_client(no_cache=ctx.obj["no_cache"], refresh=ctx.obj["refresh"])
    with client:
        products = client.lookup_product(serial)
        if not products:
            click.echo("No products found for serial.", err=True)
            raise SystemExit(1)

        product_path = products[0].get("Id", "")
        machine_type = SupportClient.extract_machine_type(products[0])

        driver_data = {}
        warranty_data = {}

        if product_path:
            driver_data = client.get_drivers(product_path)

        if machine_type:
            try:
                warranty_data = client.get_warranty(serial, machine_type, country=country, language=language)
            except RuntimeError as e:
                click.echo(f"Warranty lookup failed: {e}", err=True)

        from .output import format_report
        output = format_report(
            products,
            driver_data,
            warranty_data,
            fmt=ctx.obj["fmt"],
            no_emoji=ctx.obj["no_emoji"],
            full_urls=full_urls,
            os_filter=os_filter,
            category_filter=category_filter,
        )
        click.echo(output)
