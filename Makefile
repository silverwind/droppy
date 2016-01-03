lint:
	eslint --ignore-pattern *.min.js server client *.js

publish:
	git push -u --tags origin master
	if git ls-remote --exit-code gogs &>/dev/null; then git push -u -f --tags gogs master; fi
	npm publish

docker:
	docker build --no-cache=true -t silverwind/droppy .

update:
	ncu -ua
	rm -rf node_modules
	npm install

deploy:
	if git ls-remote --exit-code demo &>/dev/null; then git push -f demo master; fi
	if git ls-remote --exit-code droppy &>/dev/null; then git push -f droppy master; fi

npm-patch:
	npm version patch

npm-minor:
	npm version minor

npm-major:
	npm version major

patch: lint npm-patch publish deploy
minor: lint npm-minor publish deploy
major: lint npm-major publish deploy

.PHONY: lint publish docker update deploy npm-patch npm-minor npm-major patch minor major
