#!/usr/bin/env bash
# Claudeck status line: dir, branch, model, effort, context, 5h/weekly limits, cost, cpu/ram and subagents.
# Needs bash 4.2+, jq, git, GNU coreutils and /proc (Linux); icons need a Nerd Font.
(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 2) )) || { echo "claudeck status line: bash 4.2+ is required"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "claudeck status line: jq is required"; exit 0; }
input=$(cat)
export LC_CTYPE=C.UTF-8
printf '%s' "$input" > "${TMPDIR:-/tmp}/claude-statusline-last.json" 2>/dev/null

shopt -s extglob
# One jq run for every field (unit-separator delimited so empty fields survive `read`).
IFS=$'\x1f' read -r f_dir f_cwd f_model f_ctx f_cost f_h5 f_h5r f_d7 f_d7r f_agents f_effort f_sid < <(
  jq -r '[(.workspace.current_dir // ""), (.cwd // ""), (.model.display_name // ""),
    (.context_window.used_percentage // ""), (.cost.total_cost_usd // ""),
    (.rate_limits.five_hour.used_percentage // ""), (.rate_limits.five_hour.resets_at // ""),
    (.rate_limits.seven_day.used_percentage // ""), (.rate_limits.seven_day.resets_at // ""),
    ((.agents // .subagents // []) | if type=="array" then length else . end),
    (.effort.level // ""), (.session_id // "")] | map(tostring) | join("\u001f")' <<<"$input" 2>/dev/null)

R=$'\033[0m'; D=$'\033[2m'; B=$'\033[1m'
G=$'\033[32m'; Y=$'\033[33m'; RD=$'\033[31m'; C=$'\033[36m'; M=$'\033[35m'

color() { # pct -> color by threshold
  local p=${1%.*}; p=${p:-0}
  if   [ "$p" -ge 85 ]; then printf '%s' "$RD"
  elif [ "$p" -ge 60 ]; then printf '%s' "$Y"
  else printf '%s' "$G"; fi
}
rnd() { # "8.6" -> 9, like the panel's Math.round (half up); integers pass through
  local v=${1:-0} i=${1%.*} fr; i=${i:-0}
  if [[ "$v" == *.* ]]; then fr=${v#*.}; [ "${fr:0:1}" -ge 5 ] && i=$((i + 1)); fi
  printf '%d' "$i"
}
bar() { # pct width -> ▰▰▰▱▱▱
  local p=${1%.*} w=${2:-8} f i out=""; p=${p:-0}
  f=$(( (p * w + 50) / 100 )); [ "$f" -gt "$w" ] && f=$w
  for ((i=0;i<w;i++)); do [ "$i" -lt "$f" ] && out+="▰" || out+="▱"; done
  printf '%s' "$out"
}
until_reset() { # epoch|iso -> "2h10m" / "3d4h"
  local t=$1 now s d h m
  [ -z "$t" ] && return
  [[ "$t" =~ ^[0-9]+$ ]] || t=$(date -d "$t" +%s 2>/dev/null) || return
  [ "${#t}" -gt 11 ] && t=$((t/1000))
  now=$(date +%s); s=$((t-now)); [ "$s" -le 0 ] && { printf 'ya'; return; }
  d=$((s/86400)); h=$(((s%86400)/3600)); m=$(((s%3600)/60))
  if [ "$d" -gt 0 ]; then printf '%dd%dh' "$d" "$h"
  elif [ "$h" -gt 0 ]; then printf '%dh%02dm' "$h" "$m"
  else printf '%dm' "$m"; fi
}

icon() { # Nerd Font (Material Design) glyph per label
  case $1 in
    ctx) printf '\U000f035b' ;; 5h) printf '\U000f0150' ;; sem) printf '\U000f0a33' ;;
    cpu) printf '\U000f0ee0' ;; ram) printf '\U000f01bc' ;; dir) printf '\U000f024b' ;;
    branch) printf '\U000f062c' ;; model) printf '\U000f09d1' ;; cost) printf '\U000f012a' ;;
  esac
}

meter() { # label pct resets_at
  local p=$2; [ -z "$p" ] && { printf '%s%s %-3s %s%s%s --%s' "$D" "$(icon "$1")" "$1" "$(bar 0 8)" "$R" "$D" "$R"; return; }
  local c shown; c=$(color "$p"); shown=$(rnd "$p")  # colour from the raw value, number rounded: same as the panel
  printf '%s%s%s %s%-3s%s %s%s %3s%%%s' "$c" "$(icon "$1")" "$R" "$B" "$1" "$R" "$c" "$(bar "$shown" 8)" "$shown" "$R"
  local r; r=$(until_reset "$3"); [ -n "$r" ] && printf '%s ↻%s%s' "$D" "$r" "$R"
}

