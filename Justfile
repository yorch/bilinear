# Docker operations for local development and production deployments.

set shell := ["bash", "-cu"]

infra := "docker compose -f docker-compose.infra.yml"
dev := "docker compose -f docker-compose.app.yml -f docker-compose.infra.yml"
prod := "docker compose -f docker-compose.prod.yml -f docker-compose.infra.yml"
prod_traefik := prod + " -f docker-compose.traefik.yml"
prod_watchtower := prod + " -f docker-compose.watchtower.yml"
prod_full := prod_traefik + " -f docker-compose.watchtower.yml"

# List available recipes.
default:
    @just --list

# Start backing services for native development (Postgres, Redis, Mailpit).
infra-up:
    {{ infra }} up -d

# Stop backing services for native development.
infra-down:
    {{ infra }} down

# Follow backing-service logs. Pass a service name to filter them.
infra-logs service="":
    {{ infra }} logs -f {{ service }}

# Show backing-service status.
infra-ps:
    {{ infra }} ps

# Build the local application image.
dev-build:
    {{ dev }} build

# Build and start the complete local Docker stack.
dev-up:
    {{ dev }} up -d --build

# Stop the complete local Docker stack.
dev-down:
    {{ dev }} down

# Follow local stack logs. Pass a service name to filter them.
dev-logs service="":
    {{ dev }} logs -f {{ service }}

# Show local stack status.
dev-ps:
    {{ dev }} ps

# Restart local application and infrastructure services.
dev-restart:
    {{ dev }} restart

# Pull the published production image and infrastructure images.
prod-pull:
    {{ prod }} pull

# Pull and start production with directly published host ports.
prod-up: prod-pull
    {{ prod }} up -d

# Stop the direct production stack.
prod-down:
    {{ prod }} down

# Follow production logs. Pass a service name to filter them.
prod-logs service="":
    {{ prod }} logs -f {{ service }}

# Show production stack status.
prod-ps:
    {{ prod }} ps

# Restart production services without changing images.
prod-restart:
    {{ prod }} restart

# Pull and start production behind the external Traefik network.
prod-traefik-up:
    {{ prod_traefik }} pull
    {{ prod_traefik }} up -d

# Stop the production stack running with the Traefik overlay.
prod-traefik-down:
    {{ prod_traefik }} down

# Pull and start production with opt-in Watchtower updates.
prod-watchtower-up:
    {{ prod_watchtower }} pull
    {{ prod_watchtower }} up -d

# Stop the production stack running with the Watchtower overlay.
prod-watchtower-down:
    {{ prod_watchtower }} down

# Pull and start production behind Traefik with Watchtower updates enabled.
prod-full-up:
    {{ prod_full }} pull
    {{ prod_full }} up -d

# Stop the production stack running with Traefik and Watchtower.
prod-full-down:
    {{ prod_full }} down
