FROM golang:1.21-alpine

# Install Python for entrypoint script
RUN apk add --no-cache python3

# Set up non-root user (optional but recommended)
RUN adduser -D -u 1000 runner

# Copy entrypoint
COPY entrypoint.py /entrypoint.py
RUN chmod +x /entrypoint.py

# Create work directory
RUN mkdir -p /work && chown runner:runner /work

# No need to switch user here - sandbox handles that
WORKDIR /work

ENTRYPOINT ["python3", "/entrypoint.py"]
