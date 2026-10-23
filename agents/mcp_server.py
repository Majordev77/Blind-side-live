"""MCP server: the match tools, for any MCP client.

The same read-only tools the agents use in the workflow (agents/match_tools.py),
served over MCP so other agents, Copilot or a broadcaster's tools can ask
the match the same questions. Pass the play time with `at_t` so answers
never include the future.

Run: python -m agents.mcp_server --match demo_1              (stdio)
     python -m agents.mcp_server --match demo_1 --http       (streamable HTTP)
"""

from __future__ import annotations

import argparse

from mcp.server.mcpserver import MCPServer

from agents.match_tools import MatchTools


def build_server(match_id: str) -> MCPServer:
    """An MCP server over one match."""
    tools = MatchTools(match_id)
    server = MCPServer("blindside-match", instructions=(
        "Read-only tools over one synthetic football match. Every tool takes at_t, the play time in seconds; "
        "answers only use events up to that time. Facts come from the state engine, never from a model."))

    def at(t: float | None) -> MatchTools:
        if t is not None:
            tools.advance_to(t)
        return tools

    @server.tool()
    def get_score(at_t: float | None = None) -> dict:
        """Current score, clock, period and team in possession."""
        return at(at_t).get_score()

    @server.tool()
    def get_recent_events(seconds: int = 60, types: list[str] | None = None, at_t: float | None = None) -> list[dict]:
        """Events from the last N seconds of play, optionally filtered by type."""
        return at(at_t).get_recent_events(seconds, types)

    @server.tool()
    def get_moment(moment_id: str, at_t: float | None = None) -> dict | None:
        """One moment with its facts and the IDs of the events that prove it."""
        return at(at_t).get_moment(moment_id)

    @server.tool()
    def get_player_stats(player: str, at_t: float | None = None) -> dict | None:
        """A player's running totals, by ID (p_123) or name."""
        return at(at_t).get_player_stats(player)

    @server.tool()
    def get_team_stats(team: str, minutes: int = 5, at_t: float | None = None) -> dict:
        """A team's numbers over the last N minutes."""
        return at(at_t).get_team_stats(team, minutes)

    @server.tool()
    def get_signals(at_t: float | None = None) -> dict:
        """Momentum, control versus chaos, pressing level and tempo."""
        return at(at_t).get_signals()

    @server.tool()
    def get_said_log(variant: str, last: int = 5) -> list[dict]:
        """The last lines aired to one listener variant."""
        return tools.get_said_log(variant, last)

    return server


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--match", default="demo_1")
    ap.add_argument("--http", action="store_true")
    args = ap.parse_args()
    build_server(args.match).run("streamable-http" if args.http else "stdio")


if __name__ == "__main__":
    main()
