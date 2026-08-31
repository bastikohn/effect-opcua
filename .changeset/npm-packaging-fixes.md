---
"@effect-opcua/client": patch
"@effect-opcua/codegen": patch
---

Improve npm packaging: widen the `effect` peer dependency from an exact pin to
`^4.0.0-beta.92`, publish `@effect-opcua/codegen`'s dependency on
`@effect-opcua/client` as a caret range, add npm keywords, ship `CHANGELOG.md`
in the tarball, drop sourcemaps that referenced unshipped sources, and keep the
npm `latest` dist-tag pointing at the newest prerelease until a stable release
exists.
