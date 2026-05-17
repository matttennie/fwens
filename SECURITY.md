# Security

## Threat model

fwens is a **local-only** coordination server. It does not open network ports, make outbound connections, or store credentials.

- **Transport**: stdio only. Each agent spawns its own server process. No TCP/HTTP listeners.
- **Storage**: SQLite database on the local filesystem. No remote storage.
- **Credentials**: fwens never reads, stores, or transmits API keys or tokens.

## Hardening

- **Path traversal**: All file path arguments are validated and confined to the project directory.
- **SQL injection**: All database queries use parameterized statements.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2.0 | No        |

## Reporting a Vulnerability

Report security issues privately via [GitHub Security Advisories](https://github.com/matttennie/fwens/security/advisories/new). Do not open a public issue for security-sensitive bugs.

We aim to acknowledge all reports within 48 hours and provide regular status updates until the issue is resolved.
