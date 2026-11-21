# Home Assistant builds this on the PC. The heavy part (Rust server and web
# pages) is built by GitHub Actions (.github/workflows/web-server.yml) and
# published as a release named after the add-on version; this only downloads it.
ARG BUILD_FROM
FROM debian:trixie-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

ARG BUILD_VERSION
RUN mkdir -p /opt/open-grind \
	&& curl -fsSL "https://github.com/guerramm886/open-grind/releases/download/web-v${BUILD_VERSION}/open-grind-web.tar.gz" \
		| tar -xz -C /opt/open-grind

ENV OG_DATA_DIR=/data \
	OG_WEB_DIR=/opt/open-grind/web \
	OG_PORT=8099
WORKDIR /opt/open-grind
CMD ["/opt/open-grind/open-grind-server"]