dir=$f_dir; [ -z "$dir" ] && dir=$f_cwd
proj=${dir##*/}
# Branch and dirty flag change slowly and cost two git processes: cache them for 10 s per directory.
git_state() { # dir -> "branch<US>dirty"
  local d=$1 cache="${TMPDIR:-/tmp}/claude-statusline-git" k t b dt now; now=$(printf '%(%s)T' -1)
  IFS=$'\x1f' read -r k t b dt 2>/dev/null <"$cache"
  if [ "$k" = "$d" ] && [ -n "$t" ] && [ $((now - t)) -lt 10 ]; then printf '%s\x1f%s' "$b" "$dt"; return; fi
  b=$(git -C "$d" symbolic-ref --short HEAD 2>/dev/null); dt=""
  [ -n "$b" ] && [ -n "$(git -C "$d" status --porcelain 2>/dev/null | head -1)" ] && dt="*"
  printf '%s\x1f%s\x1f%s\x1f%s\n' "$d" "$now" "$b" "$dt" >"$cache" 2>/dev/null
  printf '%s\x1f%s' "$b" "$dt"
}
IFS=$'\x1f' read -r branch dirty < <(git_state "$dir")
model=$f_model; ctx=$f_ctx; cost=$f_cost
h5=$f_h5; h5r=$f_h5r; d7=$f_d7; d7r=$f_d7r; agents=$f_agents

cpu_pct() { # CPU % since the last run; resamples 0.2s when the last sample is stale
  local cache="${TMPDIR:-/tmp}/claude-statusline-cpu" a1 a2 a3 a4 a5 a6 a7 a8 t i pt pi pe now
  now=$(date +%s)
  read -r pt pi pe 2>/dev/null <"$cache"
  if [ -z "$pt" ] || [ $((now - ${pe:-0})) -gt 20 ]; then
    read -r _ a1 a2 a3 a4 a5 a6 a7 a8 _ </proc/stat || return
    pt=$((a1+a2+a3+a4+a5+a6+a7+a8)); pi=$((a4+a5)); sleep 0.2
  fi
  read -r _ a1 a2 a3 a4 a5 a6 a7 a8 _ </proc/stat || return
  t=$((a1+a2+a3+a4+a5+a6+a7+a8)); i=$((a4+a5))
  printf '%s %s %s\n' "$t" "$i" "$now" >"$cache" 2>/dev/null
  [ "$t" -gt "$pt" ] && echo $(( 100 * ((t - pt) - (i - pi)) / (t - pt) ))
}
ram_pct() { awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END{if (t>0) printf "%d", 100*(t-a)/t}' /proc/meminfo 2>/dev/null; }
cpu=$(cpu_pct); ram=$(ram_pct)

cost_spark() { # session_id usd -> 7-day sparkline of daily cost; keeps its own history file
  local f="$HOME/.claude/state/statusline-cost.tsv" today now cutoff i days="" sid=$1 usd=$2
  printf -v now '%(%s)T' -1; printf -v today '%(%F)T' "$now"; printf -v cutoff '%(%F)T' $((now - 14*86400))
  mkdir -p "${f%/*}" 2>/dev/null; [ -e "$f" ] || : >"$f" 2>/dev/null
  if [ -n "$sid" ] && [ -n "$usd" ] && ! grep -qxF "$today"$'\t'"$sid"$'\t'"$usd" "$f" 2>/dev/null; then
    awk -F'\t' -v OFS='\t' -v d="$today" -v s="$sid" -v u="$usd" -v c="$cutoff" \
      '$1<c {next} $1==d && $2==s {next} {print} END{print d,s,u}' "$f" 2>/dev/null >"$f.tmp" && mv "$f.tmp" "$f"
  fi
  for i in 6 5 4 3 2 1 0; do printf -v d '%(%F)T' $((now - i*86400)); days+="$d "; done
  # Each row is a session's running total that day; a session spanning midnight only adds what it
  # spent beyond its total on earlier days.
  awk -F'\t' -v days="$days" '
    { nr++; rd[nr] = $1; rs[nr] = $2; ru[nr] = $3 + 0 }
    END {
      for (a = 1; a <= nr; a++) {
        prev = 0
        for (b = 1; b <= nr; b++) if (rs[b] == rs[a] && rd[b] < rd[a] && ru[b] > prev) prev = ru[b]
        if (ru[a] > prev) t[rd[a]] += ru[a] - prev
      }
      n = split(days, dd, " "); cols = 8
      for (i = 1; i <= n; i++) { v[i] = t[dd[i]] + 0; if (v[i] > m) m = v[i] }
      for (k = 0; k < cols; k++) {
        x = k * (n - 1) / (cols - 1); i0 = int(x); f = x - i0; i1 = (i0 < n - 1) ? i0 + 1 : i0
        y[k] = (m > 0) ? int((v[i0 + 1] * (1 - f) + v[i1 + 1] * f) / m * 3 + 0.5) : 0
      }
      split("64 4 2 1", L, " "); split("128 32 16 8", R, " ")
      for (c = 0; c < cols / 2; c++) {
        mask = 0
        for (q = 0; q < 2; q++) {
          k = c * 2 + q; lo = y[k]; hi = y[k]
          if (k > 0) { if (y[k - 1] < lo) lo = y[k - 1]; if (y[k - 1] > hi) hi = y[k - 1] }
          for (r = lo; r <= hi; r++) mask += (q == 0 ? L[r + 1] : R[r + 1])
        }
        printf "%c", 10240 + mask
      }
    }' "$f" 2>/dev/null
}
sc="${TMPDIR:-/tmp}/claude-statusline-spark"; skey="$(printf '%(%F)T' -1)|$f_sid|$cost"
IFS=$'\x1f' read -r ck spark 2>/dev/null <"$sc"
if [ "$ck" != "$skey" ] || [ -z "$spark" ]; then
  spark=$(cost_spark "$f_sid" "$cost"); printf '%s\x1f%s\n' "$skey" "$spark" >"$sc" 2>/dev/null
fi

vlen() { local s=${1//$'\033['+([0-9;])m/}; printf '%d' "${#s}"; }
pad() { local n; n=$(vlen "$1"); printf '%s%*s' "$1" $(( $2 > n ? $2 - n : 0 )) ''; }
wmax() { local a b; a=$(vlen "$1"); b=$(vlen "$2"); printf '%d' $(( a > b ? a : b )); }

# 4 columns x 2 rows, columns padded so the separators line up.
c11="${C}$(icon dir) ${B}${proj}${R}"; [ -n "$branch" ] && c11+=" ${M}$(icon branch) ${branch}${dirty}${R}"
effort=$f_effort
case "$effort" in
  low) etxt="bajo"; ecol="$D" ;;
  medium) etxt="medio"; ecol="$G" ;;
  high) etxt="alto"; ecol="$Y" ;;
  xhigh) etxt="muy alto"; ecol=$'\033[38;2;217;119;87m' ;;
  max) etxt="máximo"; ecol="$RD" ;;
  "") etxt="auto"; ecol="$D" ;;  # same word the panel uses when no effort is set
  *) etxt="$effort"; ecol="$D" ;;
