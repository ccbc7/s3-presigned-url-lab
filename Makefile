.PHONY: help up install ensure-env check-env build

FRONTEND_DIR := frontend
FRONTEND_ENV := $(FRONTEND_DIR)/.env
FRONTEND_ENV_EXAMPLE := $(FRONTEND_DIR)/.env.example
FRONTEND_NODE_MODULES := $(FRONTEND_DIR)/node_modules
FRONTEND_VITE_BIN := $(FRONTEND_NODE_MODULES)/.bin/vite

help:
	@echo "Usage:"
	@echo "  make up       Start the local frontend dev server"
	@echo "  make install  Install frontend dependencies"
	@echo "  make build    Build the frontend"

up: ensure-env install
	npm --prefix $(FRONTEND_DIR) run dev

install:
	@if [ ! -x "$(FRONTEND_VITE_BIN)" ]; then \
		echo "Installing frontend dependencies..."; \
		npm --prefix $(FRONTEND_DIR) ci; \
	fi

ensure-env:
	@if [ ! -f "$(FRONTEND_ENV)" ]; then \
		echo "Creating $(FRONTEND_ENV) from $(FRONTEND_ENV_EXAMPLE)..."; \
		cp "$(FRONTEND_ENV_EXAMPLE)" "$(FRONTEND_ENV)"; \
	fi
	@if grep -q "xxxxxxxxxx" "$(FRONTEND_ENV)"; then \
		echo "Warning: $(FRONTEND_ENV) still contains the placeholder API URL."; \
		echo "Set VITE_API_BASE_URL to the deployed ApiBaseUrl before testing uploads."; \
	fi

check-env:
	@if [ ! -f "$(FRONTEND_ENV)" ]; then \
		echo "Missing $(FRONTEND_ENV). Run make up once or copy $(FRONTEND_ENV_EXAMPLE)."; \
		exit 1; \
	fi
	@if grep -q "xxxxxxxxxx" "$(FRONTEND_ENV)"; then \
		echo "$(FRONTEND_ENV) still contains the placeholder API URL."; \
		echo "Set VITE_API_BASE_URL to the deployed ApiBaseUrl."; \
		exit 1; \
	fi

build: check-env install
	npm --prefix $(FRONTEND_DIR) run build
