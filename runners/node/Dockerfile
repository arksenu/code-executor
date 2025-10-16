FROM node:20-slim
RUN groupadd -r sandbox -g 10001 && useradd -r -g sandbox -u 10001 sandbox
WORKDIR /home/sandbox
COPY entrypoint.sh /usr/local/bin/runner
RUN chmod +x /usr/local/bin/runner
USER sandbox
ENTRYPOINT ["/usr/local/bin/runner"]
