## Summary

What does this PR do? One paragraph max.

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (adapter interface or run root contract modified)
- [ ] Documentation
- [ ] Refactor / internal improvement

## Related issues

Closes #

## Changes

-
-
-

## Breaking changes

If this is a breaking change, describe what callers need to update.

## Testing

How did you verify this works?

- [ ] Demo runs end-to-end (`npx tsx demo/run.ts`)
- [ ] Unit tests pass (`npm test`)
- [ ] Tested against a real product integration
- [ ] Added/updated tests for new behavior

## Adapter contract changes

If you modified any adapter interface, confirm:

- [ ] `docs/adapter-contract.md` updated
- [ ] `CHANGELOG.md` updated with breaking change note
- [ ] Version bump in `package.json` (major for breaking, minor for additive)

## Checklist

- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] No new `any` types without justification
- [ ] No hardcoded product-specific logic in the framework
- [ ] New exports added to `src/index.ts`
