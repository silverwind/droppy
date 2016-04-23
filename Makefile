JQUERY_FLAGS=-ajax,-css/showHide,-deprecated,-effects,-event/alias,-event/focusin,-event/trigger,-wrap,-core/ready,-deferred,-exports/amd,-sizzle,-offset,-dimensions,-css,-serialize,-queue,-callbacks,-event/support,-event/ajax

lint:
	eslint --ignore-pattern *.min.js server client *.js
	stylelint client/*.css

build:
	touch client/client.js
	node droppy.js build

publish:
	if git ls-remote --exit-code origin &>/dev/null; then git push -u -f --tags origin master; fi
	if git ls-remote --exit-code gogs &>/dev/null; then git push -u -f --tags gogs master; fi
	npm publish

docker:
	docker rm -f "$$(docker ps -a -f="image=silverwind/droppy" -q)" 2>/dev/null || true
	docker rmi "$$(docker images -qa silverwind/droppy)" 2>/dev/null || true
	docker build --no-cache=true -t silverwind/droppy .
	docker push silverwind/droppy

update:
	ncu --packageFile package.json -ua
	rm -rf node_modules
	npm install
	touch client/client.js

deploy:
	git commit --allow-empty --allow-empty-message -m ""
	if git ls-remote --exit-code demo &>/dev/null; then git push -f demo master; fi
	if git ls-remote --exit-code droppy &>/dev/null; then git push -f droppy master; fi
	git reset --hard HEAD~1

jquery:
	git clone --depth 1 https://github.com/jquery/jquery /tmp/jquery
	cd /tmp/jquery; npm run build; grunt custom:$(JQUERY_FLAGS); grunt remove_map_comment
	cat /tmp/jquery/dist/jquery.min.js | perl -pe 's|"3\..+?"|"3"|' > $(CURDIR)/client/jquery-custom.min.js
	rm -rf /tmp/jquery

npm-patch:
	npm version patch

npm-minor:
	npm version minor

npm-major:
	npm version major

patch: lint npm-patch build docker deploy publish
minor: lint npm-minor build docker deploy publish
major: lint npm-major build docker deploy publish

.PHONY: lint publish docker update deploy jquery npm-patch npm-minor npm-major patch minor major
