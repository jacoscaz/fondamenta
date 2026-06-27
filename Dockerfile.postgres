# Multi-stage build for TimescaleDB with pg_textsearch (compiled from source)
# pgvector is already included in the timescaledb image since v2.18-pg17.
#
# pg_textsearch pre-compiled binaries are glibc-linked and won't work on Alpine (musl),
# so we compile from source. The source build is fast and keeps us on musl.

FROM timescale/timescaledb:2.28.1-pg17 AS base

FROM base AS builder

RUN apk update
RUN apk add --no-cache build-base git clang llvm
RUN git clone --branch v1.3.1 --depth 1 https://github.com/timescale/pg_textsearch.git /tmp/pg_textsearch
RUN cd /tmp/pg_textsearch && make && make install

FROM base
# Copy compiled pg_textsearch extension from builder
COPY --from=builder /usr/local/lib/postgresql/pg_textsearch.so /usr/local/lib/postgresql/
COPY --from=builder /usr/local/share/postgresql/extension/pg_textsearch* /usr/local/share/postgresql/extension/

# Add pg_textsearch to shared_preload_libraries in config template
# (pgvector does not require preloading)
RUN sed -r -i \
    "s/(shared_preload_libraries\s*=\s*'timescaledb)/\1,pg_textsearch/" \
    /usr/local/share/postgresql/postgresql.conf.sample
