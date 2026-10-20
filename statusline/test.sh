#!/usr/bin/env bash
# Smoke test for claudeck-statusline.sh: feeds it a sample payload in a throwaway HOME and checks the output.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/claudeck-statusline.sh"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" TMPDIR="$tmp/tmp"; mkdir -p "$HOME/.claude/state" "$TMPDIR" "$tmp/demo"
fails=0
plain() { sed -E 's/\x1b\[[0-9;]*m//g'; }
check() { # name haystack needle
  if grep -qF -- "$3" <<<"$2"; then echo "ok   $1"; else echo "FAIL $1: expected «$3»"; fails=$((fails + 1)); fi
}
absent() { # name haystack needle
  if grep -qF -- "$3" <<<"$2"; then echo "FAIL $1: unexpected «$3»"; fails=$((fails + 1)); else echo "ok   $1"; fi
}
future=$(( $(date +%s) + 7500 ))
payload=$(cat <<JSON
{"workspace":{"current_dir":"$tmp/demo"},"model":{"display_name":"Sonnet 5.5"},
 "context_window":{"used_percentage":42},"cost":{"total_cost_usd":1.5},
 "rate_limits":{"five_hour":{"used_percentage":23,"resets_at":$future},"seven_day":{"used_percentage":82.6,"resets_at":$future}},
 "effort":{"level":"medium"},"session_id":"test-session"}
JSON
)

out=$(plain < <("$script" <<<"$payload"))
check "shows the project folder" "$out" "demo"
check "shows the model" "$out" "Sonnet 5.5"
check "translates the effort" "$out" "medio"
check "shows the context percent" "$out" "42%"
check "rounds the weekly limit half up" "$out" "83%"
check "shows the cost" "$out" '$1.50'
check "shows the reset countdown" "$out" "2h"
check "reports no agents" "$out" "agentes 0"

# A first run, with no cache files yet, must not write anything to stderr.
fresh=$(mktemp -d "$tmp/fresh.XXXX")
err=$(TMPDIR="$fresh" "$script" <<<"$payload" 2>&1 >/dev/null)
if [ -z "$err" ]; then echo "ok   first run is silent on stderr"; else echo "FAIL first run wrote to stderr: $err"; fails=$((fails + 1)); fi

# A fresh agents file lists the running subagent; a stale one counts as no agents.
printf 'general-purpose\tContar hasta 40\tBash for i\t%s\n' "$(( $(date +%s) - 5 ))" >"$HOME/.claude/state/agents-test-session.tsv"
out=$(plain < <("$script" <<<"$payload"))
check "lists a running agent" "$out" "Contar hasta 40"
check "counts the agent" "$out" "agentes 1"
touch -d '2 minutes ago' "$HOME/.claude/state/agents-test-session.tsv"
out=$(plain < <("$script" <<<"$payload"))
absent "ignores a stale agents file" "$out" "Contar hasta 40"

# Missing data must not break it: no cost, no limits, no session.
out=$(plain < <("$script" <<<'{"model":{"display_name":"X"}}'))
check "survives an almost empty payload" "$out" "agentes 0"
out=$(plain < <("$script" <<<''))
check "survives an empty input" "$out" "agentes 0"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
