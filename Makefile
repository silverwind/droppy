# os deps: node yarn git jq docker

JQUERY_FLAGS:=-ajax,-css,-deprecated,-effects,-event/alias,-event/focusin,-event/trigger,-wrap,-core/ready,-deferred,-exports/amd,-sizzle,-offset,-dimensions,-serialize,-queue,-callbacks,-event/support,-event/ajax,-attributes/prop,-attributes/val,-attributes/attr,-attributes/support,-manipulation/support,-manipulation/var/rcheckableType

dev:
	node droppy.js start --dev

run:
	node droppy.js start

lint:
	yarn -s run eslint server client/client.js droppy.js
	yarn -s run stylelint client/*.css

test: lint

build:
	@touch client/client.js
	node droppy.js build

publish:
	if git ls-remote --exit-code origin &>/dev/null; then git push -u -f --tags origin master; fi
	if git ls-remote --exit-code git &>/dev/null; then git push -u -f --tags git master; fi
	npm publish

docker:
	@rm -rf node_modules
	yarn -s --production --pure-lockfile
	$(eval IMAGE := silverwind/droppy)
	$(eval VERSION := $(shell cat package.json | jq -r .version))
	$(eval ARCHS := "linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6")
	@docker rm -f "$$(docker ps -a -f='ancestor=$(IMAGE)' -q)" 2>/dev/null || true
	@docker rmi "$$(docker images -qa $(IMAGE))" 2>/dev/null || true
	@docker buildx rm builder &>/dev/null || true
	@docker buildx create --name builder --use &>/dev/null || true
	docker buildx build --pull --push --platform $(ARCHS) -t $(IMAGE):$(VERSION) .
	docker buildx build --pull --push --platform $(ARCHS) -t $(IMAGE):latest .
	@docker buildx rm builder  &>/dev/null || true
	yarn

deps:
	rm -rf node_modules
	yarn

update:
	yarn -s run updates -u
	@$(MAKE) --no-print-directory deps
	@touch client/client.js

jquery:
	rm -rf /tmp/jquery
	git clone --depth 1 https://github.com/jquery/jquery /tmp/jquery
	cd /tmp/jquery; yarn; yarn -s run grunt; yarn -s run grunt custom:$(JQUERY_FLAGS); yarn -s run grunt remove_map_comment
	cat /tmp/jquery/dist/jquery.min.js | perl -pe 's|"3\..+?"|"3"|' > $(CURDIR)/client/jquery-custom.min.js
	rm -rf /tmp/jquery

ver-patch:
	yarn -s run versions -C patch

ver-minor:
	yarn -s run versions -C minor

ver-major:
	yarn -s run versions -C major

patch: test build ver-patch docker publish
minor: test build ver-minor docker publish
major: test build ver-major docker publish

.PHONY: dev run lint test publish docker deps update jquery version-patch version-minor version-major patch minor major
