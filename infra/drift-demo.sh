#!/usr/bin/env bash
# Week 6: provision the staging container, cause drift, observe it, tear down.
# Run from anywhere:   bash infra/drift-demo.sh
# Needs: Terraform and Docker (Docker Desktop running). Output is also saved to infra/terraform-run.log
set -u
cd "$(dirname "$0")"
LOG="terraform-run.log"
: > "$LOG"

# Point Terraform's Docker provider at whatever socket the docker CLI uses (works for Docker Desktop on macOS).
if command -v docker >/dev/null 2>&1; then
  DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"
  [ -n "$DOCKER_HOST" ] && export DOCKER_HOST
fi

run() { printf '\n\033[1m$ %s\033[0m\n' "$*"; "$@"; }
pause() { printf '\n\033[1;33m>>> %s\033[0m' "$1"; read -r _; }

{
  run terraform -version
  run docker --version
} 2>&1 | tee -a "$LOG"

echo; echo "=== STEP 3: init, plan, apply ===" | tee -a "$LOG"
{
  run terraform init -input=false
  run terraform plan
  run terraform apply -auto-approve
  run docker ps --filter name=scm-staging
  run curl -s -o /dev/null -w 'HTTP %{http_code} from http://localhost:8080\n' http://localhost:8080
} 2>&1 | tee -a "$LOG"

pause "SCREENSHOT NOW (the 'Apply complete!' lines and docker ps above). Then press Enter to cause drift..."

echo; echo "=== STEP 4: cause drift outside Terraform ===" | tee -a "$LOG"
{
  run docker stop scm-staging
  run docker ps -a --filter name=scm-staging
  run terraform plan
} 2>&1 | tee -a "$LOG"

pause "Read what terraform plan reported above (also in infra/terraform-run.log). Press Enter to destroy..."

echo; echo "=== STEP 5: tear down ===" | tee -a "$LOG"
{
  run terraform destroy -auto-approve
  run docker ps -a --filter name=scm-staging
} 2>&1 | tee -a "$LOG"

printf '\nDone. Full output saved to infra/%s\n' "$LOG"
