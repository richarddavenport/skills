#!/usr/bin/env bash
# Downloads ClickUp's API specs over the copies in spec/. When they changed, writes a
# pull request body saying what changed to the file named by $1. The last line printed
# is changed=true or changed=false, ready for $GITHUB_OUTPUT.
set -euo pipefail
cd "$(dirname "$0")/.."

body="${1:?Usage: tools/spec-watch.sh <pr-body-file>}"
before="$(mktemp -d)"
cp spec/* "$before/"

curl -fsSL -o spec/clickup-api-v2-reference.json https://developer.clickup.com/openapi/clickup-api-v2-reference.json
curl -fsSL -o spec/ClickUp_PUBLIC_API_V3.yaml https://developer.clickup.com/openapi/ClickUp_PUBLIC_API_V3.yaml

if git diff --quiet -- spec; then
  echo "changed=false"
  exit 0
fi

{
  echo "ClickUp's published API specs changed. This updates the copies in \`spec/\`."
  echo
  echo "## Endpoints"
  echo
  node tools/endpoints.mjs diff "$before" spec
  echo
  echo "## Coverage"
  echo
  echo '```'
  node tools/endpoints.mjs coverage
  echo '```'
  echo
  echo "Add or change commands in \`cu.js\` for anything above, then run \`node tools/endpoints.mjs docs --write\`."
  echo "CI doesn't run on a pull request the workflow opens, so run the checks in the README before merging."
} > "$body"
echo "changed=true"
