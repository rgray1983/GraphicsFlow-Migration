# GraphicsFlow V3 Development Workflow

## Source of truth

- The latest `main` branch in GitHub is the source of truth.
- Before starting a feature, inspect both the latest V3 code and the relevant files in `PHP version/`.
- The PHP application is the behavioral reference for the V3 rebuild and should remain untouched unless explicitly requested.

## Pull request workflow

1. Start each testable feature from the latest `main` branch.
2. Use one dedicated `agent/` branch per feature.
3. Keep each PR focused on one coherent, testable outcome.
4. Make all required frontend, API, shared-type, configuration, and documentation changes together.
5. Avoid unrelated visual or architectural changes.
6. Remove duplicate, obsolete, or conflicting code introduced by the feature when doing so does not break existing functionality.
7. Open the PR as a draft with testing instructions and known limitations.
8. Richie tests the PR branch locally.
9. Richie merges the PR after approval.
10. Begin the next feature from the newly updated `main` branch.

## Safeguards

- Never rely only on conversation memory when repository code can be inspected.
- Always re-read the latest `main` branch before modifying files.
- Do not overwrite user changes that may have been merged or committed since the previous task.
- Do not silently expand feature scope.
- Preserve existing behavior first; improve architecture within the agreed scope.
- Clearly distinguish completed code from plans or recommendations.

## PR documentation

Every feature PR receives a numbered Markdown file in `docs/PRs/` using this format:

```text
001-feature-name.md
002-next-feature.md
```

The document should include scope, reference behavior, implementation plan, acceptance criteria, testing steps, and deferred work.