esac
c12="${D}$(icon model)${R} ${model}"
[ -n "$etxt" ] && c12+="${D} · ${R}${ecol}${etxt}${R}"
c21=$(meter ctx "$ctx")
c22=""
[ -n "$cost" ] && c22="${D}$(icon cost) \$$(LC_ALL=C printf '%.2f' "$cost")${R}"
[ -n "$cost" ] && [ "${#spark}" -eq 4 ] && c22+=" ${D}${spark:0:3}${R}${C}${spark:3:1}${R}"
c31=$(meter 5h "$h5" "$h5r")
c32=$(meter sem "$d7" "$d7r")
c41=$(meter cpu "$cpu")
c42=$(meter ram "$ram")

sep="${D} │ ${R}"
w1=$(wmax "$c11" "$c12"); w2=$(wmax "$c21" "$c22"); w3=$(wmax "$c31" "$c32")
l1="$(pad "$c11" "$w1")${sep}$(pad "$c21" "$w2")${sep}$(pad "$c31" "$w3")${sep}${c41}"
l2="$(pad "$c12" "$w1")${sep}$(pad "$c22" "$w2")${sep}$(pad "$c32" "$w3")${sep}${c42}"

# Mini terminal: an 11x2-cell window (title bar with three dots + a prompt line), fixed width. MASCOT=0 hides it.
# Idle: dim dots and a blinking cursor. Working (a turn is running): the dots light up, a spinner turns in the
# title bar and a made-up command is typed on the prompt line, one after another.
# Working state comes from the file the claudeck mod writes ("start <epoch>" while a turn runs).
MASCOT=0
mark="$HOME/.claude/state/working-$f_sid"
state=idle
now=$(printf '%(%s)T' -1)
if [ -f "$mark" ]; then
  read -r kind _ <"$mark"
  age=$(( now - $(stat -c %Y "$mark" 2>/dev/null || echo 0) ))
  [ "$kind" = start ] && [ "$age" -lt 300 ] && state=work
