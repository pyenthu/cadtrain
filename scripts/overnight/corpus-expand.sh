#!/usr/bin/env bash
# Overnight corpus expansion (#49, loop B) — claude authors small .app manifests for new archetypes;
# each is validated (parses + has docType + a panels[] array) and STAGED to runs/corpus-candidates/
# for your morning review. NEVER written to the shared volume — you promote the good ones (the
# /api/app/promote {atomic:true} flow decomposes them into per-component goldens). Grows the RAG DB.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"  # detached shells may lack claude/bun on PATH
. "$(dirname "$0")/limit-guard.sh"   # circuit-breaker: a rate-limited `claude --print` returns
                                     # refusal prose instantly — without this the loop spins on it
RUNDIR="scripts/overnight/runs"; CAND="$RUNDIR/corpus-candidates"; mkdir -p "$CAND"
LOG="$RUNDIR/corpus.log"; HOURS="${CORPUS_HOURS:-7}"
log(){ echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
ARCH=(
  "a contact form with name, email and message fields, docType form"
  "a kanban board with three columns of task cards, docType board"
  "a settings page with labelled toggles and a save button, docType settings"
  "an operations dashboard with three KPI stat tiles, a line chart and a data table, docType dashboard"
  "a product catalog with a searchable data table of products, docType catalog"
  "an invoice with a line-item data table and a totals row, docType invoice"
  "a user profile page with a heading, stats and an activity data table, docType profile"
  "a survey form with several questions and a submit button, docType form"
)
END=$(( $(date +%s) + HOURS*3600 )); i=0
while [ "$(date +%s)" -lt "$END" ]; do
  a="${ARCH[$(( i % ${#ARCH[@]} ))]}"
  raw=$({ echo "Output ONLY a minimal cadtrain .app JSON object — no prose, no markdown fences — for: $a"; echo 'Shape: {"app":slug,"title":str,"docType":str,"theme"?:{mode,accent},"vars"?:{name:[rows]},"structures"?:{name:[{name,type}]},"panels":[{"id":slug,"kind":str,"props"?:{},"source"?:{verb,args},"children"?:[]}]}. Use real component kinds (heading,text,statgrid,stat,chart,datatable,list,form,tabs). Keep it small and STRICTLY valid JSON.'; } | claude --print 2>/dev/null)
  # Blocked → sleep it out and RETRY THE SAME ARCHETYPE. Without this the refusal prose reaches
  # JSON.parse and logs as "SKIP JSON Parse error: Unexpected identifier \"You\"" — a real-looking
  # failure that hid a dead model for 7 hours (4,017 of 4,138 attempts, 2026-08-02).
  if guard_blocked "$raw"; then guard_backoff "$raw" || break; continue; fi
  guard_ok; i=$((i+1))
  printf '%s' "$raw" | sed 's/^```json//; s/^```//; s/```$//' > "$CAND/.tmp.json"
  verdict=$(bun -e '
    const fs=require("fs");
    try{
      const app=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      if(!app.docType || !Array.isArray(app.panels) || !app.panels.length) { console.log("SKIP bad-shape"); process.exit(0); }
      const base=String(app.app||app.title||"app").replace(/[^a-z0-9_-]+/gi,"_").toLowerCase().slice(0,40);
      const out=process.argv[2]+"/"+base+"-"+process.argv[3];
      fs.writeFileSync(out+".app.json", JSON.stringify(app,null,2)+"\n");
      console.log("OK "+app.panels.length+"p "+app.docType+" -> "+out+".app.json");
    }catch(e){ console.log("SKIP "+String(e&&e.message||e).slice(0,60)); }
  ' "$CAND/.tmp.json" "$CAND" "$(date +%s)" 2>&1)
  log "$a => $verdict"
done
log "DONE ($i attempts)"
