# Product Demo Video Skill: Publication Record

## Current state

The portable source remains local and uncommitted at `.agents/skills/product-demo-video/`. Validated copies are installed globally at `~/.codex/skills/product-demo-video/` and `~/.agents/skills/product-demo-video/`. The skill contains workflow instructions and ten style references; only the Kapture example is a built Remotion composition. For new code-driven projects with no chosen renderer, the skill recommends Remotion. Do not describe all ten styles as ready-made code templates.

## Public package

The separate public repository is [Otitodev/product-demo-video-skill](https://github.com/Otitodev/product-demo-video-skill), updated through local commit `53356e9`. It contains:

```text
README.md
LICENSE
skills/product-demo-video/SKILL.md
skills/product-demo-video/references/styles.md
```

The package uses the Kapture project's Apache 2.0 license. Kapture-specific code and rendered videos remain local. The README explains that the ten styles are creative directions, not ten ready-made code compositions.

## Release checks and results

1. Packaged skill passed `quick_validate.py`; its files match the portable source.
2. `npx skills add ./publication/product-demo-video-skill --list` found one skill locally. The public `Otitodev/product-demo-video-skill --list` check also found one skill.
3. Reviewed the four public files for local paths, tokens, bundled media, and product-specific claims.
4. Created and pushed the separate public repository. Kapture's main branch was not committed or pushed.
5. Installed from the public source with `npx skills add Otitodev/product-demo-video-skill --skill product-demo-video -g -y -a codex`; both global copies validate. The [skills.sh page](https://www.skills.sh/otitodev/product-demo-video-skill/product-demo-video) returned HTTP 200 after installation.

On this Windows machine, Git commands used the Schannel certificate backend because the default Git CA bundle failed validation. This was set per command, not globally.

## Future updates

Edit the local `.agents/skills/product-demo-video/` source, copy changed skill files into the separate `publication/product-demo-video-skill/` repository, validate there, then commit and push that repository. Users can run `npx skills update -g product-demo-video` to fetch the published revision. Keep the Kapture working tree and its video assets out of that release commit.

Sources: [skills.sh FAQ](https://www.skills.sh/docs/faq), [skills CLI documentation](https://www.skills.sh/docs/cli), [skills CLI README](https://github.com/vercel-labs/skills#readme).
