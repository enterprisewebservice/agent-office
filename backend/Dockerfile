# Frontend builder
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ .
RUN npm run build

# Go builder: runs on native platform, cross-compiles to amd64
FROM --platform=$BUILDPLATFORM golang:1.22-bookworm AS builder
ARG TARGETARCH=amd64
WORKDIR /build
COPY go.mod ./
COPY backend/ backend/
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -o server ./backend/

# Final: amd64 image for OpenShift
FROM --platform=linux/amd64 gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=builder /build/server /app/server
COPY --from=builder /build/backend/templates/*.tmpl /app/templates/
COPY --from=frontend /frontend/dist /app/static/
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
