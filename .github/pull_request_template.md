<!-- What does this change, and why? -->

## Checklist

- [ ] `pnpm verify` passes locally (it needs no secrets — same loop as CI)
- [ ] Every env var an app reads is listed in that app's `.env.example`
- [ ] Generator templates (`turbo/generators/templates/`) updated if the app scaffold shape changed
- [ ] Docs updated if conventions or playbooks changed (`docs/`, `AGENTS.md`)
