# NerdCard multi-agent orchestration via pi-vs-cc coms
# Prerequisites: just, pi, bun (all installed). pi-vs-cc cloned to ./pi-vs-cc.

set dotenv-load := true

# Coms: peer-to-peer, same-machine messaging between Pi agents.
# The coms extension reads --cname for its agent registry (pi owns --name).
# Pass both so the session name and coms name stay in sync.
local-coms *args:
    cd pi-vs-cc && pi -e extensions/coms.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts {{args}}

# Launch the emergency problem fixer
# Defaults to Agnès 2.0 Flash. Override provider/model via extra args, e.g.:
#   just fixer --provider mistral --model mistral-large-latest
fixer *args:
    just local-coms --name problem-fixer --cname problem-fixer --color FF3333 --provider agnes --model agnes-2.0-flash {{args}}

# Launch a standard worker
# Defaults to Agnès 2.0 Flash. Override provider/model via extra args.
worker *args:
    just local-coms --name worker --cname worker --color 36F9F6 --provider agnes --model agnes-2.0-flash {{args}}

# Launch the Pi-Pi meta-agent (builds Pi agents with parallel experts)
pi-pi *args:
    cd pi-vs-cc && pi -e extensions/pi-pi.ts -e extensions/theme-cycler.ts {{args}}
