.PHONY: install build test clean

## Install dependencies.
## ignore-scripts is set in .npmrc; esbuild needs its postinstall to download
## the platform binary, so we rebuild it explicitly afterwards.
install:
	npm install
	npm rebuild esbuild

## Build the TypeScript source into dist/.
build: install
	npm run build

## Run all Vitest test suites.
test:
	npm test

## Remove generated artefacts.
clean:
	rm -rf dist node_modules
