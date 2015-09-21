lint:
	eslint --color --quiet --ignore-pattern *.min.js server client *.js

publish:
	git push -u --tags origin master
	npm publish

update:
	ncu -ua
	rm -rf node_modules
	npm install

deploy:
	if git ls-remote demo -ne 0 &>/dev/null; then git push -f demo master; fi
	if git ls-remote droppy -ne 0 &>/dev/null; then git push -f droppy master; fi

npm-patch:
	npm version patch

npm-minor:
	npm version minor

npm-major:
	npm version major

patch: lint npm-patch publish deploy
minor: lint npm-minor publish deploy
major: lint npm-major publish deploy

.PHONY: lint touch publish update deploy patch minor major npm-patch npm-minor npm-major
