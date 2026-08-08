
# Fondamenta: PostgreSQL / TimescaleDB via Docker

This directory contains the assets required to build and run a Docker container
for Fondamenta's PostgreSQL / TimescaleDB database.

The Docker image built from this directory is based on the official TimescaleDB
Docker image and extends it with the `pg_textsearch` extension.

The result is an image the includes the extensions `timescaledb`, `pg_vector`,
and `pg_textsearch`.

## Howto

```sh
# Copy example.env to .env
cp .env-example .env

# Edit .env to set your desired configuration
vim .env

# Build and start the PostgreSQL container
docker compose up --build -d postgres
```

Use `docker-compose.override.yml` to extend the default `docker-compose.yml`
file with custom configuration for your local environment, such as exposing 
the database port to your host machine:

```yaml
services:
  postgres:
    ports:
      - 127.0.0.1:5432:5432
```

Both `.env` and any file matching the `docker-compose.*.yml` pattern will be
ignored by git. For more information, see [Docker Compose overrides].

[Docker Compose overrides]: https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/
