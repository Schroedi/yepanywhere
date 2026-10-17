# The verified Alpine archive is the base; no mutable registry base tag.
FROM scratch
ADD alpine.tar.gz /
COPY apks/ /tmp/host-apks/
RUN /sbin/apk add --no-network /tmp/host-apks/*.apk && rm -rf /tmp/host-apks
ADD codex-package.tar.gz /opt/codex/
COPY claude/ /opt/claude/
COPY yep/ /opt/yep/
COPY runtime/ /opt/host/
RUN mkdir -p /home/host && chmod 755 /home && chown 10000:10000 /home/host \
    && chmod 755 /opt/claude/claude
ENV HOME=/home/host
USER 10000:10000
WORKDIR /home/host
CMD ["/usr/bin/node", "/opt/host/launch.mjs"]
