# Contributing

## Setup

Requires Node.js 22.14 or later (`.nvmrc` pins the major version).

```bash
git clone https://github.com/matttennie/fwens.git
cd fwens
npm install
npm run build
```

## Testing

```bash
npm test
npm run format:check
```

CI runs both on Node 22, 24, and 26, plus `npm audit --audit-level=high`. For an end-to-end check with real clients, see [Live test](README.md#live-test).

## Submitting changes

1. Create a branch from `main`.
2. Make your changes and add tests where applicable.
3. Run `npm test` and `npm run format:check` and confirm everything passes.
4. Open a pull request against `main` with a clear description of what changed and why.

## Code style

- TypeScript throughout.
- 2-space indentation, LF line endings.
- Run `npm run format` before committing to ensure consistent style.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
