# Security

## Threat model

fwens is a **local-only** coordination server. It does not make outbound connections or store credentials.

- **MCP transport**: stdio only. Each agent spawns its own MCP server process. The MCP server has no TCP/HTTP listeners.
- **`fwens watch` dashboard**: optional CLI command that starts an HTTP server bound to `127.0.0.1` for the live dashboard. Localhost-only; not reachable from other hosts. Stopped on Ctrl-C.
- **Storage**: SQLite database on the local filesystem. No remote storage.
- **Credentials**: fwens never reads, stores, or transmits API keys or tokens.

## Hardening

- **Path traversal**: All file path arguments are validated and confined to the project directory.
- **SQL injection**: All database queries use parameterized statements.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

If you find a security issue, please report it via GitHub Issues (private vulnerability reporting) or contact the maintainer directly. Do not open a public issue for security-sensitive bugs.

We aim to acknowledge all reports within 48 hours and provide regular status updates until the issue is resolved.
