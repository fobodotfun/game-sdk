# Releasing

One package is published: `@fobo/game-sdk` (npm org `fobo`). Nothing is published from a laptop by accident: a release happens when a version tag is pushed **and** someone approves the run.

## Before a release

1. Set the version in `packages/game-sdk/package.json` (semver; see [docs/versioning.md](docs/versioning.md)), and the same version in every `https://unpkg.com/@fobo/game-sdk@<version>/` address in the README, `llms.txt` and the examples. `pnpm release:check` fails when one is left behind.
2. Add the release to `packages/game-sdk/CHANGELOG.md`, written for game developers.
3. Run both and read the output:

    ```sh
    pnpm check           # format, lint, build, types, unit tests, browser tests
    pnpm release:check   # packs the package and inspects the tarball. Publishes nothing
    ```

    `release:check` fails when: the name is not `@fobo/game-sdk`; there is a runtime dependency or a peer that is not optional; a file is missing or one that should not ship is inside (source, tests, maps, env files, local paths, keys); a page entry can reach the code that sends the secret key; the core imports a wallet library; a subpath does not resolve or load; a connector loads without its wallet library, or fails without naming it; `publint` or `attw` complain; `pnpm audit` reports an advisory that is not on the accepted list in `scripts/release-check.ts`. It prints file sizes too.

4. Check the docs: no "bundle", "bundler" or "guaranteed"; no person's name (author: "The fobo.fun team", contact: @fobodev).
5. Commit, open a pull request, merge.

## Publishing

```sh
git tag v0.1.0        # must equal the version in package.json
git push origin v0.1.0
```

That starts `.github/workflows/release.yml`, which:

1. waits in the GitHub environment `npm` until a required reviewer approves it,
2. installs with `pnpm install --frozen-lockfile` on Node 24 with the latest npm,
3. runs `pnpm check` and `pnpm release:check`,
4. stops unless the package is named exactly `@fobo/game-sdk` and the tag equals `v<version>`,
5. packs with pnpm and publishes that tarball with `npm publish --access public`.

## One-time setup (owner)

- **GitHub**: Settings → Environments → new environment `npm` → add required reviewers. Without reviewers the run does not wait.
- **npm, first release**: a package must exist before trusted publishing can be switched on for it. Create a granular npm token that may publish to the `fobo` org, save it as the secret `NPM_TOKEN` **on the `npm` environment** (not the repo), and release. The workflow uses the token only when that secret is set.
- **npm, after the first release**: on npmjs.com open the package → Settings → Trusted publisher → GitHub Actions, with repository `fobodotfun/fobo-game-sdk`, workflow `release.yml`, environment `npm`. Then delete the `NPM_TOKEN` secret and revoke the token. From then on the workflow publishes with a short-lived identity from GitHub (OIDC) and no token exists anywhere.
- **Provenance** (npm's proof of which repo and run built the package) is added only when the repository is public: npm cannot make it for a private one. Nothing to set; the workflow checks.

## Links while the repo is private

- The README shown on npmjs.com only loads images and links with a full `https://` address, and nobody outside can open this repository. So the logo and every guide link in `packages/game-sdk/README.md` point at the published package itself: `https://unpkg.com/@fobo/game-sdk@<version>/...`. They start working the moment that version is published.
- The guides (`docs/*.md`) and the logo (`assets/logo.png`) ship in the npm package. `docs/assets/` (brand files) does not.
- The root `README.md`, `llms.txt` and `docs` are links to the ones in `packages/game-sdk/`, so there is one copy of each.
- `pnpm release:check` reads every link in the packed README, guides and `llms.txt`: none may point at the private repository, a package link must name this version and a file that is in the package, and the guides' own links must stay inside the package.

## After a release

- `npm view @fobo/game-sdk` shows the new version.
- Load `https://unpkg.com/@fobo/game-sdk@<version>/dist/browser/game-sdk.js` once: the README's first example depends on it.

## If something is wrong

A published version cannot be replaced. Fix it, release the next patch version, and mark the bad one: `npm deprecate @fobo/game-sdk@0.1.0 "use 0.1.1"`.
