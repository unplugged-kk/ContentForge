#!/usr/bin/env bash
# Read-only project context for agents.
# Usage: script/agent-context.sh status|sync|handover
# Does not edit files, commit, push, or contact the network.
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-status}"

print_git() {
  echo "repo: ContentForge"
  echo "branch: $(git rev-parse --abbrev-ref HEAD)"
  echo "commit: $(git rev-parse HEAD)"
  echo "subject: $(git log -1 --format=%s)"
  echo "committed: $(git log -1 --format=%ci)"
  if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    echo "upstream: $(git rev-parse --abbrev-ref '@{upstream}')"
    counts="$(git rev-list --left-right --count HEAD...'@{upstream}')"
    echo "ahead of upstream: $(echo "$counts" | awk '{print $1}')"
    echo "behind upstream: $(echo "$counts" | awk '{print $2}')"
  else
    echo "upstream: none"
  fi
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    echo "origin/main: $(git rev-parse --short origin/main) $(git log -1 --format=%s origin/main)"
  fi
  echo "dirty entries: $(git status --porcelain | wc -l | tr -d ' ')"
}

print_register() {
  echo
  echo "Active work:"
  if [[ ! -f docs/ACTIVE_WORK.md ]]; then
    echo "docs/ACTIVE_WORK.md is missing."
    return
  fi
  awk '
    BEGIN { show = 0 }
    /^\| Workstream / { show = 1 }
    show { print }
    show && NF == 0 { exit }
  ' docs/ACTIVE_WORK.md
}

case "$cmd" in
  status)
    print_git
    print_register
    ;;
  sync)
    print_git
    print_register
    echo
    echo "Read before new work, in this order:"
    echo "  docs/PROJECT.md"
    echo "  docs/STATUS.md"
    echo "  docs/ACTIVE_WORK.md"
    echo "  AGENTS.md"
    echo "  docs/MENTAL-MODEL.md"
    echo "  CURRENT_ARCHITECTURE.md"
    echo "  docs/product-discovery/EXECUTION_ROADMAP.md"
    echo
    echo "If the task continues an existing row, also read docs/HANDOVER.md and docs/CONSTRAINTS.md."
    echo "The map of every other document is docs/README.md."
    sha="$(git rev-parse --short HEAD)"
    product_changes=""
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      product_changes="$(git diff --name-only origin/main...HEAD | grep -v -E '^(docs/|AGENTS\.md|CLAUDE\.md|Makefile|script/agent-context\.sh|CURRENT_ARCHITECTURE\.md|HANDOVER\.md)$' || true)"
    fi
    if [[ -n "$product_changes" ]] && ! grep -q "$sha" docs/STATUS.md 2>/dev/null; then
      echo
      echo "WARNING: HEAD $sha changes product files and docs/STATUS.md does not mention it."
      echo "Reconcile docs/STATUS.md and docs/ACTIVE_WORK.md before more product edits."
      echo "$product_changes"
    fi
    ;;
  handover)
    print_git
    cat <<'EOF'

Write the narrative into docs/HANDOVER.md and update the matching row in docs/ACTIVE_WORK.md.
Keep older handovers. Move a stale one to docs/archive/ instead of deleting it.

Record:
- what changed
- branch and full commit
- commands you ran, with pass or fail counts you actually saw
- what you did not run
- blockers
- the single next action
EOF
    ;;
  *)
    echo "usage: script/agent-context.sh status|sync|handover" >&2
    exit 2
    ;;
esac
