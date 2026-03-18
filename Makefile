QUAY_HOST ?= quay-quay-quay-test.apps.salamander.aimlworkbench.com
QUAY_ORG ?= deanpeterson
VERSION ?= 0.1.0

SERVER_IMG = $(QUAY_HOST)/$(QUAY_ORG)/agent-office-server:$(VERSION)
UI_IMG = $(QUAY_HOST)/$(QUAY_ORG)/agent-office-ui:$(VERSION)
OPENCLAW_IMG ?= quay.io/aicatalyst/openclaw:latest

CONTAINER_TOOL ?= podman
TLS_VERIFY ?= false

.PHONY: all build push deploy undeploy

all: build push

# -- Build ------------------------------------------------------------------

build: build-server build-ui

build-server:
	$(CONTAINER_TOOL) build -t $(SERVER_IMG) -f backend/Dockerfile .

build-ui:
	cd frontend && npm install && npm run build
	$(CONTAINER_TOOL) build -t $(UI_IMG) -f frontend/Dockerfile frontend/

# -- Push -------------------------------------------------------------------

push: push-server push-ui

push-server:
	$(CONTAINER_TOOL) push --tls-verify=$(TLS_VERIFY) $(SERVER_IMG)

push-ui:
	$(CONTAINER_TOOL) push --tls-verify=$(TLS_VERIFY) $(UI_IMG)

# -- Deploy -----------------------------------------------------------------

deploy: deploy-crds deploy-rbac deploy-app

deploy-crds:
	oc apply -f manifests/crd/

deploy-rbac:
	oc apply -f manifests/rbac/agent-office-rbac.yaml

deploy-app:
	oc apply -f manifests/deploy/agent-office-deploy.yaml

deploy-samples:
	oc apply -f manifests/samples/

undeploy:
	oc delete -f manifests/deploy/agent-office-deploy.yaml --ignore-not-found
	oc delete -f manifests/rbac/agent-office-rbac.yaml --ignore-not-found
	oc delete -f manifests/crd/ --ignore-not-found

# -- Helpers ----------------------------------------------------------------

login:
	$(CONTAINER_TOOL) login --tls-verify=$(TLS_VERIFY) $(QUAY_HOST) \
		-u rhdh+pipeline \
		-p SOUNRT8D973BM2M4UYKTHZC0P17SCKD8DV95QVCXW4F4EAQUVR4HTSGIHZ8X3ZX5

status:
	@echo "-- CRDs --"
	@oc get crd | grep agentoffice.ai || echo "No CRDs found"
	@echo ""
	@echo "-- Deployments --"
	@oc get deployments -n agent-office 2>/dev/null || echo "Not deployed"
	@echo ""
	@echo "-- AgentWorkstations --"
	@oc get agentworkstations -A 2>/dev/null || echo "None"
