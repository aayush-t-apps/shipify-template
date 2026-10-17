# A Shipify box as a container (ADR 0056, docs/box-setup.md): the same machine box/setup.sh makes
# on a Pi, set up once, at a release. Each release builds it for x64 and arm64 (ci.yml) and
# publishes it as ghcr.io/<owner>/shipify-box. It holds no key and no one's data: registering
# (`register`) puts this box's runners in the volume on /home/shipify, and nothing else is kept.
#   docker build -f box/Dockerfile .      (box/prep.tsv first: pnpm exec tsx scripts/box-prep.ts)
FROM ubuntu:24.04

COPY box/setup.sh box/here.sh box/container.sh box/prep.tsv /opt/shipify/
# The build's GitHub token, when it gives one (`--secret id=gh`): only for setup.sh's one call to
# GitHub's API, never in the image.
RUN --mount=type=secret,id=gh,required=false \
  SHIPIFY_IMAGE=1 bash /opt/shipify/setup.sh "" /opt/shipify/prep.tsv \
  && chmod 0755 /opt/shipify/here.sh /opt/shipify/container.sh

# The runners' registration and the box's own files: kept across new images.
VOLUME /home/shipify

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/shipify/container.sh"]
CMD ["run"]
