# Realm Contribution Guidelines

## Development Setup

```bash
git clone <repo>
cd theaiincrealm
pnpm install
pnpm build
```

## Code Conventions

- **Language:** TypeScript with strict mode
- **Module system:** ESM (`.js` extensions in imports)
- **Style:** No `any` types, interface-first design
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types/classes/enums
- **Testing:** vitest with `describe`/`it`/`expect` pattern
- **Documentation:** JSDoc for all public API members

## Project Structure

```
packages/
  realm-core/     # Core framework (no runtime deps)
  realm-container/# Docker engine
  realm-browser/  # Playwright engine
  realm-api/      # HTTP API server
  realm-cli/      # CLI tool
  realm-veil/     # PII redaction bridge
```

## Adding a New Engine

1. Implement the `RealmEngine` interface from `@theaiinc/realm-core`
2. Register it with `RealmAPI.registerEngine()`
3. Add engine type to `EngineType` enum
4. Write tests in `src/*.spec.ts` (vitest)
5. Export from the package's `index.ts`

## Testing

```bash
# All packages
pnpm test

# Single package
cd packages/realm-core && pnpm test
```

## Commit Style

```
type(scope): description

feat(container): add terminal streaming
fix(api): handle container exec errors
docs(readme): add quickstart guide
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

## PR Checklist

- [ ] Build passes (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] No lint errors
- [ ] JSDoc added for new public APIs
- [ ] Tests added for new functionality
