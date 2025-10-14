.PHONY: up down test build

up:
 docker compose up -d
 docker compose --profile runners up -d

down:
 docker compose down --remove-orphans
 docker compose --profile runners down --remove-orphans || true

test:
 cd api && npm install && npm test