fi
if [ "$MASCOT" -eq 1 ]; then
  E=$'\033'; X="${E}[0m"
  bar="${E}[48;2;49;50;68m"; body="${E}[48;2;24;24;37m"
  if [ "$state" = work ]; then
    cmds=("git add" "npm run" "ls -la" "tsc -b" "make" "grep -r" "pytest" "go test" "vitest" "sudo !!" "cat *" "git log" "vim" ":wq" "echo ok" "exit 0")
    cmd="${cmds[$(( now / 4 % ${#cmds[@]} ))]}"
    shown=$(( (${#cmd} * ($now % 4 + 1) + 3) / 4 ))
    typed="${cmd:0:shown}"
    spin="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"; sp="${spin:$(( now % 10 )):1}"
    d1="${E}[38;2;243;139;168m"; d2="${E}[38;2;249;226;175m"; d3="${E}[38;2;166;227;161m"
    spc="${E}[38;2;217;119;87m${sp}"
    txt="${E}[38;2;186;194;222m"; cur="█"
  else
    typed=""; d1="${E}[38;2;88;91;112m"; d2="$d1"; d3="$d1"; spc=" "
    txt="${E}[38;2;108;112;134m"
    if [ $(( now % 2 )) -eq 0 ]; then cur="█"; else cur=" "; fi
  fi
  field="${typed}${cur}"
  while [ "${#field}" -lt 8 ]; do field+=" "; done
  m1="${bar} ${d1}●${bar} ${d2}●${bar} ${d3}●${bar}   ${spc}${bar} ${X}"
  m2="${body} ${E}[38;2;217;119;87m❯${body} ${txt}${field}${X}"
  printf '%s  %s\n%s  %s\n' "$m1" "$l1" "$m2" "$l2"
else
  printf '%s\n%s\n' "$l1" "$l2"
fi

# Agents row, always shown under the grid and aligned to its first column: what each subagent is
# doing now. The claudeck mod writes ~/.claude/state/agents-<session>.tsv (type, description,
# activity, since) every few seconds; a file older than 30 s counts as no agents.
af="$HOME/.claude/state/agents-$f_sid.tsv"
now=$(printf '%(%s)T' -1); n=0; segs=()
clipw() { local s=$1; [ "${#s}" -gt "$2" ] && s="${s:0:$(( $2 - 1 ))}…"; printf '%s' "$s"; }
room=$(( $(vlen "$l1") - w1 - 3 )); [ "$room" -lt 20 ] && room=20
if [ -s "$af" ] && [ $(( now - $(stat -c %Y "$af" 2>/dev/null || echo 0) )) -lt 30 ]; then
  while IFS=$'\t' read -r atype adesc aact asince; do
    [ -z "$atype$adesc" ] && continue
    n=$((n + 1))
    [[ "$asince" =~ ^[0-9]{1,12}$ ]] || asince=$now
    el=$(( now - asince )); [ "$el" -lt 0 ] && el=0
    if [ "$el" -ge 60 ]; then et="$((el / 60))m"; else et="${el}s"; fi
    segs+=("${adesc:-$atype}"$'\t'"${aact}"$'\t'"${et}")
  done <"$af"
fi
alabel="${Y}$(printf '\U000f06a9')${R} ${B}agentes${R} ${Y}${n}${R}"
if [ "$n" -eq 0 ]; then
  printf '%s\n' "$alabel"
else
  shown=0
  for s in "${segs[@]}"; do
    [ "$shown" -ge 3 ] && break
    IFS=$'\t' read -r name act et <<<"$s"
    name=$(clipw "$name" $(( room * 2 / 5 ))); act=$(clipw "$act" $(( room - ${#name} - ${#et} - 8 )))
    first=""; [ "$shown" -eq 0 ] && first="$alabel"
    printf '%s%s%s◆%s %s%s%s%s · %s · %s%s\n' "$(pad "$first" "$w1")" "$sep" $'\033[38;2;217;119;87m' "$R" "$B" "$name" "$R" "$D" "$act" "$et" "$R"
    shown=$(( shown + 1 ))
  done
  [ "$n" -gt 3 ] && printf '%s%s%s+%d agentes más%s\n' "$(pad "" "$w1")" "$sep" "$D" $(( n - 3 )) "$R"
fi
