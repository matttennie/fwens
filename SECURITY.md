# Security

## Threat model

fwens is a **local-only** coordination server. It does not open network ports, make outbound connections, or store credentials.

- **Transport**: stdio only. Each agent spawns its own server process. No TCP/HTTP listeners.
- **Storage**: SQLite database on the local filesystem. No remote storage.
- **Credentials**: fwens never reads, stores, or transmits API keys or tokens.

## Hardening

- **Path traversal**: All file path arguments are validated and confined to the project directory.
- **SQL injection**: All database queries use parameterized statements.

## Reporting vulnerabilities

If you find a security issue, please report it via GitHub Issues (private vulnerability reporting) or contact the maintainer directly. Do not open a public issue for security-sensitive bugs.
