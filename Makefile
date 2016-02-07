lint:
	eslint --ignore-pattern *.min.js server client *.js

build:
	node droppy.js build

publish:
	if git ls-remote --exit-code origin &>/dev/null; then git push -u -f --tags origin master; fi
	if git ls-remote --exit-code gogs &>/dev/null; then git push -u -f --tags gogs master; fi
	npm publish

docker:
	docker-machine start default || true
	eval "$$(docker-machine env default)" || true
	docker rm -f "$$(docker ps -a -f="image=silverwind/droppy" -q)" 2>/dev/null || true
	docker rmi "$$(docker images -qa silverwind/droppy)" 2>/dev/null || true
	docker build --no-cache=true -t silverwind/droppy .
	docker push silverwind/droppy

update:
	ncu -ua
	rm -rf node_modules
	npm install

	# ensure cache is rebuilt
	touch client/client.js

deploy:
	if git ls-remote --exit-code demo &>/dev/null; then git push -f demo master; fi
	if git ls-remote --exit-code droppy &>/dev/null; then git push -f droppy master; fi

npm-patch:
	npm version patch

npm-minor:
	npm version minor

npm-major:
	npm version major

patch: lint npm-patch build docker publish deploy
minor: lint npm-minor build docker publish deploy
major: lint npm-major build docker publish deploy

.PHONY: lint publish docker update deploy npm-patch npm-minor npm-major patch minor major
